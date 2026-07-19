"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronDown,
  CloudRain,
  Droplet,
  Droplets,
  FileText,
  LocateFixed,
  MapPin,
  Snowflake,
  Sprout,
  Sun,
  TriangleAlert,
  Volume2,
  Waves,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { DISTRICTS, type District } from "@/lib/districts";
import { irrigationAdvice } from "@/lib/irrigation";
import { speak, stopSpeaking } from "@/lib/speech";
import type { WaterSource } from "@/lib/agronomy";
import type { MandiResponse, MandiRow, RecommendResponse, SoilSnapshot, WeatherSnapshot } from "@/lib/types";

type ProfileData = {
  soil: SoilSnapshot;
  weather: WeatherSnapshot;
  shcNote?: string;
  soilType?: { key: string; en: string; hi: string; wrbClass: string | null };
  extras?: { cecCmolKg: number | null; next7dRainMm: number | null };
};

type Season = "Kharif" | "Rabi" | "Zaid";
type Phase = "form" | "results";

const SEASONS: { id: Season; icon: LucideIcon; hi: string; months: string }[] = [
  { id: "Kharif", icon: CloudRain, hi: "खरीफ", months: "Jun–Oct" },
  { id: "Rabi", icon: Snowflake, hi: "रबी", months: "Nov–Mar" },
  { id: "Zaid", icon: Sun, hi: "ज़ायद", months: "Apr–Jun" },
];

const WATER_OPTIONS: { id: WaterSource; icon: LucideIcon; en: string; hi: string }[] = [
  { id: "rainfed", icon: CloudRain, en: "Rainfed", hi: "सिर्फ बारिश" },
  { id: "canal", icon: Waves, en: "Canal", hi: "नहर" },
  { id: "borewell", icon: Droplet, en: "Borewell", hi: "बोरवेल" },
  { id: "drip", icon: Droplets, en: "Drip", hi: "ड्रिप" },
];

const LOAD_STAGES = [
  "Reading satellite soil grids (ISRIC, 250 m)…",
  "Checking Soil Health Card records…",
  "Fetching 16-day forecast (Open-Meteo)…",
  "Applying ICAR agronomy (Gemini)…",
];

function defaultSeason(): Season {
  const m = new Date().getMonth(); // 0-11
  if (m >= 5 && m <= 9) return "Kharif";
  if (m >= 10 || m <= 1) return "Rabi";
  return "Zaid";
}

function nearestDistrict(lat: number, lon: number): District {
  let best = DISTRICTS[0];
  let bestD = Infinity;
  for (const d of DISTRICTS) {
    // Equirectangular approximation is plenty at district scale
    const dx = (d.lon - lon) * Math.cos(((d.lat + lat) / 2) * (Math.PI / 180));
    const dy = d.lat - lat;
    const dist = dx * dx + dy * dy;
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

function todayDdMmYyyy(): string {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" })
    .format(new Date())
    .split("-");
  return `${d}-${m}-${y}`;
}

const num = (s: string): number | undefined => {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
};

export default function RecommendClient() {
  // ---- Form state ----
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<District | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [geoState, setGeoState] = useState<"idle" | "locating" | "error">("idle");
  const [season, setSeason] = useState<Season>(defaultSeason);
  const [water, setWater] = useState<WaterSource>("rainfed");
  const [acres, setAcres] = useState("2");
  const [shcOpen, setShcOpen] = useState(false);
  const [shcPh, setShcPh] = useState("");
  const [shcN, setShcN] = useState("");
  const [shcP, setShcP] = useState("");
  const [shcK, setShcK] = useState("");

  // ---- Results state ----
  const [phase, setPhase] = useState<Phase>("form");
  const [stage, setStage] = useState(0);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [rec, setRec] = useState<RecommendResponse | null>(null);
  const [recFailed, setRecFailed] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const runIdRef = useRef(0);

  useEffect(() => () => stopSpeaking(), []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DISTRICTS;
    return DISTRICTS.filter(
      (d) => d.district.toLowerCase().includes(q) || d.state.toLowerCase().includes(q),
    );
  }, [query]);

  const pickDistrict = (d: District) => {
    setSel(d);
    setQuery(`${d.district}, ${d.state}`);
    setListOpen(false);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoState("error");
      return;
    }
    setGeoState("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        pickDistrict(nearestDistrict(pos.coords.latitude, pos.coords.longitude));
        setGeoState("idle");
      },
      () => setGeoState("error"),
      { timeout: 8000 },
    );
  };

  const buildShc = () => {
    const shc = { ph: num(shcPh), n: num(shcN), p: num(shcP), k: num(shcK) };
    return shc.ph != null || shc.n != null || shc.p != null || shc.k != null ? shc : undefined;
  };
  const shcEntered = buildShc() !== undefined;

  // ---- The run: soil-profile → recommend, with staged loading narrative ----
  const run = async () => {
    const d = sel;
    if (!d) return;
    const id = ++runIdRef.current;
    stopSpeaking();
    setSpeaking(false);
    setPhase("results");
    setStage(0);
    setProfile(null);
    setRec(null);
    setRecFailed(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });

    const bump = (s: number) => {
      if (runIdRef.current === id) setStage((cur) => Math.max(cur, s));
    };
    const timers = [setTimeout(() => bump(1), 1500), setTimeout(() => bump(2), 3200)];

    let prof: ProfileData | null = null;
    try {
      const res = await fetch(
        `/api/soil-profile?lat=${d.lat}&lon=${d.lon}&state=${encodeURIComponent(d.state)}&district=${encodeURIComponent(d.district)}`,
        { signal: AbortSignal.timeout(20000) },
      );
      prof = (await res.json()) as ProfileData;
    } catch {
      prof = null; // recommend gathers its own copy server-side
    }
    timers.forEach(clearTimeout);
    if (runIdRef.current !== id) return;
    setProfile(prof);
    setStage(3);

    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: d.lat,
          lon: d.lon,
          district: d.district,
          state: d.state,
          season,
          waterSource: water,
          landAcres: num(acres) ?? 2,
          ...(buildShc() ? { shc: buildShc() } : {}),
          lang: "hi",
        }),
        signal: AbortSignal.timeout(60000),
      });
      const data = (await res.json()) as RecommendResponse;
      if (runIdRef.current !== id) return;
      setRec(data);
      setStage(4);
    } catch {
      if (runIdRef.current !== id) return;
      setRecFailed(true);
    }
  };

  const backToForm = () => {
    runIdRef.current++;
    stopSpeaking();
    setSpeaking(false);
    setPhase("form");
  };

  const toggleSpeak = () => {
    if (!rec) return;
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speak(rec.summaryVoice, "hi-IN", () => setSpeaking(false));
  };

  // Post-override snapshots win once /api/recommend responds
  const soil = rec?.soil ?? profile?.soil ?? null;
  const weather = rec?.weather ?? profile?.weather ?? null;
  const soilType = profile?.soilType ?? null;
  const topCrop = rec?.recommendations[0]?.crop ?? sel?.crops[0] ?? "Soybean";

  const irr = useMemo(() => {
    if (!weather) return null;
    const next7 =
      profile?.extras?.next7dRainMm ??
      (weather.next16dRainMm != null ? Math.round(weather.next16dRainMm * (7 / 16) * 10) / 10 : null);
    return irrigationAdvice(weather.soilMoisture, weather.et0mm, next7, topCrop);
  }, [weather, profile, topCrop]);

  const soilBadge =
    soil?.source === "shc-manual"
      ? "Soil Health Card · Government of India"
      : soil?.source === "soilgrids"
        ? "ISRIC SoilGrids · satellite"
        : "Regional estimate · Soil Health Card test recommended";
  const weatherBadge = weather?.source === "open-meteo" ? "Open-Meteo" : "Cached forecast";

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="border-b border-forest/10 bg-paper/90 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-display text-xl font-semibold text-forest">
            <Sprout className="w-[18px] h-[18px] text-forest" aria-hidden />
            KisanVaani
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/demo" className="text-ink-soft hover:text-forest">Farmer demo</Link>
            <Link href="/command" className="text-ink-soft hover:text-forest hidden sm:inline">Command center</Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6">
          <h1 className="font-display text-3xl font-semibold text-forest">क्या बोऊँ? — Crop Advisor</h1>
          <p className="text-ink-soft mt-1 max-w-2xl">
            Ranked crop recommendations for your plot, built from satellite soil grids, Soil Health Card records,
            a 16-day forecast and current mandi prices, applied against ICAR agronomy.
          </p>
        </header>

        {phase === "form" && (
          <div className="max-w-2xl rounded-2xl bg-white border border-forest/15 p-6 shadow-sm rise">
            {/* District */}
            <label className="block text-sm font-semibold text-ink mb-1.5">
              आपका जिला · Your district
            </label>
            <div className="relative">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <MapPin className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden />
                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setSel(null);
                      setListOpen(true);
                    }}
                    onFocus={() => setListOpen(true)}
                    onBlur={() => setTimeout(() => setListOpen(false), 150)}
                    placeholder="Type your district… (e.g. Sehore)"
                    className="w-full border border-forest/20 rounded-xl pl-9 pr-3 py-2.5 text-sm bg-paper focus:outline-none focus:border-forest"
                  />
                </div>
                <button
                  onClick={useMyLocation}
                  aria-label="Use my location"
                  className="shrink-0 flex items-center gap-1.5 rounded-xl border border-forest/25 px-3 py-2.5 text-sm font-medium text-forest hover:bg-leaf-mist/50 transition"
                >
                  <LocateFixed className={`w-4 h-4 ${geoState === "locating" ? "blink" : ""}`} aria-hidden />
                  <span className="hidden sm:inline">{geoState === "locating" ? "Locating…" : "Use my location"}</span>
                </button>
              </div>
              {listOpen && matches.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-forest/15 bg-white shadow-lg">
                  {matches.map((d) => (
                    <button
                      key={`${d.state}-${d.district}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickDistrict(d);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-leaf-mist/50 flex justify-between items-center"
                    >
                      <span className="font-medium">{d.district}</span>
                      <span className="text-xs text-ink-soft">{d.state}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {geoState === "error" && (
              <div className="text-xs text-clay mt-1.5">Location unavailable — please pick your district from the list.</div>
            )}

            {/* Season */}
            <label className="block text-sm font-semibold text-ink mt-5 mb-1.5">सीज़न · Season</label>
            <div className="grid grid-cols-3 gap-2">
              {SEASONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSeason(s.id)}
                  className={`rounded-xl border p-2.5 text-center transition ${
                    season === s.id ? "bg-forest text-paper border-forest" : "bg-white border-forest/15 hover:border-forest/40"
                  }`}
                >
                  <s.icon className={`w-4 h-4 mx-auto mb-1 ${season === s.id ? "text-paper" : "text-ink-soft"}`} aria-hidden />
                  <div className="text-sm font-semibold">{s.id} · {s.hi}</div>
                  <div className={`text-[11px] ${season === s.id ? "text-paper/70" : "text-ink-soft"}`}>{s.months}</div>
                </button>
              ))}
            </div>

            {/* Water source */}
            <label className="block text-sm font-semibold text-ink mt-5 mb-1.5">पानी का स्रोत · Water source</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {WATER_OPTIONS.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setWater(w.id)}
                  className={`rounded-xl border p-2.5 text-center transition ${
                    water === w.id ? "bg-forest text-paper border-forest" : "bg-white border-forest/15 hover:border-forest/40"
                  }`}
                >
                  <w.icon className={`w-4 h-4 mx-auto mb-1 ${water === w.id ? "text-paper" : "text-ink-soft"}`} aria-hidden />
                  <div className="text-sm font-semibold">{w.en}</div>
                  <div className={`text-[11px] ${water === w.id ? "text-paper/70" : "text-ink-soft"}`}>{w.hi}</div>
                </button>
              ))}
            </div>

            {/* Land size */}
            <label className="block text-sm font-semibold text-ink mt-5 mb-1.5">ज़मीन · Land size</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0.25}
                step={0.25}
                value={acres}
                onChange={(e) => setAcres(e.target.value)}
                className="w-28 border border-forest/20 rounded-xl px-3 py-2.5 text-sm bg-paper focus:outline-none focus:border-forest"
              />
              <span className="text-sm text-ink-soft">acres · एकड़</span>
            </div>

            {/* SHC accordion */}
            <div className="mt-5 rounded-xl border border-turmeric/30 bg-turmeric-soft/15 overflow-hidden">
              <button
                onClick={() => setShcOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-ink"
              >
                <span className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-ink-soft" aria-hidden />
                  I have my Soil Health Card
                  {shcEntered && (
                    <span className="flex items-center gap-1 text-leaf">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
                      entered
                    </span>
                  )}
                </span>
                <ChevronDown className={`w-4 h-4 transition-transform ${shcOpen ? "rotate-180" : ""}`} aria-hidden />
              </button>
              {shcOpen && (
                <div className="px-4 pb-4 rise">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(
                      [
                        ["pH", shcPh, setShcPh, "e.g. 7.2"],
                        ["N kg/ha", shcN, setShcN, "e.g. 240"],
                        ["P kg/ha", shcP, setShcP, "e.g. 18"],
                        ["K kg/ha", shcK, setShcK, "e.g. 310"],
                      ] as [string, string, (v: string) => void, string][]
                    ).map(([label, val, set, ph]) => (
                      <div key={label}>
                        <div className="text-[11px] font-semibold text-ink-soft mb-1">{label}</div>
                        <input
                          type="number"
                          value={val}
                          onChange={(e) => set(e.target.value)}
                          placeholder={ph}
                          className="w-full border border-forest/20 rounded-lg px-2.5 py-2 text-sm bg-white focus:outline-none focus:border-forest"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] text-ink-soft mt-2">
                    Values from your Soil Health Card override the satellite estimates.
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={run}
              disabled={!sel}
              className="mt-6 w-full rounded-xl bg-forest text-paper py-3.5 font-semibold text-base hover:bg-leaf transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              फसल सुझाव पाएं · Get recommendations
            </button>
            {!sel && <div className="text-[11px] text-ink-soft text-center mt-2">Select your district to continue.</div>}
          </div>
        )}

        {phase === "results" && (
          <div>
            <button onClick={backToForm} className="text-sm text-ink-soft hover:text-forest mb-4">
              Change details {sel && <span className="text-forest font-medium">· {sel.district}, {sel.state} · {season} · {WATER_OPTIONS.find((w) => w.id === water)?.en}</span>}
            </button>

            <div className="grid lg:grid-cols-[minmax(0,340px)_1fr] gap-6 items-start">
              {/* ============ LEFT: your land right now ============ */}
              <div className="space-y-4">
                {!soil && (
                  <div className="rounded-2xl bg-white border border-forest/15 p-5 text-sm text-ink-soft blink">
                    Reading soil data for your district…
                  </div>
                )}

                {soil && (
                  <div className="rounded-2xl bg-white border border-forest/15 p-5 shadow-sm rise">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <h2 className="font-semibold text-forest">आपकी मिट्टी · Your soil</h2>
                      <span className="text-[10px] font-semibold bg-leaf-mist text-forest rounded-full px-2 py-1 whitespace-nowrap">{soilBadge}</span>
                    </div>

                    {soilType && (
                      <div className="mb-3">
                        <div className="font-display text-xl font-semibold text-ink">{soilType.hi}</div>
                        <div className="text-xs text-ink-soft">
                          {soilType.en}
                          {soilType.wrbClass && <span> · WRB: {soilType.wrbClass}</span>}
                        </div>
                      </div>
                    )}

                    {soil.ph != null && (
                      <div className="mb-4">
                        <div className="flex justify-between text-[10px] text-ink-soft mb-1">
                          <span>4.0 acidic</span><span>7.0</span><span>9.5 alkaline</span>
                        </div>
                        <div
                          className="relative h-2.5 rounded-full"
                          style={{ background: "linear-gradient(90deg, #d97706 0%, #40916c 42%, #40916c 62%, #0369a1 100%)" }}
                        >
                          <div
                            className="absolute -top-[5px] h-[20px] w-1.5 rounded-full bg-ink border-2 border-white shadow"
                            style={{ left: `${Math.min(97, Math.max(1, ((soil.ph - 4) / 5.5) * 100))}%` }}
                          />
                        </div>
                        <div className="text-sm font-semibold mt-1.5">
                          pH {soil.ph}{" "}
                          <span className="font-normal text-ink-soft">
                            — {soil.ph < 6.5 ? "अम्लीय · acidic" : soil.ph <= 7.5 ? "उदासीन · neutral" : "क्षारीय · alkaline"}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {soil.texture && (
                        <div className="rounded-lg bg-paper-warm px-3 py-2">
                          <div className="text-[10px] text-ink-soft">TEXTURE</div>
                          <div className="font-medium capitalize">{soil.texture}</div>
                        </div>
                      )}
                      {soil.clayPct != null && (
                        <div className="rounded-lg bg-paper-warm px-3 py-2">
                          <div className="text-[10px] text-ink-soft">CLAY / SAND</div>
                          <div className="font-medium">{Math.round(soil.clayPct)}% / {soil.sandPct != null ? Math.round(soil.sandPct) : "–"}%</div>
                        </div>
                      )}
                      {soil.soc != null && (
                        <div className="rounded-lg bg-paper-warm px-3 py-2">
                          <div className="text-[10px] text-ink-soft">ORGANIC CARBON</div>
                          <div className="font-medium">{(soil.soc / 10).toFixed(2)}%</div>
                        </div>
                      )}
                      {soil.nitrogen != null && (
                        <div className="rounded-lg bg-paper-warm px-3 py-2">
                          <div className="text-[10px] text-ink-soft">NITROGEN {soil.source === "shc-manual" ? "(SHC)" : ""}</div>
                          <div className="font-medium">
                            {soil.nitrogen} {soil.source === "shc-manual" ? "kg/ha" : "g/kg"}
                          </div>
                        </div>
                      )}
                      {num(shcP) != null && (
                        <div className="rounded-lg bg-turmeric-soft/25 px-3 py-2">
                          <div className="text-[10px] text-ink-soft">PHOSPHORUS (SHC)</div>
                          <div className="font-medium">{shcP} kg/ha</div>
                        </div>
                      )}
                      {num(shcK) != null && (
                        <div className="rounded-lg bg-turmeric-soft/25 px-3 py-2">
                          <div className="text-[10px] text-ink-soft">POTASSIUM (SHC)</div>
                          <div className="font-medium">{shcK} kg/ha</div>
                        </div>
                      )}
                    </div>

                    {profile?.shcNote && (
                      <div className="mt-3 rounded-lg bg-leaf-mist/50 border border-leaf/20 px-3 py-2 text-xs text-forest">
                        {profile.shcNote}
                      </div>
                    )}
                  </div>
                )}

                {weather && (
                  <div className="rounded-2xl bg-white border border-forest/15 p-5 shadow-sm rise">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <h2 className="font-semibold text-forest">16-day outlook</h2>
                      <span className="text-[10px] font-semibold bg-sky/10 text-sky rounded-full px-2 py-1 whitespace-nowrap">{weatherBadge}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-lg bg-paper-warm px-3 py-2">
                        <div className="text-[10px] text-ink-soft">RAIN (16 DAYS)</div>
                        <div className="font-medium">{weather.next16dRainMm != null ? `${Math.round(weather.next16dRainMm)} mm` : "–"}</div>
                      </div>
                      <div className="rounded-lg bg-paper-warm px-3 py-2">
                        <div className="text-[10px] text-ink-soft">AVG MAX TEMP</div>
                        <div className="font-medium">{weather.avgTmaxC != null ? `${weather.avgTmaxC}°C` : "–"}</div>
                      </div>
                      <div className="rounded-lg bg-paper-warm px-3 py-2">
                        <div className="text-[10px] text-ink-soft">ET0 / DAY</div>
                        <div className="font-medium">{weather.et0mm != null ? `${weather.et0mm} mm` : "–"}</div>
                      </div>
                      <div className="rounded-lg bg-paper-warm px-3 py-2">
                        <div className="text-[10px] text-ink-soft">TOPSOIL MOISTURE</div>
                        <div className="font-medium">{weather.soilMoisture != null ? `${weather.soilMoisture} m³/m³` : "–"}</div>
                      </div>
                    </div>
                  </div>
                )}

                {irr && (
                  <div
                    className={`rounded-2xl border p-5 rise ${
                      irr.shouldIrrigate ? "bg-turmeric-soft/20 border-turmeric/40" : "bg-leaf-mist/50 border-leaf/30"
                    }`}
                  >
                    <div className="text-xs font-bold tracking-wide text-ink-soft mb-1.5">
                      सिंचाई सलाह · Irrigation guidance · {topCrop}
                    </div>
                    <p className="text-sm font-medium leading-relaxed">{irr.advice}</p>
                    <p className="text-[11px] text-ink-soft mt-2 leading-relaxed">{irr.reasoning}</p>
                  </div>
                )}
              </div>

              {/* ============ MAIN: recommendations ============ */}
              <div className="space-y-4">
                {!rec && !recFailed && (
                  <div className="rounded-2xl bg-white border border-forest/15 p-6 shadow-sm">
                    <div className="text-sm font-semibold text-forest mb-4">Building your recommendation…</div>
                    <div className="space-y-3">
                      {LOAD_STAGES.map((s, i) => (
                        <div key={s} className={`flex items-center gap-2.5 text-sm ${i > stage ? "text-ink-soft/40" : "text-ink"}`}>
                          {i < stage ? (
                            <CheckCircle2 className="w-4 h-4 text-leaf-bright shrink-0" aria-hidden />
                          ) : i === stage ? (
                            <span className="w-4 h-4 shrink-0 text-center text-turmeric blink leading-4">●</span>
                          ) : (
                            <span className="w-4 h-4 shrink-0 text-center leading-4">○</span>
                          )}
                          {s}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {recFailed && (
                  <div className="rounded-2xl bg-white border border-forest/15 p-6 text-center">
                    <WifiOff className="w-5 h-5 mx-auto text-ink-soft mb-2" aria-hidden />
                    <div className="text-sm text-ink-soft mb-3">The recommendation could not be fetched. Check your connection and try again.</div>
                    <button onClick={run} className="rounded-xl bg-forest text-paper px-5 py-2.5 text-sm font-semibold hover:bg-leaf transition">
                      Try again
                    </button>
                  </div>
                )}

                {rec && (
                  <>
                    {/* Voice summary */}
                    <div className="rounded-2xl bg-forest text-paper p-5 rise">
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-xs font-bold tracking-widest text-leaf-mist/80">VOICE SUMMARY — फोन पर किसान को यही सुनाया जाता है</div>
                        <span className="text-[10px] whitespace-nowrap text-leaf-mist/70">
                          {rec.source === "gemini" ? "Gemini · live" : "Generated offline"}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed mt-2">{rec.summaryVoice}</p>
                      <button
                        onClick={toggleSpeak}
                        className="mt-3 inline-flex items-center gap-2 rounded-full bg-paper/15 hover:bg-paper/25 px-4 py-2 text-sm font-medium transition"
                      >
                        <Volume2 className="w-4 h-4" aria-hidden />
                        {speaking ? "रोकें · Stop" : "सुनें · Listen (Hindi)"}
                      </button>
                    </div>

                    {rec.recommendations.map((r, i) => (
                      <div
                        key={`${r.crop}-${i}`}
                        className={`rounded-2xl bg-white border p-5 shadow-sm rise ${i === 0 ? "border-turmeric ring-1 ring-turmeric/40" : "border-forest/15"}`}
                        style={{ animationDelay: `${i * 90}ms` }}
                      >
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center font-display font-semibold ${i === 0 ? "bg-turmeric text-white" : "bg-forest text-paper"}`}>
                              {i + 1}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-display text-xl font-semibold text-forest">{r.crop}</h3>
                                <span className="text-sm text-ink-soft">{r.localName}</span>
                                {i === 0 && (
                                  <span className="text-[10px] font-bold bg-turmeric-soft/50 text-clay rounded-full px-2 py-0.5">Best match</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[11px]">
                                <span className="bg-paper-warm rounded-full px-2 py-0.5">{r.season}</span>
                                <span
                                  className={`rounded-full px-2 py-0.5 ${
                                    r.waterNeed === "low"
                                      ? "bg-leaf-mist text-forest"
                                      : r.waterNeed === "medium"
                                        ? "bg-amber-100 text-amber-800"
                                        : "bg-sky/10 text-sky"
                                  }`}
                                >
                                  {r.waterNeed} water
                                </span>
                                <span className="bg-paper-warm rounded-full px-2 py-0.5">{r.durationDays} days</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-display text-2xl font-semibold text-forest">{r.suitabilityScore}</div>
                            <div className="text-[10px] text-ink-soft -mt-0.5">suitability</div>
                            <div className="h-1.5 w-24 rounded-full bg-forest/10 overflow-hidden mt-1">
                              <div
                                className="h-full rounded-full grow-bar"
                                style={{
                                  width: `${r.suitabilityScore}%`,
                                  background: i === 0 ? "var(--turmeric)" : "var(--leaf-bright)",
                                  animationDelay: `${200 + i * 120}ms`,
                                }}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 text-sm">
                          <span className="font-semibold text-ink">{r.expectedYield}</span>
                          {r.marketOutlook && <span className="text-ink-soft"> · {r.marketOutlook}</span>}
                        </div>

                        {i === 0 && sel && <MandiStrip key={`${r.crop}|${sel.state}`} crop={r.crop} state={sel.state} />}

                        <ul className="mt-3 space-y-1.5 text-sm">
                          {r.why.map((w, k) => (
                            <li key={k} className="flex gap-2">
                              <span className="text-leaf-bright shrink-0">•</span>
                              <span>{w}</span>
                            </li>
                          ))}
                        </ul>

                        {r.risks.length > 0 && (
                          <details className="mt-3 group">
                            <summary className="text-xs font-semibold text-clay cursor-pointer select-none">
                              <span className="inline-flex items-center gap-1.5">
                                <TriangleAlert className="w-3.5 h-3.5" aria-hidden />
                                Risks to watch ({r.risks.length})
                              </span>
                            </summary>
                            <ul className="mt-2 space-y-1 text-xs text-ink-soft">
                              {r.risks.map((risk, k) => (
                                <li key={k} className="flex gap-1.5">
                                  <span className="shrink-0">–</span>
                                  <span>{risk}</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}

                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                          <div className="rounded-lg bg-paper-warm px-3 py-2">
                            <div className="text-[10px] font-bold text-ink-soft mb-0.5">SEED</div>
                            {r.inputs.seed}
                          </div>
                          <div className="rounded-lg bg-paper-warm px-3 py-2">
                            <div className="text-[10px] font-bold text-ink-soft mb-0.5">FERTILIZER</div>
                            {r.inputs.fertilizer}
                          </div>
                          <div className="rounded-lg bg-paper-warm px-3 py-2">
                            <div className="text-[10px] font-bold text-ink-soft mb-0.5">IRRIGATION</div>
                            {r.inputs.irrigation}
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                <div className="text-[11px] text-ink-soft text-center pt-2 pb-6">
                  Data sources: ISRIC SoilGrids, Soil Health Card (Government of India), Open-Meteo, Agmarknet.
                  Agronomy grounded in ICAR/SAU Package of Practices and FAO-56.
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live mandi strip for the top recommendation
// ---------------------------------------------------------------------------

function MandiStrip({ crop, state }: { crop: string; state: string }) {
  const [row, setRow] = useState<MandiRow | null>(null);
  const [source, setSource] = useState<MandiResponse["source"] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/mandi?crop=${encodeURIComponent(crop)}&state=${encodeURIComponent(state)}`, {
          signal: AbortSignal.timeout(15000),
        });
        const data = (await res.json()) as MandiResponse;
        if (!alive) return;
        setRow(data.rows[0] ?? null);
        setSource(data.source);
      } catch {
        /* strip simply hides on client network failure */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [crop, state]);

  if (!loading && !row) return null;

  return (
    <div className="mt-3 rounded-xl bg-leaf-mist/40 border border-leaf/25 px-3.5 py-2.5 text-sm">
      {loading ? (
        <span className="text-ink-soft blink">Fetching current mandi price (Agmarknet)…</span>
      ) : (
        row && (
          <span>
            <b className="text-forest">₹{row.modalPrice.toLocaleString("en-IN")}/q</b>
            <span className="text-ink-soft"> modal · {row.market} mandi · {row.arrivalDate === todayDdMmYyyy() ? "today" : row.arrivalDate} · </span>
            <span className="text-[11px] font-semibold">
              {source === "data.gov.in"
                ? "data.gov.in · live"
                : source === "agmarknet"
                  ? "Agmarknet · live"
                  : "Agmarknet · cached"}
            </span>
          </span>
        )
      )}
    </div>
  );
}
