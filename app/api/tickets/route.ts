import { NextRequest, NextResponse } from "next/server";
import type { EscalationTicket } from "@/lib/types";
import { createTicket, dbSource, listTickets, updateTicket, type NewTicket, type TicketPatch } from "@/lib/db";

const CHANNELS: EscalationTicket["channel"][] = ["call", "sms", "photo", "whatsapp"];
const SEVERITIES: EscalationTicket["severity"][] = ["low", "medium", "high"];
const STATUSES: EscalationTicket["status"][] = ["pending", "assigned", "expert_replied", "closed"];

export async function GET() {
  try {
    const tickets = await listTickets(100);
    return NextResponse.json({ tickets, source: dbSource() });
  } catch (err) {
    console.error("tickets GET error:", err instanceof Error ? err.message : err);
    // The console falls back to seed data; an empty list keeps the demo alive.
    return NextResponse.json({ tickets: [], source: "memory" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<NewTicket>;
    const channel = CHANNELS.includes(body.channel as EscalationTicket["channel"])
      ? (body.channel as EscalationTicket["channel"])
      : "photo";
    const severity = SEVERITIES.includes(body.severity as EscalationTicket["severity"])
      ? (body.severity as EscalationTicket["severity"])
      : "medium";
    const confidence = Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : 0;

    const ticket = await createTicket({
      farmer: typeof body.farmer === "string" ? body.farmer : undefined,
      village: typeof body.village === "string" ? body.village : undefined,
      district: typeof body.district === "string" ? body.district : undefined,
      state: typeof body.state === "string" ? body.state : undefined,
      channel,
      crop: typeof body.crop === "string" && body.crop.trim() ? body.crop.trim() : "Unknown crop",
      aiDiagnosis:
        typeof body.aiDiagnosis === "string" && body.aiDiagnosis.trim()
          ? body.aiDiagnosis.trim()
          : "Diagnosis unavailable",
      confidence,
      severity,
    });
    return NextResponse.json({ ticket, source: dbSource() }, { status: 201 });
  } catch (err) {
    console.error("tickets POST error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "could not create ticket" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string; status?: string; officer?: string; kendra?: string };
    if (!body.id || typeof body.id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const patch: TicketPatch = {};
    if (body.status && STATUSES.includes(body.status as EscalationTicket["status"])) {
      patch.status = body.status as EscalationTicket["status"];
    }
    if (typeof body.officer === "string" && body.officer.trim()) patch.officer = body.officer.trim();
    if (typeof body.kendra === "string" && body.kendra.trim()) patch.kendra = body.kendra.trim();

    const ticket = await updateTicket(body.id, patch);
    if (!ticket) return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    return NextResponse.json({ ticket, source: dbSource() });
  } catch (err) {
    console.error("tickets PATCH error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "could not update ticket" }, { status: 500 });
  }
}
