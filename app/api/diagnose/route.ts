import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { generateContentResilient } from "@/lib/genai";
import { FALLBACK_DIAGNOSIS } from "@/lib/data";
import { LANG_NAME_FOR_PROMPT } from "@/lib/i18n-full";
import { logQuery } from "@/lib/db";

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    is_plant: { type: Type.BOOLEAN, description: "Is the image actually a plant/crop/leaf?" },
    plant: { type: Type.STRING, description: "Crop name with common Indian name in brackets" },
    disease_en: { type: Type.STRING, description: "Disease name in English" },
    disease_local: { type: Type.STRING, description: "Disease name in the requested local language" },
    disease_scientific: { type: Type.STRING, description: "Pathogen scientific name" },
    confidence: { type: Type.INTEGER, description: "Confidence percent 0-100" },
    severity: { type: Type.STRING, enum: ["low", "medium", "high"] },
    symptoms: { type: Type.ARRAY, items: { type: Type.STRING } },
    treatment_organic: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Organic/IPM steps with exact dosages" },
    treatment_chemical: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Chemical options with exact dosages" },
    prevention: { type: Type.ARRAY, items: { type: Type.STRING } },
    urgency: { type: Type.STRING, description: "One line: how fast to act and why" },
    voice_summary: {
      type: Type.STRING,
      description: "50-70 word spoken-style summary in the requested local language, speakable over a phone call, no markdown",
    },
  },
  required: [
    "is_plant", "plant", "disease_en", "disease_local", "disease_scientific", "confidence",
    "severity", "symptoms", "treatment_organic", "treatment_chemical", "prevention", "urgency", "voice_summary",
  ],
};

export async function POST(req: NextRequest) {
  let parsed: { image?: string; mimeType?: string; lang?: string };
  try {
    parsed = (await req.json()) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  // `|| "image/jpeg"` also covers the empty-string mime an extension-less
  // file upload produces (data:;base64,…), which Gemini rejects.
  const image = parsed.image ?? "";
  const mimeType = parsed.mimeType || "image/jpeg";
  const lang = parsed.lang || "hi";

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logQuery({ channel: "photo", lang, query: `photo diagnosis: ${FALLBACK_DIAGNOSIS.disease_en}`, responseSource: "fallback" });
    return NextResponse.json({ ...FALLBACK_DIAGNOSIS, is_plant: true, source: "fallback" });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await generateContentResilient(ai, {
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: image, mimeType } },
            {
              text: `[REQUEST]
Diagnose the attached crop photo sent by an Indian smallholder farmer via WhatsApp or a field extension worker's smartphone. Your tasks:
1. First, determine if the image is actually a plant, crop, leaf, or agricultural subject. If NOT, set is_plant=false and leave all other fields as empty strings/arrays with confidence 0.
2. If it IS a plant: identify the crop species (use both English and common Indian name, e.g., "Cotton (Kapas)").
3. Identify the most likely disease, pest, or nutrient deficiency visible in the image.
4. Provide practical treatment recommendations suited to rural India — IPM/organic solutions FIRST, then chemical options with EXACT dosages (e.g., "Mancozeb 75% WP @ 2 g/L", "Neem oil 5 ml/L").
5. All local-language fields (disease_local, voice_summary) MUST be in ${LANG_NAME_FOR_PROMPT[lang] || LANG_NAME_FOR_PROMPT.hi}.

[EXAMPLES]
Example for cotton with curled yellow leaves:
- plant: "Cotton (Kapas)"
- disease_en: "Cotton Leaf Curl Virus (CLCuV)"
- disease_local: "\u092A\u0924\u094D\u0924\u0940 \u092E\u094B\u0921\u093C\u0915 \u0930\u094B\u0917"
- confidence: 87
- severity: "high"
- treatment_organic: ["Yellow sticky traps @ 10 per acre to trap whitefly", "Neem oil 5 ml/L water, spray in evening every 7 days"]
- treatment_chemical: ["Diafenthiuron 50% WP @ 1 g/L against whitefly vector"]
- voice_summary: A 50-70 word spoken summary in the local language, warm and conversational, with key action items.

[ADJUSTMENTS]
- Confidence score must honestly reflect your certainty. If two diseases look similar, pick the most likely one but lower the confidence (e.g., 55-65%).
- Never recommend banned pesticides (Endosulfan, Monocrotophos, etc.) without explicit warning.
- Image quality may be poor (low resolution, bad lighting, blurry) — work with what you can see and reflect uncertainty in confidence.
- The voice_summary will be read aloud to the farmer over a phone call — make it speakable, warm, and actionable. No markdown, no lists, no symbols.`,
            },
          ],
        },
      ],
      config: {
        systemInstruction: `[CHARACTER]
You are a senior plant pathologist and entomologist at an Indian State Agricultural University (SAU), with 25+ years of experience diagnosing crop diseases across India's diverse agro-climatic zones. You have deep expertise in the diseases and pests of major Indian crops: cotton (CLCuV, pink bollworm, whitefly), paddy (blast, BPH, sheath blight), tomato (early/late blight, leaf curl), soybean (stem fly, girdle beetle), and more. You regularly train KVK scientists and village-level agriculture officers. Your diagnosis philosophy: be accurate, be practical, be honest about uncertainty. You always recommend IPM/organic first, and chemical options second with precise dosages. You understand that Indian smallholder farmers have limited budgets and may not have access to specialized chemicals.

[EVALUATE]
Before finalizing your diagnosis, verify:
- Is the crop identification correct based on leaf shape, color, and morphology visible in the image?
- Does the confidence score honestly reflect what you can see? (Blurry photo = lower confidence, not a forced 90%.)
- Are the symptoms listed actually visible in THIS image, not assumed?
- Are all treatment dosages specific and actionable (never "apply fungicide" without naming the compound and rate)?
- Is the voice_summary truly speakable in the local language — no lists, no markdown, no technical Latin names?
- Would a real SAU plant pathologist agree with this diagnosis and treatment plan?
- Are organic/IPM options listed BEFORE chemical options?

[TYPE OF OUTPUT]
Return a JSON object conforming to the provided schema. All fields are required. The voice_summary must be 50-70 words in the requested local language, suitable for reading aloud over a phone call.`,
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
        temperature: 0.2,
      },
    });
    const parsed = JSON.parse(result.text || "{}");
    if (typeof parsed.is_plant !== "boolean") throw new Error("bad shape");
    logQuery({
      channel: "photo",
      lang,
      query: `photo diagnosis: ${parsed.is_plant === false ? "not a plant" : parsed.disease_en || "unidentified"}`,
      responseSource: "gemini",
    });
    return NextResponse.json({ ...parsed, source: "gemini" });
  } catch (err) {
    console.error("diagnose gemini error:", err instanceof Error ? err.message : err);
    logQuery({ channel: "photo", lang, query: `photo diagnosis: ${FALLBACK_DIAGNOSIS.disease_en}`, responseSource: "fallback" });
    return NextResponse.json({ ...FALLBACK_DIAGNOSIS, is_plant: true, source: "fallback" });
  }
}
