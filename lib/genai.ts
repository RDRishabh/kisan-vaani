import type { GoogleGenAI } from "@google/genai";

// Resilient Gemini call: retry on the fallback model when the primary is
// throttled (429) or unavailable to the API key (404 / legacy model sunset).
type GenParams = Omit<Parameters<GoogleGenAI["models"]["generateContent"]>[0], "model">;

function shouldRetryOnFallback(err: unknown, primary: string, fallback: string): boolean {
  if (fallback === primary) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /429|RESOURCE_EXHAUSTED|quota/i.test(msg) ||
    /404|NOT_FOUND|no longer available/i.test(msg)
  );
}

export async function generateContentResilient(ai: GoogleGenAI, params: GenParams) {
  const primary = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const fallback = process.env.GEMINI_MODEL_FALLBACK || "gemini-3.1-flash-lite";
  try {
    return await ai.models.generateContent({ model: primary, ...params });
  } catch (err) {
    if (!shouldRetryOnFallback(err, primary, fallback)) throw err;
    console.error(`gemini ${primary} unavailable — retrying on ${fallback}`);
    return await ai.models.generateContent({ model: fallback, ...params });
  }
}
