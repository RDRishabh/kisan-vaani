"use client";

import { useEffect, useState } from "react";
import { ChevronDown, CircleDot, UserRound } from "lucide-react";
import { OPS_DISTRICTS } from "@/lib/opsData";

const TAB_TITLE: Record<string, string> = {
  overview: "Overview",
  alerts: "Weather Alerts",
  outbreaks: "Disease Outbreaks",
  escalations: "RSK Escalations",
  broadcasts: "Broadcasts",
  registry: "Farmer Registry",
};

export default function TopBar({ tab, district, onDistrict }: {
  tab: string;
  district: string;
  onDistrict: (d: string) => void;
}) {
  const [clock, setClock] = useState<string | null>(null);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
        })
      );
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:px-6">
      <h1 className="text-sm font-semibold text-slate-900">{TAB_TITLE[tab] ?? tab}</h1>

      <div className="relative ml-2">
        <label htmlFor="ops-district" className="sr-only">Filter by district</label>
        <select
          id="ops-district"
          value={district}
          onChange={(e) => onDistrict(e.target.value)}
          className="h-8 appearance-none rounded-md border border-slate-200 bg-white pl-3 pr-8 text-[13px] font-medium text-slate-700 hover:border-slate-300 focus:border-forest focus:outline-none"
        >
          {OPS_DISTRICTS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      </div>

      <div className="ml-auto flex items-center gap-4">
        <span
          className="hidden rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 md:inline-flex"
          title="Weather alerts, escalation tickets and the query feed are live; historical totals and the farmer registry are seeded demonstration data."
        >
          Seeded demo data + live rows
        </span>
        <span className="hidden items-center gap-1.5 text-xs text-slate-500 sm:inline-flex">
          <CircleDot className="size-3 text-emerald-500" aria-hidden="true" />
          Live
          <span className="tabular-nums font-medium text-slate-700">{clock ?? "--:--:--"}</span>
          <span className="text-slate-400">IST</span>
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1 pl-1.5 pr-3 text-xs font-medium text-slate-700">
          <span className="flex size-5 items-center justify-center rounded-full bg-forest text-white">
            <UserRound className="size-3" aria-hidden="true" />
          </span>
          DAO · Sehore
        </span>
      </div>
    </header>
  );
}
