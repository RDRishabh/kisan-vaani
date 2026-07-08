// POST /api/telephony/whatsapp — Twilio WhatsApp sandbox webhook (form-encoded).
// Photo message (NumMedia>0): download the media with Twilio basic auth, self-call
// /api/diagnose (reusing its schema + fallbacks), reply with a compact diagnosis.
// Text message: same advisory path as SMS. Replies are plain text — no markdown.

import type { NextRequest } from "next/server";
import {
  escapeXml,
  forbiddenTwiml,
  formParams,
  selfBaseUrl,
  textAdvisory,
  twiml,
  validateTwilioSignature,
} from "@/lib/twilio";

const MEDIA_TIMEOUT_MS = 10_000;
const DIAGNOSE_TIMEOUT_MS = 25_000;

type DiagnoseResult = {
  is_plant: boolean;
  plant: string;
  disease_en: string;
  disease_local: string;
  confidence: number;
  severity: "low" | "medium" | "high";
  treatment_organic: string[];
  treatment_chemical: string[];
  urgency: string;
};

async function fetchMediaBase64(url: string): Promise<{ data: string; mimeType: string }> {
  // Twilio media URLs require basic auth (Account SID : Auth Token).
  const sid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const token = process.env.TWILIO_AUTH_TOKEN ?? "";
  const headers: Record<string, string> = {};
  if (sid && token) {
    headers.Authorization = `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
  }
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`media fetch HTTP ${res.status}`);
  const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const data = Buffer.from(await res.arrayBuffer()).toString("base64");
  return { data, mimeType };
}

async function diagnosePhoto(req: NextRequest, mediaUrl: string): Promise<string> {
  const { data, mimeType } = await fetchMediaBase64(mediaUrl);
  const res = await fetch(`${selfBaseUrl(req)}/api/diagnose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: data, mimeType, lang: "hi" }),
    signal: AbortSignal.timeout(DIAGNOSE_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`diagnose HTTP ${res.status}`);
  const d = (await res.json()) as DiagnoseResult;

  if (!d.is_plant) {
    return "किसानवाणी: यह फोटो फसल या पत्ती की नहीं लग रही। कृपया प्रभावित पौधे की साफ़ फोटो भेजें।";
  }

  const severityHi = d.severity === "high" ? "गंभीर" : d.severity === "medium" ? "मध्यम" : "हल्का";
  const lines = [
    `किसानवाणी निदान — ${d.plant}`,
    `रोग: ${d.disease_local} (${d.disease_en}) — भरोसा ${d.confidence}%, स्तर: ${severityHi}`,
  ];
  if (d.treatment_organic[0]) lines.push(`जैविक उपाय: ${d.treatment_organic[0]}`);
  if (d.treatment_chemical[0]) lines.push(`रासायनिक उपाय: ${d.treatment_chemical[0]}`);
  if (d.urgency) lines.push(d.urgency);
  lines.push("मदद: 1800-180-1551");
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  const params = await formParams(req);
  if (!validateTwilioSignature(req, params)) return forbiddenTwiml();

  const numMedia = Number.parseInt(params.NumMedia ?? "0", 10) || 0;
  const body = (params.Body ?? "").trim();

  let reply: string;
  if (numMedia > 0 && params.MediaUrl0) {
    try {
      reply = await diagnosePhoto(req, params.MediaUrl0);
    } catch (err) {
      console.error("telephony whatsapp diagnose error:", err instanceof Error ? err.message : err);
      reply =
        "किसानवाणी: फोटो की जाँच अभी नहीं हो पाई। कृपया कुछ देर बाद दोबारा भेजें, या समस्या लिखकर भेजें। मदद: 1800-180-1551";
    }
  } else if (body) {
    reply = await textAdvisory(body);
  } else {
    reply =
      "किसानवाणी में आपका स्वागत है। फसल की समस्या लिखकर भेजें, या प्रभावित पौधे की फोटो भेजें।";
  }

  return twiml(`<Message>${escapeXml(reply)}</Message>`);
}
