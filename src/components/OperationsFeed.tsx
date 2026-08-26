import type { OperationsPortalSnapshot } from "@/lib/operations/portal";
import { civilDateValue } from "@/lib/operations/capacity";
import { operationalLabel } from "@/lib/operations/presentation";

const timestampFormat = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" });

function stamp(value: string | null | undefined, fallback: string): string {
  return value ? timestampFormat.format(new Date(value)) : fallback;
}

type FeedItem = { code: string; text: string; meta: string };

export function OperationsFeed({ snapshot }: { snapshot: OperationsPortalSnapshot }) {
  const { health } = snapshot;
  const items: FeedItem[] = [
    {
      code: "SNC",
      text: "Verdad operativa recalculada desde la fuente canónica",
      meta: timestampFormat.format(new Date(snapshot.generatedAt)),
    },
    {
      code: "SYN",
      text: `Reply sync · ${operationalLabel(health.replySync)}`,
      meta: "Carril de respuestas",
    },
    {
      code: "WDG",
      text: `Watchdog · ${operationalLabel(health.operations.state)}`,
      meta: stamp(health.operations.lastWatchdogAt, operationalLabel(health.operations.reasonCode)),
    },
    {
      code: "CAD",
      text: `Cadencia · ${operationalLabel(health.cadence.state)} · ${health.cadence.cadence_count}/${health.cadence.required_cadence_count}`,
      meta: stamp(health.cadence.last_reconciled_at, operationalLabel(health.cadence.reason_code)),
    },
    {
      code: "APO",
      text: `${health.outboundProvider.name} · ${operationalLabel(health.outboundProvider.state)}`,
      meta: `Dominios ${health.outboundProvider.domainsReady}/${health.outboundProvider.domainsTarget} · Buzones ${health.outboundProvider.mailboxesReady}/${health.outboundProvider.mailboxesTarget}`,
    },
    {
      code: "CAP",
      text: `Capacidad · ${health.capacity.committed}/${health.capacity.limit ?? "?"} proyectos comprometidos`,
      meta: `${civilDateValue(health.capacity.month)} · ${health.capacity.available ?? "?"} disponibles`,
    },
  ];

  return (
    <div aria-label="Registro operativo" className="cr-feed" role="list">
      {items.map((item) => (
        <div className="cr-feed-item" key={item.code} role="listitem">
          <span aria-hidden="true" className="cr-feed-code">{item.code}</span>
          <div>
            <p>{item.text}</p>
            <span>{item.meta}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
