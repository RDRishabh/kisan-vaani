// OpenWeatherMap — farmer weather telling (current + 5-day / 3h forecast).
// Docs: https://openweathermap.org/api
// Endpoint: https://api.openweathermap.org

import { resolveWeatherPlaceCandidates } from "@/lib/place-resolve";

const OWM_BASE = "https://api.openweathermap.org";
const FETCH_TIMEOUT_MS = 12_000;

export type OpenWeatherSnapshot = {
  place: string;
  state?: string;
  country: string;
  /** Original place the farmer asked for (when we used a nearby station). */
  askedPlace?: string;
  /** True when weather is from a nearby / substitute place. */
  usedNearby?: boolean;
  tempC: number;
  feelsLikeC: number;
  humidityPct: number;
  windMs: number;
  description: string;
  descriptionHi: string;
  rainNext3hMm: number | null;
  rainNext24hMm: number | null;
  rainNext5dMm: number | null;
  tmaxNext5dC: number | null;
  tminNext5dC: number | null;
  source: "openweathermap";
};

type OwmCurrent = {
  name?: string;
  sys?: { country?: string };
  weather?: Array<{ id?: number; main?: string; description?: string }>;
  main?: { temp?: number; feels_like?: number; humidity?: number; temp_min?: number; temp_max?: number };
  wind?: { speed?: number };
  rain?: { "1h"?: number; "3h"?: number };
  coord?: { lat?: number; lon?: number };
};

type OwmForecast = {
  list?: Array<{
    dt?: number;
    main?: { temp?: number; temp_min?: number; temp_max?: number };
    rain?: { "3h"?: number };
    weather?: Array<{ description?: string }>;
  }>;
  city?: { name?: string; country?: string };
};

type OwmGeo = Array<{ name?: string; lat?: number; lon?: number; state?: string; country?: string }>;

function apiKey(): string | null {
  const key = process.env.OPENWEATHERMAP_API_KEY?.trim();
  return key || null;
}

export function openWeatherApiKey(): string | null {
  return apiKey();
}

async function owmFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("OPENWEATHERMAP_API_KEY not configured");

  const url = new URL(`${OWM_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("appid", key);
  url.searchParams.set("units", "metric");

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenWeather HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
  }
  return (await res.json()) as T;
}

/** Resolve a place name in India to lat/lon via OpenWeather Geocoding. */
export async function geocodeIndia(place: string): Promise<{
  lat: number;
  lon: number;
  name: string;
  state?: string;
  country: string;
} | null> {
  const q = place.includes(",") ? place : `${place},IN`;
  const hits = await owmFetch<OwmGeo>("/geo/1.0/direct", { q, limit: "5" });
  const inIndia = hits.find((h) => (h.country ?? "").toUpperCase() === "IN") ?? hits[0];
  if (!inIndia || inIndia.lat == null || inIndia.lon == null) return null;
  return {
    lat: inIndia.lat,
    lon: inIndia.lon,
    name: inIndia.name ?? place,
    state: inIndia.state,
    country: inIndia.country ?? "IN",
  };
}

const DESC_HI: Record<string, string> = {
  "clear sky": "साफ आसमान",
  "few clouds": "हल्के बादल",
  "scattered clouds": "छिटपुट बादल",
  "broken clouds": "बादल छाए",
  "overcast clouds": "घने बादल",
  "light rain": "हल्की बारिश",
  "moderate rain": "सामान्य बारिश",
  "heavy intensity rain": "तेज़ बारिश",
  "very heavy rain": "बहुत तेज़ बारिश",
  thunderstorm: "आंधी-तूफान",
  mist: "धुंध",
  fog: "कोहरा",
  haze: "धुंधला मौसम",
  drizzle: "फुहार",
};

function descriptionHi(en: string): string {
  const key = en.trim().toLowerCase();
  return DESC_HI[key] ?? en;
}

function sumRain(list: NonNullable<OwmForecast["list"]>, hoursAhead: number): number {
  const cutoff = Date.now() / 1000 + hoursAhead * 3600;
  let total = 0;
  for (const row of list) {
    if ((row.dt ?? 0) > cutoff) break;
    total += row.rain?.["3h"] ?? 0;
  }
  return Math.round(total * 10) / 10;
}

export async function fetchOpenWeatherByCoords(
  lat: number,
  lon: number,
  placeHint?: string,
): Promise<OpenWeatherSnapshot> {
  const [current, forecast] = await Promise.all([
    owmFetch<OwmCurrent>("/data/2.5/weather", {
      lat: String(lat),
      lon: String(lon),
    }),
    owmFetch<OwmForecast>("/data/2.5/forecast", {
      lat: String(lat),
      lon: String(lon),
    }),
  ]);

  const list = forecast.list ?? [];
  const tempsMax = list.map((r) => r.main?.temp_max).filter((v): v is number => v != null);
  const tempsMin = list.map((r) => r.main?.temp_min).filter((v): v is number => v != null);
  const desc = current.weather?.[0]?.description ?? "clear sky";

  return {
    place: placeHint || current.name || forecast.city?.name || "आपका क्षेत्र",
    country: current.sys?.country ?? forecast.city?.country ?? "IN",
    tempC: Math.round((current.main?.temp ?? 0) * 10) / 10,
    feelsLikeC: Math.round((current.main?.feels_like ?? current.main?.temp ?? 0) * 10) / 10,
    humidityPct: Math.round(current.main?.humidity ?? 0),
    windMs: Math.round((current.wind?.speed ?? 0) * 10) / 10,
    description: desc,
    descriptionHi: descriptionHi(desc),
    rainNext3hMm: current.rain?.["3h"] ?? current.rain?.["1h"] ?? null,
    rainNext24hMm: list.length ? sumRain(list, 24) : null,
    rainNext5dMm: list.length ? sumRain(list, 24 * 5) : null,
    tmaxNext5dC: tempsMax.length ? Math.round(Math.max(...tempsMax) * 10) / 10 : null,
    tminNext5dC: tempsMin.length ? Math.round(Math.min(...tempsMin) * 10) / 10 : null,
    source: "openweathermap",
  };
}

export async function fetchOpenWeatherForPlace(place: string): Promise<OpenWeatherSnapshot> {
  const geo = await geocodeIndia(place);
  if (!geo) throw new Error(`Could not geocode place: ${place}`);
  const snap = await fetchOpenWeatherByCoords(geo.lat, geo.lon, geo.name);
  return { ...snap, state: geo.state, place: geo.name };
}

/**
 * Smart weather fetch: AI + registry candidates, try exact place then nearby
 * stations until OpenWeather returns data.
 */
export async function fetchOpenWeatherSmart(rawPlace: string): Promise<OpenWeatherSnapshot> {
  const { asked, candidates } = await resolveWeatherPlaceCandidates(rawPlace);
  const errors: string[] = [];

  for (const c of candidates) {
    try {
      let snap: OpenWeatherSnapshot;
      if (c.lat != null && c.lon != null) {
        snap = await fetchOpenWeatherByCoords(c.lat, c.lon, c.label);
        snap = { ...snap, state: c.state ?? snap.state, place: c.label };
      } else {
        snap = await fetchOpenWeatherForPlace(c.query);
        if (c.state) snap = { ...snap, state: c.state };
        if (c.label) snap = { ...snap, place: c.label };
      }

      const usedNearby = c.reason === "ai_nearby" || !placesRoughlyMatch(asked, snap.place);
      return {
        ...snap,
        askedPlace: asked,
        usedNearby,
      };
    } catch (err) {
      errors.push(`${c.query}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(
    `No weather for "${rawPlace}" after ${candidates.length} candidates. ${errors.slice(0, 3).join("; ")}`,
  );
}

function placesRoughlyMatch(asked: string, resolved: string): boolean {
  const a = asked.toLowerCase().replace(/[^a-z0-9\u0900-\u097F]+/gu, " ").trim();
  const b = resolved.toLowerCase().replace(/[^a-z0-9\u0900-\u097F]+/gu, " ").trim();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a) || a.split(" ").some((w) => w.length > 3 && b.includes(w));
}

/** Short Hindi advisory for IVR / SMS. */
export function formatWeatherAdvisoryHi(w: OpenWeatherSnapshot): string {
  const place = w.state ? `${w.place}, ${w.state}` : w.place;
  let line =
    w.usedNearby && w.askedPlace && !placesRoughlyMatch(w.askedPlace, w.place)
      ? `${w.askedPlace} के नज़दीकी स्थान ${place} का मौसम: अभी ${w.tempC} डिग्री (${w.descriptionHi}), नमी ${w.humidityPct} प्रतिशत।`
      : `${place} का मौसम: अभी ${w.tempC} डिग्री (${w.descriptionHi}), नमी ${w.humidityPct} प्रतिशत।`;
  if (w.rainNext24hMm != null) {
    line +=
      w.rainNext24hMm > 0.5
        ? ` अगले 24 घंटे लगभग ${w.rainNext24hMm} मिमी बारिश की संभावना।`
        : " अगले 24 घंटे में खास बारिश नहीं दिख रही।";
  }
  if (w.rainNext5dMm != null && w.tmaxNext5dC != null) {
    line += ` पाँच दिन में कुल लगभग ${w.rainNext5dMm} मिमी बारिश, अधिकतम तापमान करीब ${w.tmaxNext5dC} डिग्री।`;
  }
  if (w.rainNext24hMm != null && w.rainNext24hMm < 2 && w.tempC >= 35) {
    line += " सिंचाई सुबह या शाम करें; दोपहर की धूप में काम टालें।";
  } else if (w.rainNext24hMm != null && w.rainNext24hMm >= 20) {
    line += " तेज़ बारिश की तैयारी रखें; खेत से जल निकासी साफ़ रखें।";
  } else {
    line += " सिंचाई से पहले मिट्टी की नमी जाँच लें।";
  }
  return line;
}

export function formatWeatherAdvisoryEn(w: OpenWeatherSnapshot): string {
  const place = w.state ? `${w.place}, ${w.state}` : w.place;
  let line =
    w.usedNearby && w.askedPlace && !placesRoughlyMatch(w.askedPlace, w.place)
      ? `Weather near ${w.askedPlace} (using ${place}): now ${w.tempC}°C (${w.description}), humidity ${w.humidityPct}%.`
      : `Weather for ${place}: now ${w.tempC}°C (${w.description}), humidity ${w.humidityPct}%.`;
  if (w.rainNext24hMm != null) {
    line +=
      w.rainNext24hMm > 0.5
        ? ` About ${w.rainNext24hMm} mm rain likely in the next 24 hours.`
        : " Little rain expected in the next 24 hours.";
  }
  if (w.rainNext5dMm != null && w.tmaxNext5dC != null) {
    line += ` Over 5 days ~${w.rainNext5dMm} mm rain, highs near ${w.tmaxNext5dC}°C.`;
  }
  line += " Check soil moisture before irrigating.";
  return line;
}
