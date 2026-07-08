import type { GoogleGenAI } from "@google/genai";

// Resilient Gemini call: if the primary model hits a quota/429 throttle,
// retry once on the fallback model (separate free-tier quota bucket).
type GenParams = Omit<Parameters<GoogleGenAI["models"]["generateContent"]>[0], "model">;

export async function generateContentResilient(ai: GoogleGenAI, params: GenParams) {
  const primary = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const fallback = process.env.GEMINI_MODEL_FALLBACK || "gemini-2.5-flash-lite";
  try {
    return await ai.models.generateContent({ model: primary, ...params });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/429|RESOURCE_EXHAUSTED|quota/i.test(msg) || fallback === primary) throw err;
    console.error(`gemini ${primary} throttled — retrying on ${fallback}`);
    return await ai.models.generateContent({ model: fallback, ...params });
  }
}
