"use client";

import { useEffect, useState } from "react";
import { LIVE_FEED } from "@/lib/opsData";
import { ChannelBadge, EmptyState, SectionCard, TableShell, Td, Th } from "./ui";

const RES_STYLE: Record<string, string> = {
  ai: "bg-emerald-50 text-emerald-700 border-emerald-200",
  escalated: "bg-amber-50 text-amber-700 border-amber-200",
  pending: "bg-slate-50 text-slate-500 border-slate-200",
};
const RES_LABEL: Record<string, string> = { ai: "AI-resolved", escalated: "Escalated", pending: "Pending" };

type FeedRow = {
  name: string;
  village: string;
  district: string;
  state: string;
  channel: string;
  lang: string;
  crop: string;
  issue: string;
  resolution: string;
  time: string;
  live?: boolean;
};

type LiveQuery = {
  id: number;
  createdAt: string;
  channel: string;
  lang?: string;
  query: string;
  responseSource: string;
};

const LANG_LABEL: Record<string, string> = {
  hi: "Hindi", en: "English", mr: "Marathi", te: "Telugu", ta: "Tamil", kn: "Kannada",
  ml: "Malayalam", bn: "Bengali", gu: "Gujarati", pa: "Punjabi", or: "Odia", as: "Assamese",
};

function relTime(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs} hr ago` : `${Math.round(hrs / 24)} d ago`;
}

export default function QueryFeedTable({ district }: { district: string }) {
  const [liveRows, setLiveRows] = useState<FeedRow[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/queries", { signal: AbortSignal.timeout(10000) });
        const data = (await res.json()) as { queries: LiveQuery[] };
        setLiveRows(
          (data.queries ?? []).map((q) => ({
            name: q.responseSource === "telephony-live" ? "Live caller" : "Platform user",
            village: q.responseSource === "telephony-live" ? "via +1 254 272 6372" : "via web demo",
            district: "Sehore",
            state: "Madhya Pradesh",
            channel: q.channel,
            lang: LANG_LABEL[q.lang ?? "hi"] ?? q.lang ?? "Hindi",
            crop: "—",
            issue: q.query.length > 60 ? q.query.slice(0, 60) + "…" : q.query,
            resolution: "ai",
            time: relTime(q.createdAt),
            live: true,
          })),
        );
      } catch {
        /* feed stays on seed data */
      }
    })();
  }, []);

  const rows: FeedRow[] = [
    ...liveRows,
    ...LIVE_FEED,
  ].filter((r) => district === "All districts" || r.district === district);

  return (
    <SectionCard
      title="Live query feed"
      sub={liveRows.length > 0 ? `Most recent farmer queries across channels · ${liveRows.length} live from the database` : "Most recent farmer queries across channels"}
      pad={false}
    >
      {rows.length === 0 ? (
        <EmptyState title={`No queries from ${district} in the last hour`} hint="Switch to All districts to see the national feed." />
      ) : (
        <TableShell maxH="max-h-80">
          <thead>
            <tr>
              <Th>Farmer</Th>
              <Th>Location</Th>
              <Th>Channel</Th>
              <Th>Language</Th>
              <Th>Crop</Th>
              <Th>Issue</Th>
              <Th>Resolution</Th>
              <Th right>Received</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.name}-${i}`} className="hover:bg-slate-50">
                <Td className="font-medium text-slate-900">
                  {r.name}
                  {r.live && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      Live
                    </span>
                  )}
                </Td>
                <Td>
                  {r.village}, {r.district}
                  <span className="ml-1 text-slate-400">· {r.state}</span>
                </Td>
                <Td><ChannelBadge channel={r.channel} /></Td>
                <Td>{r.lang}</Td>
                <Td>{r.crop}</Td>
                <Td className="max-w-56 truncate">{r.issue}</Td>
                <Td>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${RES_STYLE[r.resolution]}`}>
                    {RES_LABEL[r.resolution]}
                  </span>
                </Td>
                <Td right className="text-slate-400">{r.time}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </SectionCard>
  );
}
