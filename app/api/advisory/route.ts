import { NextRequest, NextResponse } from "next/server";
import {
  composeSmsAdvisoryReply,
  followupPrompt,
  isOtherOptionChoice,
  IVR_ASK_FREEFORM,
  IVR_REPEAT_HINT,
  resolveOptionChoice,
  runAdvisoryTurn,
  SMS_ASK_FREEFORM,
  withIvrRepeatHint,
  type AdvisoryMessage,
  type AdvisoryPhase,
} from "@/lib/advisory-flow";
import { logQuery } from "@/lib/db";
import {
  extractPlaceFromWeatherQuery,
  isMandiIntent,
  isWeatherIntent,
  SMS_ASK_WEATHER_DISTRICT,
  IVR_ASK_WEATHER_DISTRICT,
} from "@/lib/helpline-intent";
import { handleMandiInput, mandiEntryMenu, type MandiMenuHandlerResult } from "@/lib/mandi-handler";
import {
  appBaseUrl,
  fetchMandiPriceText,
  startMandiContext,
  type MandiContext,
} from "@/lib/mandi-flow";
import {
  fetchOpenWeatherSmart,
  formatWeatherAdvisoryEn,
  formatWeatherAdvisoryHi,
  openWeatherApiKey,
} from "@/lib/openweather";

type Body = {
  query?: string;
  lang?: string;
  channel?: "ivr" | "sms";
  history?: AdvisoryMessage[];
  phase?: AdvisoryPhase | null;
  options?: string[];
  skipFollowup?: boolean;
  mandi?: MandiContext | null;
};

async function mandiPriceResponse(
  req: NextRequest,
  commodity: string,
  district: string,
  state: string,
  channel: "ivr" | "sms",
): Promise<{ text: string; source: string; phase: "followup"; options: string[] }> {
  const { text: priceText, source } = await fetchMandiPriceText(
    commodity,
    state,
    appBaseUrl(req),
    30_000,
    district,
  );
  const follow = followupPrompt(channel);
  const text =
    channel === "ivr"
      ? `${priceText}\n\n${IVR_REPEAT_HINT}\n\n${follow.text}`
      : `${priceText}\n\n${follow.text}`;
  return { text, source, phase: "followup", options: follow.options ?? [] };
}

function mandiMenuResponse(
  result: MandiMenuHandlerResult,
  channel: "ivr" | "sms",
) {
  const text = channel === "ivr" ? withIvrRepeatHint(result.text) : result.text;
  return NextResponse.json({
    text,
    source: "data.gov.in",
    phase: "mandi" as const,
    options: result.options,
    mandi: result.mandi,
    mandiStep: result.step,
  });
}

async function weatherResponse(
  place: string,
  channel: "ivr" | "sms",
  lang: string,
): Promise<NextResponse> {
  const follow = followupPrompt(channel);
  if (!openWeatherApiKey()) {
    const text =
      channel === "ivr"
        ? withIvrRepeatHint("मौसम सेवा अभी उपलब्ध नहीं है।")
        : "मौसम सेवा अभी उपलब्ध नहीं है। कृपया थोड़ी देर बाद फिर कोशिश करें।";
    return NextResponse.json({
      text: channel === "sms" ? `${text}\n\n${follow.text}` : `${text}\n\n${IVR_REPEAT_HINT}\n\n${follow.text}`,
      source: "cached",
      phase: "followup",
      options: follow.options ?? [],
    });
  }

  try {
    const weather = await fetchOpenWeatherSmart(place);
    const advice =
      lang === "en" ? formatWeatherAdvisoryEn(weather) : formatWeatherAdvisoryHi(weather);
    const text =
      channel === "ivr"
        ? `${advice}\n\n${IVR_REPEAT_HINT}\n\n${follow.text}`
        : `${advice}\n\n${follow.text}`;
    logQuery({
      channel: channel === "sms" ? "sms" : "call",
      lang,
      query: `weather ${place}`,
      responseSource: "openweathermap",
    });
    return NextResponse.json({
      text,
      source: "openweathermap",
      phase: "followup",
      options: follow.options ?? [],
    });
  } catch (err) {
    console.error("advisory weather error:", err instanceof Error ? err.message : err);
    const fail = "मौसम अभी उपलब्ध नहीं है। कृपया थोड़ी देर बाद फिर कोशिश करें।";
    return NextResponse.json({
      text: channel === "sms" ? `${fail}\n\n${follow.text}` : withIvrRepeatHint(fail),
      source: "cached",
      phase: "followup",
      options: follow.options ?? [],
    });
  }
}

export async function POST(req: NextRequest) {
  let parsed: Body;
  try {
    parsed = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const {
    query = "",
    lang = "hi",
    channel = "ivr",
    history = [],
    phase = null,
    options: priorOptions,
    skipFollowup = false,
    mandi: mandiCtx = null,
  } = parsed;

  if (!query.trim()) {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }

  let farmerText = query.trim();

  if (phase === "followup" && priorOptions?.length) {
    const choice = resolveOptionChoice(farmerText, priorOptions);
    if (choice && /done|bas|dhanyavaad|thank/i.test(choice)) {
      return NextResponse.json({
        text: "किसानवाणी से संपर्क करने के लिए धन्यवाद। कभी भी 1800-180-1551 पर कॉल करें।",
        source: "gemini",
        phase: "done",
        options: [],
      });
    }
    if (choice && /mandi|bhav|price/i.test(choice)) {
      const entry = mandiEntryMenu(channel);
      const text = channel === "ivr" ? withIvrRepeatHint(entry.text) : entry.text;
      return NextResponse.json({
        text,
        source: "data.gov.in",
        phase: "mandi",
        options: entry.options,
        mandi: entry.mandi,
        mandiStep: entry.step,
      });
    }
  }

  if (phase === "weather") {
    return weatherResponse(farmerText, channel, lang);
  }

  if (phase === "mandi") {
    const mandi = mandiCtx ?? startMandiContext();
    const hasMenuOptions = (priorOptions?.length ?? 0) > 0;
    const result = handleMandiInput(farmerText, mandi, channel, hasMenuOptions);

    if (result.kind === "price") {
      const price = await mandiPriceResponse(
        req,
        result.commodity,
        result.district,
        result.state,
        channel,
      );
      logQuery({
        channel: channel === "sms" ? "sms" : "call",
        lang,
        query: `mandi ${result.commodity} ${result.district}`,
        responseSource: price.source,
      });
      return NextResponse.json({ ...price, mandi: undefined, mandiStep: undefined });
    }

    return mandiMenuResponse(result as MandiMenuHandlerResult, channel);
  }

  // Free-text weather / mandi — before Gemini (SMS helpline + demo).
  if (isWeatherIntent(farmerText)) {
    const place = extractPlaceFromWeatherQuery(farmerText);
    if (place) return weatherResponse(place, channel, lang);
    const ask =
      channel === "sms" ? SMS_ASK_WEATHER_DISTRICT : withIvrRepeatHint(IVR_ASK_WEATHER_DISTRICT);
    return NextResponse.json({
      text: ask,
      source: "openweathermap",
      phase: "weather",
      options: [],
    });
  }

  if (isMandiIntent(farmerText)) {
    const entry = mandiEntryMenu(channel);
    const text = channel === "ivr" ? withIvrRepeatHint(entry.text) : entry.text;
    return NextResponse.json({
      text,
      source: "data.gov.in",
      phase: "mandi",
      options: entry.options,
      mandi: entry.mandi,
      mandiStep: entry.step,
    });
  }

  if (phase === "clarify" && isOtherOptionChoice(farmerText)) {
    const ask = channel === "sms" ? SMS_ASK_FREEFORM : withIvrRepeatHint(IVR_ASK_FREEFORM);
    return NextResponse.json({
      text: ask,
      source: "gemini",
      phase: "listening",
      options: [],
    });
  }

  const mapped = resolveOptionChoice(farmerText, priorOptions);
  if (mapped) farmerText = mapped;

  const nextHistory: AdvisoryMessage[] = [...history, { role: "farmer", text: farmerText }];

  const turn = await runAdvisoryTurn({
    query: farmerText,
    history,
    lang,
    channel,
  });

  if (turn.phase === "clarify") {
    logQuery({
      channel: channel === "sms" ? "sms" : "call",
      lang,
      query: farmerText,
      responseSource: turn.source,
    });
    return NextResponse.json({
      text: turn.text,
      source: turn.source,
      phase: "clarify",
      options: turn.options ?? [],
    });
  }

  const advisorMessages: AdvisoryMessage[] = [{ role: "advisor", text: turn.text, kind: "advise" }];
  let responseText = turn.text;
  let responsePhase: AdvisoryPhase | "done" = "advise";
  let responseOptions: string[] | undefined;

  if (!skipFollowup) {
    const follow = followupPrompt(channel);
    responseText =
      channel === "ivr"
        ? `${turn.text}\n\n${IVR_REPEAT_HINT}\n\n${follow.text}`
        : composeSmsAdvisoryReply(turn.text);
    responsePhase = "followup";
    responseOptions = follow.options;
    advisorMessages.push({ role: "advisor", text: follow.text, kind: "followup" });
  }

  logQuery({
    channel: channel === "sms" ? "sms" : "call",
    lang,
    query: farmerText,
    responseSource: turn.source,
  });

  return NextResponse.json({
    text: responseText,
    source: turn.source,
    phase: responsePhase,
    options: responseOptions,
    history: [...nextHistory, ...advisorMessages],
  });
}
