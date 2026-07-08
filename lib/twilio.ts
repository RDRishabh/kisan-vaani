// Twilio webhook helpers: request signature validation + TwiML response builders.
// Signature validation is skipped when TWILIO_AUTH_TOKEN is unset so local dev
// and preview deploys keep working without Twilio credentials.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { generateContentResilient } from "@/lib/genai";
import { FALLBACK_ADVISORY } from "@/lib/data";

// Twilio signs: base64(HMAC-SHA1(authToken, url + concat(sortedKeys.map(k => k + params[k])))).
// The URL must match what Twilio requested — reconstructed from the forwarded
// host since the app runs behind Vercel's proxy.
export function validateTwilioSignature(
  req: NextRequest,
  params: Record<string, string>,
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return true; // no credentials configured — skip validation

  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return false;

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const url = `https://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;

  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");

  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Collect string form fields into the shape signature validation expects.
export async function formParams(req: NextRequest): Promise<Record<string, string>> {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function twiml(xmlInner: string): NextResponse {
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${xmlInner}</Response>`,
    { headers: { "Content-Type": "text/xml; charset=utf-8" } },
  );
}

export function forbiddenTwiml(): NextResponse {
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>`,
    { status: 403, headers: { "Content-Type": "text/xml; charset=utf-8" } },
  );
}

// Text advisory shared by the SMS and WhatsApp webhooks. Bounded at 12s so the
// webhook answers inside Twilio's 15s limit; any failure returns the canned
// Hindi fallback so the number always replies.
const TEXT_ADVISORY_BUDGET_MS = 12_000;

export async function textAdvisory(body: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return FALLBACK_ADVISORY.hi.sms;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await Promise.race([
      generateContentResilient(ai, {
        contents: `A farmer sent this message to the KisanVaani crop advisory line (may be shorthand code or a full sentence): "${body}"`,
        config: {
          systemInstruction: `You are KisanVaani, an expert Indian agricultural extension advisor (like a Krishi Vigyan Kendra scientist). You give practical, safe, low-cost advice suited to smallholder farmers in India. Prefer IPM/organic first, then chemical options with exact dosages.
Reply in the same Indian language as the farmer's message, in its native script. If the message is Latin-script shorthand or English crop codes, reply in Hindi (Devanagari script).
This reply will be sent as an SMS to a basic feature phone.
- Maximum 300 characters total.
- Include: likely problem, 1-2 concrete actions with exact dosage (e.g. "नीम तेल 5ml/L"), and the Kisan Call Centre number 1800-180-1551.
- No markdown, no emojis.`,
          temperature: 0.4,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("gemini budget exceeded")), TEXT_ADVISORY_BUDGET_MS),
      ),
    ]);
    const text = result.text?.trim();
    if (!text) throw new Error("empty response");
    return text.slice(0, 320);
  } catch (err) {
    console.error("telephony text advisory gemini error:", err instanceof Error ? err.message : err);
    return FALLBACK_ADVISORY.hi.sms;
  }
}

// Base URL for self-calls to sibling API routes (mandi, diagnose).
// Local dev runs plain http; anything behind a proxy is https.
export function selfBaseUrl(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (/^(localhost|127\.0\.0\.1)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
