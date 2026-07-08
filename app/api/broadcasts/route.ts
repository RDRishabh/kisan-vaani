import { NextRequest, NextResponse } from "next/server";
import type { BroadcastRecord } from "@/lib/opsData";
import { createBroadcast, dbSource, listBroadcasts, type NewBroadcast } from "@/lib/db";

const KINDS: BroadcastRecord["kind"][] = ["weather", "outbreak", "scheme"];

export async function GET() {
  try {
    const broadcasts = await listBroadcasts(100);
    return NextResponse.json({ broadcasts, source: dbSource() });
  } catch (err) {
    console.error("broadcasts GET error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ broadcasts: [], source: "memory" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<NewBroadcast>;
    if (typeof body.message !== "string" || !body.message.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }
    const broadcast = await createBroadcast({
      kind: KINDS.includes(body.kind as BroadcastRecord["kind"]) ? (body.kind as BroadcastRecord["kind"]) : "weather",
      title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Untitled broadcast",
      district: typeof body.district === "string" && body.district.trim() ? body.district.trim() : "All districts",
      state: typeof body.state === "string" && body.state.trim() ? body.state.trim() : "Pan-India",
      language: typeof body.language === "string" && body.language.trim() ? body.language.trim() : "Hindi",
      channels: Array.isArray(body.channels) ? body.channels.filter((c): c is string => typeof c === "string") : ["SMS"],
      recipients: Number.isFinite(Number(body.recipients)) ? Number(body.recipients) : 0,
      message: body.message.trim(),
    });
    return NextResponse.json({ broadcast, source: dbSource() }, { status: 201 });
  } catch (err) {
    console.error("broadcasts POST error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "could not create broadcast" }, { status: 500 });
  }
}
