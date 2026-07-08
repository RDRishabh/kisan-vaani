// Weather zone alert engine — Open-Meteo batch fetch + IMD-grounded detectors.
// Server-only pure logic; no React, no 'use client'.
//
// Thresholds are Indian-government DEFINITIONS embedded as constants (verified sources):
//  - Rainfall intensity classes (mm/24h): IMD classification, verified from IMD MC Ahmedabad
//    state bulletin (mausam.imd.gov.in/ahmedabad/mcdata/state.pdf).
//  - Dry day: below IMD "rainy day" threshold of 2.5 mm/day. Dry-spell day-count heuristic is
//    derived from the official weekly definition in the Manual for Drought Management 2016
//    (DAC&FW, agriwelfare.gov.in) — 3-4 consecutive weeks with rainfall <50% of weekly normal.
//  - Heatwave (plains): Tmax >= 40 degC with departure from normal +4.5 to 6.4 = heatwave,
//    >6.4 = severe; Tmax >= 45 qualifies outright, >= 47 severe (IMD criteria).
//
// Data: Open-Meteo forecast API (CC-BY 4.0 — "Weather data by Open-Meteo.com"), one batched
// call per 16 districts via comma-separated latitude/longitude lists, past_days=30 +
// forecast_days=16 in a single request.

import type { District } from "./districts";
import type { AlertSeverity, ZoneAlert } from "./types";

// ---------------------------------------------------------------------------
// IMD-grounded threshold constants
// ---------------------------------------------------------------------------

export const IMD_THRESHOLDS = {
  rainyDayMm: 2.5, // IMD: a day with >= 2.5 mm rainfall is a "rainy day"; below = dry day
  heavyMm: 64.5, // IMD "Heavy rainfall": 64.5-115.5 mm / 24h
  veryHeavyMm: 115.6, // IMD "Very heavy rainfall": 115.6-204.4 mm / 24h
  extremelyHeavyMm: 204.5, // IMD "Extremely heavy rainfall": >= 204.5 mm / 24h
  drySpellDays: { watch: 7, warning: 14, severe: 21 }, // consecutive dry-day tiers
  heatwaveTmaxPlainsC: 40, // plains stations considered only if Tmax >= 40 degC
  heatwaveDepartureC: 4.5, // departure +4.5 to 6.4 = heatwave
  severeHeatwaveDepartureC: 6.5, // departure > 6.4 = severe heatwave
  heatwaveAbsoluteC: 45, // Tmax >= 45 = heatwave irrespective of departure
  severeHeatwaveAbsoluteC: 47, // Tmax >= 47 = severe heatwave
} as const;

// ---------------------------------------------------------------------------
// Fetch — batched Open-Meteo daily series (30 past + 16 forecast days)
// ---------------------------------------------------------------------------

export type DistrictDaily = {
  district: District;
  dates: string[]; // ISO dates, past 30d then today + 15 forecast days (~46 rows)
  rain: (number | null)[]; // daily precipitation_sum, mm
  et0: (number | null)[]; // daily et0_fao_evapotranspiration, mm
  tmax: (number | null)[]; // daily temperature_2m_max, degC
  tmin: (number | null)[]; // daily temperature_2m_min, degC
  rainProb: (number | null)[]; // daily precipitation_probability_max, %
  pastDays: number; // rows [0, pastDays) are observed past; [pastDays, ...) are today+forecast
};

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const DAILY_PARAMS =
  "precipitation_sum,et0_fao_evapotranspiration,temperature_2m_max,temperature_2m_min,precipitation_probability_max";
const PAST_DAYS = 30;
const FORECAST_DAYS = 16;
const BATCH_SIZE = 16; // 32 districts -> 2 parallel requests
const FETCH_TIMEOUT_MS = 8000;

type OpenMeteoDaily = {
  daily?: {
    time?: string[];
    precipitation_sum?: (number | null)[];
    et0_fao_evapotranspiration?: (number | null)[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    precipitation_probability_max?: (number | null)[];
  };
};

export async function fetchDistrictWeather(districts: District[]): Promise<DistrictDaily[]> {
  const chunks: District[][] = [];
  for (let i = 0; i < districts.length; i += BATCH_SIZE) {
    chunks.push(districts.slice(i, i + BATCH_SIZE));
  }
  const results = await Promise.all(chunks.map(fetchChunk));
  return results.flat();
}

async function fetchChunk(chunk: District[]): Promise<DistrictDaily[]> {
  const lats = chunk.map((d) => d.lat).join(",");
  const lons = chunk.map((d) => d.lon).join(",");
  const url =
    `${OPEN_METEO_URL}?latitude=${lats}&longitude=${lons}` +
    `&daily=${DAILY_PARAMS}&forecast_days=${FORECAST_DAYS}&past_days=${PAST_DAYS}` +
    `&timezone=Asia%2FKolkata`;

  // Open-Meteo occasionally throws a transient nginx 502 (observed in testing) —
  // one quick retry rescues the live path; second attempt gets a shorter budget.
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`);
  } catch {
    await new Promise((r) => setTimeout(r, 300));
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS / 2), cache: "no-store" });
    if (!res.ok) throw new Error(`open-meteo HTTP ${res.status} (after retry)`);
  }

  const body = (await res.json()) as OpenMeteoDaily | OpenMeteoDaily[];
  const items = Array.isArray(body) ? body : [body]; // single-location responses are not arrays
  if (items.length !== chunk.length) {
    throw new Error(`open-meteo returned ${items.length} locations, expected ${chunk.length}`);
  }

  return items.map((item, i) => {
    const daily = item.daily;
    const time = daily?.time;
    if (!daily || !time || time.length === 0) {
      throw new Error(`open-meteo: missing daily series for ${chunk[i].district}`);
    }
    const n = time.length;
    const pad = (arr?: (number | null)[]) =>
      Array.from({ length: n }, (_, k) => (arr && arr[k] != null ? arr[k] : null));
    return {
      district: chunk[i],
      dates: time,
      rain: pad(daily.precipitation_sum),
      et0: pad(daily.et0_fao_evapotranspiration),
      tmax: pad(daily.temperature_2m_max),
      tmin: pad(daily.temperature_2m_min),
      rainProb: pad(daily.precipitation_probability_max),
      pastDays: Math.min(PAST_DAYS, n - 1),
    };
  });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const r1 = (n: number) => Math.round(n * 10) / 10;

const isDryDay = (mm: number | null) => mm != null && mm < IMD_THRESHOLDS.rainyDayMm;

function sum(values: (number | null)[], from: number, to: number): number {
  let total = 0;
  for (let i = Math.max(0, from); i < Math.min(values.length, to); i++) {
    const v = values[i];
    if (v != null) total += v;
  }
  return total;
}

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HI_MONTHS = ["जनवरी", "फरवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];

function fmtEn(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${d} ${EN_MONTHS[(m || 1) - 1]}`;
}

function fmtHi(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${d} ${HI_MONTHS[(m || 1) - 1]}`;
}

// Hindi names for registry crops (fallback: English name as-is).
const HI_CROP: Record<string, string> = {
  Soybean: "सोयाबीन",
  Wheat: "गेहूं",
  Cotton: "कपास",
  Gram: "चना",
  Redgram: "अरहर",
  Paddy: "धान",
  Chilli: "मिर्च",
  Groundnut: "मूंगफली",
  Maize: "मक्का",
  Grapes: "अंगूर",
  Onion: "प्याज",
  Tomato: "टमाटर",
  Sugarcane: "गन्ना",
  Jute: "जूट",
  Mustard: "सरसों",
  Potato: "आलू",
  Vegetables: "सब्ज़ियां",
  Ragi: "रागी",
  Blackgram: "उड़द",
  Banana: "केला",
  Coconut: "नारियल",
  Cumin: "जीरा",
  Bajra: "बाजरा",
  Moong: "मूंग",
  Orange: "संतरा",
  Tea: "चाय",
  Tobacco: "तंबाकू",
};

const hiCrop = (crop: string) => HI_CROP[crop] ?? crop;

// Season of each crop, so an alert does not advise action on a crop that is not
// in the field (e.g. wheat, a rabi crop, during a July kharif dry spell).
// "any" = perennial/plantation or year-round vegetables.
const CROP_SEASON: Record<string, "kharif" | "rabi" | "any"> = {
  Soybean: "kharif", Cotton: "kharif", Paddy: "kharif", Redgram: "kharif",
  Maize: "kharif", Groundnut: "kharif", Bajra: "kharif", Moong: "kharif",
  Chilli: "kharif", Jute: "kharif", Soyabean: "kharif",
  Wheat: "rabi", Gram: "rabi", Mustard: "rabi", Potato: "rabi",
  Grapes: "any", Onion: "any", Tomato: "any", Sugarcane: "any", Vegetables: "any",
  Ragi: "kharif", Blackgram: "kharif", Banana: "any", Coconut: "any", Cumin: "rabi",
  Orange: "any", Tea: "any", Tobacco: "rabi",
};

// Kharif ~ Jun-Oct (months 5-9), Rabi ~ Nov-Mar (10,11,0,1,2), else transitional.
function currentSeason(month: number): "kharif" | "rabi" {
  return month >= 5 && month <= 9 ? "kharif" : "rabi";
}

// Pick the district crop that is actually standing this month; fall back to a
// neutral phrase so the advisory never names an out-of-season crop.
function seasonalCrop(crops: string[], month: number): string {
  const season = currentSeason(month);
  const match = crops.find((c) => {
    const s = CROP_SEASON[c] ?? "any";
    return s === season || s === "any";
  });
  return match ?? "your standing crop";
}
const hiSeasonalCrop = (crops: string[], month: number) => {
  const c = seasonalCrop(crops, month);
  return c === "your standing crop" ? "आपकी खड़ी फसल" : hiCrop(c);
};

// Hindi names for the 32 registry districts (blocks keep exact registry spellings —
// mixed-script SMS is standard practice and preserves exact region names).
const HI_DISTRICT: Record<string, string> = {
  Sehore: "सीहोर",
  Vidisha: "विदिशा",
  Adilabad: "आदिलाबाद",
  Warangal: "वारंगल",
  Nalgonda: "नलगोंडा",
  Guntur: "गुंटूर",
  Anantapur: "अनंतपुर",
  Nashik: "नासिक",
  Washim: "वाशिम",
  Amravati: "अमरावती",
  Ludhiana: "लुधियाना",
  Karnal: "करनाल",
  Muzaffarnagar: "मुज़फ्फरनगर",
  Gorakhpur: "गोरखपुर",
  Patna: "पटना",
  Samastipur: "समस्तीपुर",
  Nadia: "नदिया",
  "Purba Bardhaman": "पूर्व बर्धमान",
  Cuttack: "कटक",
  Kalahandi: "कालाहांडी",
  Belagavi: "बेलगावी",
  Mandya: "मंड्या",
  Thanjavur: "तंजावुर",
  Madurai: "मदुरै",
  Palakkad: "पलक्कड़",
  Rajkot: "राजकोट",
  Sabarkantha: "साबरकांठा",
  Jodhpur: "जोधपुर",
  "Sri Ganganagar": "श्रीगंगानगर",
  Ranchi: "रांची",
  Raipur: "रायपुर",
  Dibrugarh: "डिब्रूगढ़",
};

const hiDistrict = (district: string) => HI_DISTRICT[district] ?? district;

function slug(district: string): string {
  return district.toUpperCase().replace(/[^A-Z]+/g, "");
}

function alertId(prefix: string, district: string, date: string): string {
  return `${prefix}-${slug(district)}-${date.replace(/-/g, "")}`;
}

// ---------------------------------------------------------------------------
// Detector: dry spell (backward 30d observation + forward 16d forecast)
// ---------------------------------------------------------------------------

export function detectDrySpell(w: DistrictDaily): ZoneAlert | null {
  const { district, dates, rain, pastDays } = w;

  // Consecutive dry days observed, counting backward from yesterday through the past window.
  let observedDry = 0;
  for (let i = pastDays - 1; i >= 0 && isDryDay(rain[i]); i--) observedDry++;

  // Projected continuation: consecutive dry forecast days from today forward.
  let forecastDry = 0;
  for (let j = pastDays; j < rain.length && isDryDay(rain[j]); j++) forecastDry++;

  const runLength = observedDry + forecastDry;
  const past30dRain = sum(rain, 0, pastDays);
  const next7dRain = sum(rain, pastDays, pastDays + 7);
  const next16dRain = sum(rain, pastDays, rain.length);

  // Fire only when the streak is real (>= watch tier) AND the near forecast stays below the
  // IMD rainy-day threshold in aggregate (7 x 2.5 mm) — deficit behind us AND ahead of us.
  const tiers = IMD_THRESHOLDS.drySpellDays;
  if (runLength < tiers.watch || next7dRain >= IMD_THRESHOLDS.rainyDayMm * 7) return null;

  const severity: AlertSeverity =
    runLength >= tiers.severe ? "severe" : runLength >= tiers.warning ? "warning" : "watch";

  const startIdx = pastDays - observedDry;
  const endIdx = Math.max(startIdx, pastDays + forecastDry - 1);
  const windowStart = dates[Math.min(startIdx, dates.length - 1)];
  const windowEnd = dates[Math.min(endIdx, dates.length - 1)];

  const blocksHi = district.blocks.slice(0, 2).join(", ");
  const alertMonth = new Date((windowStart ?? dates[0]) + "T00:00:00").getMonth();
  const crop = seasonalCrop(district.crops, alertMonth);
  const cropHi = hiSeasonalCrop(district.crops, alertMonth);

  // Honest phrasing: only claim past dryness for observed days; forecast dryness
  // is always framed as a prediction.
  const spellHi =
    observedDry >= 3
      ? `पिछले ${observedDry} दिन से बारिश नहीं हुई है और ` +
        (forecastDry >= 3
          ? `अगले ${forecastDry} दिन भी बारिश नहीं होने का अनुमान है`
          : `अगले हफ्ते भी बहुत कम बारिश का अनुमान है`)
      : `अगले ${Math.max(forecastDry, 7)} दिन बहुत कम बारिश का अनुमान है`;

  return {
    id: alertId("DS", district.district, dates[pastDays] ?? windowStart),
    type: "dry_spell",
    severity,
    state: district.state,
    district: district.district,
    blocks: district.blocks,
    lat: district.lat,
    lon: district.lon,
    windowStart,
    windowEnd,
    metric: `${runLength} consecutive dry days (<2.5 mm/day, IMD rainy-day threshold) — ${observedDry} observed + ${forecastDry} forecast; past 30-day rainfall ${r1(past30dRain)} mm; next 16-day forecast ${r1(next16dRain)} mm`,
    advisory: `Dry spell over ${district.district} (${district.blocks.slice(0, 3).join(", ")}): ${runLength}-day dry run (${observedDry} observed + ${forecastDry} forecast), only ${r1(next7dRain)} mm rain expected this week. Advise protective irrigation for ${crop.toLowerCase()}, mulching to conserve moisture, and verify borewell/canal availability.`,
    farmerMessage: `${hiDistrict(district.district)} जिले के ${blocksHi} क्षेत्र में ${spellHi}। ${cropHi} की फसल में नमी बचाएं — शाम को हल्की सिंचाई करें, जड़ों के पास घास/पुआल की मल्च बिछाएं। मदद: 1800-180-1551`,
    farmersInZone: district.farmers,
    crops: district.crops,
    source: "open-meteo",
  };
}

// ---------------------------------------------------------------------------
// Detector: heavy rain (IMD 24h intensity classes over the 16-day forecast)
// ---------------------------------------------------------------------------

export function detectHeavyRain(w: DistrictDaily): ZoneAlert | null {
  const { district, dates, rain, pastDays } = w;

  let firstIdx = -1;
  let lastIdx = -1;
  let peakIdx = -1;
  let peakMm = 0;
  let heavyDays = 0;

  for (let i = pastDays; i < rain.length; i++) {
    const mm = rain[i];
    if (mm != null && mm >= IMD_THRESHOLDS.heavyMm) {
      heavyDays++;
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
      if (mm > peakMm) {
        peakMm = mm;
        peakIdx = i;
      }
    }
  }
  if (firstIdx === -1) return null;

  const severity: AlertSeverity =
    peakMm >= IMD_THRESHOLDS.extremelyHeavyMm
      ? "severe"
      : peakMm >= IMD_THRESHOLDS.veryHeavyMm
        ? "warning"
        : "watch";

  const imdLabel =
    peakMm >= IMD_THRESHOLDS.extremelyHeavyMm
      ? "Extremely heavy rainfall (>=204.5 mm)"
      : peakMm >= IMD_THRESHOLDS.veryHeavyMm
        ? "Very heavy rainfall (115.6-204.4 mm)"
        : "Heavy rainfall (64.5-115.5 mm)";

  const next16dRain = sum(rain, pastDays, rain.length);
  const blocksHi = district.blocks.slice(0, 2).join(", ");
  const alertMonth = new Date((dates[pastDays] ?? dates[0]) + "T00:00:00").getMonth();
  const crop = seasonalCrop(district.crops, alertMonth);
  const cropHi = hiSeasonalCrop(district.crops, alertMonth);

  return {
    id: alertId("HR", district.district, dates[pastDays] ?? dates[firstIdx]),
    type: "heavy_rain",
    severity,
    state: district.state,
    district: district.district,
    blocks: district.blocks,
    lat: district.lat,
    lon: district.lon,
    windowStart: dates[firstIdx],
    windowEnd: dates[lastIdx],
    metric: `Forecast peak ${r1(peakMm)} mm/24h on ${fmtEn(dates[peakIdx])} — IMD "${imdLabel}"; ${heavyDays} day(s) >=64.5 mm in next 16 days; 16-day total ${r1(next16dRain)} mm`,
    advisory: `Heavy rain over ${district.district} (${district.blocks.slice(0, 3).join(", ")}): peak ${r1(peakMm)} mm on ${fmtEn(dates[peakIdx])}. Advise field drainage channels now, delay fertilizer/pesticide sprays, move harvested ${crop.toLowerCase()} produce to covered storage.`,
    farmerMessage: `${hiDistrict(district.district)} के ${blocksHi} क्षेत्र में ${fmtHi(dates[peakIdx])} को भारी बारिश (लगभग ${Math.round(peakMm)} मिमी) का अनुमान है। आज ही खेत में जल निकासी की नालियां साफ करें, ${cropHi} में जलभराव न होने दें, कटी फसल और खाद सुरक्षित जगह रखें। मदद: 1800-180-1551`,
    farmersInZone: district.farmers,
    crops: district.crops,
    source: "open-meteo",
  };
}

// ---------------------------------------------------------------------------
// Detector: heatwave (IMD plains criteria; departure vs past-30-day mean Tmax)
// ---------------------------------------------------------------------------

export function detectHeatwave(w: DistrictDaily): ZoneAlert | null {
  const { district, dates, tmax, pastDays } = w;

  // Baseline: mean observed Tmax over the past 30 days (honest proxy — IMD "normal"
  // requires 30-year climatology which no open API serves).
  let baseSum = 0;
  let baseCount = 0;
  for (let i = 0; i < pastDays; i++) {
    const t = tmax[i];
    if (t != null) {
      baseSum += t;
      baseCount++;
    }
  }
  if (baseCount === 0) return null;
  const baseline = baseSum / baseCount;

  // Longest consecutive forecast run with Tmax >= 40 degC (IMD plains threshold).
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = pastDays; i < tmax.length; i++) {
    const t = tmax[i];
    if (t != null && t >= IMD_THRESHOLDS.heatwaveTmaxPlainsC) {
      if (curLen === 0) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curLen = 0;
    }
  }

  // IMD declares a heatwave only when criteria hold on at least 2 consecutive days.
  if (bestLen < 2) return null;

  // Peak within the alert window itself, so metric/message match windowStart..windowEnd.
  let peakC = 0;
  let peakIdx = bestStart;
  for (let i = bestStart; i < bestStart + bestLen; i++) {
    const t = tmax[i];
    if (t != null && t > peakC) {
      peakC = t;
      peakIdx = i;
    }
  }

  const departure = peakC - baseline;
  const severity: AlertSeverity =
    peakC >= IMD_THRESHOLDS.severeHeatwaveAbsoluteC || departure >= IMD_THRESHOLDS.severeHeatwaveDepartureC
      ? "severe"
      : peakC >= IMD_THRESHOLDS.heatwaveAbsoluteC || departure >= IMD_THRESHOLDS.heatwaveDepartureC
        ? "warning"
        : "watch";

  const windowStart = dates[bestStart];
  const windowEnd = dates[Math.min(bestStart + bestLen - 1, dates.length - 1)];
  const blocksHi = district.blocks.slice(0, 2).join(", ");
  const alertMonth = new Date((dates[pastDays] ?? dates[0]) + "T00:00:00").getMonth();
  const crop = seasonalCrop(district.crops, alertMonth);
  const cropHi = hiSeasonalCrop(district.crops, alertMonth);

  return {
    id: alertId("HW", district.district, dates[pastDays] ?? windowStart),
    type: "heatwave",
    severity,
    state: district.state,
    district: district.district,
    blocks: district.blocks,
    lat: district.lat,
    lon: district.lon,
    windowStart,
    windowEnd,
    metric: `Forecast Tmax peaks ${r1(peakC)} degC on ${fmtEn(dates[peakIdx])}; ${bestLen} consecutive days >=40 degC (IMD plains threshold); departure +${r1(departure)} degC vs past-30-day mean ${r1(baseline)} degC`,
    advisory: `Heat stress over ${district.district} (${district.blocks.slice(0, 3).join(", ")}): ${bestLen} days >=40 degC, peaking ${r1(peakC)} degC. Advise early-morning/evening irrigation only, light frequent watering for ${crop.toLowerCase()}, shade nets for nurseries, livestock shade and water.`,
    farmerMessage: `${hiDistrict(district.district)} के ${blocksHi} क्षेत्र में ${bestLen} दिन तेज गर्मी (${Math.round(peakC)}°C तक) का अनुमान है। ${cropHi} में दोपहर की सिंचाई न करें — सुबह या शाम को हल्की सिंचाई करें, नर्सरी पर छाया करें, पशुओं को छांव और पानी दें। मदद: 1800-180-1551`,
    farmersInZone: district.farmers,
    crops: district.crops,
    source: "open-meteo",
  };
}

// ---------------------------------------------------------------------------
// Scan composition
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<AlertSeverity, number> = { severe: 0, warning: 1, watch: 2 };

export function detectAlerts(weather: DistrictDaily[]): ZoneAlert[] {
  const alerts: ZoneAlert[] = [];
  for (const w of weather) {
    const drySpell = detectDrySpell(w);
    if (drySpell) alerts.push(drySpell);
    const heavyRain = detectHeavyRain(w);
    if (heavyRain) alerts.push(heavyRain);
    const heatwave = detectHeatwave(w);
    if (heatwave) alerts.push(heatwave);
  }
  return alerts.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.district.localeCompare(b.district),
  );
}

/** Fetch weather for all districts and run every detector. Throws on fetch failure. */
export async function scanDistricts(districts: District[]): Promise<ZoneAlert[]> {
  const weather = await fetchDistrictWeather(districts);
  return detectAlerts(weather);
}
