# Setup guide

Everything needed to run, deploy, and operate KisanVaani. Written for teammates
joining the project cold.

## 1. Quick start (five minutes)

```bash
git clone https://github.com/frenchfryfeatures/kisan-vaani.git
cd kisan-vaani
npm install
cp .env.example .env.local     # fill in GEMINI_API_KEY at minimum
npm run dev -- -p 3100
```

Open http://localhost:3100. The application runs with **zero keys** (every route
serves reviewed cached content), but live AI needs `GEMINI_API_KEY`.

## 2. Keys and services

| Variable | Required for | Where to get it | Behaviour if absent |
|---|---|---|---|
| `GEMINI_API_KEY` | All AI: advisory, photo diagnosis, voice language detection, crop recommendation | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free tier works; billing-enabled avoids daily quota throttles | Routes serve reviewed cached advisories, labelled as such |
| `GEMINI_MODEL` | Optional override | — | Defaults to `gemini-3.5-flash` (AI Studio free tier) |
| `GEMINI_MODEL_FALLBACK` | Auto-retry on quota (429) or unavailable model (404) | — | Defaults to `gemini-3.1-flash-lite` |
| `DATABASE_URL` | Persistence: escalation tickets, broadcasts, query log | [neon.tech](https://neon.tech) free Postgres (any Postgres works). Tables `kv_tickets`, `kv_broadcasts`, `kv_queries` auto-create on first use | Falls back to per-instance memory; app still runs |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Real phone line: IVR, SMS, WhatsApp webhooks (signature validation + media download) | [console.twilio.com](https://console.twilio.com) — trial account is enough for inbound | Telephony endpoints skip signature validation (dev mode); the rest of the app is unaffected |
| `DATA_GOV_IN_API_KEY` | Live mandi prices via [data.gov.in](https://data.gov.in) (official Agmarknet republication) | Register at data.gov.in → My Account → Generate API Key. Optional: `DATA_GOV_IN_MANDI_RESOURCE_ID` (default `35985678-0d79-46b4-9ed6-6f13308a1d24`) | Falls back to keyless Agmarknet 2.0 API, then cached quotes |

**Other keyless live data sources:** Open-Meteo · ISRIC SoilGrids · NASA POWER · Agmarknet 2.0 (mandi fallback) · Soil Health Card GraphQL. Details in `research/*.json`.

## 3. Deploying (Vercel)

```bash
vercel link
for K in GEMINI_API_KEY DATA_GOV_IN_API_KEY DATABASE_URL TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM_NUMBER; do
  vercel env add $K production
done
vercel --prod
```

## 4. Connecting a phone number

1. Buy or use a Twilio number with voice + SMS capability.
2. Point its webhooks at the deployment:
   `node scripts/configure-twilio.mjs` (reads `.env.local`, idempotent), or set
   Voice URL → `/api/telephony/voice` and SMS URL → `/api/telephony/sms`
   (both POST) in the Twilio console.
3. WhatsApp: enable the Twilio WhatsApp sandbox and set its inbound webhook to
   `/api/telephony/whatsapp`. Senders join once with the sandbox code.
4. Trial-account limits: inbound calls/SMS work from any phone (a short Twilio
   notice plays first); outbound is restricted to verified numbers.

Full telephony reference, curl simulations, and the Exotel/DLT production path:
`docs/TELEPHONY.md`.

## 5. Current production instance

- App: https://kisan-vaani.vercel.app
- Live line (voice + SMS): +1 254 272 6372 (US Twilio trial; international
  rates apply from India; production plan is an Indian 1800 line via Exotel)
- Database: Neon Postgres (tables namespaced `kv_`)

## 6. Repository map

| Path | What it is |
|---|---|
| `app/` | Next.js App Router pages (`/`, `/demo`, `/recommend`, `/whatsapp`, `/command`) and API routes (`advisory`, `diagnose`, `voice`, `recommend`, `soil-profile`, `mandi`, `alerts`, `tickets`, `broadcasts`, `telephony/*`) |
| `components/` | Page clients; `components/command/` is the ops console |
| `lib/` | Domain logic: `weather.ts` (IMD-threshold alert engine), `agronomy.ts` (ICAR/FAO crop table), `soil-profile.ts` (SoilGrids + SHC + Open-Meteo merge), `irrigation.ts` (FAO-56 guidance), `db.ts` (Postgres + fallback), `twilio.ts` (webhook validation + TwiML), `i18n-full.ts` (12-language pack), `genai.ts` (quota-resilient Gemini calls) |
| `research/` | Verified data-source research: endpoints, response shapes, quirks |
| `scripts/configure-twilio.mjs` | Points a Twilio number's webhooks at a deployment |
| `docs/TELEPHONY.md` | Telephony endpoints, testing, production path |

## 7. Verifying an environment

```bash
# AI live?              → expect "source":"gemini"
curl -s -X POST localhost:3100/api/advisory -H 'Content-Type: application/json' \
  -d '{"query":"KAPAS PILA PATTA","lang":"hi","channel":"sms"}'
# Weather scan live?    → expect "source":"open-meteo", alerts with named blocks
curl -s localhost:3100/api/alerts
# Persistence live?     → expect "source":"db"
curl -s localhost:3100/api/tickets
# Mandi live?           → expect "source":"agmarknet" with today's date
curl -s "localhost:3100/api/mandi?crop=Soybean&state=Madhya+Pradesh"
```

Every route answers even when its upstream is down — a `"source":"cached"`
response is the designed degradation, not a failure.
