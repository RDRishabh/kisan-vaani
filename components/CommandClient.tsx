"use client";

// KisanVaani Ops — professional command center for District Agriculture Officers.
// White-theme, data-first console: overview KPIs + charts, weather alerts,
// disease outbreaks, RSK/KVK escalation queue, broadcast log, farmer registry.

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck } from "lucide-react";
import type { EscalationTicket } from "@/lib/types";
import { BROADCAST_SEED, ESCALATIONS } from "@/lib/opsData";
import {
  createLiveBroadcast,
  fetchLiveBroadcasts,
  fetchLiveTickets,
  patchLiveTicket,
  type LiveBroadcast,
  type LiveTicket,
} from "@/lib/ops-live";
import Sidebar, { type OpsTab } from "./command/Sidebar";
import TopBar from "./command/TopBar";
import KpiCards from "./command/KpiCards";
import { LanguageDonut, QueryVolumeChart, TopCropsChart } from "./command/Charts";
import QueryFeedTable from "./command/QueryFeedTable";
import AlertsPanel from "./command/AlertsPanel";
import OutbreaksPanel from "./command/OutbreaksPanel";
import EscalationsPanel from "./command/EscalationsPanel";
import BroadcastsPanel from "./command/BroadcastsPanel";
import RegistryTable from "./command/RegistryTable";
import BroadcastComposer, { type ComposeTarget } from "./command/BroadcastComposer";

export default function CommandClient() {
  const [tab, setTab] = useState<OpsTab>("overview");
  const [district, setDistrict] = useState("All districts");

  // escalation tickets are mutable local state (assign / reply / close actions);
  // rows fetched from /api/tickets carry live=true and persist edits via PATCH
  const [tickets, setTickets] = useState<LiveTicket[]>(ESCALATIONS);
  const liveTicketIds = useRef<Set<string>>(new Set());
  const updateTicket = useCallback((id: string, patch: Partial<EscalationTicket>) => {
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    if (liveTicketIds.current.has(id)) {
      patchLiveTicket(id, {
        status: patch.status,
        officer: patch.officer ?? undefined,
        kendra: patch.kendra,
      });
    }
  }, []);

  // broadcast log grows as the composer queues sends
  const [broadcasts, setBroadcasts] = useState<LiveBroadcast[]>(BROADCAST_SEED);
  const [composeTarget, setComposeTarget] = useState<ComposeTarget | null>(null);
  const [liveAlerts, setLiveAlerts] = useState<{ total: number; severe: number; warning: number; watch: number } | undefined>(undefined);
  const nextBrdId = useRef(1042);

  // merge persisted rows on top of the seed data on mount; seed rows stay so
  // the console keeps its operating-at-scale look
  useEffect(() => {
    let cancelled = false;
    void fetchLiveTickets().then((live) => {
      if (cancelled || live.length === 0) return;
      live.forEach((t) => liveTicketIds.current.add(t.id));
      setTickets((prev) => [...live.filter((t) => !prev.some((p) => p.id === t.id)), ...prev]);
    });
    void fetchLiveBroadcasts().then((live) => {
      if (cancelled || live.length === 0) return;
      setBroadcasts((prev) => [...live.filter((b) => !prev.some((p) => p.id === b.id)), ...prev]);
    });
    // Keep the Overview weather-alert KPI consistent with the live scan the
    // Weather Alerts tab shows (avoids a 4-vs-13 contradiction on the demo path).
    void fetch("/api/alerts", { signal: AbortSignal.timeout(12000) })
      .then((r) => r.json())
      .then((data: { alerts?: { severity: string }[] }) => {
        if (cancelled || !Array.isArray(data.alerts)) return;
        const a = data.alerts;
        setLiveAlerts({
          total: a.length,
          severe: a.filter((x) => x.severity === "severe").length,
          warning: a.filter((x) => x.severity === "warning").length,
          watch: a.filter((x) => x.severity === "watch").length,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  const queueBroadcast = useCallback(
    ({ target, message, channels }: { target: ComposeTarget; message: string; channels: string[] }) => {
      const id = `BRD-${nextBrdId.current++}`;
      const rec: LiveBroadcast = {
        id,
        createdAt: new Date().toISOString(),
        kind: target.kind,
        title: target.title,
        district: target.district,
        state: target.state,
        language: target.language,
        channels,
        recipients: target.recipients,
        sent: 0,
        delivered: 0,
        heard: 0,
        status: "queued",
        message,
      };
      setBroadcasts((prev) => [rec, ...prev]);
      showToast(`Broadcast queued · #${id}`);
      // persist to /api/broadcasts; on success mark the local row live so the
      // console shows which sends are database-backed
      void createLiveBroadcast({
        kind: target.kind,
        title: target.title,
        district: target.district,
        state: target.state,
        language: target.language,
        channels,
        recipients: target.recipients,
        message,
      }).then((saved) => {
        if (saved) setBroadcasts((prev) => prev.map((b) => (b.id === id ? { ...b, live: true } : b)));
      });
      // simulate the gateway completing the send
      setTimeout(() => {
        setBroadcasts((prev) =>
          prev.map((b) =>
            b.id === id
              ? {
                  ...b,
                  status: "completed",
                  sent: b.recipients,
                  delivered: Math.round(b.recipients * 0.95),
                  heard: channels.includes("Voice call") ? Math.round(b.recipients * 0.72) : 0,
                }
              : b
          )
        );
      }, 6000);
    },
    [showToast]
  );

  const openEscalations = tickets.filter((t) => t.status === "pending" || t.status === "assigned").length;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <Sidebar
        tab={tab}
        onTab={setTab}
        badges={{ escalations: openEscalations, alerts: 4, outbreaks: 3 }}
      />

      <div className="pl-52">
        <TopBar tab={tab} district={district} onDistrict={setDistrict} />

        <main className="space-y-4 p-4 lg:p-6">
          {tab === "overview" && (
            <>
              <KpiCards liveAlerts={liveAlerts} />
              <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr_1fr]">
                <QueryVolumeChart />
                <LanguageDonut />
                <TopCropsChart />
              </div>
              <QueryFeedTable district={district} />
            </>
          )}

          {tab === "alerts" && <AlertsPanel district={district} onCompose={setComposeTarget} />}

          {tab === "outbreaks" && <OutbreaksPanel district={district} onCompose={setComposeTarget} />}

          {tab === "escalations" && (
            <EscalationsPanel district={district} tickets={tickets} onUpdate={updateTicket} />
          )}

          {tab === "broadcasts" && <BroadcastsPanel district={district} broadcasts={broadcasts} />}

          {tab === "registry" && <RegistryTable district={district} />}
        </main>
      </div>

      <BroadcastComposer target={composeTarget} onClose={() => setComposeTarget(null)} onSend={queueBroadcast} />

      {toast && (
        <div className="rise fixed bottom-5 left-1/2 z-50 -translate-x-1/2" role="status" aria-live="polite">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-lg">
            <CircleCheck className="size-4 text-emerald-600" aria-hidden="true" />
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
