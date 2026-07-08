import type { BroadcastRecord } from "@/lib/opsData";
import type { LiveBroadcast } from "@/lib/ops-live";
import { EmptyState, SectionCard, StatusPill, TableShell, Td, Th, fmtDateTime, nf } from "./ui";

// Marks broadcasts persisted in the database (queued through the composer).
function LivePill() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700 align-middle">
      <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
      Live
    </span>
  );
}

const KIND_LABEL: Record<BroadcastRecord["kind"], string> = {
  weather: "Weather",
  outbreak: "Outbreak",
  scheme: "Scheme",
};

function pct(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

export default function BroadcastsPanel({ district, broadcasts }: {
  district: string;
  broadcasts: LiveBroadcast[];
}) {
  const rows = broadcasts.filter(
    (b) => district === "All districts" || b.district === district || b.district === "All districts"
  );

  return (
    <div className="space-y-4">
      <SectionCard
        title="Broadcast history"
        sub="Alerts sent to registered farmers · delivery stats per channel mix"
        pad={false}
      >
        {rows.length === 0 ? (
          <EmptyState title={`No broadcasts sent for ${district} yet`} hint="Compose one from Weather Alerts or Disease Outbreaks." />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>ID</Th>
                <Th>Sent</Th>
                <Th>Type</Th>
                <Th>Title</Th>
                <Th>District</Th>
                <Th>Language</Th>
                <Th>Channels</Th>
                <Th right>Recipients</Th>
                <Th right>Delivered</Th>
                <Th right>Heard (voice)</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50" title={b.message}>
                  <Td className="font-medium tabular-nums text-slate-900">
                    #{b.id}
                    {b.live && <LivePill />}
                  </Td>
                  <Td className="tabular-nums text-slate-500">{fmtDateTime(b.createdAt)}</Td>
                  <Td>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                      {KIND_LABEL[b.kind]}
                    </span>
                  </Td>
                  <Td className="max-w-64 truncate font-medium text-slate-800">{b.title}</Td>
                  <Td>
                    {b.district}
                    <span className="ml-1 text-slate-400">· {b.state}</span>
                  </Td>
                  <Td>{b.language}</Td>
                  <Td className="text-xs text-slate-500">{b.channels.join(" + ")}</Td>
                  <Td right className="font-medium text-slate-900">{nf.format(b.recipients)}</Td>
                  <Td right>
                    {b.status === "queued" ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <>
                        {nf.format(b.delivered)} <span className="text-slate-400">({pct(b.delivered, b.sent)})</span>
                      </>
                    )}
                  </Td>
                  <Td right>
                    {b.heard > 0 ? (
                      <>
                        {nf.format(b.heard)} <span className="text-slate-400">({pct(b.heard, b.sent)})</span>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </Td>
                  <Td><StatusPill status={b.status} /></Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </SectionCard>
      <p className="text-[11px] text-slate-400">
        Voice “heard” = call answered and listened ≥30s · delivery via telephony/SMS gateway (demo simulated)
      </p>
    </div>
  );
}
