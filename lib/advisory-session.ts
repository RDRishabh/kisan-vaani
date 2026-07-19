// In-memory SMS advisory sessions keyed by sender phone number.
// Resets on cold start; sufficient for demo + Twilio trial volumes.

import type { AdvisoryMessage, AdvisoryPhase } from "@/lib/advisory-flow";
import type { MandiContext } from "@/lib/mandi-flow";

export type AdvisorySession = {
  history: AdvisoryMessage[];
  options?: string[];
  phase?: AdvisoryPhase;
  lang: string;
  lastAnswer?: string;
  mandi?: MandiContext;
  updatedAt: number;
};

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, AdvisorySession>();

function purgeStale(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [key, session] of sessions) {
    if (session.updatedAt < cutoff) sessions.delete(key);
  }
}

export function getAdvisorySession(phone: string): AdvisorySession | null {
  purgeStale();
  const session = sessions.get(phone);
  if (!session) return null;
  if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
    sessions.delete(phone);
    return null;
  }
  return session;
}

export function saveAdvisorySession(phone: string, session: Omit<AdvisorySession, "updatedAt">): void {
  sessions.set(phone, { ...session, updatedAt: Date.now() });
}

export function clearAdvisorySession(phone: string): void {
  sessions.delete(phone);
}
