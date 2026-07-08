// POST /api/telephony/sms — Twilio SMS webhook (form-encoded, TwiML <Message> reply).
// Farmer texts a crop problem (native script or Latin shorthand like "KAPAS PILA
// PATTA"); reply is a <=300-char advisory. Gemini failure degrades to the canned
// Hindi fallback so the number always answers.

import type { NextRequest } from "next/server";
import { logQuery } from "@/lib/db";
import {
  escapeXml,
  forbiddenTwiml,
  formParams,
  textAdvisory,
  twiml,
  validateTwilioSignature,
} from "@/lib/twilio";

export async function POST(req: NextRequest) {
  const params = await formParams(req);
  if (!validateTwilioSignature(req, params)) return forbiddenTwiml();

  const body = (params.Body ?? "").trim();
  if (!body) {
    return twiml(
      `<Message>${escapeXml("किसानवाणी: फसल का नाम और समस्या लिखकर भेजें। उदाहरण: KAPAS PILA PATTA")}</Message>`,
    );
  }

  const reply = await textAdvisory(body);
  logQuery({ channel: "sms", lang: "hi", query: body, responseSource: "telephony-live" });
  return twiml(`<Message>${escapeXml(reply)}</Message>`);
}
