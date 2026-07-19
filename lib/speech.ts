"use client";

// Browser TTS wrapper. In production this maps to Bhashini / Google Cloud TTS
// delivered over the IVR line — the browser voice here simulates that channel.

let current: SpeechSynthesisUtterance | null = null;

export function speak(text: string, bcp47: string, onEnd?: () => void) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = bcp47;
  u.rate = 0.78;
  const voices = window.speechSynthesis.getVoices();
  const exact = voices.find((v) => v.lang === bcp47);
  const prefix = voices.find((v) => v.lang.startsWith(bcp47.split("-")[0]));
  if (exact) u.voice = exact;
  else if (prefix) u.voice = prefix;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  current = u;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  current = null;
}

export function isSpeaking(): boolean {
  return typeof window !== "undefined" && !!window.speechSynthesis?.speaking;
}

// Browser speech recognition (Chrome supports hi-IN etc.). Graceful null if unsupported.
export function createRecognizer(bcp47: string, onResult: (text: string) => void, onEnd: () => void) {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, any>;
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = bcp47;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalTranscript = "";
  let explicitStop = false;

  rec.onresult = (e: any) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        finalTranscript += e.results[i][0].transcript;
      }
    }
  };

  rec.onend = () => {
    if (!explicitStop) {
      try {
        rec.start();
        return;
      } catch {
        /* recognition ended — fall through to submit */
      }
    }
    const text = finalTranscript.trim();
    if (text) onResult(text);
    onEnd();
  };

  rec.onerror = () => {
    if (!explicitStop) {
      try {
        rec.start();
        return;
      } catch {
        /* ignore */
      }
    }
    onEnd();
  };

  return {
    start: () => {
      explicitStop = false;
      finalTranscript = "";
      rec.start();
    },
    stop: () => {
      explicitStop = true;
      rec.stop();
    },
  } as { start: () => void; stop: () => void };
}
