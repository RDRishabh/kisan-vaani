// AI-assisted place resolution for weather (and similar) APIs.
// Interprets messy farmer text, then suggests nearby cities/districts when the
// exact hamlet isn't in OpenWeatherMap.

import { GoogleGenAI } from "@google/genai";
import { generateContentResilient } from "@/lib/genai";
import { DISTRICTS } from "@/lib/districts";
import { resolveMandiGeo } from "@/lib/mandi-geo";

export type PlaceCandidate = {
  /** Query string for OpenWeather geocoding, e.g. "Noida, Uttar Pradesh, IN" */
  query: string;
  /** Farmer-facing label */
  label: string;
  state?: string;
  lat?: number;
  lon?: number;
  /** Why this candidate (exact / nearby HQ / AI suggestion) */
  reason: "exact" | "registry" | "ai_primary" | "ai_nearby";
};

type AiPlacePlan = {
  asked?: string;
  primary?: { name?: string; state?: string; query?: string };
  nearby?: Array<{ name?: string; state?: string; query?: string; note?: string }>;
};

const AI_BUDGET_MS = 8_000;

function registryCandidates(raw: string): PlaceCandidate[] {
  const geo = resolveMandiGeo(raw);
  const out: PlaceCandidate[] = [];
  const want = (geo.district || raw).toLowerCase();
  const wantState = (geo.state || "").toLowerCase();

  for (const d of DISTRICTS) {
    if (d.district.toLowerCase() !== want) continue;
    if (wantState && d.state.toLowerCase() !== wantState) continue;
    out.push({
      query: `${d.district}, ${d.state}, IN`,
      label: d.district,
      state: d.state,
      lat: d.lat,
      lon: d.lon,
      reason: "registry",
    });
  }

  if (out.length === 0 && geo.district) {
    out.push({
      query: geo.state ? `${geo.district}, ${geo.state}, IN` : `${geo.district}, IN`,
      label: geo.district,
      state: geo.state ?? undefined,
      reason: "exact",
    });
  }

  return out;
}

async function aiPlacePlan(raw: string): Promise<AiPlacePlan | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await Promise.race([
      generateContentResilient(ai, {
        contents: `Farmer place text: "${raw}"`,
        config: {
          temperature: 0.1,
          responseMimeType: "application/json",
          systemInstruction: `You resolve Indian place names for a weather API (OpenWeatherMap).
Farmers often write village/colony/misspelt names (e.g. "Noida Nalgadha region", "कानपुर देहात").

Return ONLY JSON:
{
  "asked": "cleaned farmer place",
  "primary": { "name": "best official city/district", "state": "State", "query": "Name, State, IN" },
  "nearby": [
    { "name": "nearby larger city or district HQ with weather coverage", "state": "State", "query": "Name, State, IN", "note": "why nearby" }
  ]
}

Rules:
- India only. Prefer places that usually have weather stations (district HQ, major towns).
- If the named place is a small village/colony, primary = that area's district/city; nearby = 1–3 alternatives within ~50 km (district HQ, neighbouring district HQ).
- Fix spelling. Hindi → English official names in "query".
- nearby: at least 1 item when the place is obscure; max 3.
- Never invent countries outside India.`,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("place-resolve AI budget")), AI_BUDGET_MS),
      ),
    ]);

    const text = result.text?.trim() ?? "";
    const json = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    return JSON.parse(json) as AiPlacePlan;
  } catch (err) {
    console.error("place-resolve AI error:", err instanceof Error ? err.message : err);
    return null;
  }
}

function pushUnique(list: PlaceCandidate[], c: PlaceCandidate) {
  const key = `${c.query}|${c.lat ?? ""}|${c.lon ?? ""}`.toLowerCase();
  if (list.some((x) => `${x.query}|${x.lat ?? ""}|${x.lon ?? ""}`.toLowerCase() === key)) return;
  list.push(c);
}

/**
 * Build ordered place candidates: registry → raw text → AI primary → AI nearby.
 * Callers try each until the weather API succeeds.
 */
export async function resolveWeatherPlaceCandidates(raw: string): Promise<{
  asked: string;
  candidates: PlaceCandidate[];
}> {
  const asked = raw.trim();
  const candidates: PlaceCandidate[] = [];

  for (const c of registryCandidates(asked)) pushUnique(candidates, c);

  // Raw farmer text as geocode attempt
  pushUnique(candidates, {
    query: asked.includes(",") ? asked : `${asked}, IN`,
    label: asked,
    reason: "exact",
  });

  // Strip filler and try again
  const stripped = asked
    .replace(/\b(region|area|village|gaon|गाँव|जिला|district)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped && stripped.toLowerCase() !== asked.toLowerCase()) {
    pushUnique(candidates, {
      query: `${stripped}, IN`,
      label: stripped,
      reason: "exact",
    });
  }

  const plan = await aiPlacePlan(asked);
  if (plan?.primary?.query || plan?.primary?.name) {
    const name = plan.primary.name ?? plan.primary.query!;
    const state = plan.primary.state;
    pushUnique(candidates, {
      query: plan.primary.query ?? (state ? `${name}, ${state}, IN` : `${name}, IN`),
      label: name,
      state,
      reason: "ai_primary",
    });
    // Also try registry match on AI primary
    for (const c of registryCandidates(name)) {
      pushUnique(candidates, { ...c, reason: "ai_primary" });
    }
  }

  for (const n of plan?.nearby ?? []) {
    if (!n.name && !n.query) continue;
    const name = n.name ?? n.query!;
    pushUnique(candidates, {
      query: n.query ?? (n.state ? `${name}, ${n.state}, IN` : `${name}, IN`),
      label: name,
      state: n.state,
      reason: "ai_nearby",
    });
    for (const c of registryCandidates(name)) {
      pushUnique(candidates, { ...c, reason: "ai_nearby" });
    }
  }

  return { asked: plan?.asked?.trim() || asked, candidates };
}
