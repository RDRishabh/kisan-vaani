import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { generateContentResilient } from "@/lib/genai";
import { FALLBACK_ADVISORY, type Lang } from "@/lib/data";
import { LANG_NAME_FOR_PROMPT } from "@/lib/i18n-full";
import { logQuery } from "@/lib/db";

// Fallback advisories exist for hi/en/mr/te; every other language code degrades to Hindi.
function fallbackText(lang: string, channel: "ivr" | "sms"): string {
  const known: Lang = lang === "hi" || lang === "en" || lang === "mr" || lang === "te" ? lang : "hi";
  return FALLBACK_ADVISORY[known][channel];
}

export async function POST(req: NextRequest) {
  let parsed: { query?: string; lang?: string; channel?: "ivr" | "sms" };
  try {
    parsed = (await req.json()) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { query = "", lang = "hi", channel = "ivr" } = parsed;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logQuery({ channel: channel === "sms" ? "sms" : "call", lang, query, responseSource: "fallback" });
    return NextResponse.json({ text: fallbackText(lang, channel), source: "fallback" });
  }

  const channelRules =
    channel === "sms"
      ? `This reply will be sent as an SMS to a basic feature phone.
- Maximum 300 characters total.
- Use the native script of the language.
- Include: likely problem, 1-2 concrete actions with exact dosage (e.g. "नीम तेल 5ml/L"), and the Kisan Call Centre number 1800-180-1551.
- No markdown, no emojis except at most one ⚠️.`
      : `This reply will be READ ALOUD over a phone call (IVR) to a farmer who may not read or write.
- Spoken, warm, conversational style — like a trusted agriculture officer.
- 60-90 words. Short sentences.
- Say numbers and dosages in words where natural.
- No markdown, no lists, no symbols — pure speakable text.
- End by telling them they can call again anytime.`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await generateContentResilient(ai, {
      contents: `A farmer contacted the KisanVaani crop advisory line. Their message (may be shorthand SMS code or spoken sentence): "${query}"`,
      config: {
        systemInstruction: `You are KisanVaani, an expert Indian agricultural extension advisor (like a Krishi Vigyan Kendra scientist). You give practical, safe, low-cost advice suited to smallholder farmers in India. Prefer IPM/organic first, then chemical options with exact dosages. Respond ONLY in ${LANG_NAME_FOR_PROMPT[lang] || LANG_NAME_FOR_PROMPT.hi}.\n${channelRules}`,
        temperature: 0.4,
      },
    });
    const text = result.text?.trim();
    if (!text) throw new Error("empty response");
    logQuery({ channel: channel === "sms" ? "sms" : "call", lang, query, responseSource: "gemini" });
    return NextResponse.json({ text, source: "gemini" });
  } catch (err) {
    console.error("advisory gemini error:", err instanceof Error ? err.message : err);
    logQuery({ channel: channel === "sms" ? "sms" : "call", lang, query, responseSource: "fallback" });
    return NextResponse.json({ text: fallbackText(lang, channel), source: "fallback" });
  }
}
