#!/usr/bin/env node
// Point the Twilio number's Voice and SMS webhooks at the deployed KisanVaani app.
// Reads credentials from .env.local; idempotent (re-running sets the same URLs).
//
//   node scripts/configure-twilio.mjs [base-url]
//
// base-url defaults to https://kisan-vaani.vercel.app

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = process.argv[2]?.replace(/\/+$/, "") || "https://kisan-vaani.vercel.app";
const VOICE_URL = `${BASE_URL}/api/telephony/voice`;
const SMS_URL = `${BASE_URL}/api/telephony/sms`;

// --- read .env.local (no dotenv dependency) --------------------------------

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
try {
  const raw = readFileSync(resolve(projectRoot, ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  // .env.local absent — rely on process.env
}

const SID = env.TWILIO_ACCOUNT_SID;
const TOKEN = env.TWILIO_AUTH_TOKEN;
const FROM = env.TWILIO_FROM_NUMBER;

if (!SID || !TOKEN || !FROM) {
  console.error("Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER.");
  process.exit(1);
}

// --- Twilio REST via plain fetch --------------------------------------------

const API = `https://api.twilio.com/2010-04-01/Accounts/${SID}`;
const AUTH = { Authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString("base64")}` };

async function twilioGet(path) {
  const res = await fetch(`${API}${path}`, { headers: AUTH });
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function twilioPost(path, form) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) throw new Error(`POST ${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

function describe(n) {
  return [
    `  phone     ${n.phone_number}`,
    `  voice     ${n.voice_method} ${n.voice_url || "(unset)"}`,
    `  sms       ${n.sms_method} ${n.sms_url || "(unset)"}`,
  ].join("\n");
}

const list = await twilioGet("/IncomingPhoneNumbers.json?PageSize=50");
const numbers = list.incoming_phone_numbers ?? [];

console.log(`Account ${SID} has ${numbers.length} incoming number(s):`);
for (const n of numbers) console.log(`  ${n.phone_number}  (${n.friendly_name})`);

const target = numbers.find((n) => n.phone_number === FROM);
if (!target) {
  console.error(`\nNumber ${FROM} not found on this account.`);
  process.exit(1);
}

console.log(`\nBefore:\n${describe(target)}`);

if (
  target.voice_url === VOICE_URL &&
  target.voice_method === "POST" &&
  target.sms_url === SMS_URL &&
  target.sms_method === "POST"
) {
  console.log("\nAlready configured — nothing to do.");
  process.exit(0);
}

const updated = await twilioPost(`/IncomingPhoneNumbers/${target.sid}.json`, {
  VoiceUrl: VOICE_URL,
  VoiceMethod: "POST",
  SmsUrl: SMS_URL,
  SmsMethod: "POST",
});

console.log(`\nAfter:\n${describe(updated)}`);
console.log("\nDone. Call or text the number to test.");
console.log("WhatsApp sandbox webhook must be set manually in the Twilio console:");
console.log(`  ${BASE_URL}/api/telephony/whatsapp  (see docs/TELEPHONY.md)`);
