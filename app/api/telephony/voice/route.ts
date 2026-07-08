// POST /api/telephony/voice — Twilio voice webhook (form-encoded TwiML IVR).
// Stateless menu machine keyed on ?step=; Twilio replays the URL per turn.
// Trial-account calls begin with Twilio's own preamble before this greeting.

import type { NextRequest } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { generateContentResilient } from "@/lib/genai";
import { FALLBACK_ADVISORY } from "@/lib/data";
import { logQuery } from "@/lib/db";
import type { MandiResponse } from "@/lib/types";
import {
  escapeXml,
  forbiddenTwiml,
  formParams,
  selfBaseUrl,
  twiml,
  validateTwilioSignature,
} from "@/lib/twilio";

const GEMINI_BUDGET_MS = 12_000;
const MANDI_TIMEOUT_MS = 8_000;
const SAY_MAX_CHARS = 800; // Twilio caps <Say> at 4096; brevity keeps latency down

const VOICE_ATTRS = `voice="Polly.Aditi" language="hi-IN"`;

const GREETING =
  "नमस्ते! किसानवाणी में आपका स्वागत है। फसल की समस्या बताने के लिए एक दबाएँ या अपनी समस्या बोलें। मंडी भाव के लिए दो दबाएँ।";
const ASK_PROBLEM = "बीप के बाद अपनी फसल की समस्या बताएँ। बोलने के बाद कुछ पल रुकें।";
const GOODBYE = "किसानवाणी को कॉल करने के लिए धन्यवाद। नमस्ते।";
const NOT_HEARD = "माफ़ कीजिए, आवाज़ समझ नहीं आई।";
const ANOTHER_QUESTION = "एक और सवाल पूछने के लिए एक दबाएँ, या फ़ोन रख दें।";

function say(text: string): string {
  return `<Say ${VOICE_ATTRS}>${escapeXml(text.slice(0, SAY_MAX_CHARS))}</Say>`;
}

function gather(action: string, inner: string, opts?: { speechOnly?: boolean }): string {
  const input = opts?.speechOnly ? `input="speech"` : `input="dtmf speech" numDigits="1"`;
  return `<Gather ${input} language="hi-IN" speechTimeout="auto" action="${action}" method="POST">${inner}</Gather>`;
}

async function mandiSayText(req: NextRequest): Promise<string> {
  try {
    const res = await fetch(
      `${selfBaseUrl(req)}/api/mandi?crop=Soybean&state=Madhya+Pradesh`,
      { signal: AbortSignal.timeout(MANDI_TIMEOUT_MS), cache: "no-store" },
    );
    if (!res.ok) throw new Error(`mandi HTTP ${res.status}`);
    const body = (await res.json()) as MandiResponse;
    const top = body.rows[0];
    if (!top) throw new Error("mandi returned no rows");
    return `सोयाबीन का ताज़ा भाव: ${top.market} मंडी, ${top.district} में ${top.modalPrice} रुपये प्रति क्विंटल। न्यूनतम ${top.minPrice}, अधिकतम ${top.maxPrice} रुपये।`;
  } catch (err) {
    console.error("telephony mandi error:", err instanceof Error ? err.message : err);
    return "मंडी भाव अभी उपलब्ध नहीं है। कृपया थोड़ी देर बाद फिर कोशिश करें।";
  }
}

async function generateAnswer(question: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return FALLBACK_ADVISORY.hi.ivr;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await Promise.race([
      generateContentResilient(ai, {
        contents: `A farmer called the KisanVaani crop advisory line and said: "${question}"`,
        config: {
          systemInstruction: `You are KisanVaani, an expert Indian agricultural extension advisor (like a Krishi Vigyan Kendra scientist). You give practical, safe, low-cost advice suited to smallholder farmers in India. Prefer IPM/organic first, then chemical options with exact dosages. Respond ONLY in Hindi (Devanagari script).
This reply will be READ ALOUD over a phone call (IVR) to a farmer who may not read or write.
- Spoken, warm, conversational style — like a trusted agriculture officer.
- 60-90 words. Short sentences.
- Say numbers and dosages in words where natural.
- No markdown, no lists, no symbols — pure speakable text.`,
          temperature: 0.4,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("gemini budget exceeded")), GEMINI_BUDGET_MS),
      ),
    ]);
    const text = result.text?.trim();
    if (!text) throw new Error("empty response");
    return text;
  } catch (err) {
    console.error("telephony voice gemini error:", err instanceof Error ? err.message : err);
    return FALLBACK_ADVISORY.hi.ivr;
  }
}

export async function POST(req: NextRequest) {
  const params = await formParams(req);
  if (!validateTwilioSignature(req, params)) return forbiddenTwiml();

  const step = req.nextUrl.searchParams.get("step");
  const digits = params.Digits ?? "";
  const speech = (params.SpeechResult ?? "").trim();

  if (step === "menu") {
    if (digits === "2") {
      const priceText = await mandiSayText(req);
      return twiml(
        say(priceText) +
          gather("/api/telephony/voice?step=menu", say(GREETING)) +
          say(GOODBYE),
      );
    }
    // Digit 1, any other digit, or spoken input: route to the problem prompt.
    // If the caller already spoke their problem at the menu, answer it directly.
    if (speech.length > 8) {
      const reply = await generateAnswer(speech);
      logQuery({ channel: "call", lang: "hi", query: speech, responseSource: "telephony-live" });
      return twiml(
        say(reply) +
          gather("/api/telephony/voice?step=menu", say(ANOTHER_QUESTION)) +
          say(GOODBYE),
      );
    }
    return twiml(
      gather("/api/telephony/voice?step=answer", say(ASK_PROBLEM), { speechOnly: true }) +
        say(GOODBYE),
    );
  }

  if (step === "answer") {
    if (!speech) {
      return twiml(
        gather("/api/telephony/voice?step=answer", say(`${NOT_HEARD} ${ASK_PROBLEM}`), {
          speechOnly: true,
        }) + say(GOODBYE),
      );
    }
    const reply = await generateAnswer(speech);
    logQuery({ channel: "call", lang: "hi", query: speech, responseSource: "telephony-live" });
    return twiml(
      say(reply) +
        gather("/api/telephony/voice?step=menu", say(ANOTHER_QUESTION)) +
        say(GOODBYE),
    );
  }

  // New call: greeting + main menu.
  return twiml(gather("/api/telephony/voice?step=menu", say(GREETING)) + say(GOODBYE));
}
