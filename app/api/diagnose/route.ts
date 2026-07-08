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
              text: `Diagnose this crop photo sent by an Indian smallholder farmer. Identify the crop and the most likely disease/pest/deficiency. Give practical treatment suited to rural India (IPM/organic first, then chemical with exact dosages like "2 g/L"). Local-language fields must be in ${LANG_NAME_FOR_PROMPT[lang] || LANG_NAME_FOR_PROMPT.hi}. If the image is not a plant, set is_plant=false and leave other fields as empty strings/arrays with confidence 0.`,
            },
          ],
        },
      ],
      config: {
        systemInstruction:
          "You are an expert plant pathologist at an Indian agricultural university, advising smallholder farmers. Be accurate and practical. If uncertain between diseases, pick the most likely and reflect uncertainty in the confidence score.",
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
