// Client-side fetch helpers for the persistence rails (/api/tickets, /api/broadcasts).
// Every helper fails soft (null / empty list) so UI callers keep their existing
// local behaviour when the API or database is unavailable.

import type { EscalationTicket } from "./types";
import type { BroadcastRecord } from "./opsData";

export type LiveTicket = EscalationTicket & { live?: boolean };
export type LiveBroadcast = BroadcastRecord & { live?: boolean };

export type NewTicketInput = {
  farmer?: string;
  village?: string;
  district?: string;
  state?: string;
  channel: EscalationTicket["channel"];
  crop: string;
  aiDiagnosis: string;
  confidence: number;
  severity: EscalationTicket["severity"];
};

export type NewBroadcastInput = {
  kind: BroadcastRecord["kind"];
  title: string;
  district: string;
  state: string;
  language: string;
  channels: string[];
  recipients: number;
  message: string;
};

const JSON_HEADERS = { "Content-Type": "application/json" };

export async function fetchLiveTickets(): Promise<LiveTicket[]> {
  try {
    const res = await fetch("/api/tickets", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { tickets?: EscalationTicket[] };
    return (data.tickets ?? []).map((t) => ({ ...t, live: true }));
  } catch {
    return [];
  }
}

export async function createLiveTicket(input: NewTicketInput): Promise<EscalationTicket | null> {
  try {
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ticket?: EscalationTicket };
    return data.ticket ?? null;
  } catch {
    return null;
  }
}

// Fire-and-forget: optimistic UI state is already updated by the caller.
export function patchLiveTicket(
  id: string,
  patch: { status?: EscalationTicket["status"]; officer?: string; kendra?: string }
): void {
  void fetch("/api/tickets", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ id, ...patch }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {
    // local state remains authoritative for this session
  });
}

export async function fetchLiveBroadcasts(): Promise<LiveBroadcast[]> {
  try {
    const res = await fetch("/api/broadcasts", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { broadcasts?: BroadcastRecord[] };
    return (data.broadcasts ?? []).map((b) => ({ ...b, live: true }));
  } catch {
    return [];
  }
}

export async function createLiveBroadcast(input: NewBroadcastInput): Promise<BroadcastRecord | null> {
  try {
    const res = await fetch("/api/broadcasts", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { broadcast?: BroadcastRecord };
    return data.broadcast ?? null;
  } catch {
    return null;
  }
}
