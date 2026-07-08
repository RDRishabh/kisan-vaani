import type { ReactNode } from "react";
import { ArrowUpRight, CloudSun, Bug, Ticket, Radio, Timer } from "lucide-react";
import { OVERVIEW_KPIS, QUERY_VOLUME_14D } from "@/lib/opsData";
import { nf } from "./ui";

function Spark() {
  // tiny sparkline of 14-day totals — pure SVG, decorative
  const totals = QUERY_VOLUME_14D.map((d) => d.voice + d.sms + d.whatsapp);
  const max = Math.max(...totals);
  const min = Math.min(...totals);
  const pts = totals
    .map((v, i) => `${(i / (totals.length - 1)) * 72},${20 - ((v - min) / (max - min || 1)) * 18}`)
    .join(" ");
  return (
    <svg viewBox="0 0 72 22" className="h-5 w-[72px] text-forest" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export default function KpiCards({ liveAlerts }: { liveAlerts?: { total: number; severe: number; warning: number; watch: number } }) {
  const k = OVERVIEW_KPIS;
  const alertCount = liveAlerts?.total ?? k.activeWeatherAlerts;
  const alertSub = liveAlerts
    ? `${liveAlerts.severe} severe · ${liveAlerts.warning} warning · ${liveAlerts.watch} watch`
    : "1 severe · 2 warning · 1 watch";
  const cards: { label: string; value: string; sub: ReactNode; icon?: ReactNode }[] = [
    {
      label: "Queries today",
      value: nf.format(k.queriesToday),
      sub: (
        <span className="inline-flex items-center gap-1 text-emerald-600">
          <ArrowUpRight className="size-3" aria-hidden="true" />
          {k.queriesDeltaPct}% <span className="text-slate-400">vs last Wed</span>
        </span>
      ),
      icon: <Spark />,
    },
    {
      label: "Active weather alerts",
      value: String(alertCount),
      sub: <span className="text-slate-500">{alertSub}</span>,
      icon: <CloudSun className="size-4 text-slate-300" aria-hidden="true" />,
    },
    {
      label: "Open outbreaks",
      value: String(k.openOutbreaks),
      sub: <span className="text-slate-500">2 high · 1 medium</span>,
      icon: <Bug className="size-4 text-slate-300" aria-hidden="true" />,
    },
    {
      label: "RSK escalations open",
      value: String(k.escalationsPending),
      sub:
        k.slaBreaches > 0 ? (
          <span className="font-medium text-red-700">{k.slaBreaches} SLA breached</span>
        ) : (
          <span className="text-slate-500">SLA on track</span>
        ),
      icon: <Ticket className="size-4 text-slate-300" aria-hidden="true" />,
    },
    {
      label: "Advisories delivered",
      value: nf.format(k.advisoriesDelivered),
      sub: <span className="text-slate-500">projected pilot scale · all channels</span>,
      icon: <Radio className="size-4 text-slate-300" aria-hidden="true" />,
    },
    {
      label: "Median AI response",
      value: `${k.medianResponseSec}s`,
      sub: <span className="text-slate-500">voice call, query to advisory</span>,
      icon: <Timer className="size-4 text-slate-300" aria-hidden="true" />,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-slate-200 bg-white p-3.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{c.label}</p>
            {c.icon}
          </div>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">{c.value}</p>
          <p className="mt-1 text-[11px]">{c.sub}</p>
        </div>
      ))}
    </div>
  );
}
