// POST /api/recommend — ranked crop recommendations for a farmer's plot.
// Pipeline: getSoilProfile (shared lib, cached — never fetches our own route)
// → farmer SHC overrides → Gemini with a responseSchema grounded on the
// embedded ICAR/SAU agronomy table + the ACTUAL soil/weather numbers.
// Fallback: deterministic scoreCrops() result with source "cached".

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { generateContentResilient } from "@/lib/genai";
import { DISTRICTS } from "@/lib/districts";
import { LANG_NAME_FOR_PROMPT } from "@/lib/i18n-full";
import { AGRONOMY_TABLE, scoreCrops, type WaterSource } from "@/lib/agronomy";
import { getSoilProfile, type SoilProfile } from "@/lib/soil-profile";
import type { CropRecommendation, RecommendResponse, SoilSnapshot } from "@/lib/types";

type RecommendBody = {
  lat?: number;
  lon?: number;
  district?: string;
  state?: string;
  season?: string;
  waterSource?: WaterSource;
  landAcres?: number;
  shc?: { ph?: number; n?: number; p?: number; k?: number };
  lang?: string;
};

const WATER_SOURCES: WaterSource[] = ["rainfed", "canal", "borewell", "drip"];

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    recommendations: {
      type: Type.ARRAY,
      description: "4-5 ranked crop recommendations, best first",
      items: {
        type: Type.OBJECT,
        properties: {
          crop: { type: Type.STRING, description: "Crop name in English, exactly as in the agronomy table" },
          localName: { type: Type.STRING, description: "Crop name in the requested language, native script" },
          suitabilityScore: { type: Type.INTEGER, description: "Honest 0-100 suitability for THIS plot" },
          season: { type: Type.STRING, description: "Kharif | Rabi | Zaid" },
          waterNeed: { type: Type.STRING, enum: ["low", "medium", "high"] },
          durationDays: { type: Type.STRING, description: 'e.g. "110-130"' },
          expectedYield: { type: Type.STRING, description: 'e.g. "8-10 quintal/acre"' },
          marketOutlook: { type: Type.STRING, description: "One line grounded in typical mandi/MSP trends" },
          why: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "3-4 reasons; EVERY bullet must quote the actual numbers (pH, clay %, mm rain, °C)",
          },
          risks: { type: Type.ARRAY, items: { type: Type.STRING }, description: "2-3 concrete risks" },
          inputs: {
            type: Type.OBJECT,
            properties: {
              seed: { type: Type.STRING },
              fertilizer: { type: Type.STRING },
              irrigation: { type: Type.STRING },
            },
            required: ["seed", "fertilizer", "irrigation"],
          },
        },
        required: [
          "crop", "localName", "suitabilityScore", "season", "waterNeed", "durationDays",
          "expectedYield", "marketOutlook", "why", "risks", "inputs",
        ],
      },
    },
    summaryVoice: {
      type: Type.STRING,
      description: "~60-word spoken-style summary in the requested language — speakable over a phone call, no markdown",
    },
  },
  required: ["recommendations", "summaryVoice"],
};

export async function POST(req: NextRequest) {
  let body: RecommendBody = {};
  try {
    body = (await req.json()) as RecommendBody;
  } catch {
    /* fall through to registry defaults */
  }

  const registry =
    (body.district && DISTRICTS.find((d) => d.district.toLowerCase() === body.district!.toLowerCase())) ||
    DISTRICTS[0];
  const lat = Number.isFinite(body.lat) ? (body.lat as number) : registry.lat;
  const lon = Number.isFinite(body.lon) ? (body.lon as number) : registry.lon;
  const state = body.state || registry.state;
  const district = body.district || registry.district;
  const season = body.season || "Kharif";
  const waterSource: WaterSource = WATER_SOURCES.includes(body.waterSource as WaterSource)
    ? (body.waterSource as WaterSource)
    : "rainfed";
  const landAcres = Number.isFinite(body.landAcres) && (body.landAcres as number) > 0 ? (body.landAcres as number) : 2;
  const lang = body.lang || "hi";
  const shc = body.shc;

  const profile = await getSoilProfile(lat, lon, state, district);

  // Farmer-provided Soil Health Card values OVERRIDE satellite estimates.
  // When overridden, soil.source = "shc-manual" and soil.nitrogen carries the
  // farmer's card value in kg/ha available N (the SHC unit) — the client
  // labels units by source.
  const soil: SoilSnapshot = { ...profile.soil };
  const hasShc = shc && (shc.ph != null || shc.n != null || shc.p != null || shc.k != null);
  if (hasShc) {
    soil.source = "shc-manual";
    if (shc.ph != null && Number.isFinite(shc.ph)) soil.ph = shc.ph;
    if (shc.n != null && Number.isFinite(shc.n)) soil.nitrogen = shc.n;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(fallbackResponse(profile, soil, season, waterSource));
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const langName = LANG_NAME_FOR_PROMPT[lang] || LANG_NAME_FOR_PROMPT.hi;
    const result = await generateContentResilient(ai, {
      contents: buildPrompt(profile, soil, {
        district, state, season, waterSource, landAcres, langName, shc: hasShc ? shc : undefined,
      }),
      config: {
        systemInstruction: `[CHARACTER]
You are KisanVaani's crop-planning agronomist \u2014 a senior ICAR/State Agricultural University Package-of-Practices expert with 25+ years of experience advising Indian smallholder farmers (1-5 acre holdings). You have deep knowledge of crop-soil-climate interactions across India's 15 agro-climatic zones. You understand Indian soil classification (Alluvial, Black Cotton/Regur, Red, Laterite), WRB correlations, and how pH, texture, organic carbon, and nutrient availability affect crop suitability. You also understand Indian market dynamics \u2014 MSP trends, mandi demand patterns, and regional crop economics. You are honest, evidence-driven, and never inflate scores to please.

[REQUEST]
Using the measured soil data, weather forecast, and the ICAR/SAU agronomy table provided below, rank the 4-5 best crops for this specific farmer's plot for the specified season. You must:
1. Score each crop's suitability (0-100) for THIS exact plot based on the actual soil properties, weather forecast, and water source \u2014 not generic national averages.
2. Provide 3-4 specific reasons ("why" bullets) for each crop \u2014 EVERY bullet MUST cite the actual measured numbers you were given (e.g., "pH 7.4 is within the ideal 6.5-8.0 range for soybean", "42% clay content suits cotton's moisture retention needs").
3. List 2-3 concrete risks for each crop on this specific plot.
4. Provide input estimates (seed, fertilizer, irrigation) scaled to the farmer's actual acreage.
5. Generate a summaryVoice in the requested language for reading aloud over a phone call.

[EXAMPLES]
Good "why" bullet: "Your soil pH of 7.4 is ideal for soybean (optimal range 6.0-7.5), and the 42% clay content provides excellent moisture retention during the Kharif dry spells."
Bad "why" bullet: "Soybean grows well in Indian soils." (no data citation, too generic)

Good suitabilityScore pattern: Top crop 88, second 79, third 71, fourth 62, fifth 54 (meaningful differentiation).
Bad suitabilityScore pattern: 85, 84, 83, 82, 81 (no meaningful differentiation \u2014 useless for the farmer).

[ADJUSTMENTS]
- Recommend ONLY crops from the provided agronomy table. Do NOT invent crops or use data outside the table.
- If farmer-entered Soil Health Card (SHC) values are present, they override satellite estimates \u2014 treat SHC values as AUTHORITATIVE.
- If soil data source is "cached" (regional averages, not measured), phrase "why" bullets as "typical for your soil type" rather than "your measured pH is..." and recommend the farmer get a Soil Health Card test.
- Scores MUST differ meaningfully between ranks (at least 5-8 points apart). Do not cluster scores.
- Scale input quantities (seed, fertilizer, irrigation) to sensible per-acre norms for the farmer's stated acreage.
- The summaryVoice is read aloud to a potentially illiterate farmer over a phone call \u2014 it must be warm, conversational, 60 words, no markdown, no lists, no symbols.
- Keep advice practical and low-cost for a smallholder. Do not recommend expensive drip irrigation to a rainfed farmer.

[TYPE OF OUTPUT]
Return a JSON object conforming to the provided schema with: recommendations (array of 4-5 crops ranked by suitabilityScore descending) and summaryVoice (spoken-style summary in the requested language).

[EVALUATE]
Before finalizing, verify:
- Does every "why" bullet cite specific numbers from the provided soil/weather data?
- Are suitabilityScores honest and differentiated (not clustered)?
- Does each crop actually appear in the provided agronomy table?
- Are the recommended crops appropriate for the stated season (Kharif/Rabi/Zaid)?
- Is the water source constraint respected (no high-water crops for rainfed farmers)?
- Is the summaryVoice truly speakable \u2014 no markdown, no lists, no technical jargon?
- Would an ICAR scientist reviewing these recommendations approve them as sound?`,
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
        temperature: 0.35,
      },
    });
    const parsed = JSON.parse(result.text || "{}") as unknown;
    const clean = sanitize(parsed);
    if (!clean) throw new Error("bad recommendation shape");
    const response: RecommendResponse = {
      soil,
      weather: profile.weather,
      recommendations: clean.recommendations,
      summaryVoice: clean.summaryVoice,
      source: "gemini",
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error("recommend gemini error:", err instanceof Error ? err.message : err);
    return NextResponse.json(fallbackResponse(profile, soil, season, waterSource));
  }
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function buildPrompt(
  profile: SoilProfile,
  soil: SoilSnapshot,
  ctx: {
    district: string;
    state: string;
    season: string;
    waterSource: WaterSource;
    landAcres: number;
    langName: string;
    shc?: { ph?: number; n?: number; p?: number; k?: number };
  },
): string {
  const soilLines = [
    `pH: ${soil.ph ?? "unknown"}`,
    `clay: ${soil.clayPct ?? "unknown"}%  sand: ${soil.sandPct ?? "unknown"}%  texture: ${soil.texture ?? "unknown"}`,
    `soil organic carbon: ${soil.soc ?? "unknown"} g/kg`,
    soil.source === "shc-manual"
      ? `nitrogen: ${soil.nitrogen ?? "unknown"} kg/ha available N (farmer's Soil Health Card — AUTHORITATIVE)`
      : `total nitrogen: ${soil.nitrogen ?? "unknown"} g/kg (SoilGrids satellite estimate)`,
    profile.extras.cecCmolKg != null ? `CEC: ${profile.extras.cecCmolKg} cmol/kg` : null,
    profile.soilType
      ? `Indian soil type: ${profile.soilType.en} / ${profile.soilType.hi}${profile.soilType.wrbClass ? ` (WRB: ${profile.soilType.wrbClass})` : ""}`
      : null,
    `data source: ${soil.source}`,
  ].filter(Boolean);

  const shcLines = ctx.shc
    ? [
        "FARMER'S SOIL HEALTH CARD (manual entry — overrides satellite):",
        ctx.shc.ph != null ? `  pH ${ctx.shc.ph}` : null,
        ctx.shc.n != null ? `  N ${ctx.shc.n} kg/ha` : null,
        ctx.shc.p != null ? `  P ${ctx.shc.p} kg/ha` : null,
        ctx.shc.k != null ? `  K ${ctx.shc.k} kg/ha` : null,
      ].filter(Boolean)
    : [];

  const w = profile.weather;
  // Honesty: only call it "measured" when SoilGrids/SHC actually returned data.
  // On the cached path the numbers are regional soil-type averages, and Gemini
  // must hedge accordingly rather than quoting them as this plot's measurements.
  const soilHeader =
    soil.source === "cached"
      ? "ESTIMATED SOIL (regional soil-type averages — the live satellite grid was unavailable, so treat these as approximate for the district, not measured for this exact plot; phrase 'why' bullets as typical-for-your-soil, and recommend a Soil Health Card test):"
      : "MEASURED SOIL (ISRIC SoilGrids 250m satellite grid unless marked otherwise):";
  return [
    `FARMER'S PLOT — ${ctx.district}, ${ctx.state} | season: ${ctx.season} | water source: ${ctx.waterSource} | land: ${ctx.landAcres} acres`,
    "",
    soilHeader,
    ...soilLines.map((l) => `  ${l}`),
    ...(shcLines.length ? ["", ...shcLines] : []),
    ...(profile.shcNote ? ["", `DISTRICT SOIL HEALTH CARD RECORD: ${profile.shcNote}`] : []),
    "",
    "WEATHER (Open-Meteo 16-day forecast for this exact location):",
    `  total rain next 16 days: ${w.next16dRainMm ?? "unknown"} mm (next 7 days: ${profile.extras.next7dRainMm ?? "unknown"} mm)`,
    `  avg daily max temp: ${w.avgTmaxC ?? "unknown"} °C | avg ET0: ${w.et0mm ?? "unknown"} mm/day | topsoil moisture: ${w.soilMoisture ?? "unknown"} m3/m3`,
    "",
    "AGRONOMY TABLE (ICAR/SAU Package of Practices + FAO-56 — recommend ONLY from these crops):",
    JSON.stringify(
      AGRONOMY_TABLE.map((c) => ({
        crop: c.crop,
        hindi: c.localNameHi,
        seasons: c.seasons,
        soils: c.soilTypes,
        ph: c.phRange,
        water_mm: c.waterNeedMm,
        days: c.durationDays,
        yield_q_per_acre: c.typicalYieldQPerAcre,
        market: c.marketOutlook,
        risks: c.risks,
        inputs: c.inputs,
        notes: c.notes,
      })),
    ),
    "",
    `TASK: Rank the 4-5 best crops for this plot for the ${ctx.season} season. localName and summaryVoice must be in ${ctx.langName}. Scores must differ meaningfully between ranks. Scale input quantities to sensible per-acre norms (farmer has ${ctx.landAcres} acres). The summaryVoice is read aloud to the farmer over a phone call.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Gemini output validation
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

function sanitize(parsed: unknown): { recommendations: CropRecommendation[]; summaryVoice: string } | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const rawRecs = Array.isArray(obj.recommendations) ? obj.recommendations : [];
  const summaryVoice = str(obj.summaryVoice);
  if (!summaryVoice) return null;

  const recommendations: CropRecommendation[] = [];
  for (const raw of rawRecs) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const crop = str(r.crop);
    if (!crop) continue;
    const inputsRaw = (r.inputs ?? {}) as Record<string, unknown>;
    const score = typeof r.suitabilityScore === "number" ? r.suitabilityScore : Number(r.suitabilityScore);
    const waterNeedRaw = str(r.waterNeed).toLowerCase();
    recommendations.push({
      crop,
      localName: str(r.localName) || crop,
      suitabilityScore: Math.max(0, Math.min(100, Math.round(Number.isFinite(score) ? score : 60))),
      season: str(r.season) || "Kharif",
      waterNeed: waterNeedRaw === "low" || waterNeedRaw === "high" ? waterNeedRaw : "medium",
      durationDays: str(r.durationDays) || "100-120",
      expectedYield: str(r.expectedYield) || "—",
      marketOutlook: str(r.marketOutlook),
      why: strArray(r.why).slice(0, 4),
      risks: strArray(r.risks).slice(0, 3),
      inputs: {
        seed: str(inputsRaw.seed),
        fertilizer: str(inputsRaw.fertilizer),
        irrigation: str(inputsRaw.irrigation),
      },
    });
  }
  if (recommendations.length < 3) return null;
  recommendations.sort((a, b) => b.suitabilityScore - a.suitabilityScore);
  return { recommendations: recommendations.slice(0, 5), summaryVoice };
}

// ---------------------------------------------------------------------------
// Deterministic fallback — must still look excellent
// ---------------------------------------------------------------------------

function fallbackResponse(
  profile: SoilProfile,
  soil: SoilSnapshot,
  season: string,
  waterSource: WaterSource,
): RecommendResponse {
  const recommendations = scoreCrops(
    soil,
    profile.weather,
    season,
    waterSource,
    profile.soilType?.en,
    profile.soilType?.key ?? null,
  );
  return {
    soil,
    weather: profile.weather,
    recommendations,
    summaryVoice: fallbackSummaryHi(recommendations, soil, profile.soilType?.hi),
    source: "cached",
  };
}

function fallbackSummaryHi(recs: CropRecommendation[], soil: SoilSnapshot, soilHi?: string): string {
  const top = recs[0];
  const second = recs[1];
  const third = recs[2];
  const soilBit = soilHi ? `आपके खेत की ${soilHi}` : "आपके खेत की मिट्टी";
  const phBit = soil.ph != null ? ` (pH ${soil.ph})` : "";
  const alts = [second?.localName, third?.localName].filter(Boolean).join(" और ");
  return (
    `${soilBit}${phBit} और मौसम के हिसाब से इस सीज़न सबसे अच्छी फसल ${top.localName} है — ` +
    `करीब ${top.expectedYield.replace("quintal/acre", "क्विंटल प्रति एकड़")} उपज मिल सकती है। ` +
    (alts ? `${alts} भी अच्छे विकल्प हैं। ` : "") +
    `बुवाई से पहले प्रमाणित बीज लें और अपने कृषि विस्तार अधिकारी से किस्म की सलाह जरूर करें।`
  );
}
