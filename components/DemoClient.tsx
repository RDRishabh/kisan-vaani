"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Mic,
  Square,
  CheckCircle2,
  Languages,
  Phone,
  PhoneOff,
  MessageSquare,
  Camera,
  Leaf,
  FlaskConical,
  Clock,
  Sprout,
  ScanSearch,
  ImagePlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CASE_STUDIES } from "@/lib/data";
import { DISTRICTS } from "@/lib/districts";
import { LANGS_FULL, T_FULL, SAMPLE_QUERIES_FULL } from "@/lib/i18n-full";
import { speak, stopSpeaking, createRecognizer } from "@/lib/speech";
import { startRecording, stopRecording } from "@/lib/recorder";
import { createLiveTicket } from "@/lib/ops-live";
import type { VoiceResult, MandiResponse } from "@/lib/types";

type Mode = "call" | "sms" | "photo";
type CallState = "idle" | "dialing" | "menu" | "listening" | "mandi" | "thinking" | "answered";
type Bubble = { who: "ivr" | "farmer"; text: string };
type SmsMsg = { who: "farmer" | "kisanvaani"; text: string };

type Diagnosis = {
  is_plant?: boolean;
  plant: string;
  disease_en: string;
  disease_local: string;
  disease_scientific: string;
  confidence: number;
  severity: "low" | "medium" | "high";
  symptoms: string[];
  treatment_organic: string[];
  treatment_chemical: string[];
  prevention: string[];
  urgency: string;
  voice_summary: string;
  source?: string;
};

const MODES: { id: Mode; icon: LucideIcon; label: string; sub: string }[] = [
  { id: "call", icon: Phone, label: "Voice call (IVR)", sub: "No reading required" },
  { id: "sms", icon: MessageSquare, label: "SMS", sub: "Any 2G handset" },
  { id: "photo", icon: Camera, label: "Photo diagnosis", sub: "Via relay worker" },
];

// Keypad-2 mandi flow: crops + state from the pilot's first district (Sehore, MP).
const MANDI_CROPS: string[] = DISTRICTS[0]?.crops ?? ["Wheat", "Soybean", "Cotton"];
const MANDI_STATE = DISTRICTS[0]?.state ?? "Madhya Pradesh";

// Cached mandi quotes so the flow works even while /api/mandi is unavailable.
const CACHED_MANDI: Record<string, { market: string; modal: number }> = {
  Wheat: { market: "Sehore", modal: 2450 },
  Soybean: { market: "Ashta", modal: 4720 },
  Cotton: { market: "Khargone", modal: 7040 },
};

export default function DemoClient() {
  const [lang, setLang] = useState<string>("hi"); // 12 language codes + "auto"
  const [mode, setMode] = useState<Mode>("call");
  const uiLang = lang === "auto" ? "hi" : lang; // auto mode falls back to Hindi UI strings
  const langMeta = LANGS_FULL.find((l) => l.code === uiLang) ?? LANGS_FULL[0];
  const bcp47 = langMeta.bcp47;
  const t = T_FULL[uiLang] ?? T_FULL.hi;
  const samples = SAMPLE_QUERIES_FULL[uiLang] ?? SAMPLE_QUERIES_FULL.hi;

  // ---- Call state ----
  const [callState, setCallState] = useState<CallState>("idle");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [callSource, setCallSource] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const [callInput, setCallInput] = useState("");
  const recRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);

  // ---- Auto language-detect state ----
  const [recording, setRecording] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [detected, setDetected] = useState<{ code: string; name: string } | null>(null);
  const [ttsNote, setTtsNote] = useState(false);

  // ---- SMS state ----
  const [smsThread, setSmsThread] = useState<SmsMsg[]>([]);
  const [smsInput, setSmsInput] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [smsSource, setSmsSource] = useState<string | null>(null);

  // ---- Photo state ----
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [activeCase, setActiveCase] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [kvkTicket, setKvkTicket] = useState<{ id: string; kendra: string } | null>(null);
  const [kvkReferring, setKvkReferring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    setMicSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    // warm the voice list (loads async in Chrome)
    window.speechSynthesis?.getVoices();
  }, []);

  useEffect(() => {
    screenRef.current?.scrollTo({ top: 99999, behavior: "smooth" });
  }, [bubbles, callState, smsThread]);

  useEffect(() => () => stopSpeaking(), []);

  const endCall = useCallback(() => {
    stopSpeaking();
    recRef.current?.stop?.();
    void stopRecording(); // safe no-op when not recording
    setCallState("idle");
    setBubbles([]);
    setCallSource(null);
    setMicOn(false);
    setCallInput("");
    setRecording(false);
    setMicDenied(false);
    setDetected(null);
    setTtsNote(false);
  }, []);

  // Reset transient state when switching language or mode
  useEffect(() => {
    endCall();
    stopSpeaking();
    setSpeaking(false);
    setKvkTicket(null);
  }, [lang, mode, endCall]);

  const startCall = () => {
    setBubbles([]);
    setCallState("dialing");
    setTimeout(() => {
      setCallState("menu");
      setBubbles([{ who: "ivr", text: t.ivrGreeting }]);
      speak(t.ivrGreeting, bcp47);
    }, 1200);
  };

  const pressKey = (k: string) => {
    if (callState !== "menu") return;
    if (k === "1") {
      stopSpeaking();
      setCallState("listening");
      const ask = lang === "auto" ? `${t.ivrAskProblem} ${t.recordHint}` : t.ivrAskProblem;
      setBubbles((b) => [...b, { who: "farmer", text: `[ ${k} ]` }, { who: "ivr", text: ask }]);
      speak(ask, bcp47);
    }
    if (k === "2") {
      stopSpeaking();
      setCallState("mandi");
      const ask = `${t.mandiPrices}: ${MANDI_CROPS.join(" / ")}?`;
      setBubbles((b) => [...b, { who: "farmer", text: `[ ${k} ]` }, { who: "ivr", text: ask }]);
      speak(ask, bcp47);
    }
  };

  const submitProblem = async (text: string) => {
    if (!text.trim()) return;
    stopSpeaking();
    setBubbles((b) => [...b, { who: "farmer", text }]);
    setCallState("thinking");
    try {
      const res = await fetch("/api/advisory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, lang: uiLang, channel: "ivr" }),
      });
      const data = await res.json();
      setBubbles((b) => [...b, { who: "ivr", text: data.text }]);
      setCallSource(data.source);
      setCallState("answered");
      speak(data.text, bcp47);
    } catch {
      setCallState("listening");
    }
    setCallInput("");
  };

  // ---- AUTO MODE: record any language → /api/voice ----
  const toggleRecord = async () => {
    if (recording) {
      setRecording(false);
      const clip = await stopRecording();
      if (!clip) return;
      setCallState("thinking");
      try {
        const res = await fetch("/api/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio: clip.base64, mimeType: clip.mimeType }),
          signal: AbortSignal.timeout(30000),
        });
        const data = (await res.json()) as VoiceResult;
        setBubbles((b) => [...b, { who: "farmer", text: data.transcript }, { who: "ivr", text: data.replyText }]);
        setDetected({ code: data.detectedLangCode, name: data.detectedLangName });
        setCallSource(data.source);
        setCallState("answered");
        const prefix = (data.detectedLangCode.split("-")[0] || "hi").toLowerCase();
        const voices = window.speechSynthesis?.getVoices() ?? [];
        const hasVoice = voices.some((v) => v.lang.replace("_", "-").toLowerCase().startsWith(prefix));
        setTtsNote(!hasVoice);
        speak(data.replyText, data.detectedLangCode);
      } catch {
        setCallState("listening");
      }
      return;
    }
    setMicDenied(false);
    const ok = await startRecording();
    if (!ok) {
      setMicDenied(true);
      return;
    }
    setRecording(true);
  };

  // ---- KEYPAD 2: mandi bhav ----
  const askMandi = async (crop: string) => {
    stopSpeaking();
    setBubbles((b) => [...b, { who: "farmer", text: crop }]);
    setCallState("thinking");
    const cached = CACHED_MANDI[crop] ?? { market: "Sehore", modal: 2450 };
    let market = cached.market;
    let modal = cached.modal;
    let source = "cached";
    try {
      const res = await fetch(
        `/api/mandi?crop=${encodeURIComponent(crop)}&state=${encodeURIComponent(MANDI_STATE)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const data = (await res.json()) as MandiResponse;
        const row = data.rows?.[0];
        if (row && row.modalPrice > 0) {
          market = row.market;
          modal = row.modalPrice;
          source = data.source;
        }
      }
    } catch {
      /* keep cached quote */
    }
    const line =
      uiLang === "en"
        ? `${crop} price: ₹${modal} per quintal at ${market} mandi.`
        : `${crop} ka bhav: ${market} mandi mein ₹${modal} prati quintal.`;
    setBubbles((b) => [...b, { who: "ivr", text: line }]);
    setCallSource(source);
    setCallState("answered");
    speak(line, bcp47);
  };

  const toggleMic = () => {
    if (micOn) {
      recRef.current?.stop?.();
      setMicOn(false);
      return;
    }
    const rec = createRecognizer(
      bcp47,
      (text) => submitProblem(text),
      () => setMicOn(false)
    );
    if (!rec) return;
    recRef.current = rec;
    setMicOn(true);
    rec.start();
  };

  const sendSms = async (text: string) => {
    if (!text.trim() || smsSending) return;
    setSmsThread((th) => [...th, { who: "farmer", text }]);
    setSmsInput("");
    setSmsSending(true);
    try {
      const res = await fetch("/api/advisory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, lang: uiLang, channel: "sms" }),
      });
      const data = await res.json();
      setSmsThread((th) => [...th, { who: "kisanvaani", text: data.text }]);
      setSmsSource(data.source);
    } catch {
      /* keep thread as-is */
    }
    setSmsSending(false);
  };

  const runCase = (id: string) => {
    const c = CASE_STUDIES.find((x) => x.id === id)!;
    stopSpeaking();
    setSpeaking(false);
    setActiveCase(id);
    setPhotoPreview(null);
    setDiag(null);
    setKvkTicket(null);
    setDiagLoading(true);
    setTimeout(() => {
      setDiag({ ...c.diagnosis, is_plant: true, source: "case-study" });
      setDiagLoading(false);
    }, 900);
  };

  const onUpload = (file: File) => {
    stopSpeaking();
    setSpeaking(false);
    setActiveCase(null);
    setDiag(null);
    setKvkTicket(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setPhotoPreview(dataUrl);
      setDiagLoading(true);
      const base64 = dataUrl.split(",")[1];
      const mimeType = dataUrl.slice(5, dataUrl.indexOf(";"));
      try {
        const res = await fetch("/api/diagnose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64, mimeType, lang: uiLang }),
        });
        setDiag(await res.json());
      } catch {
        setDiag(null);
      }
      setDiagLoading(false);
    };
    reader.readAsDataURL(file);
  };

  // Escalate the current diagnosis to a real ticket via /api/tickets; the
  // returned id and kendra come from the database. Falls back to the previous
  // local ticket behaviour if the API is unreachable.
  const referToExpert = async () => {
    if (!diag || kvkReferring) return;
    setKvkReferring(true);
    const d = DISTRICTS[0];
    const ticket = await createLiveTicket({
      farmer: "Demo farmer",
      village: d?.blocks[0] ?? "Sehore",
      district: d?.district ?? "Sehore",
      state: d?.state ?? "Madhya Pradesh",
      channel: "photo",
      crop: diag.plant,
      aiDiagnosis: `${diag.disease_en}${diag.disease_scientific ? ` (${diag.disease_scientific})` : ""}`,
      confidence: diag.confidence,
      severity: diag.severity,
    });
    setKvkReferring(false);
    setKvkTicket(
      ticket
        ? { id: ticket.id, kendra: ticket.kendra }
        : { id: `RSK-${1000 + Math.floor(Math.random() * 9000)}`, kendra: "KVK Sehore" }
    );
  };

  const listenSummary = () => {
    if (!diag) return;
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speak(diag.voice_summary, bcp47, () => setSpeaking(false));
  };

  const sevColor = { low: "bg-leaf-mist text-forest", medium: "bg-amber-100 text-amber-800", high: "bg-red-100 text-clay" };

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="border-b border-forest/10 bg-paper/90 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
          <Link href="/" className="font-display text-xl font-semibold text-forest inline-flex items-center gap-1.5">
            <Sprout className="text-leaf" size={18} aria-hidden />
            KisanVaani
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/command" className="text-ink-soft hover:text-forest">Command Center</Link>
            <Link href="/" className="text-ink-soft hover:text-forest">About</Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6">
          <h1 className="font-display text-3xl font-semibold text-forest">Farmer demo</h1>
          <p className="text-ink-soft mt-1 max-w-2xl">
            This simulator reproduces the experience on a <strong>₹1,500 feature phone</strong>. In production the same
            flows run over an IVR line and SMS gateway; the farmer needs no app and no internet connection.
          </p>
        </header>

        {/* Language picker — 12 scheduled languages + auto-detect */}
        <div className="mb-6 max-w-3xl">
          <div className="text-sm text-ink-soft mb-2">Farmer&rsquo;s language</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {LANGS_FULL.map((l) => (
              <button
                key={l.code}
                onClick={() => setLang(l.code)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                  lang === l.code
                    ? "bg-forest text-paper border-forest"
                    : "bg-white text-ink-soft border-forest/20 hover:border-forest/50"
                }`}
              >
                {l.native}
              </button>
            ))}
            <button
              onClick={() => setLang("auto")}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                lang === "auto"
                  ? "bg-turmeric text-white border-turmeric"
                  : "bg-turmeric-soft/40 text-ink border-turmeric/40 hover:border-turmeric"
              }`}
            >
              <Mic className="inline w-3 h-3 -mt-0.5 mr-1" aria-hidden />
              Auto — any language
            </button>
          </div>
          {lang === "auto" && (
            <div className="text-xs text-ink-soft mt-2 rise">
              <Languages className="inline w-3.5 h-3.5 -mt-0.5 mr-1 text-turmeric" aria-hidden />
              Speak in any Indian language; Gemini detects it and replies in the same language.
            </div>
          )}
        </div>

        {/* Mode tabs */}
        <div className="grid grid-cols-3 gap-3 mb-8 max-w-2xl">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`rounded-xl border p-3 text-left transition ${
                mode === m.id ? "bg-forest text-paper border-forest shadow-lg" : "bg-white border-forest/15 hover:border-forest/40"
              }`}
            >
              <m.icon size={18} className={mode === m.id ? "text-paper/80" : "text-ink-soft"} aria-hidden />
              <div className="font-semibold text-sm mt-1.5">{m.label}</div>
              <div className={`text-xs ${mode === m.id ? "text-paper/70" : "text-ink-soft"}`}>{m.sub}</div>
            </button>
          ))}
        </div>

        <div className="grid lg:grid-cols-[minmax(0,420px)_1fr] gap-10 items-start">
          {/* ================= PHONE / PANEL ================= */}
          <div>
            {mode !== "photo" ? (
              /* Feature phone frame */
              <div className="mx-auto w-[300px] rounded-[2rem] bg-gradient-to-b from-zinc-800 to-zinc-900 p-4 shadow-2xl border border-zinc-700">
                <div className="text-center text-zinc-400 text-[10px] tracking-[0.3em] mb-2">KISANPHONE 105</div>
                {/* Screen */}
                <div ref={screenRef} className="phone-screen rounded-lg h-72 overflow-y-auto p-3 text-[13px] leading-snug">
                  {mode === "call" && (
                    <>
                      {callState === "idle" && (
                        <div className="h-full flex flex-col items-center justify-center text-center text-forest/80">
                          <div className="text-3xl mb-2">🌾</div>
                          <div className="font-semibold">{t.welcome}</div>
                          <div className="text-xs mt-2 text-forest/60">📞 1800-180-KISAN</div>
                          <div className="text-[10px] mt-4 text-forest/50">Press the green button to call</div>
                        </div>
                      )}
                      {callState === "dialing" && (
                        <div className="h-full flex flex-col items-center justify-center text-forest/80">
                          <div className="text-2xl blink">📞</div>
                          <div className="mt-2 text-sm">{t.dialing}</div>
                          <div className="text-xs text-forest/60">1800-180-KISAN</div>
                        </div>
                      )}
                      {(callState === "menu" || callState === "listening" || callState === "mandi" || callState === "thinking" || callState === "answered") && (
                        <div className="space-y-2">
                          <div className="text-center text-[10px] text-forest/60 border-b border-forest/10 pb-1 mb-2">
                            {t.connected} · 00:{String(bubbles.length * 7 + 12).padStart(2, "0")}
                          </div>
                          {bubbles.map((b, i) => (
                            <div key={i} className={`rise max-w-[90%] rounded-lg px-2.5 py-1.5 ${
                              b.who === "ivr" ? "bg-white/80 text-ink" : "bg-forest text-paper ml-auto"
                            }`}>
                              {b.who === "ivr" && <div className="text-[9px] font-semibold text-leaf mb-0.5">KISANVAANI</div>}
                              {b.text}
                            </div>
                          ))}
                          {callState === "thinking" && (
                            <div className="bg-white/80 rounded-lg px-2.5 py-1.5 max-w-[90%] text-ink-soft blink">{t.ivrThinking}</div>
                          )}
                          {callState === "listening" && lang !== "auto" && micOn && (
                            <div className="text-center text-clay text-xs blink mt-2">🎙 {t.speakNow}</div>
                          )}
                          {callState === "listening" && lang === "auto" && recording && (
                            <div className="text-center text-clay text-xs blink mt-2">● REC — {t.speakNow}</div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {mode === "sms" && (
                    <div className="space-y-2">
                      <div className="text-center text-[10px] text-forest/60 border-b border-forest/10 pb-1 mb-2">
                        Messages · KISAN (56070)
                      </div>
                      {smsThread.length === 0 && (
                        <div className="text-center text-forest/50 text-xs mt-16">
                          Send crop + problem to shortcode <b>56070</b>
                          <br />
                          <span className="text-[10px]">works on any phone, ₹0.15/SMS</span>
                        </div>
                      )}
                      {smsThread.map((m, i) => (
                        <div key={i} className={`rise max-w-[92%] rounded-lg px-2.5 py-1.5 ${
                          m.who === "kisanvaani" ? "bg-white/80 text-ink" : "bg-forest text-paper ml-auto"
                        }`}>
                          {m.who === "kisanvaani" && <div className="text-[9px] font-semibold text-leaf mb-0.5">KISAN 56070</div>}
                          {m.text}
                        </div>
                      ))}
                      {smsSending && (
                        <div className="bg-white/80 rounded-lg px-2.5 py-1.5 max-w-[90%] text-ink-soft blink">…</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Call buttons */}
                <div className="flex justify-between items-center mt-3 px-2">
                  <button
                    onClick={mode === "call" ? startCall : undefined}
                    disabled={mode !== "call" || callState !== "idle"}
                    className={`w-12 h-12 rounded-full bg-green-600 text-white text-xl flex items-center justify-center keypad-btn disabled:opacity-40 ${
                      mode === "call" && callState === "idle" ? "pulse-ring" : ""
                    }`}
                    aria-label="Start call"
                  >
                    <Phone size={20} aria-hidden />
                  </button>
                  <div className="text-zinc-500 text-[9px] text-center leading-tight">IVR simulation<br />browser voice stands in for the line</div>
                  <button
                    onClick={endCall}
                    disabled={mode !== "call" || callState === "idle"}
                    className="w-12 h-12 rounded-full bg-red-600 text-white text-xl flex items-center justify-center keypad-btn disabled:opacity-40"
                    aria-label="End call"
                  >
                    <PhoneOff size={20} aria-hidden />
                  </button>
                </div>

                {/* Keypad */}
                <div className="grid grid-cols-3 gap-1.5 mt-3">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) => (
                    <button
                      key={k}
                      onClick={() => pressKey(k)}
                      className={`keypad-btn rounded-md py-1.5 text-sm font-semibold border ${
                        (k === "1" || k === "2") && callState === "menu"
                          ? "bg-turmeric-soft/90 text-ink border-turmeric"
                          : "bg-zinc-700 text-zinc-200 border-zinc-600"
                      }`}
                    >
                      {k}
                      {k === "1" && <span className="block text-[8px] font-normal -mt-0.5">फसल</span>}
                      {k === "2" && <span className="block text-[8px] font-normal -mt-0.5">भाव</span>}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Photo mode panel */
              <div className="rounded-2xl bg-white border border-forest/15 p-5 shadow-sm">
                <h3 className="font-semibold text-forest mb-1 flex items-center gap-1.5">
                  <Camera size={16} className="text-ink-soft" aria-hidden /> Send a crop photo
                </h3>
                <p className="text-xs text-ink-soft mb-4">
                  In the field, the farmer hands the photo to the village <b>relay worker (sahayak)</b> or sends it on
                  WhatsApp to +91-98XXX-KISAN. The reply arrives as a voice note in their language.
                </p>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full border-2 border-dashed border-leaf/40 rounded-xl p-6 text-center hover:bg-leaf-mist/40 transition"
                >
                  {photoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoPreview} alt="uploaded crop" className="max-h-40 mx-auto rounded-lg" />
                  ) : (
                    <>
                      <ImagePlus size={24} className="mx-auto text-leaf" aria-hidden />
                      <div className="text-sm font-medium text-leaf mt-1.5">Upload a leaf or crop photo</div>
                      <div className="text-xs text-ink-soft">Analysed live with Gemini vision</div>
                    </>
                  )}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
                />
                <div className="text-xs text-ink-soft text-center my-3">Or replay a documented field case</div>
                <div className="space-y-2">
                  {CASE_STUDIES.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => runCase(c.id)}
                      className={`w-full flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                        activeCase === c.id ? "border-forest bg-leaf-mist/50" : "border-forest/15 hover:border-forest/40"
                      }`}
                    >
                      <div className="w-9 h-9 shrink-0 rounded-lg bg-leaf-mist text-forest flex items-center justify-center text-sm font-semibold" aria-hidden>
                        {c.crop.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{c.crop} — {c.farmer}</div>
                        <div className="text-xs text-ink-soft truncate">{c.village} · {c.photoNote}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Under-phone inputs for call & sms */}
            {mode === "call" && callState === "listening" && lang === "auto" && (
              <div className="mt-4 rounded-xl bg-white border border-forest/15 p-4 rise">
                <div className="text-xs font-semibold text-ink-soft mb-3 flex items-center gap-1.5">
                  <Languages size={14} className="text-turmeric shrink-0" aria-hidden /> {t.recordHint}
                </div>
                <button
                  onClick={toggleRecord}
                  className={`w-full flex items-center justify-center gap-2 rounded-xl py-4 font-semibold text-base transition ${
                    recording ? "bg-red-600 text-white blink" : "bg-turmeric text-white hover:bg-turmeric/90"
                  }`}
                >
                  {recording ? (
                    <>
                      <Square className="w-5 h-5" aria-hidden /> Stop &amp; send
                    </>
                  ) : (
                    <>
                      <Mic className="w-5 h-5" aria-hidden /> Hold the line — press &amp; speak
                    </>
                  )}
                </button>
                <div className="text-[11px] text-ink-soft text-center mt-2">
                  Hindi, Tamil, Bhojpuri, Santali — any Indian language works; Gemini detects it automatically.
                </div>
                {micDenied && (
                  <div className="text-xs text-clay text-center mt-2">
                    Microphone unavailable or permission denied — allow mic access in the browser and try again.
                  </div>
                )}
              </div>
            )}

            {mode === "call" && callState === "listening" && lang !== "auto" && (
              <div className="mt-4 rounded-xl bg-white border border-forest/15 p-4 rise">
                <div className="text-xs font-semibold text-ink-soft mb-2 flex items-center gap-1.5">
                  <Mic size={14} className="shrink-0" aria-hidden />
                  Farmer speaks {micSupported && "(use your mic, or tap a sample)"}
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {samples.ivr.map((q) => (
                    <button
                      key={q}
                      onClick={() => submitProblem(q)}
                      className="text-xs bg-leaf-mist text-forest rounded-full px-3 py-1.5 hover:bg-leaf/20 text-left"
                    >
                      &ldquo;{q}&rdquo;
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  {micSupported && (
                    <button
                      onClick={toggleMic}
                      className={`px-3 py-2 rounded-lg text-sm font-medium ${micOn ? "bg-red-600 text-white blink" : "bg-forest text-paper"}`}
                    >
                      {micOn ? (
                        <span className="inline-flex items-center gap-1"><Square size={14} aria-hidden /> Stop</span>
                      ) : (
                        <span className="inline-flex items-center gap-1"><Mic size={14} aria-hidden /> Mic</span>
                      )}
                    </button>
                  )}
                  <input
                    value={callInput}
                    onChange={(e) => setCallInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitProblem(callInput)}
                    placeholder={t.speakNow}
                    className="flex-1 border border-forest/20 rounded-lg px-3 py-2 text-sm bg-paper focus:outline-none focus:border-forest"
                  />
                  <button onClick={() => submitProblem(callInput)} className="px-3 py-2 rounded-lg bg-turmeric text-white text-sm font-medium">
                    Send
                  </button>
                </div>
              </div>
            )}

            {mode === "call" && callState === "mandi" && (
              <div className="mt-4 rounded-xl bg-white border border-forest/15 p-4 rise">
                <div className="text-xs font-semibold text-ink-soft mb-2">{t.mandiPrices} — {MANDI_STATE}</div>
                <div className="flex flex-wrap gap-2">
                  {MANDI_CROPS.map((c) => (
                    <button
                      key={c}
                      onClick={() => askMandi(c)}
                      className="text-sm bg-leaf-mist text-forest rounded-full px-4 py-2 hover:bg-leaf/20 font-medium"
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] text-ink-soft mt-2">Prices: Agmarknet; a cached quote is used if the feed is unavailable.</div>
              </div>
            )}

            {mode === "call" && detected && (
              <div className="mt-3 rise">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-turmeric-soft/60 border border-turmeric/40 px-3 py-1.5 text-xs font-semibold text-ink">
                  <Languages className="w-3.5 h-3.5 text-turmeric" aria-hidden />
                  {t.detected} {detected.name}
                </div>
                {ttsNote && (
                  <div className="text-[11px] text-ink-soft mt-1.5">
                    (voice output available on Android for this language — showing text here)
                  </div>
                )}
              </div>
            )}

            {mode === "sms" && (
              <div className="mt-4 rounded-xl bg-white border border-forest/15 p-4">
                <div className="flex flex-wrap gap-2 mb-3">
                  {samples.sms.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendSms(q)}
                      className="text-xs bg-leaf-mist text-forest rounded-full px-3 py-1.5 hover:bg-leaf/20 font-mono"
                    >
                      {q}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={smsInput}
                    onChange={(e) => setSmsInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendSms(smsInput)}
                    placeholder={t.smsPlaceholder}
                    className="flex-1 border border-forest/20 rounded-lg px-3 py-2 text-sm bg-paper focus:outline-none focus:border-forest"
                  />
                  <button onClick={() => sendSms(smsInput)} className="px-4 py-2 rounded-lg bg-forest text-paper text-sm font-medium">
                    {t.sendSms}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ================= RIGHT: RESULT / PIPELINE ================= */}
          <div className="space-y-5">
            {/* Photo diagnosis result */}
            {mode === "photo" && (
              <div className="rounded-2xl bg-white border border-forest/15 p-6 shadow-sm min-h-64">
                {!diag && !diagLoading && (
                  <div className="h-full flex flex-col items-center justify-center text-center text-ink-soft py-14">
                    <ScanSearch size={32} className="mb-3 text-ink-soft/60" aria-hidden />
                    <div className="font-medium">Diagnosis appears here</div>
                    <div className="text-xs mt-1">Upload a photo or replay a field case</div>
                  </div>
                )}
                {diagLoading && (
                  <div className="py-14 text-center">
                    <ScanSearch size={32} className="mx-auto text-forest blink" aria-hidden />
                    <div className="mt-3 font-medium text-forest">Gemini is examining the photo…</div>
                    <div className="text-xs text-ink-soft mt-1">Crop, disease, treatment, then a voice note</div>
                  </div>
                )}
                {diag && !diagLoading && diag.is_plant === false && (
                  <div className="py-14 text-center text-ink-soft">
                    <div className="mt-2">This does not appear to be a plant. Try a crop or leaf photo.</div>
                  </div>
                )}
                {diag && !diagLoading && diag.is_plant !== false && (
                  <div className="rise">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-xs text-ink-soft">{diag.plant}</div>
                        <h3 className="font-display text-2xl font-semibold text-forest">{diag.disease_en}</h3>
                        <div className="text-sm text-ink-soft">
                          {diag.disease_local} · <i>{diag.disease_scientific}</i>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${sevColor[diag.severity]}`}>
                          Severity: {diag.severity}
                        </span>
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-leaf-mist text-forest">
                          {diag.confidence}% match
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 h-1.5 rounded-full bg-forest/10 overflow-hidden">
                      <div className="h-full bg-leaf-bright rounded-full" style={{ width: `${diag.confidence}%` }} />
                    </div>

                    <button
                      onClick={listenSummary}
                      className="mt-4 w-full rounded-xl bg-forest text-paper py-3 font-semibold hover:bg-leaf transition"
                    >
                      {speaking ? t.stop : `${t.listen} — voice note (${langMeta.native})`}
                    </button>
                    <div className="text-[11px] text-ink-soft text-center mt-1">
                      This is the voice note the farmer receives on their phone; no reading required.
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4 mt-5">
                      <div className="rounded-xl bg-leaf-mist/50 p-4">
                        <div className="text-xs font-semibold text-forest mb-2 flex items-center gap-1.5">
                          <Leaf size={14} aria-hidden /> Organic / IPM first
                        </div>
                        <ul className="text-sm space-y-1.5">
                          {diag.treatment_organic.map((x, i) => <li key={i}>• {x}</li>)}
                        </ul>
                      </div>
                      <div className="rounded-xl bg-amber-50 p-4">
                        <div className="text-xs font-semibold text-clay mb-2 flex items-center gap-1.5">
                          <FlaskConical size={14} aria-hidden /> Chemical control (if severe)
                        </div>
                        <ul className="text-sm space-y-1.5">
                          {diag.treatment_chemical.map((x, i) => <li key={i}>• {x}</li>)}
                        </ul>
                        <p className="mt-2 text-[11px] text-clay/80">
                          Confirm with your KVK and read the product label before spraying — dosages are indicative.
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-forest/10 p-4">
                      <div className="text-xs font-semibold text-ink-soft mb-2">Symptoms matched</div>
                      <div className="flex flex-wrap gap-1.5">
                        {diag.symptoms.map((s, i) => (
                          <span key={i} className="text-xs bg-paper-warm rounded-full px-2.5 py-1">{s}</span>
                        ))}
                      </div>
                      <div className="text-xs font-semibold text-ink-soft mt-3 mb-1">Prevention for next season</div>
                      <ul className="text-sm space-y-1">{diag.prevention.map((x, i) => <li key={i}>• {x}</li>)}</ul>
                    </div>

                    <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-clay">
                      <Clock size={16} className="mt-0.5 shrink-0" aria-hidden />
                      <span><b>Urgency:</b> {diag.urgency}</span>
                    </div>

                    {/* Escalate to human expert (RSK/KVK) */}
                    {!kvkTicket ? (
                      <button
                        onClick={() => void referToExpert()}
                        disabled={kvkReferring}
                        className="mt-4 w-full rounded-xl border-2 border-forest/30 text-forest py-3 text-sm font-semibold hover:bg-leaf-mist/40 transition disabled:opacity-60"
                      >
                        {kvkReferring ? "Creating ticket…" : "Refer to a KVK / Rythu Seva Kendra expert"}
                      </button>
                    ) : (
                      <div className="mt-4 flex items-start gap-2 rounded-xl bg-leaf-mist/60 border border-leaf/40 p-3 text-sm text-forest rise">
                        <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
                        <span>
                          <b>Ticket {kvkTicket.id} created</b> · {kvkTicket.kendra} · response within 48 hours
                        </span>
                      </div>
                    )}

                    <div className="text-[11px] text-ink-soft mt-3 text-right">
                      {diag.source === "gemini" ? "Source: live Gemini 2.5 Flash diagnosis" : diag.source === "case-study" ? "Source: field case study (cached)" : "Source: cached fallback"}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Pipeline explainer */}
            <div className="rounded-2xl bg-forest text-paper p-6">
              <div className="text-xs font-semibold tracking-widest text-leaf-mist/80 mb-3 uppercase">How this works in production</div>
              {mode === "call" && (
                <ol className="space-y-2.5 text-sm">
                  <li><b>1 · Toll-free IVR</b> — the farmer dials a toll-free 1800 line (provisioned via Exotel in production; a live Twilio number answers today). No cost to the farmer.</li>
                  <li><b>2 · Speech to text</b> — {lang === "auto" ? <>Gemini ingests the raw audio, detects the language and transcribes it; no language menu is needed <span className="text-leaf-mist/70">(the demo just did this with your microphone)</span></> : <>Bhashini / Google Cloud Speech ASR in 12+ Indic languages <span className="text-leaf-mist/70">(the demo uses your browser&rsquo;s microphone and speech engine)</span></>}.</li>
                  <li><b>3 · Gemini reasons</b> — grounded on the Kisan Call Centre Q&amp;A corpus, crop calendar and weather, with guardrailed dosages.</li>
                  <li><b>4 · Text to speech</b> — the advisory is spoken back in the farmer&rsquo;s language on the same call.</li>
                  <li><b>5 · Logged to Kisan Alert</b> — every query feeds district-level outbreak detection. <Link href="/command" className="underline text-turmeric-soft">View the command center</Link></li>
                </ol>
              )}
              {mode === "sms" && (
                <ol className="space-y-2.5 text-sm">
                  <li><b>1 · SMS to shortcode 56070</b> — works on 2G on any handset at ₹0.15 per message. Shorthand such as <span className="font-mono">KAPAS PILA PATTA</span> is understood.</li>
                  <li><b>2 · Gemini expands and reasons</b> — reads transliterated Hindi/Marathi/Telugu shorthand and returns the advisory in native script.</li>
                  <li><b>3 · Reply within two SMS segments</b> — exact dosages plus the Kisan Call Centre number, readable on a monochrome screen.</li>
                  <li><b>4 · Logged to Kisan Alert</b> — aggregated to block level by registered village for outbreak mapping; individual identity is not shown on the public map. <Link href="/command" className="underline text-turmeric-soft">View the command center</Link></li>
                </ol>
              )}
              {mode === "photo" && (
                <ol className="space-y-2.5 text-sm">
                  <li><b>1 · Photo via relay</b> — the farmer&rsquo;s own phone, the village sahayak&rsquo;s smartphone, or WhatsApp. One smartphone can serve a village.</li>
                  <li><b>2 · Gemini 2.5 Flash vision</b> — identifies the crop and disease with schema-enforced structured JSON output.</li>
                  <li><b>3 · Voice note back</b> — a 60-word spoken summary in the farmer&rsquo;s language, with the full advisory sent by SMS to their feature phone.</li>
                  <li><b>4 · Every diagnosis is a data point</b> — 23 leaf-curl photos from one block become an outbreak alert to 1,240 farmers. <Link href="/command" className="underline text-turmeric-soft">View the command center</Link></li>
                </ol>
              )}
              {(callSource || smsSource) && mode !== "photo" && (
                <div className="text-[11px] text-leaf-mist/70 mt-4 text-right">
                  {(mode === "call" ? callSource : smsSource) === "gemini" ? "Source: live Gemini 2.5 Flash response" : (mode === "call" ? callSource : smsSource) === "agmarknet" ? "Source: live Agmarknet mandi prices" : "Source: cached fallback response (offline-safe)"}
                </div>
              )}
            </div>

            {/* Live test line */}
            <div className="rounded-2xl bg-white border border-forest/15 p-5 text-sm text-ink-soft">
              <b className="text-ink">A real line is connected.</b> The same IVR and SMS pipeline shown here answers a
              live Twilio number: <span className="font-medium text-ink whitespace-nowrap">+1 254 272 6372</span>. Call it
              and describe a crop problem after the menu, or text shorthand such as{" "}
              <span className="font-mono text-xs">KAPAS PILA PATTA</span> — the reply comes from the same Gemini advisory
              engine, and the query appears in the command center. It is a US trial number (a short Twilio notice plays
              first, and international rates apply from India); the production deployment uses an Indian toll-free line
              via Exotel with DLT-registered SMS.
            </div>

            {/* Why this matters */}
            <div className="rounded-2xl bg-white border border-forest/15 p-5 text-sm text-ink-soft">
              <b className="text-ink">Why voice and SMS first?</b> Roughly 55% of rural India does not use a smartphone,
              and many who do avoid apps because of literacy and data costs. Existing agri apps miss the farmers most
              exposed to crop disease. KisanVaani works on the phones farmers already own.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
