import { pct, rate, type DirectLaneStats, type DirectLaneStatsRow } from "@/lib/correos/stats";
import type { DirectLaneStatsScreen } from "@/lib/correos/stats-loader";

const variantLabel: Record<string, string> = { DIRECCION: "Dirección", MANTENIMIENTO: "Mantenimiento", SEGURIDAD: "Seguridad e higiene", COMPRAS: "Compras" };

function Funnel({ stats, title }: { stats: DirectLaneStats; title: string }) {
  const f = stats.funnel;
  return (
    <div>
      <h3>{title}</h3>
      <div className="metrics">
        <div className="metric"><span>Inscritos</span><strong>{f.enrolled}</strong></div>
        <div className="metric"><span>Alcanzados (toque 1)</span><strong>{f.reached}</strong></div>
        <div className="metric"><span>Correos enviados</span><strong>{f.sends}</strong></div>
        <div className="metric"><span>Fallos y rebotes</span><strong>{f.failed + f.bounced_enrollments}</strong></div>
        <div className="metric"><span>Respuestas</span><strong>{f.replied}</strong></div>
        <div className="metric"><span>Tasa de respuesta</span><strong>{pct(rate(f.replied, f.reached))}</strong></div>
        <div className="metric"><span>Positivas</span><strong>{f.positive}</strong></div>
        <div className="metric"><span>Leads</span><strong>{f.leads}</strong></div>
        <div className="metric"><span>Apertura (direccional)</span><strong>{pct(rate(f.opened, f.tracked))}</strong><span className="fine">{f.opened} de {f.tracked} con pixel</span></div>
        <div className="metric"><span>Bajas</span><strong>{f.unsubscribed}</strong></div>
      </div>
    </div>
  );
}

function Breakdown({ rows, title, labelFor }: { rows: DirectLaneStatsRow[] | undefined; title: string; labelFor?: (key: string) => string }) {
  if (!rows || rows.length === 0) return null;
  return (
    <details open>
      <summary className="fine">{title}</summary>
      <div className="table-scroll"><table>
        <thead><tr><th>{title}</th><th>Alcanzados</th><th>Enviados</th><th>Fallos</th><th>Respuestas</th><th>Tasa</th><th>Apertura</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{labelFor ? labelFor(r.key) : r.key}</td><td>{r.reached}</td><td>{r.sends}</td><td>{r.failed}</td><td>{r.replied}</td>
              <td>{pct(rate(r.replied, r.reached))}</td><td>{r.tracked > 0 ? `${pct(rate(r.opened, r.tracked))} (${r.opened}/${r.tracked})` : "sin pixel"}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </details>
  );
}

/** Sección Estadísticas de Correos: métricas reales del carril y el ciclo de mejora de los viernes. */
export function CorreosStats({ screen }: { screen: DirectLaneStatsScreen }) {
  if (!screen.available || !screen.thisWeek || !screen.last30) {
    return <p className="fine">Las estadísticas se activan con datos reales del carril.</p>;
  }
  return (
    <div>
      <Funnel stats={screen.thisWeek} title={`Semana del ${screen.weekStart}`} />
      <Funnel stats={screen.last30} title="Últimos 30 días" />
      <Breakdown rows={screen.last30.by.variant} title="Por variante" labelFor={(k) => variantLabel[k] ?? k} />
      <Breakdown rows={screen.last30.by.mailbox} title="Por buzón" />
      <Breakdown rows={screen.last30.by.state} title="Por estado" />
      <Breakdown rows={screen.last30.by.week} title="Por semana" />
      <h3>Ciclo de mejora de los viernes</h3>
      {screen.reports.length === 0 ? <p className="fine">El primer reporte se genera el viernes a las 14:00. Propone; el ajuste lo aplica un humano.</p> : null}
      {screen.reports.map((r, index) => (
        <details key={r.week_start} open={index === 0}>
          <summary className="fine">Semana del {r.week_start} · generado {new Date(r.generated_at).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}</summary>
          <ul>{r.recommendations.map((line, i) => <li key={i}>{line}</li>)}</ul>
        </details>
      ))}
    </div>
  );
}
