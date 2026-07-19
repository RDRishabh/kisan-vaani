// POST /api/telephony/voice — Twilio voice webhook (form-encoded TwiML IVR).
// Multi-turn advisory: clarify with numbered options → advise → follow-up menu.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { FALLBACK_ADVISORY } from "@/lib/data";
import { logQuery } from "@/lib/db";
import {
  decodeAdvisoryCtx,
  encodeAdvisoryCtx,
  followupPrompt,
  IVR_ASK_FREEFORM,
  IVR_ASK_NEXT_PROBLEM,
  IVR_FOLLOWUP_MENU,
  IVR_REPEAT_HINT,
  isOtherOptionChoice,
  withIvrRepeatHint,
  resolveOptionChoice,
  runAdvisoryTurn,
  type AdvisoryMessage,
  type AdvisoryPhase,
} from "@/lib/advisory-flow";
import { handleMandiInput, mandiEntryMenu, type MandiMenuHandlerResult } from "@/lib/mandi-handler";
import {
  fetchMandiPriceText,
  mandiAskFreeform,
  startMandiContext,
  type MandiContext,
  type MandiStep,
} from "@/lib/mandi-flow";
import {
  escapeXml,
  forbiddenTwiml,
  formParams,
  selfBaseUrl,
  twiml,
  validateTwilioSignature,
} from "@/lib/twilio";
import {
  fetchOpenWeatherSmart,
  formatWeatherAdvisoryHi,
  openWeatherApiKey,
} from "@/lib/openweather";

const GEMINI_BUDGET_MS = 12_000;
const MANDI_TIMEOUT_MS = 30_000;
const SAY_MAX_CHARS = 800;

/** Twilio Gather — 10s max wait; 2s silence after speech ends. */
const GATHER_TIMEOUT_SEC = 10;
const GATHER_SPEECH_SILENCE_SEC = 2;

const VOICE_ATTRS = `voice="Polly.Aditi" language="hi-IN"`;

const GREETING =
  "नमस्ते! किसानवाणी में आपका स्वागत है। फसल की समस्या बताने के लिए एक दबाएँ या अपनी समस्या बोलें। मंडी भाव के लिए दो दबाएँ। मौसम जानने के लिए तीन दबाएँ।";
const ASK_PROBLEM = "बीप के बाद अपनी फसल की समस्या बताएँ। बोलने के बाद कुछ पल रुकें।";
const ASK_WEATHER_DISTRICT =
  "मौसम सलाह — बीप के बाद अपने जिले का नाम बोलें। भारत का कोई भी जिला चलता है।";
const GOODBYE = "किसानवाणी को कॉल करने के लिए धन्यवाद। नमस्ते।";
const NOT_HEARD = "माफ़ कीजिए, आवाज़ समझ नहीं आई।";

type VoiceCtx = {
  history: AdvisoryMessage[];
  options?: string[];
  phase?: AdvisoryPhase;
  lastAnswer?: string;
  mandi?: MandiContext;
};

function say(text: string): string {
  return `<Say ${VOICE_ATTRS}><prosody rate="slow">${escapeXml(text.slice(0, SAY_MAX_CHARS))}</prosody></Say>`;
}

function gather(
  action: string,
  inner: string,
  opts?: { speechOnly?: boolean; numDigits?: number },
): string {
  const input =
    opts?.speechOnly === true
      ? `input="speech"`
      : `input="dtmf speech" numDigits="${opts?.numDigits ?? 1}"`;
  return `<Gather ${input} language="hi-IN" timeout="${GATHER_TIMEOUT_SEC}" speechTimeout="${GATHER_SPEECH_SILENCE_SEC}" action="${action}" method="POST">${inner}</Gather>`;
}

function ctxParam(ctx: VoiceCtx): string {
  return encodeURIComponent(encodeAdvisoryCtx(ctx));
}

function clarifyListen(step: string, ctx: VoiceCtx, answerText: string): string {
  const encoded = ctxParam({ ...ctx, lastAnswer: answerText });
  const url = `/api/telephony/voice?step=${step}&ctx=${encoded}`;
  return (
    say(answerText) +
    say(IVR_REPEAT_HINT) +
    gather(url, say("कृपया अपना विकल्प चुनें।"), { numDigits: 1 })
  );
}

/** Speak answer, repeat hint, then listen for keypad (0=repeat handled at step entry). */
function answerThenMenu(step: string, ctx: VoiceCtx, answerText: string, menuText: string): string {
  const encoded = ctxParam({ ...ctx, lastAnswer: answerText });
  const url = `/api/telephony/voice?step=${step}&ctx=${encoded}`;
  return say(answerText) + say(IVR_REPEAT_HINT) + gather(url, say(menuText), { numDigits: 1 });
}

function repeatLastAnswer(step: string, ctx: VoiceCtx, menuText: string): NextResponse | null {
  if (!ctx.lastAnswer) return null;
  const encoded = ctxParam(ctx);
  const url = `/api/telephony/voice?step=${step}&ctx=${encoded}`;
  return twiml(
    say(ctx.lastAnswer) + say(IVR_REPEAT_HINT) + gather(url, say(menuText), { numDigits: 1 }) + say(GOODBYE),
  );
}

function mandiSpeechStep(step: MandiStep): string {
  if (step === "district") return "mandi-district-free";
  if (step === "state") return "mandi-state-free";
  return "mandi-free";
}

function mandiStartListen(ctx: VoiceCtx): string {
  const entry = mandiEntryMenu("ivr");
  const nextCtx: VoiceCtx = {
    ...ctx,
    lastAnswer: entry.text,
    phase: "mandi",
    mandi: entry.mandi,
    options: [],
  };
  const url = `/api/telephony/voice?step=${mandiSpeechStep(entry.step)}&ctx=${ctxParam(nextCtx)}`;
  return say(entry.text) + say(IVR_REPEAT_HINT) + gather(url, say("बीप के बाद बोलें।"), { speechOnly: true });
}

function mandiPromptListen(
  ctx: VoiceCtx,
  menuText: string,
  mandi: MandiContext,
  step: MandiStep,
): string {
  const nextCtx: VoiceCtx = {
    ...ctx,
    lastAnswer: menuText,
    phase: "mandi",
    mandi,
    options: [],
  };
  const url = `/api/telephony/voice?step=${mandiSpeechStep(step)}&ctx=${ctxParam(nextCtx)}`;
  return say(menuText) + say(IVR_REPEAT_HINT) + gather(url, say("बीप के बाद बोलें।"), { speechOnly: true });
}

async function mandiPriceThenFollowup(
  req: NextRequest,
  commodity: string,
  district: string,
  state: string,
): Promise<string> {
  const { text: priceText, source } = await fetchMandiPriceText(
    commodity,
    state,
    selfBaseUrl(req),
    MANDI_TIMEOUT_MS,
    district,
  );
  logQuery({
    channel: "call",
    lang: "hi",
    query: `mandi ${commodity} ${district}`,
    responseSource: source,
  });
  const follow = followupPrompt("ivr");
  const followCtx: VoiceCtx = {
    history: [],
    phase: "followup",
    options: follow.options,
    lastAnswer: priceText,
  };
  return answerThenMenu("followup", followCtx, priceText, IVR_FOLLOWUP_MENU);
}

async function advisoryTurn(
  query: string,
  history: AdvisoryMessage[],
): Promise<Awaited<ReturnType<typeof runAdvisoryTurn>>> {
  return Promise.race([
    runAdvisoryTurn({ query, history, lang: "hi", channel: "ivr" }),
    new Promise<Awaited<ReturnType<typeof runAdvisoryTurn>>>((_, reject) =>
      setTimeout(() => reject(new Error("gemini budget exceeded")), GEMINI_BUDGET_MS),
    ),
  ]).catch((err) => {
    console.error("telephony voice advisory error:", err instanceof Error ? err.message : err);
    return { phase: "advise" as const, text: FALLBACK_ADVISORY.hi.ivr, source: "fallback" as const };
  });
}

function clarifyResponse(turn: Awaited<ReturnType<typeof runAdvisoryTurn>>, history: AdvisoryMessage[]): string {
  const nextCtx: VoiceCtx = {
    history,
    options: turn.options,
    phase: "clarify",
    lastAnswer: turn.text,
  };
  return clarifyListen("clarify", nextCtx, turn.text);
}

function adviseResponse(turn: Awaited<ReturnType<typeof runAdvisoryTurn>>): string {
  const follow = followupPrompt("ivr");
  const followCtx: VoiceCtx = {
    history: [],
    phase: "followup",
    options: follow.options,
    lastAnswer: turn.text,
  };
  return answerThenMenu("followup", followCtx, turn.text, IVR_FOLLOWUP_MENU);
}

export async function POST(req: NextRequest) {
  const params = await formParams(req);
  if (!validateTwilioSignature(req, params)) return forbiddenTwiml();

  const step = req.nextUrl.searchParams.get("step");
  const ctxRaw = req.nextUrl.searchParams.get("ctx");
  const ctx = decodeAdvisoryCtx(ctxRaw);
  const digits = params.Digits ?? "";
  const speech = (params.SpeechResult ?? "").trim();
  const farmerInput = speech || digits;

  if (step === "clarify") {
    if (digits === "0") {
      const replay = repeatLastAnswer("clarify", ctx, "कृपया अपना विकल्प चुनें।");
      if (replay) return replay;
    }
    // None of the options match — let the farmer speak freely.
    if (isOtherOptionChoice(digits)) {
      const freeCtx = ctxParam({ history: ctx.history, phase: "clarify", options: [] });
      return twiml(
        gather(`/api/telephony/voice?step=answer&ctx=${freeCtx}`, say(withIvrRepeatHint(IVR_ASK_FREEFORM)), {
          speechOnly: true,
        }) + say(GOODBYE),
      );
    }
    if (!farmerInput) {
      const retryCtx = ctxParam(ctx);
      return twiml(
        gather(`/api/telephony/voice?step=clarify&ctx=${retryCtx}`, say(NOT_HEARD), { numDigits: 1 }) +
          say(GOODBYE),
      );
    }

    let farmerText = farmerInput;
    const mapped = resolveOptionChoice(farmerInput, ctx.options);
    if (mapped) farmerText = mapped;

    const turn = await advisoryTurn(farmerText, ctx.history);
    logQuery({ channel: "call", lang: "hi", query: farmerText, responseSource: turn.source });

    if (turn.phase === "clarify") {
      const history: AdvisoryMessage[] = [
        ...ctx.history,
        { role: "farmer", text: farmerText },
        { role: "advisor", text: turn.text, kind: "clarify" },
      ];
      return twiml(clarifyResponse(turn, history) + say(GOODBYE));
    }

    return twiml(adviseResponse(turn) + say(GOODBYE));
  }

  async function handleMandiSpeech(speechText: string, forcedStep?: MandiStep): Promise<NextResponse> {
    const base = ctx.mandi ?? startMandiContext();
    const mandi = forcedStep ? { ...base, step: forcedStep } : base;
    const result = handleMandiInput(speechText, mandi, "ivr", false);

    if (result.kind === "price") {
      return twiml(
        (await mandiPriceThenFollowup(req, result.commodity, result.district, result.state)) + say(GOODBYE),
      );
    }

    const menu = result as MandiMenuHandlerResult;
    return twiml(mandiPromptListen(ctx, menu.text, menu.mandi, menu.step) + say(GOODBYE));
  }

  if (step === "mandi") {
    if (digits === "0") {
      const replay = repeatLastAnswer("mandi-district-free", ctx, "बीप के बाद बोलें।");
      if (replay) return replay;
    }
    if (!farmerInput) {
      return twiml(mandiStartListen(ctx) + say(GOODBYE));
    }
    return handleMandiSpeech(farmerInput);
  }

  if (step === "mandi-district-free") {
    if (digits === "0") {
      const replay = repeatLastAnswer("mandi-district-free", ctx, "बीप के बाद बोलें।");
      if (replay) return replay;
    }
    if (!speech) {
      return twiml(
        gather(
          `/api/telephony/voice?step=mandi-district-free&ctx=${ctxParam(ctx)}`,
          say(withIvrRepeatHint(`${NOT_HEARD} ${mandiAskFreeform("district", "ivr")}`)),
          { speechOnly: true },
        ) + say(GOODBYE),
      );
    }
    return handleMandiSpeech(speech, "district");
  }

  if (step === "mandi-state-free") {
    if (digits === "0") {
      const replay = repeatLastAnswer("mandi-state-free", ctx, "बीप के बाद बोलें।");
      if (replay) return replay;
    }
    if (!speech) {
      return twiml(
        gather(
          `/api/telephony/voice?step=mandi-state-free&ctx=${ctxParam(ctx)}`,
          say(withIvrRepeatHint(`${NOT_HEARD} ${mandiAskFreeform("state", "ivr")}`)),
          { speechOnly: true },
        ) + say(GOODBYE),
      );
    }
    return handleMandiSpeech(speech, "state");
  }

  if (step === "mandi-free") {
    if (digits === "0") {
      const replay = repeatLastAnswer("mandi-free", ctx, "बीप के बाद बोलें।");
      if (replay) return replay;
    }
    if (!speech) {
      return twiml(
        gather(
          `/api/telephony/voice?step=mandi-free&ctx=${ctxParam(ctx)}`,
          say(withIvrRepeatHint(`${NOT_HEARD} ${mandiAskFreeform("crop", "ivr")}`)),
          { speechOnly: true },
        ) + say(GOODBYE),
      );
    }
    return handleMandiSpeech(speech, "crop");
  }

  if (step === "followup") {
    if (digits === "0") {
      const replay = repeatLastAnswer("followup", ctx, IVR_FOLLOWUP_MENU);
      if (replay) return replay;
    }
    if (digits === "3" || /done|bas|dhanyavaad|thank/i.test(speech)) {
      return twiml(say(GOODBYE));
    }
    if (digits === "2") {
      return twiml(mandiStartListen(ctx) + say(GOODBYE));
    }
    return twiml(
      gather("/api/telephony/voice?step=answer", say(withIvrRepeatHint(IVR_ASK_NEXT_PROBLEM)), {
        speechOnly: true,
      }) + say(GOODBYE),
    );
  }

  if (step === "menu") {
    if (digits === "0") {
      return twiml(
        gather(
          "/api/telephony/voice?step=menu",
          say(withIvrRepeatHint(GREETING)),
        ) + say(GOODBYE),
      );
    }
    if (digits === "2") {
      return twiml(mandiStartListen({ history: [] }) + say(GOODBYE));
    }
    if (digits === "3") {
      return twiml(
        gather(
          "/api/telephony/voice?step=weather-district",
          say(withIvrRepeatHint(ASK_WEATHER_DISTRICT)),
          { speechOnly: true },
        ) + say(GOODBYE),
      );
    }
    if (speech.length > 8) {
      const turn = await advisoryTurn(speech, []);
      logQuery({ channel: "call", lang: "hi", query: speech, responseSource: turn.source });
      if (turn.phase === "clarify") {
        const history: AdvisoryMessage[] = [
          { role: "farmer", text: speech },
          { role: "advisor", text: turn.text, kind: "clarify" },
        ];
        return twiml(clarifyResponse(turn, history) + say(GOODBYE));
      }
      return twiml(adviseResponse(turn) + say(GOODBYE));
    }
    return twiml(
      gather("/api/telephony/voice?step=answer", say(withIvrRepeatHint(ASK_PROBLEM)), { speechOnly: true }) +
        say(GOODBYE),
    );
  }

  if (step === "weather-district") {
    if (digits === "0") {
      return twiml(
        gather(
          "/api/telephony/voice?step=weather-district",
          say(withIvrRepeatHint(ASK_WEATHER_DISTRICT)),
          { speechOnly: true },
        ) + say(GOODBYE),
      );
    }
    if (!speech) {
      return twiml(
        gather(
          "/api/telephony/voice?step=weather-district",
          say(withIvrRepeatHint(`${NOT_HEARD} ${ASK_WEATHER_DISTRICT}`)),
          { speechOnly: true },
        ) + say(GOODBYE),
      );
    }
    if (!openWeatherApiKey()) {
      return twiml(say("मौसम सेवा अभी उपलब्ध नहीं है।") + say(GOODBYE));
    }
    try {
      const weather = await fetchOpenWeatherSmart(speech);
      const text = formatWeatherAdvisoryHi(weather);
      logQuery({
        channel: "call",
        lang: "hi",
        query: `weather ${speech}`,
        responseSource: "openweathermap",
      });
      const follow = followupPrompt("ivr");
      const followCtx: VoiceCtx = {
        history: [],
        phase: "followup",
        options: follow.options,
        lastAnswer: text,
      };
      return twiml(answerThenMenu("followup", followCtx, text, IVR_FOLLOWUP_MENU) + say(GOODBYE));
    } catch (err) {
      console.error("voice weather error:", err instanceof Error ? err.message : err);
      return twiml(
        say("मौसम अभी उपलब्ध नहीं है। कृपया थोड़ी देर बाद फिर कोशिश करें।") + say(GOODBYE),
      );
    }
  }

  if (step === "answer") {
    const priorHistory = ctx.history ?? [];
    const askPrompt = priorHistory.length ? IVR_ASK_FREEFORM : ASK_PROBLEM;
    if (digits === "0") {
      return twiml(
        gather(
          `/api/telephony/voice?step=answer&ctx=${ctxParam(ctx)}`,
          say(withIvrRepeatHint(askPrompt)),
          { speechOnly: true },
        ) + say(GOODBYE),
      );
    }
    if (!farmerInput) {
      return twiml(
        gather(
          `/api/telephony/voice?step=answer&ctx=${ctxParam(ctx)}`,
          say(withIvrRepeatHint(`${NOT_HEARD} ${askPrompt}`)),
          { speechOnly: true },
        ) + say(GOODBYE),
      );
    }
    const turn = await advisoryTurn(farmerInput, priorHistory);
    logQuery({ channel: "call", lang: "hi", query: farmerInput, responseSource: turn.source });

    if (turn.phase === "clarify") {
      const history: AdvisoryMessage[] = [
        ...priorHistory,
        { role: "farmer", text: farmerInput },
        { role: "advisor", text: turn.text, kind: "clarify" },
      ];
      return twiml(clarifyResponse(turn, history) + say(GOODBYE));
    }

    return twiml(adviseResponse(turn) + say(GOODBYE));
  }

  return twiml(
    gather("/api/telephony/voice?step=menu", say(withIvrRepeatHint(GREETING))) + say(GOODBYE),
  );
}
