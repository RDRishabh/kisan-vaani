// Twilio webhook helpers: request signature validation + TwiML response builders.
// Signature validation is skipped when TWILIO_AUTH_TOKEN is unset so local dev
// and preview deploys keep working without Twilio credentials.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { FALLBACK_ADVISORY } from "@/lib/data";
import {
  followupPrompt,
  isOtherOptionChoice,
  resolveOptionChoice,
  runAdvisoryTurn,
  SMS_ASK_FREEFORM,
  SMS_FOLLOWUP_MENU,
  splitSmsAdvisoryParts,
  type AdvisoryMessage,
} from "@/lib/advisory-flow";
import {
  clearAdvisorySession,
  getAdvisorySession,
  saveAdvisorySession,
} from "@/lib/advisory-session";
import {
  extractPlaceFromWeatherQuery,
  isMandiIntent,
  isWeatherIntent,
  SMS_ASK_WEATHER_DISTRICT,
} from "@/lib/helpline-intent";
import { handleMandiInput, mandiEntryMenu, type MandiMenuHandlerResult } from "@/lib/mandi-handler";
import {
  appBaseUrl,
  fetchMandiPriceText,
  startMandiContext,
} from "@/lib/mandi-flow";
import {
  fetchOpenWeatherSmart,
  formatWeatherAdvisoryHi,
  openWeatherApiKey,
} from "@/lib/openweather";

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

async function smsWeatherReply(phone: string, place: string, lang: string): Promise<string[]> {
  const follow = followupPrompt("sms");
  if (!openWeatherApiKey()) {
    const msg = "मौसम सेवा अभी उपलब्ध नहीं है। कृपया थोड़ी देर बाद फिर कोशिश करें।";
    saveAdvisorySession(phone, {
      history: [],
      options: follow.options,
      phase: "followup",
      lang,
      lastAnswer: msg,
    });
    return [msg, follow.text];
  }

  try {
    const weather = await fetchOpenWeatherSmart(place);
    const text = formatWeatherAdvisoryHi(weather);
    saveAdvisorySession(phone, {
      history: [],
      options: follow.options,
      phase: "followup",
      lang,
      lastAnswer: text,
    });
    return [text, follow.text];
  } catch (err) {
    console.error("sms weather error:", err instanceof Error ? err.message : err);
    const msg = "मौसम अभी उपलब्ध नहीं है। कृपया थोड़ी देर बाद फिर कोशिश करें।";
    saveAdvisorySession(phone, {
      history: [],
      options: follow.options,
      phase: "followup",
      lang,
      lastAnswer: msg,
    });
    return [msg, follow.text];
  }
}

function startSmsMandi(phone: string, lang: string): string[] {
  const entry = mandiEntryMenu("sms");
  saveAdvisorySession(phone, {
    history: [],
    options: entry.options,
    phase: "mandi",
    mandi: entry.mandi,
    lang,
    lastAnswer: entry.text,
  });
  return [entry.text];
}

export async function textAdvisory(body: string, from?: string): Promise<string[]> {
  const phone = from ?? "anonymous";
  const session = getAdvisorySession(phone);
  const history = session?.history ?? [];
  const phase = session?.phase;
  const priorOptions = session?.options;
  const lang = session?.lang ?? "hi";

  // Follow-up menu — handle 1 / 2 / 3 strictly before running a new advisory turn.
  if (phase === "followup" && priorOptions?.length) {
    const choice = resolveOptionChoice(body, priorOptions);
    if (choice) {
      if (/done|bas|dhanyavaad|thank/i.test(choice)) {
        clearAdvisorySession(phone);
        return ["किसानवाणी: धन्यवाद। कभी भी 1800-180-1551 पर कॉल करें।"];
      }
      if (/mandi|bhav|price/i.test(choice)) {
        return startSmsMandi(phone, lang);
      }
      if (choice === priorOptions[0] || /aur|krishi|samasy|prashn|fasal/i.test(choice)) {
        saveAdvisorySession(phone, {
          history: [],
          options: [],
          phase: undefined,
          lang,
          lastAnswer: "अपनी फसल की समस्या या कृषि से जुड़ा प्रश्न लिखकर भेजें।",
        });
        return ["अपनी फसल की समस्या या कृषि से जुड़ा प्रश्न लिखकर भेजें।"];
      }
    }
  }

  // Weather — awaiting place name, or free-text weather intent (OpenWeatherMap).
  if (phase === "weather") {
    return smsWeatherReply(phone, body.trim(), lang);
  }

  // Mandi — pan-India freeform: district → (state if needed) → crop.
  if (phase === "mandi") {
    const mandi = session?.mandi ?? startMandiContext();
    const result = handleMandiInput(body, mandi, "sms", false);

    if (result.kind === "price") {
      const { text: priceText } = await fetchMandiPriceText(
        result.commodity,
        result.state,
        appBaseUrl(),
        TEXT_ADVISORY_BUDGET_MS,
        result.district,
      );
      const follow = followupPrompt("sms");
      const fullReply = `${priceText}\n\n${follow.text}`;
      saveAdvisorySession(phone, {
        history: session?.history ?? [],
        options: follow.options,
        phase: "followup",
        lang,
        lastAnswer: fullReply,
      });
      return [priceText, follow.text];
    }

    const menu = result as MandiMenuHandlerResult;
    saveAdvisorySession(phone, {
      history: session?.history ?? [],
      options: menu.options,
      phase: "mandi",
      mandi: menu.mandi,
      lang,
      lastAnswer: menu.text,
    });
    return menu.kind === "invalid" ? [menu.text.split("\n\n")[0] ?? menu.text, menu.text] : [menu.text];
  }

  // Free-text intents — before Gemini clarify (so "Weather in Noida" never becomes a crop menu).
  if (isWeatherIntent(body)) {
    const place = extractPlaceFromWeatherQuery(body);
    if (place) return smsWeatherReply(phone, place, lang);
    saveAdvisorySession(phone, {
      history: [],
      options: [],
      phase: "weather",
      lang,
      lastAnswer: SMS_ASK_WEATHER_DISTRICT,
    });
    return [SMS_ASK_WEATHER_DISTRICT];
  }

  if (isMandiIntent(body)) {
    return startSmsMandi(phone, lang);
  }

  // Clarify: options don't match — ask them to write freely (no SMS 0-repeat).
  if (phase === "clarify" && isOtherOptionChoice(body.trim())) {
    saveAdvisorySession(phone, {
      history,
      options: [],
      phase: "clarify",
      lang: session?.lang ?? "hi",
      lastAnswer: SMS_ASK_FREEFORM,
    });
    return [SMS_ASK_FREEFORM];
  }

  let farmerText = body.trim();
  const mapped = resolveOptionChoice(farmerText, priorOptions);
  if (mapped) farmerText = mapped;

  const turn = await Promise.race([
    runAdvisoryTurn({
      query: farmerText,
      history,
      lang: session?.lang ?? "hi",
      channel: "sms",
    }),
    new Promise<Awaited<ReturnType<typeof runAdvisoryTurn>>>((_, reject) =>
      setTimeout(() => reject(new Error("gemini budget exceeded")), TEXT_ADVISORY_BUDGET_MS),
    ),
  ]).catch((err) => {
    console.error("telephony text advisory error:", err instanceof Error ? err.message : err);
    return { phase: "advise" as const, text: FALLBACK_ADVISORY.hi.sms, source: "fallback" as const };
  });

  const nextHistory: AdvisoryMessage[] = [...history, { role: "farmer", text: farmerText }];

  if (turn.phase === "clarify") {
    saveAdvisorySession(phone, {
      history: [...nextHistory, { role: "advisor", text: turn.text, kind: "clarify" }],
      options: turn.options,
      phase: "clarify",
      lang: session?.lang ?? "hi",
      lastAnswer: turn.text,
    });
    return [turn.text.slice(0, 480)];
  }

  const follow = followupPrompt("sms");
  const [advicePart, menuPart] = splitSmsAdvisoryParts(turn.text);
  const fullReply = `${advicePart}\n\n${menuPart}`;
  saveAdvisorySession(phone, {
    history: [
      ...nextHistory,
      { role: "advisor", text: turn.text, kind: "advise" },
      { role: "advisor", text: follow.text, kind: "followup" },
    ],
    options: follow.options,
    phase: "followup",
    lang,
    lastAnswer: fullReply,
  });
  return [advicePart, menuPart];
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
