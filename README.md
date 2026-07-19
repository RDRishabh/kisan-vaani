# KisanVaani — किसानवाणी

KisanVaani is a farm-advisory platform for Indian farmers who do not own smartphones. It delivers AI-assisted advice over **voice calls** and **SMS** in 12+ Indian languages, diagnoses crop disease from photos, recommends crops from satellite and Soil Health Card data, issues dry-spell and heavy-rain zone alerts, reads out **live pan-India mandi prices**, gives **live weather advisories**, and escalates uncertain or severe cases to human experts at Rythu Seva Kendras (RSKs) and Krishi Vigyan Kendras (KVKs).

## Problem

India has more than 146 million farm holdings; 86% are smallholders. Roughly 45% of rural users carry feature phones — no apps, no data plans, oral-first. Existing agri-apps assume a smartphone the farmer does not have, while an estimated 15–25% of yield is lost to pests, disease, and mistimed irrigation. KisanVaani works on the phones farmers already own, and aggregates every interaction into district-level intelligence for agriculture officers.

---

## Tech stack

| Layer | Technology |
|---|---|
| App framework | [Next.js](https://nextjs.org/) 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| AI | Google Gemini via [`@google/genai`](https://www.npmjs.com/package/@google/genai) — primary `gemini-3.5-flash`, fallback `gemini-3.1-flash-lite` |
| Database | Postgres ([Neon](https://neon.tech) serverless driver) — tickets, broadcasts, query log |
| Telephony | [Twilio](https://www.twilio.com/) Voice + SMS + WhatsApp webhooks (TwiML); production path: Indian toll-free / Exotel + DLT SMS |
| Hosting | Vercel-ready Node server (`npm run build` / `npm start`) |
| Demo UI | Browser Speech Recognition + Speech Synthesis (stand-in for Bhashini / Cloud ASR-TTS) |

### Key packages

- `next`, `react`, `react-dom` — UI and API routes  
- `@google/genai` — Gemini (advisory, diagnosis, voice, place resolution)  
- `@neondatabase/serverless` — Postgres  
- `lucide-react` — icons  
- `tailwindcss` — styling  

---

## API keys and environment

Copy `.env.example` → `.env` / `.env.local`. Every key is optional for boot; missing keys degrade to cached/fallback answers so the farmer still gets a reply.

| Variable | Required for | Used by |
|---|---|---|
| `GEMINI_API_KEY` | Live AI advisories, diagnosis, language detect, **smart place resolution** for weather | `/api/advisory`, `/api/diagnose`, `/api/voice`, `lib/place-resolve.ts`, telephony |
| `GEMINI_MODEL` / `GEMINI_MODEL_FALLBACK` | Optional model overrides | `lib/genai.ts` |
| `DATABASE_URL` | Persistent tickets / broadcasts / query log | `lib/db.ts` |
| `TWILIO_ACCOUNT_SID` | Live phone line signature validation | `/api/telephony/*` |
| `TWILIO_AUTH_TOKEN` | HMAC webhook validation | `lib/twilio.ts` |
| `TWILIO_FROM_NUMBER` | Outbound identity | Twilio config scripts |
| `DATA_GOV_IN_API_KEY` | Live pan-India mandi prices (preferred) | `/api/mandi` → `lib/mandi-data-gov.ts` |
| `DATA_GOV_IN_MANDI_RESOURCE_ID` | Mandi resource UUID (default below) | data.gov.in Current Daily Prices |
| `OPENWEATHERMAP_API_KEY` | Farmer weather telling (IVR 3 / SMS) | `/api/weather` → `lib/openweather.ts` |

**Default mandi resource:** `35985678-0d79-46b4-9ed6-6f13308a1d24`  
([data.gov.in — Current Daily Price of Various Commodities from Various Markets](https://data.gov.in))

**OpenWeather endpoint:** `https://api.openweathermap.org`  
(current weather + 5-day / 3-hour forecast + geocoding)

Full setup and verification: [docs/SETUP.md](docs/SETUP.md) · Telephony wiring: [docs/TELEPHONY.md](docs/TELEPHONY.md)

---

## Data sources

| Source | What we use | Auth | Where in code |
|---|---|---|---|
| **data.gov.in** (Agmarknet republication) | Mandi modal / min / max by `State`, `District`, `Commodity`, `Arrival_Date` | API key | `lib/mandi-data-gov.ts` |
| **Agmarknet 2.0** | Mandi fallback if data.gov.in fails | None | `app/api/mandi/route.ts` |
| **OpenWeatherMap** | Current + 5-day weather for farmer advisories | API key | `lib/openweather.ts` |
| **Open-Meteo** | 16-day rain, ET₀, soil moisture for recommend / zone alerts | None | `lib/weather.ts`, `lib/soil-profile.ts` |
| **ISRIC SoilGrids v2** | 250 m pH, SOC, texture, WRB | None | `lib/soil-profile.ts` |
| **Soil Health Card** (soilhealth4.dac.gov.in) | District N/P/K/OC notes | None (GraphQL) | `lib/soil-profile.ts` |
| **NASA POWER** | Agroclimate (supporting) | None | research / soil pipeline |
| **ICAR / SAU / FAO** | Embedded Package of Practices crop table | Bundled | `lib/agronomy.ts` |
| **IMD thresholds** | Dry-spell / heavy-rain / heatwave definitions | Constants | `lib/weather.ts` |

### Mandi filters (data.gov.in)

| Filter | How it is set |
|---|---|
| `filters[State]` | Resolved from district (or asked only if name is ambiguous) |
| `filters[District]` | Farmer speech/SMS — any Indian district |
| `filters[Commodity]` | Farmer speech/SMS crop name (Hindi/English normalized) |
| `filters[Arrival_Date]` | **Automatic** — today (IST `DD-MM-YYYY`), then look back up to **7 days** until rows exist |

The farmer is never asked for a date.

---

## Architecture

```
Farmer (feature phone / smartphone)
  │
  ├─ Voice call ──► Twilio Voice ──► /api/telephony/voice  (TwiML Gather)
  ├─ SMS ─────────► Twilio SMS ────► /api/telephony/sms    (TwiML Message)
  ├─ WhatsApp ────► Twilio WA ─────► /api/telephony/whatsapp
  └─ Web demo ────► /demo ─────────► /api/advisory | /api/mandi | /api/weather | /api/voice | /api/diagnose
                              │
                              ▼
                    ┌─────────────────────┐
                    │  Intent + session   │
                    │  mandi / weather /  │
                    │  crop advisory      │
                    └─────────┬───────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   Gemini (advisory,     data.gov.in /        OpenWeatherMap
   clarify, diagnose,    Agmarknet mandi      (+ Gemini place
   place resolve)                             resolve → nearby)
          │                   │                   │
          └───────────────────┴───────────────────┘
                              │
                              ▼
                    Postgres (Neon) — tickets,
                    broadcasts, query log
                              │
                              ▼
                    /command — DAO ops console
```

Every live call path has a **cached / Hindi fallback** so the number always answers if Gemini or an external API fails.

---

## How the flows work

### 1. Crop advisory (IVR press **1** / free SMS problem)

1. Farmer describes a crop problem (speech or text).  
2. `runAdvisoryTurn` (Gemini) may **clarify** with numbered options (max 2 rounds), then **advise**.  
3. System appends a follow-up menu: another problem / mandi / done.  
4. Off-topic questions are refused (farming-only scope).  
5. Session state for SMS is kept in memory (`lib/advisory-session.ts`) keyed by phone.

### 2. Mandi bhav — pan-India (IVR press **2** / SMS “मंडी” / “mandi”)

```
Press 2 or text "मंडी भाव"
        │
        ▼
Ask district (free speech/text — any India district)
        │
        ▼
If name is ambiguous across states → ask state
        │
        ▼
Ask crop / commodity (free speech/text)
        │
        ▼
GET /api/mandi?crop=&district=&state=
        │
        ├─ data.gov.in resource 35985678-… (Arrival_Date auto lookback)
        └─ else Agmarknet 2.0 → else "unavailable" (no fake Sehore price)
        │
        ▼
Hindi price line + follow-up menu
```

Shared state machine: `lib/mandi-handler.ts` + `lib/mandi-flow.ts` + `lib/mandi-geo.ts`.

### 3. Weather (IVR press **3** / SMS “weather in …” / “मौसम”)

```
Press 3 or text "Weather in Noida Nalgadha region"
        │
        ▼
Intent detect (lib/helpline-intent.ts) — before Gemini clarify
        │
        ▼
Extract / ask place
        │
        ▼
fetchOpenWeatherSmart (lib/openweather.ts)
        │
        ├─ Registry coords (if known district)
        ├─ OpenWeather geocode
        └─ Gemini place-resolve (lib/place-resolve.ts)
              → primary city/district + nearby stations
              → try until API succeeds
        │
        ▼
Hindi advisory (temp, humidity, 24h / 5-day rain, irrigation tip)
  If nearby used: "X के नज़दीकी स्थान Y का मौसम…"
```

### 4. Photo diagnosis (WhatsApp / `/demo` photo)

1. Image → `/api/diagnose` → Gemini multimodal JSON (disease, confidence, organic/chemical treatment).  
2. Low confidence / high severity → escalation ticket → `/command`.

### 5. Crop recommendation (`/recommend`)

1. `/api/soil-profile` merges SoilGrids + SHC + Open-Meteo.  
2. `/api/recommend` ranks crops with Gemini grounded on measured soil/weather + ICAR table.  
3. Mandi context may be attached from `/api/mandi`.

### 6. Ops console (`/command`)

- Weather zone alerts (Open-Meteo + IMD thresholds)  
- Outbreak clusters, escalations, broadcasts, farmer registry  
- Live query feed from `kv_queries`

---

## Modules (product routes)

| Module | Description | Route |
|---|---|---|
| Voice IVR & SMS advisory | Multi-turn clarify → advise; free-text mandi & weather intents on SMS | `/demo` |
| Spoken-language auto-detect | Gemini from raw audio | `/demo` (Auto) |
| Crop recommendation | SoilGrids + SHC + weather + ICAR | `/recommend` |
| Zone alerts | Dry spell / heavy rain / heatwave | `/command` |
| WhatsApp photo / voice | Diagnosis + voice-note style reply | `/whatsapp` |
| RSK/KVK escalation | Tickets with 48h SLA | `/command` |

---

## Live telephony and persistence

A Twilio line can be wired to the deploy: Voice → `/api/telephony/voice`, SMS → `/api/telephony/sms`, WhatsApp → `/api/telephony/whatsapp`. Webhooks validate Twilio HMAC-SHA1 when `TWILIO_AUTH_TOKEN` is set.

Escalation tickets, broadcasts, and the query log persist to Postgres (`kv_tickets`, `kv_broadcasts`, `kv_queries`). Without `DATABASE_URL`, storage falls back to per-instance memory.

---

## Run locally

```bash
npm install
cp .env.example .env.local   # set GEMINI_API_KEY at minimum; add mandi + weather keys for live demos
npm run dev
```

Open [http://localhost:3000/demo](http://localhost:3000/demo).

Suggested local keys for a full demo:

```bash
GEMINI_API_KEY=...
DATA_GOV_IN_API_KEY=...
DATA_GOV_IN_MANDI_RESOURCE_ID=35985678-0d79-46b4-9ed6-6f13308a1d24
OPENWEATHERMAP_API_KEY=...
DATABASE_URL=...            # optional
TWILIO_*                    # optional for real phone
```

---

## Repository layout

```
app/
  api/advisory|mandi|weather|diagnose|voice|soil-profile|recommend|telephony/*
  demo|recommend|whatsapp|command|   # product surfaces
lib/
  advisory-flow.ts      # Gemini multi-turn prompts + SMS compose
  helpline-intent.ts    # SMS/voice intent: mandi vs weather
  mandi-*.ts            # pan-India mandi menus, geo, data.gov.in, handler
  openweather.ts        # OpenWeatherMap client + smart fetch
  place-resolve.ts      # Gemini → place candidates + nearby
  weather.ts            # Open-Meteo zone alerts (IMD thresholds)
  soil-profile.ts       # SoilGrids + SHC + Open-Meteo merge
  twilio.ts             # signature + SMS textAdvisory
docs/SETUP.md TELEPHONY.md
research/*.json         # verified endpoint research
```

---

## Pilot plan

1. Weeks 1–4: toll-free number and SMS shortcode in one block (~2,000 farmers); onboarding through gram panchayats and the local KVK; missed-call registration.  
2. Months 2–4: district scale; KVK/RSK officers review low-confidence diagnoses; weather-zone alerts live for the District Agriculture Officer.  
3. Estimated operating cost: under ₹12 per farmer per season.

---

Team Vishwakarma Devs — Build with AI: Code for Communities (Google Cloud × Hack2Skill), Track 4: Kisan Alert.
