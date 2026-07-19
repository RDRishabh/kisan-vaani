// GET /api/mandi?crop=Wheat&state=Madhya+Pradesh — live mandi prices.
// Primary (when DATA_GOV_IN_API_KEY is set): data.gov.in resource 35985678-…
// Fallback: Agmarknet 2.0 POST API (keyless). Last resort: cached realistic rows.

import { NextRequest, NextResponse } from "next/server";
import { DISTRICTS } from "@/lib/districts";
import { dataGovInApiKey, fetchDataGovMandiRows } from "@/lib/mandi-data-gov";
import { normalizeMandiCommodity } from "@/lib/mandi-flow";
import type { MandiResponse, MandiRow } from "@/lib/types";

const AGMARKNET_URL = "https://api.agmarknet.gov.in/v1/daily-price-arrival/report";
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 45 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const ALL_IDS = {
  state: "100000",
  district: "100001",
  market: "100002",
  variety: "100007",
  grade: "100003",
  type: "100004", // Price
} as const;

type CommodityDef = { name: string; commodity: string; group: string; fallbackModal: number };

// Canonical Agmarknet ids (verified from /filters) + typical modal ₹/quintal for fallbacks.
const COMMODITIES: CommodityDef[] = [
  { name: "Wheat", commodity: "1", group: "1", fallbackModal: 2450 },
  { name: "Paddy(Common)", commodity: "2", group: "1", fallbackModal: 2320 },
  { name: "Maize", commodity: "4", group: "1", fallbackModal: 2140 },
  { name: "Bajra(Pearl Millet/Cumbu)", commodity: "28", group: "1", fallbackModal: 2380 },
  { name: "Bengal Gram(Gram)(Whole)", commodity: "6", group: "2", fallbackModal: 5650 },
  { name: "Red gram/Arhar/Tur(whole)", commodity: "45", group: "2", fallbackModal: 7100 },
  { name: "Black Gram(Urd Beans)(Whole)", commodity: "8", group: "2", fallbackModal: 7400 },
  { name: "Green Gram(Moong)(Whole)", commodity: "9", group: "2", fallbackModal: 8100 },
  { name: "Groundnut", commodity: "10", group: "3", fallbackModal: 6350 },
  { name: "Mustard", commodity: "12", group: "3", fallbackModal: 5420 },
  { name: "Soyabean", commodity: "13", group: "3", fallbackModal: 4720 },
  { name: "Cotton", commodity: "15", group: "4", fallbackModal: 7040 },
  { name: "Onion", commodity: "23", group: "6", fallbackModal: 1750 },
  { name: "Potato", commodity: "24", group: "6", fallbackModal: 1350 },
  { name: "Tomato", commodity: "65", group: "6", fallbackModal: 1620 },
  { name: "Green Chilli", commodity: "73", group: "6", fallbackModal: 3400 },
  { name: "Dry Chillies", commodity: "113", group: "7", fallbackModal: 14200 },
  { name: "Sugarcane", commodity: "122", group: "10", fallbackModal: 345 },
];

// Ordered alias patterns → canonical Agmarknet name (first match wins).
const ALIASES: [RegExp, string][] = [
  [/green\s*chilli/, "Green Chilli"],
  [/chilli|mirch/, "Dry Chillies"],
  [/paddy|dhan|rice/, "Paddy(Common)"],
  [/wheat|gehu/, "Wheat"],
  [/maize|makka|corn/, "Maize"],
  [/bajra|pearl\s*millet/, "Bajra(Pearl Millet/Cumbu)"],
  [/red\s*gram|redgram|arhar|tur\b|pigeon\s*pea/, "Red gram/Arhar/Tur(whole)"],
  [/black\s*gram|blackgram|urad|urd/, "Black Gram(Urd Beans)(Whole)"],
  [/green\s*gram|greengram|moong(?!fali)/, "Green Gram(Moong)(Whole)"],
  [/gram|chickpea|chana/, "Bengal Gram(Gram)(Whole)"],
  [/groundnut|peanut|moongfali/, "Groundnut"],
  [/mustard|sarson/, "Mustard"],
  [/soy/, "Soyabean"],
  [/cotton|kapas/, "Cotton"],
  [/onion|pyaz/, "Onion"],
  [/potato|aloo/, "Potato"],
  [/tomato|tamatar/, "Tomato"],
  [/sugarcane|ganna/, "Sugarcane"],
];

function resolveCommodity(crop: string): CommodityDef | null {
  const key = crop.trim().toLowerCase();
  for (const [pattern, name] of ALIASES) {
    if (pattern.test(key)) return COMMODITIES.find((c) => c.name === name) ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fetch + cache (per commodity, all-India; state filtered per request)
// ---------------------------------------------------------------------------

const rowCache = new Map<
  string,
  { expires: number; rows: MandiRow[]; live: boolean; source: MandiResponse["source"] }
>();

function istDate(offsetDays: number): string {
  // YYYY-MM-DD in IST (en-CA locale format)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );
}

function istDateDdMmYyyy(offsetDays = 0): string {
  const [y, m, d] = istDate(offsetDays).split("-");
  return `${d}-${m}-${y}`;
}

function parsePrice(v: unknown): number {
  const n = Number.parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function dateKey(ddmmyyyy: string): number {
  const [d, m, y] = ddmmyyyy.split("-").map((x) => Number.parseInt(x, 10) || 0);
  return y * 10_000 + m * 100 + d;
}

type AgmarkResponse = {
  data?: { records?: { data?: Record<string, unknown>[] }[] };
};

async function fetchAgmarknetRows(def: CommodityDef): Promise<MandiRow[]> {
  const res = await fetch(AGMARKNET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      group: def.group, // REQUIRED — commodity filter is ignored without it
      commodity: def.commodity,
      state: ALL_IDS.state, // server ignores real ids anyway; filter client-side
      district: ALL_IDS.district,
      market: ALL_IDS.market,
      variety: ALL_IDS.variety,
      grade: ALL_IDS.grade,
      type: ALL_IDS.type,
      from_date: istDate(-2),
      to_date: istDate(0),
      page: "1",
      limit: "500",
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`agmarknet HTTP ${res.status}`);
  const body = (await res.json()) as AgmarkResponse;
  const raw = body.data?.records?.[0]?.data ?? [];

  const rows: MandiRow[] = [];
  for (const r of raw) {
    const modal = parsePrice(r.model_price);
    if (modal <= 0) continue;
    rows.push({
      market: String(r.market_name ?? ""),
      district: String(r.district_name ?? ""),
      state: String(r.state_name ?? ""),
      commodity: String(r.cmdt_name ?? def.name),
      variety: String(r.variety_name ?? ""),
      minPrice: parsePrice(r.min_price),
      maxPrice: parsePrice(r.max_price),
      modalPrice: modal,
      arrivalDate: String(r.arrival_date ?? istDateDdMmYyyy()),
    });
  }
  if (rows.length === 0) throw new Error("agmarknet returned no priced rows");
  return rows.sort((a, b) => dateKey(b.arrivalDate) - dateKey(a.arrivalDate) || b.modalPrice - a.modalPrice);
}

async function fetchDataGovRows(
  commodityName: string,
  requestedState: string | null,
  requestedDistrict: string | null,
): Promise<MandiRow[]> {
  const apiKey = dataGovInApiKey();
  if (!apiKey) throw new Error("DATA_GOV_IN_API_KEY not configured");
  return fetchDataGovMandiRows({
    commodity: commodityName,
    state: requestedState?.trim() || null,
    district: requestedDistrict?.trim() || null,
    apiKey,
  });
}

async function getRows(
  commodityName: string,
  def: CommodityDef | null,
  requestedState: string | null,
  requestedDistrict: string | null,
): Promise<{ rows: MandiRow[]; live: boolean; source: MandiResponse["source"] }> {
  const cacheKey = `${commodityName}:${requestedState ?? "all"}:${requestedDistrict ?? "all"}`;
  const hit = rowCache.get(cacheKey);
  if (hit && Date.now() < hit.expires) {
    return { rows: hit.rows, live: hit.live, source: hit.source };
  }

  if (dataGovInApiKey()) {
    try {
      const rows = await fetchDataGovRows(commodityName, requestedState, requestedDistrict);
      rowCache.set(cacheKey, {
        expires: Date.now() + CACHE_TTL_MS,
        rows,
        live: true,
        source: "data.gov.in",
      });
      return { rows, live: true, source: "data.gov.in" };
    } catch (err) {
      console.error("mandi data.gov.in error:", err instanceof Error ? err.message : err);
    }
  }

  if (def) {
    try {
      const rows = await fetchAgmarknetRows(def);
      rowCache.set(cacheKey, {
        expires: Date.now() + CACHE_TTL_MS,
        rows,
        live: true,
        source: "agmarknet",
      });
      return { rows, live: true, source: "agmarknet" };
    } catch (err) {
      console.error("mandi agmarknet error:", err instanceof Error ? err.message : err);
    }
  }

  if (requestedDistrict?.trim()) {
    return { rows: [], live: false, source: "cached" };
  }

  const fallbackModal = def?.fallbackModal ?? 3500;
  const rows = fallbackRows(commodityName, fallbackModal, requestedState);
  rowCache.set(cacheKey, {
    expires: Date.now() + FAILURE_TTL_MS,
    rows,
    live: false,
    source: "cached",
  });
  return { rows, live: false, source: "cached" };
}

// ---------------------------------------------------------------------------
// Realistic cached fallback rows
// ---------------------------------------------------------------------------

function fallbackRows(commodityName: string, modal: number, state: string | null): MandiRow[] {
  const stateDistricts = state
    ? DISTRICTS.filter((d) => d.state.toLowerCase() === state.toLowerCase())
    : [];
  // Never invent a default district (e.g. Sehore). Only synthesize rows for a known state filter.
  const places =
    stateDistricts.length > 0
      ? stateDistricts.slice(0, 3).map((d) => ({
          market: d.blocks[0] ?? d.district,
          district: d.district,
          state: d.state,
        }))
      : [];
  if (places.length === 0) return [];
  const today = istDateDdMmYyyy();
  return places.map((p, i) => {
    const m = Math.round(modal * (1 + (i - 1) * 0.018));
    return {
      market: p.market,
      district: p.district,
      state: p.state,
      commodity: commodityName,
      variety: "Other",
      minPrice: Math.round(m * 0.93),
      maxPrice: Math.round(m * 1.06),
      modalPrice: m,
      arrivalDate: today,
    };
  });
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const rawCrop = sp.get("crop") ?? "Wheat";
  const crop = normalizeMandiCommodity(rawCrop);
  const requestedState = sp.get("state")?.trim() || null;
  const requestedDistrict = sp.get("district")?.trim() || null;

  const def = resolveCommodity(crop);
  const commodityName = def?.name ?? crop;

  const { rows: allRows, live, source } = await getRows(
    commodityName,
    def,
    requestedState,
    requestedDistrict,
  );

  let rows = allRows;

  if (requestedDistrict) {
    const wantDist = requestedDistrict.toLowerCase();
    const byDistrict = rows.filter((r) => r.district.trim().toLowerCase() === wantDist);
    if (byDistrict.length > 0) rows = byDistrict;
  }

  if (requestedState) {
    const want = requestedState.toLowerCase();
    const filtered = rows.filter((r) => r.state.trim().toLowerCase() === want);
    if (filtered.length > 0) {
      rows = filtered;
    } else if (live && !requestedDistrict) {
      rows = allRows;
    } else if (!live && !requestedDistrict) {
      rows = fallbackRows(commodityName, def?.fallbackModal ?? 3500, requestedState);
    }
  }

  const response: MandiResponse = {
    rows: representativeFirst(rows).slice(0, 15),
    commodity: commodityName,
    requestedState,
    generatedAt: new Date().toISOString(),
    source: rows.length > 0 ? source : live ? source : "cached",
  };
  return NextResponse.json(response);
}

// Consumers (IVR, demo, recommend strip) quote rows[0]. A newest-dated single-lot
// outlier (min==max==modal from one small market) must not become "the price" —
// reorder so rows[0] is the median-modal row of the latest arrival date, and
// degenerate single-quote rows lose to real spreads when alternatives exist.
function representativeFirst(rows: MandiRow[]): MandiRow[] {
  const priced = rows.filter((r) => r && r.modalPrice > 0);
  if (priced.length <= 1) return priced;
  const latest = dateKey(priced[0].arrivalDate);
  let day = priced.filter((r) => dateKey(r.arrivalDate) === latest);
  if (day.length === 0) day = priced;
  const spreads = day.filter((r) => !(r.minPrice === r.maxPrice && r.maxPrice === r.modalPrice));
  if (spreads.length > 0) day = spreads;
  const sorted = [...day].sort((a, b) => a.modalPrice - b.modalPrice);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!median) return priced.slice(0, 15);
  return [median, ...priced.filter((r) => r !== median)];
}
