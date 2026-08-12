import type { PortalModule, PortalRow } from "@/lib/operations/portal";
import type { OperationModuleKey } from "@/lib/operations/portal";
import { CompleteTaskButton, LeadQualificationAction, OpportunityTransitionAction, ReplyReviewAction } from "@/components/OperationsActions";

function StatusBadge({ value }: { value: string }) {
  const blocked = /BLOCK|HOLD|REJECT|ZERO|QUARANTIN/i.test(value);
  return <span className={`status ${blocked ? "blocked" : ""}`}>{value}</span>;
}

export function PortalRowsTable({ module, actionKind, evidenceClass }: {
  module: PortalModule;
  actionKind?: OperationModuleKey;
  evidenceClass?: "synthetic_demo" | "live";
}) {
  const showsAction = evidenceClass === "live" && (actionKind === "respuestas" || actionKind === "leads" || actionKind === "pipeline");
  return (
    <section className="panel">
      <div className="panel-head portal-panel-head">
        <div>
          <h2>{module.title}</h2>
          <p>{module.description}</p>
        </div>
        <span className="badge">{module.rows.length} registros</span>
      </div>
      {module.rows.length === 0 ? (
        <div className="empty-state">
          <strong>Sin registros</strong>
          <p>{module.emptyState}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {module.columns.map((column) => <th key={column.key}>{column.label}</th>)}
                <th>Estado</th>
                {showsAction ? <th>Acción</th> : null}
              </tr>
            </thead>
            <tbody>
              {module.rows.map((item) => (
                <tr key={item.id}>
                  {module.columns.map((column) => (
                    <td data-label={column.label} key={column.key}>{item.values[column.key] ?? "Sin dato"}</td>
                  ))}
                  <td data-label="Estado"><StatusBadge value={item.status} /></td>
                  {showsAction ? (
                    <td data-label="Acción">
                      {actionKind === "leads" ? <LeadQualificationAction leadId={item.id} /> : null}
                      {actionKind === "pipeline" ? <OpportunityTransitionAction meetingId={item.values.meeting_id} opportunityId={item.id} /> : null}
                      {actionKind === "respuestas" && item.values.reviewable === "true" ? <ReplyReviewAction providerEventId={item.id} /> : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function CompactActionTable({ rows, evidenceClass }: { rows: PortalRow[]; evidenceClass: "synthetic_demo" | "live" }) {
  return (
    <div className="action-list">
      {rows.length === 0 ? <p className="fine">No hay acciones pendientes.</p> : rows.map((item) => (
        <article className="action-row" key={item.id}>
          <div>
            <strong>{item.values.objective}</strong>
            <span>{item.values.owner} · {item.values.due}</span>
          </div>
          {evidenceClass === "live" && item.status === "OPEN" ? <CompleteTaskButton taskId={item.id} /> : <StatusBadge value={item.status} />}
        </article>
      ))}
    </div>
  );
}
