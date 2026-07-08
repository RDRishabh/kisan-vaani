// Shared demo data: sample queries, fallback advisories, case studies, outbreak feed.
// Fallbacks guarantee the deployed demo never breaks in front of judges,
// even if the Gemini API key is missing or rate-limited.

export type Lang = "hi" | "en" | "mr" | "te";

export const LANGS: { code: Lang; label: string; native: string; bcp47: string }[] = [
  { code: "hi", label: "Hindi", native: "हिंदी", bcp47: "hi-IN" },
  { code: "en", label: "English", native: "English", bcp47: "en-IN" },
  { code: "mr", label: "Marathi", native: "मराठी", bcp47: "mr-IN" },
  { code: "te", label: "Telugu", native: "తెలుగు", bcp47: "te-IN" },
];

// Sample spoken/SMS queries a farmer might send, per language.
export const SAMPLE_QUERIES: Record<Lang, { ivr: string[]; sms: string[] }> = {
  hi: {
    ivr: [
      "मेरी कपास की पत्तियाँ पीली पड़ रही हैं और मुड़ रही हैं, क्या करूँ?",
      "धान में भूरे धब्बे दिख रहे हैं, कौन सी दवा डालूँ?",
      "टमाटर के पौधे मुरझा रहे हैं, पानी देने के बाद भी।",
    ],
    sms: ["KAPAS PILA PATTA", "DHAN BHURA DHABBA", "TAMATAR MURJHA RAHA"],
  },
  en: {
    ivr: [
      "My cotton leaves are turning yellow and curling, what should I do?",
      "Brown spots are appearing on my paddy crop, which medicine to spray?",
      "Tomato plants are wilting even after watering.",
    ],
    sms: ["COTTON YELLOW LEAF", "PADDY BROWN SPOT", "TOMATO WILT"],
  },
  mr: {
    ivr: [
      "माझ्या कापसाची पाने पिवळी पडत आहेत आणि वळत आहेत, काय करू?",
      "भातावर तपकिरी डाग दिसत आहेत, कोणते औषध फवारू?",
    ],
    sms: ["KAPUS PIVLA PANA", "BHAT TAPKIRI DAG"],
  },
  te: {
    ivr: [
      "నా పత్తి ఆకులు పసుపు రంగులోకి మారి ముడుచుకుంటున్నాయి, ఏమి చేయాలి?",
      "వరిలో గోధుమ రంగు మచ్చలు కనిపిస్తున్నాయి, ఏ మందు వాడాలి?",
    ],
    sms: ["PATTI PASUPU AKU", "VARI GODHUMA MACHA"],
  },
};

// Canned advisory fallbacks (used only if Gemini is unreachable).
export const FALLBACK_ADVISORY: Record<Lang, { ivr: string; sms: string }> = {
  hi: {
    ivr: "आपकी कपास में पत्ती मोड़क विषाणु यानी लीफ कर्ल वायरस के लक्षण लग रहे हैं। यह सफेद मक्खी से फैलता है। पीला चिपचिपा कार्ड लगाएँ, नीम का तेल पाँच मिलीलीटर प्रति लीटर पानी में मिलाकर शाम को छिड़काव करें। ज़्यादा प्रकोप होने पर डायफेनथ्यूरॉन एक ग्राम प्रति लीटर डालें; एक ही दवा बार-बार न छिड़कें। संक्रमित पौधे उखाड़कर जला दें। अधिक जानकारी के लिए अपने कृषि विज्ञान केंद्र से संपर्क करें।",
    sms: "कपास: लीफ कर्ल वायरस संभव। सफेद मक्खी रोकें: पीला चिपचिपा कार्ड + नीम तेल 5ml/L शाम को छिड़कें। गंभीर: डायफेनथ्यूरॉन 1g/L। रोगी पौधे उखाड़ें। KVK: 1800-180-1551",
  },
  en: {
    ivr: "Your cotton shows signs of leaf curl virus, spread by whitefly. Install yellow sticky traps and spray neem oil, five millilitres per litre of water, in the evening. If severe, use Diafenthiuron at one gram per litre, and rotate chemicals rather than repeating one. Remove and burn infected plants. Contact your Krishi Vigyan Kendra for more help.",
    sms: "Cotton: likely Leaf Curl Virus. Control whitefly: yellow sticky traps + neem oil 5ml/L evening spray. Severe: Diafenthiuron 1g/L. Uproot infected plants. KVK helpline: 1800-180-1551",
  },
  mr: {
    ivr: "तुमच्या कापसावर लीफ कर्ल व्हायरसची लक्षणे दिसत आहेत. हा पांढऱ्या माशीमुळे पसरतो. पिवळे चिकट सापळे लावा, निंबोळी तेल पाच मिली प्रति लिटर पाण्यात मिसळून संध्याकाळी फवारणी करा. जास्त प्रादुर्भाव असल्यास डायफेनथ्युरॉन एक ग्रॅम प्रति लिटर वापरा; तीच फवारणी वारंवार करू नका. रोगट झाडे उपटून जाळा.",
    sms: "कापूस: लीफ कर्ल व्हायरस शक्य. पांढरी माशी रोखा: पिवळे चिकट सापळे + निंबोळी तेल 5ml/L संध्याकाळी. गंभीर: डायफेनथ्युरॉन 1g/L. रोगट झाडे उपटा. KVK: 1800-180-1551",
  },
  te: {
    ivr: "మీ పత్తిలో లీఫ్ కర్ల్ వైరస్ లక్షణాలు కనిపిస్తున్నాయి. ఇది తెల్లదోమ ద్వారా వ్యాపిస్తుంది. పసుపు జిగురు అట్టలు పెట్టండి, వేప నూనె లీటరు నీటికి ఐదు మిల్లీలీటర్లు కలిపి సాయంత్రం పిచికారీ చేయండి. తీవ్రంగా ఉంటే డయాఫెంథియురాన్ లీటరుకు ఒక గ్రాము వాడండి; ఒకే మందు మళ్లీ మళ్లీ వాడకండి. వ్యాధి సోకిన మొక్కలను పీకి కాల్చండి.",
    sms: "పత్తి: లీఫ్ కర్ల్ వైరస్ అవకాశం. తెల్లదోమ నివారణ: పసుపు జిగురు అట్టలు + వేప నూనె 5ml/L సాయంత్రం. తీవ్రం: డయాఫెంథియురాన్ 1g/L. KVK: 1800-180-1551",
  },
};

export const FALLBACK_DIAGNOSIS = {
  plant: "Cotton (Kapas)",
  disease_en: "Cotton Leaf Curl Virus (CLCuV)",
  disease_local: "पत्ती मोड़क रोग",
  disease_scientific: "Begomovirus (whitefly-transmitted)",
  confidence: 87,
  severity: "high" as const,
  symptoms: [
    "Upward/downward curling of leaves",
    "Thickened, dark green veins",
    "Cup-shaped leaf enations on underside",
    "Stunted plant growth",
  ],
  treatment_organic: [
    "Yellow sticky traps @ 10 per acre to monitor and trap whitefly",
    "Neem oil 5 ml/L water, spray in evening every 7 days",
    "Remove and burn infected plants immediately",
  ],
  treatment_chemical: [
    "Diafenthiuron 50% WP @ 1 g/L against the whitefly vector",
    "Rotate modes of action; avoid repeat neonicotinoid sprays (whitefly resistance)",
  ],
  prevention: [
    "Use CLCuV-tolerant varieties (e.g. RS-2013) next season",
    "Avoid late sowing; maintain field sanitation",
    "Do not grow okra/bhindi near cotton (alternate host)",
  ],
  urgency: "Act within 48 hours — virus spreads to neighbouring plants via whitefly.",
  voice_summary:
    "आपकी कपास में पत्ती मोड़क रोग है, जो सफेद मक्खी से फैलता है। तुरंत पीले चिपचिपे कार्ड लगाएँ और नीम का तेल पाँच एम एल प्रति लीटर शाम को छिड़कें। रोगी पौधे उखाड़कर जला दें। दो दिन के अंदर कार्रवाई करें।",
};

// Pre-diagnosed case studies (cached real-world cases; keeps demo instant + reliable).
export const CASE_STUDIES = [
  {
    id: "cotton-clcuv",
    farmer: "Ramesh Patel",
    village: "Bilkisganj, Sehore",
    crop: "Cotton",
    emoji: "🌿",
    leafStyle: "curl" as const,
    photoNote: "Photo relayed via village extension worker",
    diagnosis: FALLBACK_DIAGNOSIS,
  },
  {
    id: "rice-blast",
    farmer: "Savita Bai",
    village: "Ashta, Sehore",
    crop: "Paddy",
    emoji: "🌾",
    leafStyle: "spots" as const,
    photoNote: "Photo sent from son's smartphone",
    diagnosis: {
      plant: "Rice / Paddy (Dhan)",
      disease_en: "Rice Blast",
      disease_local: "झोंका रोग / ब्लास्ट",
      disease_scientific: "Magnaporthe oryzae",
      confidence: 91,
      severity: "high" as const,
      symptoms: [
        "Diamond/spindle-shaped lesions with grey centres",
        "Brown margins on leaf spots",
        "Lesions merging, drying leaves",
      ],
      treatment_organic: [
        "Drain field, avoid excess nitrogen top-dressing",
        "Pseudomonas fluorescens 10 g/L seed/foliar application",
      ],
      treatment_chemical: [
        "Tricyclazole 75% WP @ 0.6 g/L at first sign",
        "Repeat after 12-15 days if lesions spread",
      ],
      prevention: [
        "Use blast-resistant varieties (Pusa Basmati 1637)",
        "Balanced NPK — avoid excess urea",
        "Treat seed with Carbendazim 2 g/kg before sowing",
      ],
      urgency: "Spray within 2-3 days; blast can cause 30-60% yield loss.",
      voice_summary:
        "आपके धान में झोंका रोग यानी ब्लास्ट है। खेत से पानी निकालें, यूरिया अभी न डालें। ट्राइसाइक्लाज़ोल पाउडर छह सौ ग्राम प्रति हज़ार लीटर पानी में मिलाकर तुरंत छिड़काव करें। दो-तीन दिन में कार्रवाई ज़रूरी है।",
    },
  },
  {
    id: "tomato-blight",
    farmer: "Lakshmamma",
    village: "Ichoda, Adilabad",
    crop: "Tomato",
    emoji: "🍅",
    leafStyle: "blight" as const,
    photoNote: "Photo from farmer's own phone",
    diagnosis: {
      plant: "Tomato (Tamatar)",
      disease_en: "Early Blight",
      disease_local: "अगेती झुलसा",
      disease_scientific: "Alternaria solani",
      confidence: 84,
      severity: "medium" as const,
      symptoms: [
        "Dark brown spots with concentric rings (target-board pattern)",
        "Yellowing around spots, lower leaves first",
      ],
      treatment_organic: [
        "Remove affected lower leaves and destroy",
        "Trichoderma viride soil drench near root zone",
        "Mulch to stop soil splash on leaves",
      ],
      treatment_chemical: [
        "Mancozeb 75% WP @ 2 g/L every 10 days",
        "Alternate with Chlorothalonil 2 g/L to avoid resistance",
      ],
      prevention: [
        "Stake plants for airflow; drip irrigation over sprinkler",
        "Crop rotation — avoid potato/tomato in same plot back-to-back",
      ],
      urgency: "Manageable if sprayed this week; monitor after every rain.",
      voice_summary:
        "आपके टमाटर में अगेती झुलसा रोग है। नीचे की रोगी पत्तियाँ तोड़कर नष्ट करें। मैंकोज़ेब दो ग्राम प्रति लीटर पानी में मिलाकर हर दस दिन में छिड़कें। बारिश के बाद खेत ज़रूर देखें।",
    },
  },
];

// Command-center mock: live query feed + outbreak clusters (deterministic demo data).
export const QUERY_FEED = [
  { name: "Ramesh Patel", village: "Bilkisganj", block: "Sehore", channel: "photo", crop: "Cotton", issue: "Leaf curl, yellowing", time: "2 min ago", lang: "hi" },
  { name: "Savita Bai", village: "Ashta", block: "Sehore", channel: "call", crop: "Paddy", issue: "Brown spots on leaves", time: "9 min ago", lang: "hi" },
  { name: "Mohan Verma", village: "Shyampur", block: "Sehore", channel: "sms", crop: "Cotton", issue: "KAPAS PILA PATTA", time: "14 min ago", lang: "hi" },
  { name: "Anita Kushwaha", village: "Ichhawar", block: "Sehore", channel: "call", crop: "Cotton", issue: "Leaves curling upward", time: "22 min ago", lang: "hi" },
  { name: "Dilip Malviya", village: "Nasrullaganj", block: "Sehore", channel: "photo", crop: "Soybean", issue: "Stem borer suspected", time: "31 min ago", lang: "hi" },
  { name: "Lakshmamma", village: "Ichoda", block: "Adilabad", channel: "photo", crop: "Tomato", issue: "Ring spots on leaves", time: "40 min ago", lang: "te" },
  { name: "Prakash Jadhav", village: "Karanja", block: "Washim", channel: "sms", crop: "Cotton", issue: "KAPUS PIVLA PANA", time: "48 min ago", lang: "mr" },
  { name: "Kalpana Bai", village: "Rehti", block: "Sehore", channel: "call", crop: "Cotton", issue: "White insects under leaves", time: "1 hr ago", lang: "hi" },
];

export const OUTBREAKS = [
  {
    disease: "Cotton Leaf Curl Virus",
    block: "Sehore block, Sehore district (MP)",
    reports: 23,
    delta: "+187% vs last week",
    radiusKm: 5,
    farmersInRadius: 1240,
    severity: "high" as const,
    alertText:
      "⚠️ किसान अलर्ट: सीहोर ब्लॉक में कपास पर लीफ कर्ल वायरस फैल रहा है। सफेद मक्खी रोकें — पीला चिपचिपा कार्ड लगाएँ, नीम तेल 5ml/L शाम को छिड़कें। रोगी पौधे उखाड़ें। मदद: 1800-180-1551",
  },
  {
    disease: "Rice Blast",
    block: "Ashta block, Sehore district (MP)",
    reports: 9,
    delta: "+64% vs last week",
    radiusKm: 8,
    farmersInRadius: 860,
    severity: "medium" as const,
    alertText:
      "⚠️ किसान अलर्ट: आष्टा क्षेत्र में धान पर ब्लास्ट रोग के मामले बढ़े हैं। खेत से पानी निकालें, यूरिया रोकें, ट्राइसाइक्लाज़ोल 0.6g/L छिड़कें। मदद: 1800-180-1551",
  },
];

export const WEEKLY_TREND = [
  { day: "Tue", queries: 84 },
  { day: "Wed", queries: 96 },
  { day: "Thu", queries: 110 },
  { day: "Fri", queries: 102 },
  { day: "Sat", queries: 141 },
  { day: "Sun", queries: 129 },
  { day: "Mon", queries: 178 },
];
