// Neon Postgres persistence for escalation tickets, broadcasts and the query log.
// The database is shared with another project, so every table is kv_-prefixed.
// When DATABASE_URL is absent, all helpers degrade to per-instance in-memory
// stores (reset on restart/redeploy) so the demo keeps functioning end-to-end.

import { neon } from "@neondatabase/serverless";
import type { EscalationTicket } from "./types";
import type { BroadcastRecord } from "./opsData";

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Connection — lazy singleton; null when DATABASE_URL is not configured.
// ---------------------------------------------------------------------------

type Sql = ReturnType<typeof neon>;
let client: Sql | null | undefined;

export function getDb(): Sql | null {
  if (client === undefined) {
    const url = process.env.DATABASE_URL;
    client = url ? neon(url) : null;
  }
  return client;
}

export function dbSource(): "db" | "memory" {
  return getDb() ? "db" : "memory";
}

// ---------------------------------------------------------------------------
// Schema — created once per process (CREATE TABLE IF NOT EXISTS).
// ---------------------------------------------------------------------------

let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  const sql = getDb();
  if (!sql) return Promise.resolve();
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS kv_tickets (
        id text PRIMARY KEY,
        created_at timestamptz DEFAULT now(),
        farmer text,
        village text,
        district text,
        state text,
        channel text,
        crop text,
        ai_diagnosis text,
        confidence int,
        severity text,
        kendra text,
        officer text,
        status text DEFAULT 'pending',
        sla_hours int DEFAULT 48,
        updated_at timestamptz DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS kv_broadcasts (
        id text PRIMARY KEY,
        created_at timestamptz DEFAULT now(),
        kind text,
        title text,
        district text,
        state text,
        language text,
        channels text,
        recipients int,
        message text,
        status text DEFAULT 'queued'
      )`;
      await sql`CREATE TABLE IF NOT EXISTS kv_queries (
        id bigserial PRIMARY KEY,
        created_at timestamptz DEFAULT now(),
        channel text,
        lang text,
        query text,
        response_source text,
        district text
      )`;
    })().catch((err) => {
      schemaReady = null; // allow the next request to retry
      throw err;
    });
  }
  return schemaReady;
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export type NewTicket = {
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

export type TicketPatch = {
  status?: EscalationTicket["status"];
  officer?: string;
  kendra?: string;
};

type MemTicket = Omit<EscalationTicket, "slaHoursLeft"> & { slaHours: number };

// In-memory fallback: per-instance only; documented limitation without a DB.
const memTickets: MemTicket[] = [];

function slaLeft(createdAt: string, slaHours: number, status: string): number {
  if (status === "closed") return 0;
  const elapsedH = (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
  return Math.round((slaHours - elapsedH) * 10) / 10;
}

// Routing mirrors the state escalation fabric: RSKs in AP, AEO clusters in TS,
// district KVKs elsewhere.
function kendraFor(district: string, state: string): string {
  if (state === "Andhra Pradesh") return `RSK ${district}`;
  if (state === "Telangana") return `AEO Cluster ${district}`;
  return `KVK ${district}`;
}

function rowToTicket(r: Row): EscalationTicket {
  const createdAt = new Date(String(r.created_at)).toISOString();
  const status = String(r.status ?? "pending") as EscalationTicket["status"];
  return {
    id: String(r.id),
    createdAt,
    farmer: String(r.farmer ?? "Unregistered farmer"),
    village: String(r.village ?? ""),
    district: String(r.district ?? ""),
    state: String(r.state ?? ""),
    channel: (r.channel ?? "photo") as EscalationTicket["channel"],
    crop: String(r.crop ?? ""),
    aiDiagnosis: String(r.ai_diagnosis ?? ""),
    confidence: Number(r.confidence ?? 0),
    severity: (r.severity ?? "medium") as EscalationTicket["severity"],
    kendra: String(r.kendra ?? ""),
    officer: r.officer == null ? null : String(r.officer),
    status,
    slaHoursLeft: slaLeft(createdAt, Number(r.sla_hours ?? 48), status),
  };
}

function memToTicket(m: MemTicket): EscalationTicket {
  const { slaHours, ...t } = m;
  return { ...t, slaHoursLeft: slaLeft(m.createdAt, slaHours, m.status) };
}

// 4-digit ids above the seeded RSK-24xx range; collisions resolved by retry.
function newTicketId(): string {
  return `RSK-${3000 + Math.floor(Math.random() * 7000)}`;
}

export async function createTicket(input: NewTicket): Promise<EscalationTicket> {
  const farmer = input.farmer?.trim() || "Unregistered farmer";
  const village = input.village?.trim() || "Sehore";
  const district = input.district?.trim() || "Sehore";
  const state = input.state?.trim() || "Madhya Pradesh";
  const kendra = kendraFor(district, state);
  const confidence = Math.max(0, Math.min(100, Math.round(input.confidence)));
  const sql = getDb();

  if (sql) {
    await ensureSchema();
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = newTicketId();
      const rows = (await sql`
        INSERT INTO kv_tickets
          (id, farmer, village, district, state, channel, crop, ai_diagnosis, confidence, severity, kendra)
        VALUES
          (${id}, ${farmer}, ${village}, ${district}, ${state}, ${input.channel}, ${input.crop},
           ${input.aiDiagnosis}, ${confidence}, ${input.severity}, ${kendra})
        ON CONFLICT (id) DO NOTHING
        RETURNING *`) as Row[];
      if (rows.length > 0) return rowToTicket(rows[0]);
    }
    throw new Error("kv_tickets: id collision after 5 attempts");
  }

  let id = newTicketId();
  while (memTickets.some((t) => t.id === id)) id = newTicketId();
  const rec: MemTicket = {
    id,
    createdAt: new Date().toISOString(),
    farmer,
    village,
    district,
    state,
    channel: input.channel,
    crop: input.crop,
    aiDiagnosis: input.aiDiagnosis,
    confidence,
    severity: input.severity,
    kendra,
    officer: null,
    status: "pending",
    slaHours: 48,
  };
  memTickets.unshift(rec);
  return memToTicket(rec);
}

export async function listTickets(limit = 100): Promise<EscalationTicket[]> {
  const sql = getDb();
  if (sql) {
    await ensureSchema();
    const rows = (await sql`
      SELECT * FROM kv_tickets ORDER BY created_at DESC LIMIT ${limit}`) as Row[];
    return rows.map(rowToTicket);
  }
  return memTickets.slice(0, limit).map(memToTicket);
}

export async function updateTicket(id: string, patch: TicketPatch): Promise<EscalationTicket | null> {
  const sql = getDb();
  if (sql) {
    await ensureSchema();
    const rows = (await sql`
      UPDATE kv_tickets SET
        status = COALESCE(${patch.status ?? null}, status),
        officer = COALESCE(${patch.officer ?? null}, officer),
        kendra = COALESCE(${patch.kendra ?? null}, kendra),
        updated_at = now()
      WHERE id = ${id}
      RETURNING *`) as Row[];
    return rows.length > 0 ? rowToTicket(rows[0]) : null;
  }
  const rec = memTickets.find((t) => t.id === id);
  if (!rec) return null;
  if (patch.status) rec.status = patch.status;
  if (patch.officer !== undefined) rec.officer = patch.officer;
  if (patch.kendra) rec.kendra = patch.kendra;
  return memToTicket(rec);
}

// ---------------------------------------------------------------------------
// Broadcasts
// ---------------------------------------------------------------------------

export type NewBroadcast = {
  kind: BroadcastRecord["kind"];
  title: string;
  district: string;
  state: string;
  language: string;
  channels: string[];
  recipients: number;
  message: string;
};

type MemBroadcast = Omit<BroadcastRecord, "sent" | "delivered" | "heard">;

const memBroadcasts: MemBroadcast[] = [];

// Delivery figures are derived, not stored: the demo has no real gateway, so a
// completed send reports the same simulated ratios the ops console uses.
function broadcastStats(status: string, recipients: number, channels: string[]) {
  if (status !== "completed") return { sent: 0, delivered: 0, heard: 0 };
  return {
    sent: recipients,
    delivered: Math.round(recipients * 0.95),
    heard: channels.includes("Voice call") ? Math.round(recipients * 0.72) : 0,
  };
}

function rowToBroadcast(r: Row): BroadcastRecord {
  const channels = String(r.channels ?? "").split(", ").filter(Boolean);
  const status: BroadcastRecord["status"] = r.status === "completed" ? "completed" : "queued";
  const recipients = Number(r.recipients ?? 0);
  return {
    id: String(r.id),
    createdAt: new Date(String(r.created_at)).toISOString(),
    kind: (r.kind ?? "weather") as BroadcastRecord["kind"],
    title: String(r.title ?? ""),
    district: String(r.district ?? ""),
    state: String(r.state ?? ""),
    language: String(r.language ?? ""),
    channels,
    recipients,
    message: String(r.message ?? ""),
    status,
    ...broadcastStats(status, recipients, channels),
  };
}

export async function createBroadcast(input: NewBroadcast): Promise<BroadcastRecord> {
  const channelsText = input.channels.join(", ");
  const recipients = Math.max(0, Math.round(input.recipients));
  const sql = getDb();

  if (sql) {
    await ensureSchema();
    const countRows = (await sql`SELECT count(*)::int AS n FROM kv_broadcasts`) as Row[];
    let seq = 1100 + Number(countRows[0]?.n ?? 0);
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = `BRD-${seq}`;
      const rows = (await sql`
        INSERT INTO kv_broadcasts
          (id, kind, title, district, state, language, channels, recipients, message)
        VALUES
          (${id}, ${input.kind}, ${input.title}, ${input.district}, ${input.state},
           ${input.language}, ${channelsText}, ${recipients}, ${input.message})
        ON CONFLICT (id) DO NOTHING
        RETURNING *`) as Row[];
      if (rows.length > 0) return rowToBroadcast(rows[0]);
      seq += 1 + Math.floor(Math.random() * 20);
    }
    throw new Error("kv_broadcasts: id collision after 5 attempts");
  }

  let seq = 1100 + memBroadcasts.length;
  while (memBroadcasts.some((b) => b.id === `BRD-${seq}`)) seq++;
  const rec: MemBroadcast = {
    id: `BRD-${seq}`,
    createdAt: new Date().toISOString(),
    kind: input.kind,
    title: input.title,
    district: input.district,
    state: input.state,
    language: input.language,
    channels: input.channels,
    recipients,
    message: input.message,
    status: "queued",
  };
  memBroadcasts.unshift(rec);
  return { ...rec, ...broadcastStats(rec.status, recipients, rec.channels) };
}

export async function listBroadcasts(limit = 100): Promise<BroadcastRecord[]> {
  const sql = getDb();
  if (sql) {
    await ensureSchema();
    // Queued sends older than 60s are marked completed on read — deterministic
    // gateway simulation without background jobs.
    await sql`
      UPDATE kv_broadcasts SET status = 'completed'
      WHERE status = 'queued' AND created_at < now() - interval '60 seconds'`;
    const rows = (await sql`
      SELECT * FROM kv_broadcasts ORDER BY created_at DESC LIMIT ${limit}`) as Row[];
    return rows.map(rowToBroadcast);
  }
  const now = Date.now();
  return memBroadcasts.slice(0, limit).map((b) => {
    const status: BroadcastRecord["status"] =
      b.status === "queued" && now - new Date(b.createdAt).getTime() > 60_000 ? "completed" : b.status;
    return { ...b, status, ...broadcastStats(status, b.recipients, b.channels) };
  });
}

// ---------------------------------------------------------------------------
// Query log — fire-and-forget. Never awaited in a request path, never throws;
// total failure cannot affect the response being sent.
// ---------------------------------------------------------------------------

export type QueryLogEntry = {
  channel: "sms" | "call" | "photo" | "voice";
  lang?: string;
  query: string;
  responseSource: string;
  district?: string;
};

export function logQuery(entry: QueryLogEntry): void {
  try {
    const sql = getDb();
    if (!sql) return;
    void ensureSchema()
      .then(
        () => sql`
          INSERT INTO kv_queries (channel, lang, query, response_source, district)
          VALUES (${entry.channel}, ${entry.lang ?? null}, ${entry.query.slice(0, 2000)},
                  ${entry.responseSource}, ${entry.district ?? null})`
      )
      .catch((err: unknown) => {
        console.error("kv_queries log error:", err instanceof Error ? err.message : err);
      });
  } catch (err) {
    console.error("kv_queries log error:", err instanceof Error ? err.message : err);
  }
}
