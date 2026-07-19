// GET /api/weather?district=Kanpur+Dehat&state=Uttar+Pradesh
//     /api/weather?lat=26.35&lon=79.97&place=Kanpur+Dehat
//     /api/weather?q=Noida+Nalgadha+region
// Uses OpenWeatherMap + Gemini place resolution (nearby fallback).

import { NextRequest, NextResponse } from "next/server";
import {
  fetchOpenWeatherByCoords,
  fetchOpenWeatherSmart,
  formatWeatherAdvisoryEn,
  formatWeatherAdvisoryHi,
  openWeatherApiKey,
  type OpenWeatherSnapshot,
} from "@/lib/openweather";

export type WeatherApiResponse = {
  weather: OpenWeatherSnapshot | null;
  textHi: string;
  textEn: string;
  source: "openweathermap" | "cached";
  generatedAt: string;
};

export async function GET(req: NextRequest) {
  if (!openWeatherApiKey()) {
    return NextResponse.json(
      {
        error: "OPENWEATHERMAP_API_KEY not configured",
        weather: null,
        textHi: "मौसम सेवा अभी उपलब्ध नहीं है। कृपया थोड़ी देर बाद फिर कोशिश करें।",
        textEn: "Weather service is not configured.",
        source: "cached",
        generatedAt: new Date().toISOString(),
      } satisfies WeatherApiResponse & { error: string },
      { status: 503 },
    );
  }

  const sp = req.nextUrl.searchParams;
  const lat = Number.parseFloat(sp.get("lat") ?? "");
  const lon = Number.parseFloat(sp.get("lon") ?? "");
  const district = sp.get("district")?.trim() || sp.get("q")?.trim() || "";
  const state = sp.get("state")?.trim() || null;
  const placeHint = sp.get("place")?.trim() || district;

  try {
    let weather: OpenWeatherSnapshot;

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      weather = await fetchOpenWeatherByCoords(lat, lon, placeHint || undefined);
      if (state) weather = { ...weather, state };
    } else if (district) {
      const q = state ? `${district}, ${state}` : district;
      weather = await fetchOpenWeatherSmart(q);
    } else {
      return NextResponse.json({ error: "district or lat/lon required" }, { status: 400 });
    }

    const response: WeatherApiResponse = {
      weather,
      textHi: formatWeatherAdvisoryHi(weather),
      textEn: formatWeatherAdvisoryEn(weather),
      source: "openweathermap",
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error("weather openweathermap error:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        weather: null,
        textHi: "मौसम अभी उपलब्ध नहीं है। कृपया थोड़ी देर बाद फिर कोशिश करें।",
        textEn: "Weather is temporarily unavailable. Please try again shortly.",
        source: "cached",
        generatedAt: new Date().toISOString(),
      } satisfies WeatherApiResponse,
      { status: 502 },
    );
  }
}
