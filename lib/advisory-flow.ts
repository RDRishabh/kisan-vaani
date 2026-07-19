// Multi-turn crop advisory flow for IVR and SMS.
// Clarifies with numbered options (max 2 rounds), then advises, then offers follow-up.

import { GoogleGenAI } from "@google/genai";
import { FALLBACK_ADVISORY, type Lang } from "@/lib/data";
import { generateContentResilient } from "@/lib/genai";
import type { MandiContext } from "@/lib/mandi-flow";

export const MAX_CLARIFY_TURNS = 2;

export type AdvisoryChannel = "ivr" | "sms";
export type AdvisoryPhase = "clarify" | "advise" | "followup" | "mandi" | "weather";

export type AdvisoryMessage = {
  role: "farmer" | "advisor";
  text: string;
  kind?: AdvisoryPhase;
};

export type AdvisoryTurnResult = {
  phase: AdvisoryPhase;
  text: string;
  options?: string[];
  source: "gemini" | "fallback";
};

type GeminiTurn = {
  phase: "clarify" | "advise";
  question?: string;
  options?: string[];
  advice?: string;
};

const DIGIT_WORDS = ["एक", "दो", "तीन"];

/** Fixed follow-up menu — option description first, digit at end of each clause. */
export const IVR_FOLLOWUP_MENU =
  "यदि आपके पास किसी और फसल की समस्या है, या कृषि से जुड़ा कुछ और जानना चाहते हैं, तो एक दबाएँ। मंडी भाव जानने के लिए दो दबाएँ। यदि अभी के लिए बस इतना ही, तो तीन दबाएँ। धन्यवाद।";

/** SMS follow-up menu — always sent in full (second segment if needed). */
export const SMS_FOLLOWUP_MENU =
  "यदि और फसल की समस्या है, तो 1। मंडी भाव के लिए 2 या मंडी लिखें। मौसम के लिए मौसम और जगह लिखें। अभी के लिए बस, तो 3।";

/** Shown when the farmer asks something outside farming scope — no off-topic answer. */
export const OFF_TOPIC_REFUSAL_HI =
  "यह हेल्पलाइन केवल खेती और फसलों से जुड़ी समस्याओं के लिए है। कृपया अपनी फसल, मिट्टी या खाद से संबंधित प्रश्न पूछें।";

const FARMING_SCOPE =
  /(?:फसल|crop|खेती|kheti|मिट्टी|soil|खाद|fertil|urea|dap|npk|कीट|pest|रोग|disease|mandi|मंडी|bhav|price|बुवाई|sowing|सिंचाई|irrigation|sinchai|पशु|livestock|dairy|मधुमक्खी|bee|नीम|neem|kapas|कपास|paddy|धान|soybean|gehu|गेहू|tamatar|टमाटर|bhindi|भिंडी|moong|मूंग|dhan|wheat|cotton|insect|fung|virus|spray|dava|दवा|bij|बीज|season|mausam|weather|rain|barish|बारिश|yojana|योजना|pm[\s-]?kisan|kvk|कृषि)/iu;

const OFF_TOPIC_PATTERNS = [
  /\bnewton\b|न्यूटन|गुरुत्व|gravity|physics|भौतिक\s*विज्ञान/iu,
  /(?:गणित|mathematics|maths|algebra|geometry|trigonometry)/iu,
  /(?:cricket|ipl|bollywood|movie|film|serial|netflix)/iu,
  /(?:politics|election|chunav|vote|राजनीति|चुनाव)/iu,
  /(?:homework|assignment|exam\s*question|परीक्षा\s*का\s*प्रश्न)/iu,
  /(?:recipe|खाना\s*बनान|restaurant|cooking\s*tip)/iu,
  /(?:joke|चुटकुला|shayari|poem\s*about\s*love)/iu,
];

/** True when the query is clearly not about farming and has no crop context. */
export function isOffTopicQuery(query: string): boolean {
  const q = query.trim();
  if (!q || q.length < 4) return false;
  if (FARMING_SCOPE.test(q)) return false;
  return OFF_TOPIC_PATTERNS.some((p) => p.test(q));
}

/** Max Hindi chars for advice body; follow-up menu is reserved separately. */
export const SMS_ADVICE_MAX = 280;

/** Trim advice for SMS; never truncate the follow-up menu. */
export function trimSmsAdvice(advice: string, maxChars = SMS_ADVICE_MAX): string {
  const trimmed = advice.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars).replace(/\s+\S{0,24}$/u, "").trim();
  return cut.endsWith("।") || cut.endsWith("…") ? cut : `${cut}…`;
}

/** One SMS string for demo/UI — follow-up menu is always appended in full. */
export function composeSmsAdvisoryReply(advice: string): string {
  return `${trimSmsAdvice(advice)}\n\n${SMS_FOLLOWUP_MENU}`;
}

/** Two-part SMS for Twilio — menu is never cut off by a long advice block. */
export function splitSmsAdvisoryParts(advice: string): [string, string] {
  return [trimSmsAdvice(advice, 480), SMS_FOLLOWUP_MENU];
}

export const IVR_REPEAT_HINT = "दोहराने के लिए शून्य दबाएँ।";

/** Keypad 9 / free-text escape when none of the clarify options match. */
export const OTHER_OPTION_DIGIT = "9";
export const IVR_OTHER_OPTION_HINT =
  "यदि इनमें से कोई विकल्प मेल नहीं खाता, तो नौ दबाएँ और अपनी समस्या बोलें।";
export const SMS_OTHER_OPTION_HINT = "विकल्प मेल न खाएँ तो समस्या लिखकर भेजें।";
export const IVR_ASK_FREEFORM =
  "ठीक है। बीप के बाद अपनी समस्या अपने शब्दों में बताएँ।";
export const SMS_ASK_FREEFORM = "ठीक है। अपनी फसल की समस्या लिखकर भेजें।";

/** Append the press-0-to-repeat line once (IVR only — SMS users can re-read). */
export function withIvrRepeatHint(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes(IVR_REPEAT_HINT)) return trimmed;
  return `${trimmed}\n\n${IVR_REPEAT_HINT}`;
}

/** True when farmer chose "none of these" (keypad 9). */
export function isOtherOptionChoice(input: string): boolean {
  return input.trim() === OTHER_OPTION_DIGIT;
}

function fallbackLang(lang: string): Lang {
  return lang === "hi" || lang === "en" || lang === "mr" || lang === "te" ? lang : "hi";
}

export function countClarifyTurns(history: AdvisoryMessage[]): number {
  return history.filter((m) => m.role === "advisor" && m.kind === "clarify").length;
}

/** Map keypad/SMS digits 1–3 (or up to options.length) to labels. Digit 9 is handled separately. */
export function resolveOptionChoice(input: string, options: string[] | undefined): string | null {
  if (!options?.length) return null;
  const trimmed = input.trim();
  if (isOtherOptionChoice(trimmed)) return null;
  if (!/^[1-3]$/.test(trimmed)) return null;
  const digit = Number.parseInt(trimmed, 10) - 1;
  if (digit >= 0 && digit < options.length) return options[digit];
  return null;
}

function historyBlock(history: AdvisoryMessage[]): string {
  if (!history.length) return "(no prior messages)";
  return history.map((m) => `${m.role === "farmer" ? "Farmer" : "KisanVaani"}: ${m.text}`).join("\n");
}

/** Remove keypad/digit phrases so numbers are not spoken twice after server formatting. */
export function stripKeypadInstructions(text: string): string {
  return text
    .replace(
      /(?:इस\s*समय\s*के\s*लिए|iss\s*samay\s*ke\s*liye)?\s*(?:ek|do|teen|one|two|three|एक|दो|तीन|[1-3])\s*(?:daba?yein?|press|नंबर|number|dabaye)[^.?!।…]*[.?!।…]?/gi,
      "",
    )
    .replace(
      /(?:press|daba?yein?|dabaye)\s*(?:ek|do|teen|one|two|three|एक|दो|तीन|[1-3])[^.?!।…]*[.?!।…]?/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip greetings/salutations from model text. The IVR/SMS channel already greets
 * once at session start — mid-call "राम-राम / नमस्ते / किसान भाई" wastes the farmer's time.
 */
export function stripRepeatGreeting(text: string): string {
  let out = text.trim();
  // Leading salutation / address (may appear once or twice at the start)
  for (let i = 0; i < 3; i++) {
    const next = out
      .replace(
        /^(?:राम[\s-]*राम|जय\s*राम\s*जी|नमस्ते|नमस्कार|प्रणाम|आदाब|सत्\s*श्री\s*अकाल|hello|hi|namaste)[.!।,\s—-]*/iu,
        "",
      )
      .replace(
        /^(?:किसान\s*)?(?:भाई|बहन|जी)[.!।,\s—-]*/iu,
        "",
      )
      .replace(
        /^(?:किसानवाणी|KisanVaani)(?:\s*में\s*आप(?:का|के)\s*स्वागत\s*(?:है|आहे)?)?[.!।,\s—-]*/iu,
        "",
      )
      .trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Clarify menu — यदि … है, तो N दबाएँ (digit at end of clause) + 9 for free speech. */
export function formatClarifyOptionsHi(question: string, options: string[]): string {
  const opts = options.slice(0, 3).map((opt) => stripRepeatGreeting(stripKeypadInstructions(opt)));
  const q = stripRepeatGreeting(stripKeypadInstructions(question)).replace(/[.?!।…]+$/u, "");
  const clauses = [
    (opt: string) => `यदि ${opt} है, तो एक दबाएँ`,
    (opt: string) => `यदि ${opt} है, तो दो दबाएँ`,
    (opt: string) => `यदि ${opt} है, तो तीन दबाएँ`,
  ];
  const parts = opts.map((opt, i) => clauses[i]?.(opt) ?? `यदि ${opt} है, तो ${DIGIT_WORDS[i]} दबाएँ`);
  const prefix = q ? `${q}। ` : "";
  return `${prefix}${parts.join("। ")}। ${IVR_OTHER_OPTION_HINT} ${IVR_REPEAT_HINT}`;
}

/** @deprecated Use formatClarifyOptionsHi — kept for internal clarify wrapper. */
export function formatNumberedOptionsHi(preamble: string, options: string[]): string {
  const q = stripKeypadInstructions(preamble).replace(/^थोड़ा और समझने के लिए —\s*/u, "");
  return formatClarifyOptionsHi(q, options);
}

function formatClarifyIvr(question: string, options: string[]): string {
  const q = stripRepeatGreeting(stripKeypadInstructions(question));
  // System already greeted at call start — start clarify with a short purpose line, never a salutation.
  return formatClarifyOptionsHi(q ? `थोड़ा और समझने के लिए — ${q}` : "थोड़ा और समझने के लिए", options);
}

function formatClarifySms(question: string, options: string[]): string {
  const q = stripRepeatGreeting(stripKeypadInstructions(question));
  const smsParts = options.slice(0, 3).map((opt, i) => {
    const label = stripKeypadInstructions(opt);
    return `यदि ${label} है, तो ${i + 1}`;
  });
  // No 0=repeat on SMS — farmer can re-read. Escape: write freely if options don't match.
  return `${q} ${smsParts.join("। ")}। ${SMS_OTHER_OPTION_HINT}`.slice(0, 300);
}

function channelRules(channel: AdvisoryChannel): string {
  if (channel === "sms") {
    return `[CHANNEL: SMS]
- Clarify: one short Hindi question + 2–3 plain option labels (no digits in labels).
- Advise: problem name → 1–2 actions with EXACT dosages → helpline 1800-180-1551. Max ${SMS_ADVICE_MAX} Hindi characters in "advice" (follow-up menu is appended by the server — do not add menu or goodbye).
- Plain Hindi only. No markdown, bullets, or emojis.`;
  }
  return `[CHANNEL: IVR — phone call, text-to-speech]
- Clarify: ONE short spoken question in simple Hindi + 2–3 plain option labels (what the farmer can see/feel). Keep question under ~15 words.
- Advise: 50–80 Hindi words, warm and speakable — short sentences, no lists, no symbols, no English. Say dosages in spoken Hindi (e.g. "पाँच मिलीलीटर प्रति लीटर").
- Do NOT say goodbye or "call again" in advice — the system adds a follow-up menu after you.`;
}

function buildSystemInstruction(
  channel: AdvisoryChannel,
  clarifyCount: number,
  forceAdvise: boolean,
): string {
  const forceLine = forceAdvise
    ? `\n[CLARIFICATION BUDGET — EXHAUSTED]
You already asked ${clarifyCount} clarifying question(s). You MUST set phase to "advise" now and give the best practical advice from what you know. Do not ask again.`
    : clarifyCount >= MAX_CLARIFY_TURNS
      ? `\n[CLARIFICATION BUDGET — EXHAUSTED]
You MUST set phase to "advise" now.`
      : `\n[CLARIFICATION BUDGET]
You may ask at most ${MAX_CLARIFY_TURNS - clarifyCount} more clarifying question(s). Ask ONLY when crop, main symptom, or severity is still unclear. If the farmer already gave enough detail, advise immediately — do not ask unnecessary questions.`;

  return `[CHARACTER]
You are KisanVaani — a senior agricultural extension scientist at a Krishi Vigyan Kendra (KVK), speaking on India's farmer helpline style (like Kisan Call Centre). You advise smallholder farmers (1–5 acre) with empathy, local crop names, and IPM-first treatments. You sound like a trusted village agriculture officer: patient, clear, never condescending, never rushed.

[LANGUAGE]
- Every JSON field (question, options, advice) MUST be Hindi in Devanagari script only.
- No English words, no Roman Hindi (no "ram-ram", "bhai", "dabaye"), no code-mixing.

[GREETING RULE — CRITICAL — INDUSTRY STANDARD FOR HELPLINES]
The phone/SMS system has ALREADY greeted the farmer at the start of this session (नमस्ते / welcome / menu).
You MUST NEVER greet again in question, options, or advice.
FORBIDDEN in every field, including the first turn:
- नमस्ते, नमस्कार, राम-राम, जय राम जी, प्रणाम, आदाब
- किसान भाई, भाई जी, बहन जी (as a greeting / address at the start)
- "स्वागत है", "मैं किसानवाणी हूँ", "आपकी बात सुन रहा हूँ" as openers
Start directly with the clarifying question or the advice. Wasting the farmer's call time with a second greeting is a serious UX failure.

[SCOPE — FARMING ONLY — CRITICAL]
This helpline answers ONLY agriculture and farmer livelihood: crops, pests, diseases, soil, irrigation, fertilizers, seeds, livestock for farming, mandi prices, weather impact on crops, PM-Kisan and KVK-type farmer schemes.
If the latest message is NOT about farming (physics, maths, homework, politics, cricket, Bollywood, jokes, general trivia, recipes unrelated to crops, etc.):
- Set phase to "advise" immediately — do NOT clarify, do NOT answer the off-topic question at all.
- In "advice": 2–3 short Hindi sentences politely declining and redirecting to crop/soil/fertilizer questions only.
- FORBIDDEN: explaining, defining, or partially answering the off-topic topic (e.g. do NOT explain Newton's laws, do NOT give cricket scores).

[MANDI BHAV — MARKET PRICE QUERIES — PAN INDIA]
When the farmer asks for mandi bhav / market price (not handled by keypad-2 live lookup):
- Live prices need API filters: District (required), Commodity/Crop (required), State (only if district name is ambiguous across states).
- Arrival date is automatic — NEVER ask the farmer for a date.
- This service covers ALL of India — never assume Madhya Pradesh or any single state/district list.
- Ask ONE free-text question at a time in Hindi (not a fixed 3-district menu).
- Order: (1) district name anywhere in India (2) state only if needed for disambiguation (3) crop/commodity name.
- NEVER invent or estimate prices. If filters are incomplete, ask what is missing, or tell them to press 2 for live mandi bhav.
- Do NOT offer hardcoded district options like Sehore/Vidisha. Accept any district the farmer names.

[CONVERSATION STANDARDS — FARMER HELPLINE]
1. Listen first: use the full conversation history; do not re-ask what the farmer already said.
2. One question at a time when clarifying — never stack multiple open questions.
3. Prefer objective choices the farmer can confirm by pressing 1 / 2 / 3 (symptoms they can see: yellow leaves, spots, wilting, insects, etc.).
4. Keep the call short: clarify only when needed, then give a complete actionable answer.
5. Advice order: (a) name the likely problem in simple words (b) organic/IPM first (c) chemical only if needed with exact dose (d) one prevention tip if space allows.
6. Never recommend banned pesticides without a clear warning. Prefer neem oil, sticky traps, sanitation, correct irrigation timing.
7. Do not scare the farmer; be calm and practical. Do not dump long lectures — phone patience is short.
8. If still ambiguous after the budget, pick the most common cause for that crop and say so briefly ("यह आमतौर पर … होता है"), then advise.

[CONVERSATION FLOW]
1. Read history + latest farmer message.
2. If off-topic (not farming) → phase "advise" with scope refusal only — no answer to the off-topic question.
3. If crop/symptom/severity is too vague for safe advice → phase "clarify".
4. If enough detail OR clarification budget exhausted → phase "advise".
5. Clarify: only the narrowing question + 2–3 short option labels. NO treatment in clarify.
6. Advise: full treatment for this channel. NO greeting. NO goodbye (system adds follow-up).

[KEYPAD / NUMBER RULES]
- NEVER put digit/keypad text in "question", "options", or "advice" (no "एक दबाएँ", "दो दबाएँ", "press 1").
- Options = plain symptom/crop labels only (e.g. "पत्ते पीले और मुड़े हुए", "पत्तों पर भूरे धब्बे").
- The server formats: "यदि … है, तो एक दबाएँ" — you must not duplicate that.

${forceLine}

${channelRules(channel)}

[OUTPUT FORMAT — strict JSON only, no markdown fence]
{
  "phase": "clarify" | "advise",
  "question": "one short Hindi clarifying question ONLY — no greeting, no keypad text",
  "options": ["label1", "label2"] // 2 or 3 plain Hindi labels when phase is clarify,
  "advice": "full Hindi advice when phase is advise — no greeting, no goodbye, no keypad text"
}

[BAD — never do this]
question: "राम-राम किसान भाई। आपकी फसल में क्या समस्या है?"
question: "नमस्ते! थोड़ा और बताएँ।"
advice: "नमस्ते भाई, आपकी कपास में … कभी भी दोबारा कॉल करें।"
advice: "न्यूटन का तीसरा नियम भौतिक विज्ञान का विषय है… यह हेल्पलाइन केवल खेती के लिए है।" ← NEVER explain off-topic; refuse only.

[GOOD]
question: "कौन सा लक्षण सबसे पास है?"
options: ["पत्ते पीले और मुड़े हुए", "पत्तों पर भूरे धब्बे", "पौधे मुरझा रहे हैं"]
advice: "आपकी कपास में पत्ती मोड़क रोग के लक्षण लग रहे हैं। … शाम को नीम का तेल पाँच मिलीलीटर प्रति लीटर पानी में मिलाकर छिड़काव करें।"
advice (off-topic): "यह हेल्पलाइन केवल खेती और फसलों से जुड़ी समस्याओं के लिए है। कृपया अपनी फसल, मिट्टी या खाद से संबंधित प्रश्न पूछें।"`;
}

function parseGeminiTurn(raw: string): GeminiTurn | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as GeminiTurn;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as GeminiTurn;
    } catch {
      return null;
    }
  }
}

export function followupPrompt(channel: AdvisoryChannel): AdvisoryTurnResult {
  const options = ["और फसल की समस्या या कृषि प्रश्न", "मंडी भाव", "अभी के लिए बस, धन्यवाद"];
  if (channel === "sms") {
    return {
      phase: "followup",
      text: SMS_FOLLOWUP_MENU,
      options,
      source: "gemini",
    };
  }
  return {
    phase: "followup",
    text: IVR_FOLLOWUP_MENU,
    options,
    source: "gemini",
  };
}

function formatTurn(turn: GeminiTurn, channel: AdvisoryChannel): AdvisoryTurnResult | null {
  if (turn.phase === "clarify" && turn.question && turn.options?.length) {
    const options = turn.options
      .slice(0, 3)
      .map((o) => stripRepeatGreeting(stripKeypadInstructions(o)));
    const text =
      channel === "sms"
        ? formatClarifySms(turn.question, options)
        : formatClarifyIvr(turn.question, options);
    return { phase: "clarify", text, options, source: "gemini" };
  }
  if (turn.phase === "advise" && turn.advice?.trim()) {
    const advice = stripRepeatGreeting(stripKeypadInstructions(turn.advice.trim()));
    return { phase: "advise", text: advice, source: "gemini" };
  }
  return null;
}

export async function runAdvisoryTurn(params: {
  query: string;
  history: AdvisoryMessage[];
  lang: string;
  channel: AdvisoryChannel;
  apiKey?: string;
}): Promise<AdvisoryTurnResult> {
  const { query, history, channel } = params;
  const apiKey = params.apiKey ?? process.env.GEMINI_API_KEY;
  const clarifyCount = countClarifyTurns(history);
  const forceAdvise = clarifyCount >= MAX_CLARIFY_TURNS;

  if (isOffTopicQuery(query)) {
    return { phase: "advise", text: OFF_TOPIC_REFUSAL_HI, source: "fallback" };
  }

  if (!apiKey) {
    const fb = FALLBACK_ADVISORY[fallbackLang(params.lang)][channel];
    if (clarifyCount === 0 && !forceAdvise) {
      const options = ["पीली और मुड़ी पत्तियाँ", "पत्तों पर भूरे धब्बे", "पौधे मुरझा रहे हैं"];
      return {
        phase: "clarify",
        text:
          channel === "sms"
            ? formatClarifySms("कौन सा लक्षण सबसे पास है?", options)
            : formatClarifyIvr("कौन सा लक्षण सबसे पास लगता है?", options),
        options,
        source: "fallback",
      };
    }
    return { phase: "advise", text: stripRepeatGreeting(fb), source: "fallback" };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await generateContentResilient(ai, {
      contents: `[Conversation so far]
${historyBlock(history)}

[Farmer's latest message]
"${query}"

The channel already greeted the farmer. Respond with JSON only — no greetings.`,
      config: {
        systemInstruction: buildSystemInstruction(channel, clarifyCount, forceAdvise),
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    });

    const parsed = parseGeminiTurn(result.text?.trim() ?? "");
    const formatted = parsed ? formatTurn(parsed, channel) : null;
    if (formatted) return formatted;

    const raw = result.text?.trim();
    if (raw && (forceAdvise || clarifyCount >= MAX_CLARIFY_TURNS)) {
      const advice = stripRepeatGreeting(stripKeypadInstructions(raw));
      return { phase: "advise", text: advice.slice(0, channel === "sms" ? 300 : 800), source: "gemini" };
    }
    throw new Error("unparseable advisory JSON");
  } catch (err) {
    console.error("advisory flow error:", err instanceof Error ? err.message : err);
    const fb = FALLBACK_ADVISORY[fallbackLang(params.lang)][channel];
    return { phase: "advise", text: stripRepeatGreeting(fb), source: "fallback" };
  }
}

/** Encode conversation state for Twilio URL query params. */
export function encodeAdvisoryCtx(ctx: {
  history: AdvisoryMessage[];
  options?: string[];
  phase?: AdvisoryPhase;
  lastAnswer?: string;
  mandi?: MandiContext;
}): string {
  return Buffer.from(JSON.stringify(ctx), "utf8").toString("base64url");
}

export function decodeAdvisoryCtx(raw: string | null): {
  history: AdvisoryMessage[];
  options?: string[];
  phase?: AdvisoryPhase;
  lastAnswer?: string;
  mandi?: MandiContext;
} {
  if (!raw) return { history: [] };
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      history?: AdvisoryMessage[];
      options?: string[];
      phase?: AdvisoryPhase;
      lastAnswer?: string;
      mandi?: MandiContext;
    };
    return {
      history: Array.isArray(parsed.history) ? parsed.history : [],
      options: parsed.options,
      phase: parsed.phase,
      lastAnswer: parsed.lastAnswer,
      mandi: parsed.mandi,
    };
  } catch {
    return { history: [] };
  }
}

/** Short prompt when the same call continues — no welcome greeting. */
export const IVR_ASK_NEXT_PROBLEM = "अपनी अगली फसल की समस्या बताएँ। बीप के बाद बोलें।";
