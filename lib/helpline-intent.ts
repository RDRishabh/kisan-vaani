// Detect mandi-bhav / weather intents from free SMS or spoken text (pan-India helpline).

const WEATHER_RE =
  /(?:weather|mausam|मौसम|tapmaan|तापमान|temperature|forecast|बारिश|barish|\brain\b|humidity|नमी|हवा\s*का\s*मूड)/iu;

const MANDI_RE =
  /(?:mandi|मंडी|bhav|भाव|market\s*price|mandibhav|मंडीभाव|आज\s*का\s*भाव|दर\s*क्या|price\s*of|भाव\s*बता)/iu;

export function isWeatherIntent(text: string): boolean {
  return WEATHER_RE.test(text.trim());
}

export function isMandiIntent(text: string): boolean {
  return MANDI_RE.test(text.trim());
}

/** Pull place name from messages like "Weather in Noida Nalgadha region". */
export function extractPlaceFromWeatherQuery(text: string): string | null {
  let t = text.trim();
  if (!t) return null;

  t = t.replace(
    /^(please|pls|kripaya|कृपया|tell\s+me|what(?:'s|\s+is)|mujhe|मुझे)\s+/iu,
    "",
  );
  t = t.replace(WEATHER_RE, " ");
  t = t.replace(
    /\b(in|at|for|of|about|around|near|ka|ki|ke|mein|में|का|की|के|region|area|jila|जिला|district|wether)\b/giu,
    " ",
  );
  t = t.replace(/[?!.]+/g, " ");
  t = t.replace(/\s+/g, " ").trim();

  if (t.length < 2) return null;
  // Drop trailing filler words
  t = t.replace(/\b(region|area|please|pls)$/iu, "").trim();
  return t.length >= 2 ? t : null;
}

export const SMS_ASK_WEATHER_DISTRICT =
  "मौसम जानने के लिए अपने जिले या शहर का नाम लिखकर भेजें (भारत का कोई भी स्थान)।";

export const IVR_ASK_WEATHER_DISTRICT =
  "मौसम सलाह — बीप के बाद अपने जिले या शहर का नाम बोलें। भारत का कोई भी स्थान चलता है।";
