// Pan-India mandi step handler: district (freeform) → state if ambiguous → crop (freeform) → API.

import { pickStateForDistrict, resolveMandiGeo, resolveMandiState } from "@/lib/mandi-geo";
import {
  formatMandiCropPrompt,
  IVR_MANDI_ASK_DISTRICT_RETRY,
  mandiAskForStep,
  normalizeMandiCommodity,
  SMS_MANDI_ASK_DISTRICT_RETRY,
  startMandiContext,
  type MandiContext,
  type MandiStep,
} from "@/lib/mandi-flow";

export type MandiHandlerResult =
  | {
      kind: "freeform";
      step: MandiStep;
      text: string;
      options: [];
      mandi: MandiContext;
    }
  | {
      kind: "invalid";
      step: MandiStep;
      text: string;
      options: [];
      mandi: MandiContext;
    }
  | {
      kind: "price";
      commodity: string;
      district: string;
      state: string;
      mandi: MandiContext;
    };

export type MandiMenuHandlerResult = Exclude<MandiHandlerResult, { kind: "price" }>;

export function mandiEntryMenu(channel: "ivr" | "sms"): MandiMenuHandlerResult {
  const mandi = startMandiContext();
  return {
    kind: "freeform",
    step: "district",
    text: mandiAskForStep("district", channel),
    options: [],
    mandi,
  };
}

function askCrop(
  channel: "ivr" | "sms",
  district: string,
  state?: string,
): MandiMenuHandlerResult {
  return {
    kind: "freeform",
    step: "crop",
    text: formatMandiCropPrompt(channel, district, state),
    options: [],
    mandi: { step: "crop", district, state },
  };
}

function askState(
  channel: "ivr" | "sms",
  district: string,
  candidates: string[],
): MandiMenuHandlerResult {
  return {
    kind: "freeform",
    step: "state",
    text: mandiAskForStep("state", channel),
    options: [],
    mandi: { step: "state", district, stateCandidates: candidates },
  };
}

/** Process farmer speech/text during mandi phase. Always freeform — no fixed district keypad. */
export function handleMandiInput(
  query: string,
  mandi: MandiContext,
  channel: "ivr" | "sms",
  _hasMenuOptions = false,
): MandiHandlerResult {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) {
    const step = mandi.step;
    return {
      kind: "invalid",
      step,
      text:
        step === "district"
          ? channel === "sms"
            ? SMS_MANDI_ASK_DISTRICT_RETRY
            : IVR_MANDI_ASK_DISTRICT_RETRY
          : mandiAskForStep(step, channel),
      options: [],
      mandi,
    };
  }

  if (mandi.step === "district") {
    const geo = resolveMandiGeo(trimmed);
    if (!geo.district) {
      return {
        kind: "invalid",
        step: "district",
        text: channel === "sms" ? SMS_MANDI_ASK_DISTRICT_RETRY : IVR_MANDI_ASK_DISTRICT_RETRY,
        options: [],
        mandi: startMandiContext(),
      };
    }

    if (geo.ambiguous?.length) {
      const candidates = [...new Set(geo.ambiguous.map((m) => m.state))];
      return askState(channel, geo.district, candidates);
    }

    return askCrop(channel, geo.district, geo.state ?? undefined);
  }

  if (mandi.step === "state") {
    const district = mandi.district ?? "";
    const ambiguous = (mandi.stateCandidates ?? []).map((state) => ({
      district,
      state,
    }));
    const geo = pickStateForDistrict(district, trimmed, ambiguous);
    const state = geo.state ?? resolveMandiState(trimmed) ?? undefined;
    if (!district) {
      return {
        kind: "invalid",
        step: "district",
        text: channel === "sms" ? SMS_MANDI_ASK_DISTRICT_RETRY : IVR_MANDI_ASK_DISTRICT_RETRY,
        options: [],
        mandi: startMandiContext(),
      };
    }
    return askCrop(channel, geo.district || district, state);
  }

  // crop
  const district = mandi.district ?? "";
  const commodity = normalizeMandiCommodity(trimmed);
  if (!commodity || commodity.length < 2) {
    return {
      kind: "invalid",
      step: "crop",
      text: mandiAskForStep("crop", channel),
      options: [],
      mandi: { ...mandi, step: "crop" },
    };
  }

  const geo = district ? resolveMandiGeo(district) : { district: "", state: null };
  const resolvedDistrict = geo.district || district;
  const resolvedState = mandi.state || geo.state || "";

  return {
    kind: "price",
    commodity,
    district: resolvedDistrict,
    state: resolvedState,
    mandi: { step: "crop", state: resolvedState || undefined, district: resolvedDistrict },
  };
}
