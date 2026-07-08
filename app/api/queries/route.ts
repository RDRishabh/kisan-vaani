import { NextResponse } from "next/server";
import { dbSource, listQueries } from "@/lib/db";

export async function GET() {
  try {
    const queries = await listQueries(30);
    return NextResponse.json({ queries, source: dbSource() });
  } catch (err) {
    console.error("queries list error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ queries: [], source: "memory" });
  }
}
