"use client";

import { useMemo, useState } from "react";
import { Camera, Check, ChevronDown, ChevronUp, UserRound, BadgeCheck } from "lucide-react";
import type { EscalationStatus, EscalationTicket } from "@/lib/types";
import type { LiveTicket } from "@/lib/ops-live";
import { ChannelBadge, EmptyState, SectionCard, SeverityChip, StatusPill, Td, Th, fmtDateTime } from "./ui";

// Marks tickets persisted in the database (created by the live demo surfaces).
function LivePill() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700 align-middle">
      <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
      Live
    </span>
  );
}

const STATUS_FILTERS: { id: EscalationStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "assigned", label: "Assigned" },
  { id: "expert_replied", label: "Expert replied" },
  { id: "closed", label: "Closed" },
];

function SlaCell({ t }: { t: EscalationTicket }) {
  if (t.status === "closed") return <span className="text-slate-400">—</span>;
  if (t.slaHoursLeft < 0)
    return <span className="font-semibold text-red-700">breached {Math.abs(t.slaHoursLeft)}h ago</span>;
  const urgent = t.slaHoursLeft < 6;
  return (
    <span className={`tabular-nums font-medium ${urgent ? "text-red-700" : "text-slate-700"}`}>
      {t.slaHoursLeft}h left
    </span>
  );
}

function ConfidenceBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? "bg-forest" : pct >= 65 ? "bg-amber-500" : "bg-red-600";
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular-nums text-xs font-medium text-slate-700">{pct}%</span>
    </span>
  );
}

export default function EscalationsPanel({ district, tickets, onUpdate }: {
  district: string;
  tickets: LiveTicket[];
  onUpdate: (id: string, patch: Partial<EscalationTicket>) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<EscalationStatus | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      tickets.filter(
        (t) =>
          (district === "All districts" || t.district === district) &&
          (statusFilter === "all" || t.status === statusFilter)
      ),
    [tickets, district, statusFilter]
  );

  const openCount = tickets.filter((t) => t.status !== "closed").length;
  const breached = tickets.filter((t) => t.status !== "closed" && t.slaHoursLeft < 0).length;

  return (
    <div className="space-y-4">
      <SectionCard
        title="Escalation queue"
        sub={`${openCount} open tickets · ${breached} SLA breached · routed to Rythu Seva Kendras (AP), AEO clusters (TS) and district KVKs · ack SLA 4h, field visit 72h`}
        pad={false}
        actions={
          <div className="flex rounded-md border border-slate-200 p-0.5" role="tablist" aria-label="Filter by status">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium ${
                  statusFilter === f.id ? "bg-forest/[0.08] text-forest" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="No tickets match these filters" hint="Adjust status or district filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-[13px]">
              <thead>
                <tr>
                  <Th>Ticket</Th>
                  <Th>Created</Th>
                  <Th>Farmer</Th>
                  <Th>Channel</Th>
                  <Th>Crop</Th>
                  <Th>AI diagnosis</Th>
                  <Th>Confidence</Th>
                  <Th>Severity</Th>
                  <Th>Assigned kendra</Th>
                  <Th>SLA</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const open = expanded === t.id;
                  return [
                    <tr key={t.id} className={`cursor-pointer ${open ? "bg-slate-50" : "hover:bg-slate-50"}`} onClick={() => setExpanded(open ? null : t.id)}>
                      <Td className="font-medium tabular-nums text-slate-900">
                        {t.id}
                        {t.live && <LivePill />}
                      </Td>
                      <Td className="tabular-nums text-slate-500">{fmtDateTime(t.createdAt)}</Td>
                      <Td>
                        <span className="font-medium text-slate-900">{t.farmer}</span>
                        <span className="ml-1 text-slate-400">· {t.village}, {t.district}</span>
                      </Td>
                      <Td><ChannelBadge channel={t.channel} /></Td>
                      <Td>{t.crop}</Td>
                      <Td className="max-w-64 truncate text-slate-600">{t.aiDiagnosis}</Td>
                      <Td><ConfidenceBar pct={t.confidence} /></Td>
                      <Td><SeverityChip sev={t.severity} /></Td>
                      <Td className="max-w-52 truncate">{t.kendra}</Td>
                      <Td><SlaCell t={t} /></Td>
                      <Td><StatusPill status={t.status} /></Td>
                      <Td>
                        {open ? <ChevronUp className="size-4 text-slate-400" aria-hidden="true" /> : <ChevronDown className="size-4 text-slate-400" aria-hidden="true" />}
                        <span className="sr-only">{open ? "Collapse" : "Expand"} ticket {t.id}</span>
                      </Td>
                    </tr>,
                    open ? (
                      <tr key={`${t.id}-detail`} className="bg-slate-50/70">
                        <td colSpan={12} className="border-b border-slate-200 px-4 py-4">
                          <div className="grid gap-4 lg:grid-cols-[180px_1fr_auto]">
                            <div className="flex h-32 w-44 flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-white text-slate-400">
                              <Camera className="size-5" aria-hidden="true" />
                              <span className="text-[11px]">
                                {t.channel === "photo" || t.channel === "whatsapp" ? "Crop photo attached" : "No photo — " + (t.channel === "call" ? "voice query" : "SMS query")}
                              </span>
                            </div>
                            <div className="min-w-0 space-y-2 text-[13px]">
                              <p className="whitespace-normal text-slate-800">
                                <span className="font-semibold">Full AI diagnosis:</span> {t.aiDiagnosis}.
                                {" "}Escalated {t.confidence < 70 ? "because confidence fell below the 70% auto-resolve gate" : "per restricted-treatment / farmer-request policy"}.
                              </p>
                              <p className="text-slate-600">
                                <span className="font-medium text-slate-800">Routing:</span> {t.kendra}
                                {" · "}
                                <span className="font-medium text-slate-800">Officer:</span>{" "}
                                {t.officer ?? <span className="text-amber-700">unassigned</span>}
                                {" · "}
                                <span className="font-medium text-slate-800">Fallback:</span> Kisan Call Centre 1800-180-1551 (L2 SME)
                              </p>
                            </div>
                            <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
                              {t.officer === null && t.status !== "closed" && (
                                <button
                                  onClick={() => onUpdate(t.id, { officer: "Duty officer (auto-assign)", status: "assigned" })}
                                  className="inline-flex items-center gap-1.5 rounded-md bg-forest px-3 py-1.5 text-xs font-medium text-white hover:bg-leaf"
                                >
                                  <UserRound className="size-3.5" aria-hidden="true" />
                                  Assign officer
                                </button>
                              )}
                              {(t.status === "pending" || t.status === "assigned") && (
                                <button
                                  onClick={() => onUpdate(t.id, { status: "expert_replied" })}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  <BadgeCheck className="size-3.5" aria-hidden="true" />
                                  Mark expert replied
                                </button>
                              )}
                              {t.status !== "closed" && (
                                <button
                                  onClick={() => onUpdate(t.id, { status: "closed", slaHoursLeft: 0 })}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  <Check className="size-3.5" aria-hidden="true" />
                                  Close ticket
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
      <p className="text-[11px] text-slate-400">
        Escalation network: AP Rythu Seva Kendras (10,778) · Telangana AEO clusters (2,601) · ICAR KVKs (731) · Kisan Sarathi / KCC 1800-180-1551 (production integration)
      </p>
    </div>
  );
}
