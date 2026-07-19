// data.gov.in — Current Daily Mandi Prices (Agmarknet republication).
// Resource: 35985678-0d79-46b4-9ed6-6f13308a1d24
// Filters are case-sensitive: filters[State], filters[District], filters[Commodity], filters[Arrival_Date]

import type { MandiRow } from "@/lib/types";

export const DATA_GOV_IN_MANDI_RESOURCE_ID =
  process.env.DATA_GOV_IN_MANDI_RESOURCE_ID ?? "35985678-0d79-46b4-9ed6-6f13308a1d24";

const DATA_GOV_IN_BASE = "https://api.data.gov.in/resource";
const FETCH_TIMEOUT_MS = 30_000;
const PAGE_LIMIT = 500;
const MAX_RECORDS = 2000;

type DataGovRecord = Record<string, unknown>;

type DataGovResponse = {
  records?: DataGovRecord[];
  total?: number;
  count?: number;
};

function istDateDdMmYyyy(offsetDays = 0): string {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );
  const [y, m, day] = d.split("-");
  return `${day}-${m}-${y}`;
}

function pickField(rec: DataGovRecord, ...keys: string[]): string {
  for (const key of keys) {
    const v = rec[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function parsePrice(v: unknown): number {
  const n = Number.parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function normalizeArrivalDate(raw: string): string {
  if (!raw) return istDateDdMmYyyy();
  return raw.trim().replace(/\//g, "-");
}

function mapRecord(rec: DataGovRecord, fallbackCommodity: string): MandiRow | null {
  const modal = parsePrice(
    pickField(rec, "Modal_Price", "Modal Price", "modal_price", "modal price"),
  );
  if (modal <= 0) return null;
  return {
    market: pickField(rec, "Market", "market", "market_name"),
    district: pickField(rec, "District", "district", "district_name"),
    state: pickField(rec, "State", "state", "state_name"),
    commodity: pickField(rec, "Commodity", "commodity", "cmdt_name") || fallbackCommodity,
    variety: pickField(rec, "Variety", "variety", "variety_name") || "Other",
    minPrice: parsePrice(pickField(rec, "Min_Price", "Min Price", "min_price", "min price")),
    maxPrice: parsePrice(pickField(rec, "Max_Price", "Max Price", "max_price", "max price")),
    modalPrice: modal,
    arrivalDate: normalizeArrivalDate(
      pickField(rec, "Arrival_Date", "Arrival Date", "arrival_date"),
    ),
  };
}

function dateKey(ddmmyyyy: string): number {
  const [d, m, y] = ddmmyyyy.split("-").map((x) => Number.parseInt(x, 10) || 0);
  return y * 10_000 + m * 100 + d;
}

/** Commodity names as stored on data.gov.in (may differ from farmer shorthand). */
const DATA_GOV_COMMODITY: Record<string, string[]> = {
  Soyabean: ["Soyabean", "Soybean"],
  Wheat: ["Wheat"],
  Cotton: ["Cotton"],
  "Paddy(Common)": ["Paddy", "Paddy(Common)", "Rice"],
  Tomato: ["Tomato"],
  Onion: ["Onion"],
  Potato: ["Potato"],
  Groundnut: ["Groundnut"],
  Mustard: ["Mustard"],
  Maize: ["Maize"],
};

function commodityCandidates(canonicalName: string): string[] {
  return DATA_GOV_COMMODITY[canonicalName] ?? [canonicalName];
}

async function fetchPage(
  resourceId: string,
  apiKey: string,
  params: Record<string, string>,
): Promise<DataGovRecord[]> {
  const url = new URL(`${DATA_GOV_IN_BASE}/${resourceId}`);
  url.searchParams.set("api-key", apiKey);
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (res.status === 403) throw new Error("data.gov.in HTTP 403 — check DATA_GOV_IN_API_KEY");
  if (!res.ok) throw new Error(`data.gov.in HTTP ${res.status}`);
  const body = (await res.json()) as DataGovResponse;
  return body.records ?? [];
}

export async function fetchDataGovMandiRows(params: {
  commodity: string;
  state?: string | null;
  district?: string | null;
  apiKey: string;
  resourceId?: string;
}): Promise<MandiRow[]> {
  const resourceId = params.resourceId ?? DATA_GOV_IN_MANDI_RESOURCE_ID;
  const candidates = commodityCandidates(params.commodity);
  const stateFilters: (string | null)[] = params.state?.trim()
    ? [params.state.trim(), null]
    : [null];

  for (const arrivalOffset of [0, -1, -2, -3, -4, -5, -6, -7]) {
    const arrivalDate = istDateDdMmYyyy(arrivalOffset);
    for (const commodity of candidates) {
      for (const stateFilter of stateFilters) {
        const allRecords: DataGovRecord[] = [];
        for (let offset = 0; offset < MAX_RECORDS; offset += PAGE_LIMIT) {
          const query: Record<string, string> = {
            limit: String(PAGE_LIMIT),
            offset: String(offset),
            "filters[Commodity]": commodity,
            "filters[Arrival_Date]": arrivalDate,
          };
          if (stateFilter) query["filters[State]"] = stateFilter;
          if (params.district?.trim()) query["filters[District]"] = params.district.trim();

          const page = await fetchPage(resourceId, params.apiKey, query);
          allRecords.push(...page);
          if (page.length < PAGE_LIMIT) break;
        }

        const rows = allRecords
          .map((r) => mapRecord(r, params.commodity))
          .filter((r): r is MandiRow => r != null);

        if (rows.length > 0) {
          return rows.sort(
            (a, b) => dateKey(b.arrivalDate) - dateKey(a.arrivalDate) || b.modalPrice - a.modalPrice,
          );
        }
      }
    }
  }

  throw new Error("data.gov.in returned no priced rows for commodity");
}

export function dataGovInApiKey(): string | null {
  const key = process.env.DATA_GOV_IN_API_KEY?.trim();
  return key || null;
}
