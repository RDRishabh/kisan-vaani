import Link from "next/link";
import {
  Sprout,
  CloudRain,
  MessageCircle,
  UserCheck,
  IndianRupee,
  Languages,
  Phone,
  MessageSquare,
  Camera,
} from "lucide-react";

const STATS = [
  { value: "146M+", label: "farm holdings in India", sub: "86% smallholders under 2 ha" },
  { value: "~45%", label: "of rural users on feature phones", sub: "no apps, no data plans" },
  { value: "15–25%", label: "yield lost to pests and disease", sub: "much of it preventable" },
  { value: "1 : 1,100", label: "extension officers to farmers", sub: "advice rarely arrives in time" },
];

const CHANNELS = [
  {
    icon: Phone,
    title: "Voice calls",
    body: "A farmer dials a simple phone number (a toll-free 1800 line via Exotel in production) and speaks in their own language. The AI understands the query and answers on the same call. No literacy, internet connection, or app required.",
  },
  {
    icon: MessageSquare,
    title: "SMS on any handset",
    body: "Shorthand like “KAPAS PILA PATTA” gets a native-script reply with exact dosages, within two SMS segments. Works on 2G feature phones.",
  },
  {
    icon: Camera,
    title: "Photo to voice note",
    body: "One smartphone per village is enough. A relay worker sends a leaf photo; Gemini diagnoses the disease; the farmer receives a voice note in their language.",
  },
];

const STEPS = [
  { n: "01", t: "Farmer reaches out", d: "Call, SMS, or photo, on whatever phone they already own." },
  { n: "02", t: "Gemini understands", d: "Indic speech and shorthand parsed; photos diagnosed with structured, schema-enforced output." },
  { n: "03", t: "Advisory delivered", d: "Spoken or SMS reply in the farmer's language: IPM-first steps with exact, safe dosages." },
  { n: "04", t: "District learns", d: "Each query is a geotagged signal. Clusters of similar reports become outbreak alerts for nearby farmers." },
];

const MODULES = [
  {
    icon: Sprout,
    title: "Smart crop recommendation",
    body: "Ranked, explained crop choices reasoned by Gemini from ISRIC 250 m soil grids, Government of India Soil Health Card records, 16-day weather, and ICAR agronomy.",
    href: "/recommend",
    cta: "Try the crop advisor",
  },
  {
    icon: CloudRain,
    title: "Dry-spell and heavy-rain zone alerts",
    body: "IMD-threshold detection over each registered district identifies the affected blocks and sends voice and SMS guidance only to farmers inside the zone.",
    href: "/command",
    cta: "View live alerts",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp photo and voice support",
    body: "Farmers send a crop photo or a voice note in any language; Gemini diagnoses and replies with a voice note. Feature-phone users receive the advisory by SMS.",
    href: "/whatsapp",
    cta: "Open the WhatsApp demo",
  },
  {
    icon: UserCheck,
    title: "Expert escalation (RSK / KVK)",
    body: "Low-confidence or severe cases become tickets routed to Rythu Seva Kendras and Krishi Vigyan Kendras with a 48-hour SLA. AI answers first; specialists review.",
    href: "/command",
    cta: "View the escalation queue",
  },
  {
    icon: IndianRupee,
    title: "Live mandi prices",
    body: "Modal prices from the Agmarknet open API (Directorate of Marketing and Inspection), available on the same IVR call: press 2 for bhav.",
    href: "/demo",
    cta: "Check prices on the demo",
  },
  {
    icon: Languages,
    title: "12+ Indian languages, auto-detected",
    body: "Farmers speak in their own language; Gemini detects it from the audio and answers in the same language. No menus, no settings, no literacy assumed.",
    href: "/demo",
    cta: "Try voice input",
  },
];

const DATA_SOURCES = [
  "Soil Health Card, Government of India — district nutrient records (N, P, K, pH)",
  "Agmarknet, Directorate of Marketing and Inspection — mandi modal prices",
  "ISRIC SoilGrids — 250 m satellite-derived soil properties",
  "NASA POWER — agroclimate normals",
  "Open-Meteo — 16-day forecasts and soil moisture",
  "ICAR and SAU Package of Practices — agronomy grounding",
  "Kisan Call Centre corpus (AIKosh) — grounding roadmap",
];

const GOOGLE_AI = [
  "Gemini 2.5 Flash — multimodal disease diagnosis",
  "Structured JSON-schema output — reliable parsing",
  "Gemini — Indic-language advisory generation",
  "Production: Vertex AI with Cloud Speech / Bhashini ASR-TTS",
  "Production: Exotel or Twilio IVR and SMS gateway",
  "Grounding: Kisan Call Centre Q&A corpus (AIKosh)",
];

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="border-b border-forest/10 bg-paper/90 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
          <span className="font-display text-xl font-semibold text-forest inline-flex items-center gap-2">
            <Sprout size={18} className="text-forest" aria-hidden="true" />
            KisanVaani
          </span>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/demo" className="text-ink-soft hover:text-forest">Demo</Link>
            <Link href="/recommend" className="text-ink-soft hover:text-forest">Crop advisor</Link>
            <Link href="/whatsapp" className="text-ink-soft hover:text-forest">WhatsApp</Link>
            <Link href="/command" className="text-ink-soft hover:text-forest">Command center</Link>
            <Link
              href="/demo"
              className="bg-forest text-paper rounded-full px-4 py-1.5 font-medium hover:bg-leaf transition"
            >
              Open the live demo
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="mx-auto max-w-6xl px-4 pt-16 pb-12">
        <div className="inline-flex items-center gap-2 rounded-full bg-leaf-mist text-forest text-xs font-semibold px-3 py-1.5 mb-6">
          Build with AI: Code for Communities · Track 4 (Kisan Alert) · an MP-submitted problem statement
        </div>
        <h1 className="font-display text-4xl sm:text-6xl font-semibold text-forest leading-[1.08] max-w-4xl">
          Every farmer deserves an agronomist,<br className="hidden sm:block" />
          <span className="text-turmeric">even on a ₹1,500 phone.</span>
        </h1>
        <p className="mt-6 text-lg text-ink-soft max-w-2xl leading-relaxed">
          KisanVaani is an AI crop advisory that speaks the farmer&rsquo;s language over ordinary{" "}
          <b className="text-ink">voice calls and SMS</b>, diagnoses crop disease from photos with Gemini,
          and aggregates queries into district-level outbreak early warnings. Built for the roughly 45% of
          rural India that smartphone apps do not reach.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/demo"
            className="bg-forest text-paper rounded-xl px-6 py-3.5 font-semibold hover:bg-leaf transition shadow-lg shadow-forest/20"
          >
            Open the live demo
          </Link>
          <Link
            href="/command"
            className="bg-white border border-forest/20 text-forest rounded-xl px-6 py-3.5 font-semibold hover:border-forest/50 transition"
          >
            View the district command center
          </Link>
        </div>
      </header>

      {/* Stats */}
      <section className="border-y border-forest/10 bg-paper-warm">
        <div className="mx-auto max-w-6xl px-4 py-10 grid grid-cols-2 lg:grid-cols-4 gap-6">
          {STATS.map((s) => (
            <div key={s.label}>
              <div className="font-display text-3xl font-semibold text-forest">{s.value}</div>
              <div className="text-sm font-medium text-ink mt-1">{s.label}</div>
              <div className="text-xs text-ink-soft mt-0.5">{s.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* The gap */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="font-display text-3xl font-semibold text-forest max-w-2xl">
          The problem isn&rsquo;t a lack of agri-apps. It&rsquo;s that apps assume a phone the farmer doesn&rsquo;t have.
        </h2>
        <p className="mt-4 text-ink-soft max-w-3xl leading-relaxed">
          Dozens of advisory apps exist for smartphone owners with data plans who are comfortable reading text in
          English or Hindi. The farmers losing the most to crop disease are precisely the ones outside that group:
          feature phones, patchy 2G, oral-first communication. The MP&rsquo;s problem statement asks for exactly this:{" "}
          <i>
            &ldquo;a voice &amp; SMS crop advisory in Indic languages with AI disease diagnosis from farmer photos, designed for
            low-connectivity, non-smartphone farmers.&rdquo;
          </i>{" "}
          KisanVaani implements that, end to end.
        </p>

        <div className="grid md:grid-cols-3 gap-5 mt-10">
          {CHANNELS.map((c) => (
            <div key={c.title} className="rounded-2xl bg-white border border-forest/15 p-6 hover:shadow-lg transition">
              <div className="h-9 w-9 rounded-lg bg-leaf-mist flex items-center justify-center">
                <c.icon size={18} className="text-forest" aria-hidden="true" />
              </div>
              <h3 className="font-semibold text-lg mt-3 text-ink">{c.title}</h3>
              <p className="text-sm text-ink-soft mt-2 leading-relaxed">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Platform modules */}
      <section className="border-t border-forest/10">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="font-display text-3xl font-semibold text-forest">One platform, six connected modules</h2>
          <p className="mt-3 text-ink-soft max-w-3xl">
            Each module addresses part of the MP&rsquo;s problem statement. All six share one data layer, so each
            interaction adds to the district picture.
          </p>
          <div className="grid md:grid-cols-3 gap-5 mt-10">
            {MODULES.map((m) => (
              <Link key={m.title} href={m.href} className="rounded-2xl bg-white border border-forest/15 p-6 hover:shadow-lg hover:border-forest/40 transition block">
                <div className="h-9 w-9 rounded-lg bg-leaf-mist flex items-center justify-center">
                  <m.icon size={18} className="text-forest" aria-hidden="true" />
                </div>
                <h3 className="font-semibold text-lg mt-3 text-ink">{m.title}</h3>
                <p className="text-sm text-ink-soft mt-2 leading-relaxed">{m.body}</p>
                <div className="text-sm font-medium text-forest mt-3">{m.cta}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Data sources */}
      <section className="bg-paper-warm border-y border-forest/10">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <div className="text-xs font-semibold tracking-widest text-ink-soft mb-4 uppercase">Data sources</div>
          <div className="flex flex-wrap gap-2 text-sm">
            {DATA_SOURCES.map((s) => (
              <span key={s} className="rounded-full bg-white border border-forest/15 px-3 py-1.5">{s}</span>
            ))}
          </div>
          <p className="mt-4 text-xs text-ink-soft">
            Weather forecasts in the demo use Open-Meteo; the production source is IMD Agromet Advisory Services.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-forest text-paper">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="font-display text-3xl font-semibold">How it works</h2>
          <div className="grid md:grid-cols-4 gap-6 mt-10">
            {STEPS.map((s) => (
              <div key={s.n} className="relative">
                <div className="font-display text-4xl text-leaf-bright/50 font-semibold">{s.n}</div>
                <h3 className="font-semibold mt-2">{s.t}</h3>
                <p className="text-sm text-paper/70 mt-1.5 leading-relaxed">{s.d}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 rounded-2xl bg-white/5 border border-white/10 p-6">
            <div className="text-xs font-semibold tracking-widest text-paper/50 mb-3 uppercase">Built with Google AI</div>
            <div className="flex flex-wrap gap-2 text-sm">
              {GOOGLE_AI.map((t) => (
                <span key={t} className="rounded-full bg-white/10 px-3 py-1.5">{t}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Kisan Alert layer */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 text-clay text-xs font-semibold px-3 py-1.5 mb-4">
              District early-warning layer
            </div>
            <h2 className="font-display text-3xl font-semibold text-forest">
              Answering one farmer is a service.<br />Learning from every farmer is an <span className="text-turmeric">early-warning system</span>.
            </h2>
            <p className="mt-4 text-ink-soft leading-relaxed">
              Every call, SMS and photo is a structured, geotagged data point. When 23 leaf-curl reports cluster in one block
              in a week, KisanVaani flags the outbreak and lets the District Agriculture Officer broadcast a voice and SMS alert
              to every registered farmer within 5 km, <b className="text-ink">days before</b> the outbreak becomes visible crop
              loss. This is the &ldquo;Alert&rdquo; in the track&rsquo;s name: the same queries that serve individual farmers
              give the district administration advance warning.
            </p>
            <Link href="/command" className="inline-block mt-6 bg-forest text-paper rounded-xl px-5 py-3 font-semibold hover:bg-leaf transition">
              Open the command center
            </Link>
          </div>
          <div className="rounded-2xl bg-[#10241a] text-paper p-6 shadow-2xl">
            <div className="text-xs text-paper/50 mb-3 uppercase tracking-wide">Sehore district · live</div>
            <div className="rounded-xl bg-red-950/50 border border-red-500/30 p-4">
              <div className="font-semibold">Cotton Leaf Curl Virus</div>
              <div className="text-sm text-paper/60">Sehore block · 23 reports · +187% week over week</div>
              <div className="mt-3 rounded-lg bg-turmeric text-white text-center text-sm font-semibold py-2">
                Broadcast alert to 1,240 farmers
              </div>
            </div>
            <div className="mt-3 text-[11px] text-paper/40">
              Outbreak flagged 4 days before visible crop loss, from advisory queries alone.
            </div>
          </div>
        </div>
      </section>

      {/* Pilot plan */}
      <section className="border-t border-forest/10 bg-paper-warm">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="font-display text-3xl font-semibold text-forest">Pilot plan</h2>
          <div className="grid md:grid-cols-3 gap-5 mt-8">
            <div className="rounded-2xl bg-white border border-forest/15 p-6">
              <div className="text-xs font-semibold tracking-widest text-ink-soft uppercase">Phase 1 · weeks 1–4</div>
              <h3 className="font-semibold mt-2">One block, 2,000 farmers</h3>
              <p className="text-sm text-ink-soft mt-2 leading-relaxed">
                Toll-free line and SMS shortcode live in one block of the MP&rsquo;s constituency. Onboarding via gram panchayat
                and KVK; farmers register with one missed call.
              </p>
            </div>
            <div className="rounded-2xl bg-white border border-forest/15 p-6">
              <div className="text-xs font-semibold tracking-widest text-ink-soft uppercase">Phase 2 · months 2–4</div>
              <h3 className="font-semibold mt-2">District scale and KVK loop</h3>
              <p className="text-sm text-ink-soft mt-2 leading-relaxed">
                Full district rollout. KVK scientists review low-confidence diagnoses; each correction improves the
                advisory corpus. Outbreak alerts go live.
              </p>
            </div>
            <div className="rounded-2xl bg-white border border-forest/15 p-6">
              <div className="text-xs font-semibold tracking-widest text-ink-soft uppercase">Unit economics</div>
              <h3 className="font-semibold mt-2">Under ₹12 per farmer per season</h3>
              <p className="text-sm text-ink-soft mt-2 leading-relaxed">
                About 6 advisories and 2 alerts per farmer per season: IVR minutes ≈ ₹8, SMS ≈ ₹1.2, Gemini Flash
                inference under ₹1. Less than the cost of a single wasted pesticide spray.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-forest text-paper/70">
        <div className="mx-auto max-w-6xl px-4 py-10 flex flex-wrap items-center justify-between gap-4 text-sm">
          <div>
            <span className="font-display text-lg text-paper font-semibold">KisanVaani</span>
            <span className="ml-3">आवाज़ ही असली ऐप है · the voice is the real app.</span>
            <div className="mt-1 text-xs text-paper/50">Built by Team Vishwakarma Devs · Build with AI: Code for Communities · Track 4 (Kisan Alert)</div>
          </div>
          <div className="flex gap-4">
            <Link href="/demo" className="hover:text-paper">Demo</Link>
            <Link href="/recommend" className="hover:text-paper">Crop advisor</Link>
            <Link href="/whatsapp" className="hover:text-paper">WhatsApp</Link>
            <Link href="/command" className="hover:text-paper">Command center</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
