# KisanVaani Real Telephony (Twilio)

The demo number **+1 254 272 6372** answers real calls, SMS and WhatsApp with KisanVaani.

## Endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/telephony/voice` | POST (form-encoded) | Voice IVR. Stateless: `?step=menu` and `?step=answer` drive the menu. Hindi greeting → press 1 / speak a problem (Gemini advisory read aloud) or press 2 (live soybean mandi price for Madhya Pradesh). |
| `/api/telephony/sms` | POST (form-encoded) | SMS advisory. `Body` → Gemini (≤300 chars, native script; Latin shorthand answered in Hindi Devanagari). |
| `/api/telephony/whatsapp` | POST (form-encoded) | WhatsApp sandbox. Photo (`NumMedia>0`) → crop diagnosis via `/api/diagnose`; text → same advisory as SMS. |

All three validate `X-Twilio-Signature` (HMAC-SHA1 over the URL + sorted form params) and return 403 TwiML on mismatch. If `TWILIO_AUTH_TOKEN` is not set in the server environment, validation is skipped so local dev works. Any Gemini failure degrades to canned Hindi fallbacks — the number always answers.

## Pointing the number at a deployment

```bash
node scripts/configure-twilio.mjs                     # defaults to https://kisan-vaani.vercel.app
node scripts/configure-twilio.mjs https://my-preview.vercel.app
```

Reads `.env.local`, lists the account's incoming numbers, sets the number's VoiceUrl and SmsUrl (POST), prints before/after. Idempotent.

## Twilio trial-account caveats

- Every call starts with Twilio's trial preamble ("You have a trial account…") and requires a keypress before our greeting plays. Inbound SMS get a "Sent from your Twilio trial account" prefix.
- **Inbound is unrestricted** — anyone can call or text the number. **Outbound** (calls/SMS initiated by us) only works to numbers verified in the Twilio console.
- The number is US-based; callers from India pay international rates. See "Production path" below.

## WhatsApp sandbox setup

1. Twilio Console → Messaging → Try it out → **Send a WhatsApp message**.
2. From your WhatsApp, send the sandbox join code (e.g. `join <two-words>`) to **+1 415 523 8886**.
3. In **Sandbox settings**, set *"When a message comes in"* to
   `https://kisan-vaani.vercel.app/api/telephony/whatsapp` (method POST) and save.
4. Send a crop photo or a text like "कपास के पत्ते पीले हो रहे हैं" to the sandbox number.

Sandbox sessions expire after 72 hours; re-send the join code to reconnect.

## Simulating webhooks with curl

Signature validation runs against the server's `TWILIO_AUTH_TOKEN`. Locally either **unset `TWILIO_AUTH_TOKEN` in the server's env** (validation is then skipped) or compute a valid signature. Twilio signs `base64(HMAC-SHA1(authToken, url + sortedKey1 + value1 + sortedKey2 + value2 …))`; the server reconstructs the URL as `https://<host><path><query>` — use the `https` scheme in the signed URL even against local http.

Compute a signature (params must exactly match the form body):

```bash
SIG=$(node -e '
const crypto = require("crypto");
const token = process.env.TWILIO_AUTH_TOKEN;
const url = "https://localhost:3100/api/telephony/sms";
const params = { Body: "KAPAS PILA PATTA", From: "+919999999999" };
const data = url + Object.keys(params).sort().map(k => k + params[k]).join("");
console.log(crypto.createHmac("sha1", token).update(data, "utf8").digest("base64"));
')
```

**SMS** (reply is TwiML `<Message>`):

```bash
curl -s -X POST http://localhost:3100/api/telephony/sms \
  -H "X-Twilio-Signature: $SIG" \
  --data-urlencode "Body=KAPAS PILA PATTA" \
  --data-urlencode "From=+919999999999"
```

**Voice** — new call (greeting + Gather), then menu, then answer:

```bash
curl -s -X POST http://localhost:3100/api/telephony/voice \
  -H "X-Twilio-Signature: <sig for https://localhost:3100/api/telephony/voice with these params>" \
  --data-urlencode "CallSid=CA123" --data-urlencode "From=+919999999999"

curl -s -X POST "http://localhost:3100/api/telephony/voice?step=menu" \
  -H "X-Twilio-Signature: <sig — note the URL string must include ?step=menu>" \
  --data-urlencode "Digits=2" --data-urlencode "From=+919999999999"

curl -s -X POST "http://localhost:3100/api/telephony/voice?step=answer" \
  -H "X-Twilio-Signature: <sig>" \
  --data-urlencode "SpeechResult=मेरी कपास की पत्तियाँ पीली पड़ रही हैं" \
  --data-urlencode "From=+919999999999"
```

**WhatsApp** — text message (photo simulation needs a reachable MediaUrl0):

```bash
curl -s -X POST http://localhost:3100/api/telephony/whatsapp \
  -H "X-Twilio-Signature: <sig>" \
  --data-urlencode "Body=धान में भूरे धब्बे" \
  --data-urlencode "From=whatsapp:+919999999999" \
  --data-urlencode "NumMedia=0"
```

A wrong or missing signature returns HTTP 403 with `<Response><Reject/></Response>`.

## Production path (India)

The Twilio US number is a pilot rail. For production in India:

- **Exotel** (or Knowlarity) Indian toll-free 1800 number for voice + IVR — no international charges for farmers, DTMF+speech supported, webhooks map 1:1 onto these endpoints.
- **SMS via DLT-registered headers** (TRAI mandate): register entity + templates on a DLT platform (e.g. Vodafone Idea, Jio), then send through Exotel/Gupshup.
- **WhatsApp Business API** via Meta BSP (Gupshup/Twilio) with a verified business — replaces the sandbox, supports proactive outbreak alerts via approved templates.
