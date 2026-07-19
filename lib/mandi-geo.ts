// Resolve farmer district/state speech → data.gov.in filters[District] + filters[State].
// Pan-India: no fixed pilot districts. Prefer known index; otherwise pass farmer text
// through as District and omit State (API accepts district-only filters).

import { DISTRICTS } from "@/lib/districts";

export type GeoMatch = { district: string; state: string };

export type GeoResolveResult = {
  district: string;
  /** null = omit filters[State]; let data.gov.in match by district alone. */
  state: string | null;
  /** When the same district name exists in multiple states. */
  ambiguous?: GeoMatch[];
};

/** Official state spellings used by Agmarknet / data.gov.in. */
export const INDIA_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;

/** Hindi / colloquial aliases → official state name (dynamic matching, not location lock). */
const STATE_ALIASES: Record<string, string> = {
  "उत्तर प्रदेश": "Uttar Pradesh",
  up: "Uttar Pradesh",
  "u p": "Uttar Pradesh",
  "मध्य प्रदेश": "Madhya Pradesh",
  mp: "Madhya Pradesh",
  "m p": "Madhya Pradesh",
  महाराष्ट्र: "Maharashtra",
  mh: "Maharashtra",
  राजस्थान: "Rajasthan",
  rj: "Rajasthan",
  बिहार: "Bihar",
  br: "Bihar",
  गुजरात: "Gujarat",
  gj: "Gujarat",
  पंजाब: "Punjab",
  pb: "Punjab",
  हरियाणा: "Haryana",
  hr: "Haryana",
  कर्नाटक: "Karnataka",
  ka: "Karnataka",
  "तमिल नाडु": "Tamil Nadu",
  "tamilnadu": "Tamil Nadu",
  tn: "Tamil Nadu",
  तेलंगाना: "Telangana",
  tg: "Telangana",
  "आंध्र प्रदेश": "Andhra Pradesh",
  ap: "Andhra Pradesh",
  "पश्चिम बंगाल": "West Bengal",
  wb: "West Bengal",
  ओडिशा: "Odisha",
  orissa: "Odisha",
  odisha: "Odisha",
  छत्तीसगढ़: "Chhattisgarh",
  cg: "Chhattisgarh",
  झारखंड: "Jharkhand",
  jh: "Jharkhand",
  असम: "Assam",
  as: "Assam",
  केरल: "Kerala",
  kl: "Kerala",
  दिल्ली: "Delhi",
  "new delhi": "Delhi",
  उत्तराखंड: "Uttarakhand",
  uk: "Uttarakhand",
  "हिमाचल प्रदेश": "Himachal Pradesh",
  hp: "Himachal Pradesh",
};

function normalizeKey(input: string): string {
  return input
    .trim()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function titleCasePlace(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (/^[\u0900-\u097F]+$/u.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/** Spoken / typed variants → official Agmarknet district (not a menu — lookup only). */
const DISTRICT_NAME_VARIANTS: Record<string, { district: string; state: string }> = {
  "कानपुर देहात": { district: "Kanpur Dehat", state: "Uttar Pradesh" },
  "कानपुर नगर": { district: "Kanpur Nagar", state: "Uttar Pradesh" },
  "लखनऊ": { district: "Lucknow", state: "Uttar Pradesh" },
  "वाराणसी": { district: "Varanasi", state: "Uttar Pradesh" },
  "बनारस": { district: "Varanasi", state: "Uttar Pradesh" },
  "सीहोर": { district: "Sehore", state: "Madhya Pradesh" },
  "विदिशा": { district: "Vidisha", state: "Madhya Pradesh" },
  "शाजापुर": { district: "Shajapur", state: "Madhya Pradesh" },
  "नाशिक": { district: "Nashik", state: "Maharashtra" },
  "लुधियाना": { district: "Ludhiana", state: "Punjab" },
  "पटना": { district: "Patna", state: "Bihar" },
  "रायपुर": { district: "Raipur", state: "Chhattisgarh" },
};

function buildDistrictIndex(): Map<string, GeoMatch[]> {
  const index = new Map<string, GeoMatch[]>();

  const add = (key: string, match: GeoMatch) => {
    const k = normalizeKey(key);
    if (!k) return;
    const list = index.get(k) ?? [];
    if (!list.some((m) => m.district === match.district && m.state === match.state)) {
      list.push(match);
      index.set(k, list);
    }
  };

  for (const d of DISTRICTS) {
    const match = { district: d.district, state: d.state };
    add(d.district, match);
    add(d.district.replace(/[^a-zA-Z0-9\u0900-\u097F]+/g, ""), match);
    for (const block of d.blocks) add(block, match);
  }

  for (const [alias, match] of Object.entries(DISTRICT_NAME_VARIANTS)) {
    add(alias, match);
  }

  return index;
}

const DISTRICT_INDEX = buildDistrictIndex();

/** Resolve spoken/typed state → official data.gov.in State filter. */
export function resolveMandiState(input: string): string | null {
  const key = normalizeKey(input);
  if (!key) return null;

  if (STATE_ALIASES[key]) return STATE_ALIASES[key];

  for (const state of INDIA_STATES) {
    if (normalizeKey(state) === key) return state;
  }

  for (const state of INDIA_STATES) {
    const nk = normalizeKey(state);
    if (nk.startsWith(key) || key.startsWith(nk)) return state;
  }

  return titleCasePlace(input);
}

/**
 * Resolve farmer district text for API filters.
 * - Known unique match → district + state
 * - Multiple states share the name → ambiguous list (caller asks state)
 * - Unknown → title-cased farmer text, state null (district-only API filter)
 */
export function resolveMandiGeo(input: string): GeoResolveResult {
  const key = normalizeKey(input);
  if (!key) {
    return { district: "", state: null };
  }

  const hits = DISTRICT_INDEX.get(key);
  if (hits && hits.length === 1) {
    return { district: hits[0].district, state: hits[0].state };
  }
  if (hits && hits.length > 1) {
    const states = new Set(hits.map((h) => h.state));
    if (states.size === 1) {
      return { district: hits[0].district, state: hits[0].state };
    }
    return {
      district: hits[0].district,
      state: null,
      ambiguous: hits,
    };
  }

  // Partial contains match (e.g. "kanpur dehat district")
  const partial: GeoMatch[] = [];
  for (const [alias, matches] of DISTRICT_INDEX) {
    if (alias.includes(key) || key.includes(alias)) {
      for (const m of matches) {
        if (!partial.some((p) => p.district === m.district && p.state === m.state)) {
          partial.push(m);
        }
      }
    }
  }
  if (partial.length === 1) {
    return { district: partial[0].district, state: partial[0].state };
  }
  if (partial.length > 1) {
    const states = new Set(partial.map((h) => h.state));
    if (states.size === 1) {
      return { district: partial[0].district, state: partial[0].state };
    }
    return {
      district: partial[0].district,
      state: null,
      ambiguous: partial,
    };
  }

  return { district: titleCasePlace(input), state: null };
}

export function pickStateForDistrict(
  districtInput: string,
  stateInput: string,
  ambiguous?: GeoMatch[],
): GeoResolveResult {
  const state = resolveMandiState(stateInput);
  if (!state) {
    return { district: titleCasePlace(districtInput), state: null };
  }

  if (ambiguous?.length) {
    const hit = ambiguous.find((m) => normalizeKey(m.state) === normalizeKey(state));
    if (hit) return { district: hit.district, state: hit.state };
  }

  const geo = resolveMandiGeo(districtInput);
  return {
    district: geo.district || titleCasePlace(districtInput),
    state,
  };
}
