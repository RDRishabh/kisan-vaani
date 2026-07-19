// Pan-India mandi flow — collect data.gov.in filters: District → (State if needed) → Commodity.
// Arrival_Date is set automatically on the server. No fixed pilot state/district menus.

import { OTHER_OPTION_DIGIT } from "@/lib/advisory-flow";

export type MandiStep = "district" | "state" | "crop";

export type MandiContext = {
  step: MandiStep;
  /** Official state name when known; omit from API when undefined. */
  state?: string;
  district?: string;
  /** Present when district name maps to multiple states. */
  stateCandidates?: string[];
};

const HI_CROP: Record<string, string> = {
  Soybean: "सोयाबीन",
  Soyabean: "सोयाबीन",
  Wheat: "गेहूँ",
  Cotton: "कपास",
  Tomato: "टमाटर",
  Onion: "प्याज",
  Potato: "आलू",
  "Paddy(Common)": "धान",
  Paddy: "धान",
  Sugarcane: "गन्ना",
  Maize: "मक्का",
  Mustard: "सरसों",
  Groundnut: "मूंगफली",
};

const HI_CROP_REVERSE: Record<string, string> = {
  सोयाबीन: "Soyabean",
  soybean: "Soyabean",
  soyabean: "Soyabean",
  गेहूँ: "Wheat",
  गेहूं: "Wheat",
  gehu: "Wheat",
  wheat: "Wheat",
  कपास: "Cotton",
  kapas: "Cotton",
  cotton: "Cotton",
  टमाटर: "Tomato",
  tamatar: "Tomato",
  tomato: "Tomato",
  प्याज: "Onion",
  pyaz: "Onion",
  onion: "Onion",
  आलू: "Potato",
  aloo: "Potato",
  potato: "Potato",
  धान: "Paddy(Common)",
  dhan: "Paddy(Common)",
  paddy: "Paddy(Common)",
  rice: "Paddy(Common)",
  गन्ना: "Sugarcane",
  ganna: "Sugarcane",
  sugarcane: "Sugarcane",
  मक्का: "Maize",
  makka: "Maize",
  maize: "Maize",
  सरसों: "Mustard",
  sarson: "Mustard",
  mustard: "Mustard",
  मूंगफली: "Groundnut",
  moongfali: "Groundnut",
  groundnut: "Groundnut",
};

export function mandiCropLabelHi(cropKey: string): string {
  return HI_CROP[cropKey] ?? cropKey;
}

/** Farmer crop text (any language) → data.gov.in Commodity filter. */
export function normalizeMandiCommodity(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (HI_CROP_REVERSE[trimmed]) return HI_CROP_REVERSE[trimmed];
  const lower = trimmed.toLowerCase();
  if (HI_CROP_REVERSE[lower]) return HI_CROP_REVERSE[lower];
  for (const [en, hi] of Object.entries(HI_CROP)) {
    if (trimmed === hi || lower === en.toLowerCase()) return en === "Soybean" ? "Soyabean" : en;
  }
  return trimmed;
}

/** Display place name as spoken — no hardcoded Hindi district map. */
export function mandiPlaceLabelHi(place: string): string {
  return place.trim();
}

function samePlace(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Hindi location phrase — avoid "Sehore मंडी, Sehore में" duplication. */
export function formatMandiLocationHi(market: string, district?: string): string {
  const marketLabel = mandiPlaceLabelHi(market);
  const districtTrim = district?.trim() ?? "";
  if (!districtTrim || samePlace(market, districtTrim)) {
    return `${marketLabel} मंडी में`;
  }
  return `${marketLabel} मंडी, ${mandiPlaceLabelHi(districtTrim)} जिले में`;
}

export function startMandiContext(): MandiContext {
  return { step: "district" };
}

export const IVR_MANDI_ASK_DISTRICT =
  "मंडी भाव — पहले अपने जिले का नाम बताएँ। बीप के बाद जिला बोलें।";

export const SMS_MANDI_ASK_DISTRICT =
  "मंडी भाव — पहले अपने जिले का नाम लिखकर भेजें (भारत का कोई भी जिला)।";

export const IVR_MANDI_ASK_STATE =
  "इस जिले का नाम एक से अधिक राज्यों में है। बीप के बाद अपने राज्य का नाम बोलें।";

export const SMS_MANDI_ASK_STATE =
  "इस जिले का नाम एक से अधिक राज्यों में है। अपना राज्य लिखकर भेजें।";

export const IVR_MANDI_ASK_CROP =
  "ठीक है। अब फसल का नाम बताएँ। बीप के बाद फसल बोलें, जैसे टमाटर, गेहूँ या धान।";

export const SMS_MANDI_ASK_CROP =
  "ठीक है। अब फसल का नाम लिखकर भेजें, जैसे टमाटर, गेहूँ या धान।";

export const IVR_MANDI_ASK_DISTRICT_RETRY =
  "माफ़ कीजिए, जिला समझ नहीं आया। बीप के बाद फिर से जिले का नाम बोलें।";

export const SMS_MANDI_ASK_DISTRICT_RETRY =
  "जिला समझ नहीं आया। कृपया जिले का नाम फिर से लिखकर भेजें।";

/** @deprecated use IVR_MANDI_ASK_DISTRICT */
export const IVR_MANDI_ASK_DISTRICT_FREEFORM = IVR_MANDI_ASK_DISTRICT;
/** @deprecated use SMS_MANDI_ASK_DISTRICT */
export const SMS_MANDI_ASK_DISTRICT_FREEFORM = SMS_MANDI_ASK_DISTRICT;
/** @deprecated use IVR_MANDI_ASK_CROP */
export const IVR_MANDI_ASK_FREEFORM = IVR_MANDI_ASK_CROP;
/** @deprecated use SMS_MANDI_ASK_CROP */
export const SMS_MANDI_ASK_FREEFORM = SMS_MANDI_ASK_CROP;

export const IVR_MANDI_INVALID = "माफ़ कीजिए, समझ नहीं आया। फिर से कोशिश करें।";
export const SMS_MANDI_INVALID = "समझ नहीं आया। फिर से भेजें।";

export function mandiAskForStep(step: MandiStep, channel: "ivr" | "sms"): string {
  if (step === "district") {
    return channel === "sms" ? SMS_MANDI_ASK_DISTRICT : IVR_MANDI_ASK_DISTRICT;
  }
  if (step === "state") {
    return channel === "sms" ? SMS_MANDI_ASK_STATE : IVR_MANDI_ASK_STATE;
  }
  return channel === "sms" ? SMS_MANDI_ASK_CROP : IVR_MANDI_ASK_CROP;
}

/** Alias kept for voice/twilio call sites. */
export function mandiAskFreeform(step: MandiStep, channel: "ivr" | "sms"): string {
  return mandiAskForStep(step, channel);
}

export function formatMandiCropPrompt(
  channel: "ivr" | "sms",
  district?: string,
  state?: string,
): string {
  const place = [district, state].filter(Boolean).join(", ");
  const prefix = place ? `${place} — ` : "";
  const ask = mandiAskForStep("crop", channel);
  return place ? `${prefix}${ask.replace(/^ठीक है।\s*/, "")}` : ask;
}

export function formatMandiPriceHi(params: {
  cropKey: string;
  market: string;
  district: string;
  modalPrice: number;
  minPrice?: number;
  maxPrice?: number;
  state?: string;
}): string {
  const crop = mandiCropLabelHi(params.cropKey);
  const location = formatMandiLocationHi(params.market, params.district);
  let line = `${crop} का ताज़ा भाव: ${location} ${params.modalPrice} रुपये प्रति क्विंटल।`;
  if (params.minPrice != null && params.maxPrice != null) {
    line += ` न्यूनतम ${params.minPrice}, अधिकतम ${params.maxPrice} रुपये।`;
  }
  if (params.state) line += ` (${params.state})`;
  return line;
}

export function appBaseUrl(req?: { headers: Headers; nextUrl: { protocol: string } }): string {
  if (req) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
    const proto =
      req.headers.get("x-forwarded-proto") ??
      req.nextUrl.protocol.replace(":", "") ??
      (host.includes("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  const host = process.env.VERCEL_URL ?? "localhost:3000";
  return host.includes("localhost") ? `http://${host}` : `https://${host}`;
}

export async function fetchMandiPriceText(
  crop: string,
  state: string,
  baseUrl: string,
  timeoutMs = 30_000,
  district?: string,
): Promise<{ text: string; source: string }> {
  try {
    const normalized = normalizeMandiCommodity(crop);
    const qs = new URLSearchParams({ crop: normalized });
    if (state?.trim()) qs.set("state", state.trim());
    if (district?.trim()) qs.set("district", district.trim());
    const res = await fetch(`${baseUrl}/api/mandi?${qs.toString()}`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`mandi HTTP ${res.status}`);
    const body = (await res.json()) as {
      rows: Array<{
        market: string;
        district: string;
        modalPrice: number;
        minPrice: number;
        maxPrice: number;
        state?: string;
      }>;
      source: string;
    };
    const top = body.rows[0];
    if (!top) throw new Error("mandi returned no rows");
    return {
      text: formatMandiPriceHi({
        cropKey: normalized,
        market: top.market,
        district: top.district,
        modalPrice: top.modalPrice,
        minPrice: top.minPrice,
        maxPrice: top.maxPrice,
        state: top.state ?? state,
      }),
      source: body.source,
    };
  } catch {
    return {
      text: "मंडी भाव अभी उपलब्ध नहीं है। कृपया थोड़ी देर बाद फिर कोशिश करें।",
      source: "cached",
    };
  }
}

export function isValidMandiKeypadInput(input: string): boolean {
  const trimmed = input.trim();
  return trimmed === OTHER_OPTION_DIGIT;
}
