// Shared v2 contracts — every module codes against these shapes.

export type AlertType = "dry_spell" | "heavy_rain" | "heatwave";
export type AlertSeverity = "watch" | "warning" | "severe";

export type ZoneAlert = {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  state: string;
  district: string;
  blocks: string[]; // affected blocks/tehsils named exactly, e.g. ["Ashta", "Ichhawar"]
  lat: number;
  lon: number;
  windowStart: string; // ISO date
  windowEnd: string; // ISO date
  metric: string; // human-readable evidence, e.g. "Next 14 days forecast rainfall 4 mm vs 62 mm normal"
  advisory: string; // English ops guidance for the dashboard
  farmerMessage: string; // Hindi broadcast text sent to farmers (voice + SMS)
  farmersInZone: number;
  crops: string[]; // dominant crops in the zone
  source: "open-meteo" | "imd" | "cached";
};

export type AlertsResponse = {
  alerts: ZoneAlert[];
  scannedDistricts: number;
  generatedAt: string;
  source: "open-meteo" | "cached";
};

export type SoilSnapshot = {
  ph: number | null;
  nitrogen: number | null; // cg/kg from SoilGrids, converted for display
  soc: number | null; // soil organic carbon
  clayPct: number | null;
  sandPct: number | null;
  texture: string | null; // derived, e.g. "clay loam"
  source: "soilgrids" | "shc-manual" | "cached";
};

export type WeatherSnapshot = {
  next16dRainMm: number | null;
  avgTmaxC: number | null;
  et0mm: number | null;
  soilMoisture: number | null; // m3/m3 topsoil
  source: "open-meteo" | "cached";
};

export type CropRecommendation = {
  crop: string;
  localName: string; // in requested language
  suitabilityScore: number; // 0-100
  season: string; // Kharif | Rabi | Zaid
  waterNeed: "low" | "medium" | "high";
  durationDays: string; // e.g. "110-130"
  expectedYield: string; // e.g. "8-10 quintal/acre"
  marketOutlook: string; // one line, grounded in mandi trends
  why: string[]; // grounded reasons referencing the actual soil/weather values
  risks: string[];
  inputs: { seed: string; fertilizer: string; irrigation: string };
};

export type RecommendResponse = {
  soil: SoilSnapshot;
  weather: WeatherSnapshot;
  recommendations: CropRecommendation[];
  summaryVoice: string; // 60-word spoken-style summary in requested language
  source: "gemini" | "cached";
};

export type EscalationStatus = "pending" | "assigned" | "expert_replied" | "closed";

export type EscalationTicket = {
  id: string; // e.g. "RSK-2417"
  createdAt: string;
  farmer: string;
  village: string;
  district: string;
  state: string;
  channel: "call" | "sms" | "photo" | "whatsapp";
  crop: string;
  aiDiagnosis: string;
  confidence: number;
  severity: "low" | "medium" | "high";
  kendra: string; // assigned Rythu Seva Kendra / KVK
  officer: string | null;
  status: EscalationStatus;
  slaHoursLeft: number;
};

export type MandiRow = {
  market: string;
  district: string;
  state: string;
  commodity: string;
  variety: string;
  minPrice: number; // Rs/quintal
  maxPrice: number;
  modalPrice: number;
  arrivalDate: string; // DD-MM-YYYY as returned by Agmarknet
};

export type MandiResponse = {
  rows: MandiRow[];
  commodity: string;
  requestedState: string | null;
  generatedAt: string;
  source: "data.gov.in" | "agmarknet" | "cached";
};

export type VoiceResult = {
  detectedLangCode: string; // BCP-47-ish, e.g. "ta-IN"
  detectedLangName: string; // e.g. "Tamil (தமிழ்)"
  transcript: string; // what the farmer said, in native script
  replyText: string; // advisory in the detected language
  replyEnglish: string; // English gloss for the ops log
  source: "gemini" | "cached";
};
