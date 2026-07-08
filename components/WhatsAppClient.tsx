"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  Camera,
  Check,
  CheckCheck,
  ExternalLink,
  Lock,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Play,
  Send,
  Smile,
  Sprout,
  Square,
  Video,
} from "lucide-react";
import type { VoiceResult } from "@/lib/types";
import { speak, stopSpeaking } from "@/lib/speech";
import { createLiveTicket } from "@/lib/ops-live";
import { DISTRICTS } from "@/lib/districts";

// ---------- WhatsApp UI constants (verified spec in research/whatsapp-sms.json) ----------
const WA = {
  header: "#008069",
  wallpaper: "#EFEAE2",
  bubbleOut: "#D9FDD3",
  bubbleIn: "#FFFFFF",
  readTicks: "#53BDEB",
  linkBlue: "#00A5F4",
  tsGray: "#667781",
  encryptChip: "#FFF3C2",
  brandGreen: "#25D366",
};

// ---------- Types ----------
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

type TickStatus = "sent" | "delivered" | "read";

type Msg = {
  id: string;
  dir: "in" | "out";
  kind: "text" | "image" | "voice" | "diagnosis";
  time: string;
  status?: TickStatus;
  text?: string;
  caption?: string; // small meta line, e.g. detected language
  imageUrl?: string;
  voice?: { duration: number; ttsText?: string; ttsLang?: string; hasAudio?: boolean };
  diag?: Diagnosis;
  referred?: boolean; // diagnosis card already escalated to an expert ticket
};

// ---------- Cached fallbacks (page must work fully standalone) ----------
const CACHED_DIAG: Diagnosis = {
  is_plant: true,
  plant: "Tomato (टमाटर)",
  disease_en: "Tomato Leaf Curl Virus",
  disease_local: "टमाटर पत्ती मोड़क विषाणु",
  disease_scientific: "Begomovirus (ToLCV)",
  confidence: 87,
  severity: "high",
  symptoms: ["पत्तियाँ ऊपर की ओर मुड़ी हुई", "पीली नसें", "पौधे की बढ़त रुकी हुई"],
  treatment_organic: [
    "नीम तेल 5ml/L का छिड़काव हर 7 दिन में",
    "पीले चिपचिपे ट्रैप 8-10 प्रति एकड़ (सफेद मक्खी नियंत्रण)",
    "संक्रमित पौधे उखाड़कर जला दें",
  ],
  treatment_chemical: ["डायफेनथ्यूरॉन 50 WP — 1g/L, केवल गंभीर प्रकोप पर; दवा बदल-बदल कर छिड़कें"],
  prevention: ["रोग-रोधी किस्म लगाएँ", "नर्सरी को नेट से ढकें"],
  urgency: "3 दिन के भीतर छिड़काव करें — सफेद मक्खी वायरस तेज़ी से फैलाती है।",
  voice_summary:
    "नमस्ते। आपके टमाटर में पत्ती मोड़क विषाणु दिख रहा है, जो सफेद मक्खी से फैलता है। संक्रमित पौधे उखाड़कर जला दें। नीम तेल पाँच मिलीलीटर प्रति लीटर पानी में मिलाकर हर सात दिन में छिड़काव करें। खेत में पीले चिपचिपे ट्रैप लगाएँ। तीन दिन के अंदर काम शुरू करें। अधिक जानकारी के लिए किसान कॉल सेंटर पर फोन करें।",
  source: "cached",
};

const CACHED_VOICE: VoiceResult = {
  detectedLangCode: "hi-IN",
  detectedLangName: "Hindi (हिन्दी)",
  transcript: "मेरी टमाटर की फसल में पत्ते पीले होकर मुड़ रहे हैं, क्या करूँ?",
  replyText:
    "नमस्ते! पत्तों का पीला होकर मुड़ना अक्सर पत्ती मोड़क विषाणु या रस चूसने वाले कीड़ों से होता है। नीम तेल 5ml प्रति लीटर पानी में मिलाकर शाम को छिड़काव करें। पीले चिपचिपे ट्रैप लगाएँ। अगर 5-6 दिन में सुधार न हो तो किसान कॉल सेंटर 1800-180-1551 पर बात करें।",
  replyEnglish:
    "Yellowing + curling leaves usually indicate leaf curl virus or sucking pests. Advised neem oil 5ml/L evening spray, yellow sticky traps, and Kisan Call Centre escalation if no improvement in 5-6 days.",
  source: "cached",
};

const CACHED_TEXT_REPLY =
  "नमस्ते! 🌾 मैं KisanVaani हूँ। अपनी फसल की समस्या बताइए, फोटो भेजिए 📷 या mic दबाकर अपनी भाषा में बोलिए 🎙 — मैं तुरंत सलाह दूँगा। आपात स्थिति में किसान कॉल सेंटर: 1800-180-1551.";

const GREETING =
  "Namaste! 🙏 KisanVaani mein aapka swagat hai. Apni fasal ki photo bhejein 📷, mic dabakar apni bhasha mein boliye 🎙, ya apna sawaal likhiye — turant salah milegi.";

// ---------- Helpers ----------
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const fmtTime = (d = new Date()) =>
  d
    .toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase()
    .replace(/\s/g, " ");

const estSeconds = (text: string) =>
  Math.min(60, Math.max(3, Math.round(text.split(/\s+/).filter(Boolean).length / 2.7)));

// deterministic waveform heights per message id
function waveHeights(id: string, n = 26): number[] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    out.push(5 + (h % 14));
  }
  return out;
}

async function resizeImage(file: File): Promise<{ dataUrl: string; base64: string; mimeType: string }> {
  const raw: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = raw;
    });
    const max = 1024;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { dataUrl, base64: dataUrl.split(",")[1], mimeType: "image/jpeg" };
  } catch {
    const mimeType = raw.slice(5, raw.indexOf(";")) || "image/jpeg";
    return { dataUrl: raw, base64: raw.split(",")[1], mimeType };
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

const STORAGE_KEY = "kv-wa-thread-v1";

// ================================================================
export default function WhatsAppClient() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playProgress, setPlayProgress] = useState(0);
  // Set after mount only — calling fmtTime() during render caused a server/client
  // hydration mismatch (React #418), since the two renders format different Dates.
  const [smsTime, setSmsTime] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioMap = useRef<Map<string, string>>(new Map()); // msgId -> blob URL (in-memory only)
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressStartRef = useRef(0);

  // ---- load / persist thread in sessionStorage ----
  useEffect(() => {
    let initial: Msg[] = [];
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) initial = JSON.parse(saved) as Msg[];
    } catch {
      /* ignore */
    }
    if (initial.length === 0) {
      initial = [{ id: uid(), dir: "in", kind: "text", text: GREETING, time: fmtTime() }];
    }
    setMsgs(initial);
    setLoaded(true);
    setSmsTime(fmtTime());
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
    } catch {
      // quota exceeded (large photos) — drop image payloads, keep the rest
      try {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(msgs.map((m) => (m.kind === "image" ? { ...m, imageUrl: undefined } : m)))
        );
      } catch {
        /* give up silently */
      }
    }
  }, [msgs, loaded]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" });
  }, [msgs, typing]);

  useEffect(
    () => () => {
      stopSpeaking();
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      audioElRef.current?.pause();
    },
    []
  );

  const addMsg = useCallback((m: Msg) => setMsgs((prev) => [...prev, m]), []);

  // sent → delivered → read tick animation
  const animateTicks = useCallback((id: string) => {
    setTimeout(
      () => setMsgs((p) => p.map((m) => (m.id === id ? { ...m, status: "delivered" as TickStatus } : m))),
      700
    );
    setTimeout(
      () => setMsgs((p) => p.map((m) => (m.id === id ? { ...m, status: "read" as TickStatus } : m))),
      1500
    );
  }, []);

  const sendOutgoing = useCallback(
    (m: Omit<Msg, "dir" | "time" | "status">) => {
      const msg: Msg = { ...m, dir: "out", time: fmtTime(), status: "sent" };
      addMsg(msg);
      animateTicks(msg.id);
      return msg.id;
    },
    [addMsg, animateTicks]
  );

  // ---------- a) TEXT via /api/advisory ----------
  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      setInput("");
      sendOutgoing({ id: uid(), kind: "text", text });
      setTimeout(() => setTyping(true), 600);
      let reply = CACHED_TEXT_REPLY;
      try {
        const res = await fetch("/api/advisory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: text, lang: "hi", channel: "sms" }),
          signal: AbortSignal.timeout(20000),
        });
        if (res.ok) {
          const data = (await res.json()) as { text?: string };
          if (data.text) reply = data.text;
        }
      } catch {
        /* cached reply */
      }
      setTyping(false);
      addMsg({ id: uid(), dir: "in", kind: "text", text: reply, time: fmtTime() });
    },
    [addMsg, sendOutgoing]
  );

  // ---------- b) PHOTO via /api/diagnose ----------
  const onPhoto = useCallback(
    async (file: File) => {
      const { dataUrl, base64, mimeType } = await resizeImage(file);
      sendOutgoing({ id: uid(), kind: "image", imageUrl: dataUrl });
      setTimeout(() => setTyping(true), 900);
      let diag = CACHED_DIAG;
      try {
        const res = await fetch("/api/diagnose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64, mimeType, lang: "hi" }),
          signal: AbortSignal.timeout(30000),
        });
        if (res.ok) {
          const data = (await res.json()) as Diagnosis;
          if (data && data.disease_en) diag = data;
        }
      } catch {
        /* cached diagnosis */
      }
      setTyping(false);
      if (diag.is_plant === false) {
        addMsg({
          id: uid(),
          dir: "in",
          kind: "text",
          text: "🤔 Yeh photo fasal ki nahin lag rahi. Kripya patte ya paudhe ki saaf photo bhejein.",
          time: fmtTime(),
        });
        return;
      }
      addMsg({ id: uid(), dir: "in", kind: "diagnosis", diag, time: fmtTime() });
      setTimeout(() => {
        addMsg({
          id: uid(),
          dir: "in",
          kind: "voice",
          time: fmtTime(),
          voice: { duration: estSeconds(diag.voice_summary), ttsText: diag.voice_summary, ttsLang: "hi-IN" },
        });
      }, 500);
    },
    [addMsg, sendOutgoing]
  );

  // ---------- b2) Escalate a diagnosis card to a real /api/tickets ticket ----------
  const referToExpert = useCallback(
    async (m: Msg) => {
      const d = m.diag;
      if (!d || m.referred) return;
      setMsgs((prev) => prev.map((x) => (x.id === m.id ? { ...x, referred: true } : x)));
      sendOutgoing({ id: uid(), kind: "text", text: "Expert se baat karani hai 🙏" });
      setTimeout(() => setTyping(true), 500);
      const home = DISTRICTS[0];
      const ticket = await createLiveTicket({
        farmer: "WhatsApp farmer",
        village: home?.blocks[0] ?? "Sehore",
        district: home?.district ?? "Sehore",
        state: home?.state ?? "Madhya Pradesh",
        channel: "whatsapp",
        crop: d.plant,
        aiDiagnosis: `${d.disease_en}${d.disease_scientific ? ` (${d.disease_scientific})` : ""}`,
        confidence: d.confidence,
        severity: d.severity,
      });
      // API unreachable → keep the demo alive with a locally generated ticket.
      const id = ticket?.id ?? `RSK-${1000 + Math.floor(Math.random() * 9000)}`;
      const kendra = ticket?.kendra ?? "KVK Sehore";
      setTyping(false);
      addMsg({
        id: uid(),
        dir: "in",
        kind: "text",
        text: `✅ Ticket ${id} ban gaya hai. ${kendra} ke krishi visheshagya 48 ghante ke andar aapse sampark karenge. Zaroorat padne par Kisan Call Centre 1800-180-1551 par bhi baat kar sakte hain.`,
        time: fmtTime(),
      });
    },
    [addMsg, sendOutgoing]
  );

  // ---------- c) VOICE via /api/voice (contract: VoiceResult) ----------
  const handleVoiceQuery = useCallback(
    async (base64: string | null, mimeType: string) => {
      setTimeout(() => setTyping(true), 600);
      let result = CACHED_VOICE;
      if (base64) {
        try {
          const res = await fetch("/api/voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio: base64, mimeType }),
            signal: AbortSignal.timeout(30000),
          });
          if (!res.ok) throw new Error(`voice route ${res.status}`);
          const data = (await res.json()) as VoiceResult;
          if (data && data.replyText) result = data;
        } catch {
          /* cached VoiceResult — page works standalone even if /api/voice is 404 */
        }
      }
      setTyping(false);
      addMsg({
        id: uid(),
        dir: "in",
        kind: "text",
        text: result.replyText,
        caption: `🌐 ${result.detectedLangName} · "${result.transcript}"`,
        time: fmtTime(),
      });
      // auto voice-note reply in detected language
      speak(result.replyText, result.detectedLangCode);
    },
    [addMsg]
  );

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const startRecording = useCallback(async () => {
    if (recording) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      // no mic in this browser — simulate the farmer's voice note so the demo never dies
      sendOutgoing({ id: uid(), kind: "voice", voice: { duration: 5, ttsText: CACHED_VOICE.transcript, ttsLang: "hi-IN" } });
      void handleVoiceQuery(null, "audio/webm");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recTimerRef.current) clearInterval(recTimerRef.current);
        setRecording(false);
        setRecSeconds(0);
        const duration = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const msgId = uid();
        audioMap.current.set(msgId, URL.createObjectURL(blob));
        sendOutgoing({ id: msgId, kind: "voice", voice: { duration, hasAudio: true } });
        try {
          const base64 = await blobToBase64(blob);
          void handleVoiceQuery(base64, blob.type.split(";")[0] || "audio/webm");
        } catch {
          void handleVoiceQuery(null, "audio/webm");
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } catch {
      // mic denied — graceful simulated flow
      sendOutgoing({ id: uid(), kind: "voice", voice: { duration: 5, ttsText: CACHED_VOICE.transcript, ttsLang: "hi-IN" } });
      void handleVoiceQuery(null, "audio/webm");
    }
  }, [recording, sendOutgoing, handleVoiceQuery]);

  // hold-to-record OR tap-to-toggle
  const onMicDown = useCallback(() => {
    if (recording) {
      stopRecording();
      pressStartRef.current = 0;
      return;
    }
    pressStartRef.current = Date.now();
    void startRecording();
  }, [recording, startRecording, stopRecording]);

  const onMicUp = useCallback(() => {
    if (recording && pressStartRef.current && Date.now() - pressStartRef.current > 600) {
      stopRecording(); // held → release to send; quick tap → stays recording until next tap
    }
  }, [recording, stopRecording]);

  // ---------- voice-note playback ----------
  const stopPlayback = useCallback(() => {
    stopSpeaking();
    audioElRef.current?.pause();
    audioElRef.current = null;
    if (playTimerRef.current) clearInterval(playTimerRef.current);
    setPlayingId(null);
    setPlayProgress(0);
  }, []);

  const playVoice = useCallback(
    (m: Msg) => {
      if (playingId === m.id) {
        stopPlayback();
        return;
      }
      stopPlayback();
      const url = audioMap.current.get(m.id);
      if (m.voice?.hasAudio && url) {
        const audio = new Audio(url);
        audioElRef.current = audio;
        setPlayingId(m.id);
        audio.ontimeupdate = () => {
          if (audio.duration) setPlayProgress(audio.currentTime / audio.duration);
        };
        audio.onended = () => stopPlayback();
        void audio.play().catch(() => stopPlayback());
      } else if (m.voice?.ttsText) {
        setPlayingId(m.id);
        const total = (m.voice.duration || estSeconds(m.voice.ttsText)) * 1000;
        const t0 = Date.now();
        playTimerRef.current = setInterval(
          () => setPlayProgress(Math.min(1, (Date.now() - t0) / total)),
          120
        );
        speak(m.voice.ttsText, m.voice.ttsLang || "hi-IN", () => stopPlayback());
      }
    },
    [playingId, stopPlayback]
  );

  // ---------- quick replies ----------
  const quickReply = useCallback(
    (label: string) => {
      if (label.toLowerCase().includes("photo")) {
        fileRef.current?.click();
        return;
      }
      sendOutgoing({ id: uid(), kind: "text", text: label });
      setTimeout(() => setTyping(true), 500);
      setTimeout(() => {
        setTyping(false);
        addMsg({
          id: uid(),
          dir: "in",
          kind: "text",
          text: label.includes("Awaaz")
            ? "Neeche hara mic button 🎙 dabakar apni bhasha mein sawaal boliye — Hindi, Marathi, Telugu, Tamil… jo bhi aap bolte hain. Main usi bhasha mein jawab dunga."
            : "📞 Kisan Call Centre: 1800-180-1551 — 24x7, bilkul nishulk. Wahan krishi visheshagya aapse seedhe baat karenge. Aap yahan photo ya voice note bhi bhej sakte hain.",
          time: fmtTime(),
        });
      }, 1400);
    },
    [addMsg, sendOutgoing]
  );

  // ---------- render helpers ----------
  const Ticks = ({ status }: { status?: TickStatus }) =>
    !status ? null : status === "sent" ? (
      <Check className="inline w-4 h-4" style={{ color: WA.tsGray }} aria-label="sent" />
    ) : (
      <CheckCheck
        className="inline w-4 h-4"
        style={{ color: status === "read" ? WA.readTicks : WA.tsGray }}
        aria-label={status}
      />
    );

  const Stamp = ({ m }: { m: Msg }) => (
    <span className="float-right ml-2 mt-1.5 flex items-center gap-0.5 text-[11px]" style={{ color: WA.tsGray }}>
      {m.time}
      {m.dir === "out" && <Ticks status={m.status} />}
    </span>
  );

  const VoiceBubble = ({ m }: { m: Msg }) => {
    const active = playingId === m.id;
    const bars = waveHeights(m.id);
    const playable = (m.voice?.hasAudio && audioMap.current.has(m.id)) || !!m.voice?.ttsText;
    const dur = m.voice?.duration ?? 0;
    return (
      <div className="flex items-center gap-2 py-0.5">
        <div className="relative shrink-0">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg" style={{ background: m.dir === "in" ? "#DFE5E7" : "#c5e8cd" }}>
            {m.dir === "in" ? "🌾" : "👨‍🌾"}
          </div>
          <Mic className="absolute -bottom-0.5 -right-0.5 w-4 h-4 p-0.5 rounded-full bg-white" style={{ color: active ? WA.tsGray : "#15a55a" }} />
        </div>
        <button
          onClick={() => playVoice(m)}
          disabled={!playable}
          className="shrink-0 disabled:opacity-40"
          aria-label={active ? "Stop voice note" : "Play voice note"}
        >
          {active ? (
            <Square className="w-7 h-7 fill-current" style={{ color: WA.tsGray }} />
          ) : (
            <Play className="w-7 h-7 fill-current" style={{ color: WA.tsGray }} />
          )}
        </button>
        <div className="flex items-center gap-[2px] h-8" aria-hidden>
          {bars.map((h, i) => {
            const done = active && i / bars.length <= playProgress;
            return (
              <span
                key={i}
                className="w-[3px] rounded-full transition-colors"
                style={{ height: h, background: done ? "#15a55a" : "#bfc5c9" }}
              />
            );
          })}
        </div>
        <div className="flex flex-col items-center gap-1 pl-1">
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-black/5" style={{ color: WA.tsGray }}>
            1×
          </span>
          <span className="text-[11px]" style={{ color: WA.tsGray }}>
            0:{String(dur).padStart(2, "0")}
          </span>
        </div>
      </div>
    );
  };

  const sevBadge = { low: "#15a55a", medium: "#d97706", high: "#dc2626" } as const;

  const DiagnosisBubble = ({ d }: { d: Diagnosis }) => {
    const lines = [...d.treatment_organic, ...d.treatment_chemical].slice(0, 3);
    return (
      <div className="text-[13.5px] leading-snug">
        <div className="rounded-lg overflow-hidden -mx-1 -mt-0.5 mb-2" style={{ background: "#f0f2f5" }}>
          <div className="px-3 py-2 border-l-4" style={{ borderColor: WA.header }}>
            <div className="text-[11px] font-semibold" style={{ color: WA.header }}>
              KISANVAANI FASAL DOCTOR
            </div>
            <div className="text-[12px]" style={{ color: WA.tsGray }}>
              {d.plant}
            </div>
          </div>
        </div>
        <div className="font-bold text-[15px]">🔬 {d.disease_en}</div>
        <div className="text-[12.5px]" style={{ color: WA.tsGray }}>
          {d.disease_local} · <i>{d.disease_scientific}</i>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span
            className="text-[10px] font-bold text-white px-2 py-0.5 rounded-full uppercase"
            style={{ background: sevBadge[d.severity] }}
          >
            {d.severity}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-black/10 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${d.confidence}%`, background: WA.header }} />
          </div>
          <span className="text-[11px] font-semibold" style={{ color: WA.tsGray }}>
            {d.confidence}%
          </span>
        </div>
        <div className="mt-2 space-y-1">
          {lines.map((t, i) => (
            <div key={i} className="flex gap-1.5">
              <span>{i < d.treatment_organic.length ? "🌿" : "🧪"}</span>
              <span>{t}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 rounded-md px-2 py-1.5 text-[12.5px]" style={{ background: "#fef3c7", color: "#92400e" }}>
          ⏰ {d.urgency}
        </div>
      </div>
    );
  };

  const canSend = input.trim().length > 0;

  // ================================================================
  return (
    <div className="min-h-screen">
      {/* Site nav (outside the phone) */}
      <nav className="border-b border-forest/10 bg-paper/90 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
          <Link href="/" className="font-display text-xl font-semibold text-forest inline-flex items-center gap-2">
            <Sprout className="w-[18px] h-[18px] text-forest/70" aria-hidden />
            KisanVaani
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/demo" className="text-ink-soft hover:text-forest">
              Live demo
            </Link>
            <Link href="/command" className="text-ink-soft hover:text-forest">
              Command center
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6">
          <h1 className="font-display text-3xl font-semibold text-forest">WhatsApp channel</h1>
          <p className="text-ink-soft mt-1 max-w-2xl">
            Send a crop photo or a <strong>voice note in any Indian language</strong>; the diagnosis returns as a voice
            note. This page simulates the production WhatsApp Business flow. One smartphone can serve several
            households in a village.
          </p>
        </header>

        <div className="grid lg:grid-cols-[minmax(0,420px)_1fr] gap-10 items-start">
          {/* ================= PHONE: WhatsApp chat ================= */}
          <div className="-mx-4 sm:mx-auto sm:w-full sm:max-w-[400px]">
            <div className="flex flex-col h-[92dvh] max-h-[680px] sm:rounded-[1.75rem] overflow-hidden shadow-2xl sm:border-[6px] border-zinc-900 bg-white">
              {/* WhatsApp header */}
              <div className="flex items-center gap-2 px-2 py-2 text-white shrink-0" style={{ background: WA.header }}>
                <ArrowLeft className="w-5 h-5 shrink-0 opacity-90" />
                <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-lg shrink-0">
                  🌾
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-[15px] truncate">KisanVaani</span>
                    <BadgeCheck className="w-4 h-4 shrink-0" style={{ color: "#a7f3d0", fill: "rgba(255,255,255,0.25)" }} />
                  </div>
                  <div className="text-[11.5px] text-white/80 truncate">
                    {typing ? "typing…" : "Business Account · Kisan Suvidha"}
                  </div>
                </div>
                <Video className="w-5 h-5 opacity-90 shrink-0" />
                <Phone className="w-[18px] h-[18px] opacity-90 shrink-0 mx-1" />
                <MoreVertical className="w-5 h-5 opacity-90 shrink-0" />
              </div>

              {/* Chat wallpaper + messages */}
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5"
                style={{
                  background: WA.wallpaper,
                  backgroundImage: "radial-gradient(rgba(60,50,30,0.05) 1.2px, transparent 1.2px)",
                  backgroundSize: "18px 18px",
                }}
              >
                {/* date chip */}
                <div className="flex justify-center pt-1">
                  <span className="text-[11px] px-2.5 py-1 rounded-md bg-white/95 shadow-sm" style={{ color: WA.tsGray }}>
                    TODAY
                  </span>
                </div>
                {/* E2E chip */}
                <div className="flex justify-center pb-1">
                  <span
                    className="text-[11px] px-3 py-1.5 rounded-md shadow-sm text-center max-w-[85%] leading-snug"
                    style={{ background: WA.encryptChip, color: "#54656f" }}
                  >
                    <Lock className="inline w-3 h-3 mr-1 -mt-0.5" />
                    Messages and calls are end-to-end encrypted. Only people in this chat can read, listen to, or share
                    them.
                  </span>
                </div>

                {msgs.map((m) => (
                  <div key={m.id} className={`flex ${m.dir === "out" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`rise relative max-w-[85%] rounded-lg shadow-sm px-2 pb-1.5 pt-1.5 text-[13.5px] leading-snug ${
                        m.dir === "out" ? "rounded-tr-none" : "rounded-tl-none"
                      }`}
                      style={{ background: m.dir === "out" ? WA.bubbleOut : WA.bubbleIn, color: "#111b21" }}
                    >
                      {m.kind === "text" && (
                        <>
                          {m.caption && (
                            <div className="text-[11px] mb-1 pb-1 border-b border-black/5 italic" style={{ color: WA.tsGray }}>
                              {m.caption}
                            </div>
                          )}
                          <span className="whitespace-pre-wrap">{m.text}</span>
                          <Stamp m={m} />
                        </>
                      )}
                      {m.kind === "image" &&
                        (m.imageUrl ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={m.imageUrl} alt="crop photo" className="rounded-md max-h-52 w-auto max-w-full" />
                            <Stamp m={m} />
                          </>
                        ) : (
                          <>
                            <span className="italic" style={{ color: WA.tsGray }}>
                              📷 Photo
                            </span>
                            <Stamp m={m} />
                          </>
                        ))}
                      {m.kind === "voice" && (
                        <>
                          <VoiceBubble m={m} />
                          <Stamp m={m} />
                        </>
                      )}
                      {m.kind === "diagnosis" && m.diag && (
                        <>
                          <DiagnosisBubble d={m.diag} />
                          {!m.referred ? (
                            <button
                              onClick={() => void referToExpert(m)}
                              className="mt-2 w-full rounded-md py-1.5 text-center text-[12.5px] font-medium active:bg-black/10"
                              style={{ color: WA.header, background: "rgba(0,0,0,0.045)" }}
                            >
                              Expert ko refer karein
                            </button>
                          ) : (
                            <div className="mt-2 text-center text-[11.5px]" style={{ color: WA.tsGray }}>
                              Expert ko refer kiya gaya
                            </div>
                          )}
                          <Stamp m={m} />
                        </>
                      )}
                    </div>
                  </div>
                ))}

                {typing && (
                  <div className="flex justify-start">
                    <div className="rounded-lg rounded-tl-none shadow-sm px-3.5 py-2.5 bg-white flex items-center gap-1">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="w-2 h-2 rounded-full bg-zinc-400 animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* quick replies — Cloud API caps interactive buttons at 3 */}
                {!typing && (
                  <div className="pt-1.5 pb-1 space-y-1.5 max-w-[85%]">
                    {["Fasal ki photo bhejein", "Awaaz se poochhein", "Call 1800-180-1551"].map((label) => (
                      <button
                        key={label}
                        onClick={() => quickReply(label)}
                        className="w-full rounded-lg bg-white/95 shadow-sm py-2.5 px-3 text-[13.5px] font-medium active:bg-zinc-100 transition"
                        style={{ color: WA.linkBlue }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Input bar */}
              <div className="flex items-end gap-1.5 px-1.5 py-1.5 shrink-0" style={{ background: "#f0f2f5" }}>
                {recording ? (
                  <div className="flex-1 flex items-center gap-2 bg-white rounded-full px-4 py-2.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 blink" />
                    <span className="text-sm font-medium text-red-600">
                      0:{String(recSeconds).padStart(2, "0")}
                    </span>
                    <span className="text-xs flex-1 text-right" style={{ color: WA.tsGray }}>
                      recording… release or tap to send
                    </span>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center gap-1 bg-white rounded-full px-3 py-1.5 min-h-[44px]">
                    <Smile className="w-5 h-5 shrink-0" style={{ color: "#8696a0" }} />
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && sendText(input)}
                      placeholder="Message"
                      className="flex-1 min-w-0 bg-transparent text-[14px] focus:outline-none py-1.5"
                      style={{ color: "#111b21" }}
                    />
                    <button onClick={() => fileRef.current?.click()} aria-label="Attach photo" className="p-1">
                      <Paperclip className="w-5 h-5" style={{ color: "#8696a0" }} />
                    </button>
                    <button onClick={() => fileRef.current?.click()} aria-label="Camera" className="p-1">
                      <Camera className="w-5 h-5" style={{ color: "#8696a0" }} />
                    </button>
                  </div>
                )}
                {/* mic morphs to send arrow */}
                <button
                  onClick={canSend && !recording ? () => sendText(input) : undefined}
                  onPointerDown={!canSend ? onMicDown : undefined}
                  onPointerUp={!canSend ? onMicUp : undefined}
                  className={`w-11 h-11 rounded-full flex items-center justify-center text-white shrink-0 shadow ${
                    recording ? "bg-red-500 pulse-ring" : ""
                  }`}
                  style={{ background: recording ? undefined : WA.header }}
                  aria-label={canSend ? "Send message" : recording ? "Stop recording" : "Record voice note"}
                >
                  {canSend && !recording ? <Send className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPhoto(f);
                e.target.value = "";
              }}
            />
            <p className="text-[11px] text-ink-soft text-center mt-3 px-4">
              The simulator follows the Meta Cloud API contract: quick replies are capped at three buttons, and media
              and voice notes match the production formats. Browser text-to-speech stands in for production voice
              notes.
            </p>
          </div>

          {/* ================= RIGHT: how farmers reach this ================= */}
          <div className="space-y-5">
            <h2 className="font-display text-xl font-semibold text-forest">How farmers reach this chat</h2>

            {/* 1 · SMS invite */}
            <div className="rounded-2xl bg-white border border-forest/15 p-5">
              <div className="text-xs font-semibold text-ink-soft mb-3">1. SMS invite — reaches feature phones</div>
              <div className="rounded-xl bg-zinc-100 border border-zinc-200 p-3 max-w-sm">
                <div className="text-[10px] font-semibold text-zinc-500 mb-1.5 flex items-center justify-between">
                  <span>KVKSHR</span>
                  <span>{smsTime}</span>
                </div>
                <div className="rounded-lg rounded-tl-none bg-white shadow-sm px-3 py-2 text-[13px] leading-snug text-zinc-800">
                  KisanVaani: Namaste! Apni fasal ki photo bhejein aur turant salah paayein:{" "}
                  <span className="text-sky underline">kisan-vaani.vercel.app/whatsapp</span> — KVK Sehore
                </div>
              </div>
              <p className="text-xs text-ink-soft mt-3">
                A DLT-registered SMS carries the WhatsApp link to any handset, including basic feature phones. The
                farmer opens it on their own smartphone or the village sahayak&rsquo;s.
              </p>
            </div>

            {/* 2 · live WhatsApp sandbox link */}
            <div className="rounded-2xl bg-white border border-forest/15 p-5">
              <div className="text-xs font-semibold text-ink-soft mb-3">2. Connect on the live WhatsApp sandbox</div>
              <a
                href="https://wa.me/14155238886?text=join%20crop-advisory"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-white font-semibold shadow hover:opacity-90 transition"
                style={{ background: WA.brandGreen }}
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden>
                  <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.4-.7-2.9-1.2-4.7-4.1-4.9-4.3-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.4l.9 2.1c.1.2.1.4 0 .6l-.4.6-.5.5c-.2.2-.3.4-.1.7.2.3.9 1.4 1.9 2.3 1.3 1.1 2.3 1.5 2.7 1.6.3.2.5.1.7-.1l.9-1c.2-.3.5-.2.8-.1l2 1c.3.1.5.2.6.4 0 .1 0 .7-.1 1.3z" />
                </svg>
                Message the KisanVaani sandbox
                <ExternalLink className="w-4 h-4 opacity-80" />
              </a>
              <p className="text-xs text-ink-soft mt-3">
                Opens WhatsApp to the Twilio sandbox number with the join code prefilled. Send the message once to
                connect your phone, then send a crop photo or voice note to reach the live pipeline. Requires the sandbox
                to be enabled in the project&rsquo;s Twilio console.
              </p>
            </div>

            {/* 3 · production path */}
            <div className="rounded-2xl bg-forest text-paper p-6">
              <div className="text-xs font-semibold text-leaf-mist/80 mb-3">
                3. Production path — why this page is simulated
              </div>
              <p className="text-sm leading-relaxed">
                Production runs on the <b>Meta WhatsApp Business Cloud API</b>: inbound farmer photos and OPUS voice
                notes arrive via webhook and feed the same Gemini pipeline shown here. Meta&rsquo;s free test number can
                message only five OTP-verified phones and its token expires every 24 hours, so this page simulates the
                interface and provides the live wa.me link instead. The SMS invite requires TRAI DLT registration
                (entity, sender header, and template approval), which takes roughly one to two weeks and costs about
                ₹0.15–0.30 per message.
              </p>
            </div>

            {/* try-it hints */}
            <div className="rounded-2xl bg-white border border-forest/15 p-5 text-sm text-ink-soft">
              <b className="text-ink">To try it:</b> use the paperclip to upload a leaf photo, and the diagnosis
              returns as a card and a voice note. Or hold the mic and ask in your own language; the reply is spoken in
              the language detected. The thread persists for the duration of your session.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
