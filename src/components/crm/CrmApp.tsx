"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";

import { sendCrmCommand } from "@/components/crm/crm-client";
import { CrmDrawer } from "@/components/crm/CrmDrawer";
import { MoveDialog, NewContactDialog } from "@/components/crm/CrmDialogs";
import {
  BOARD_STAGES, INTENT_LABELS, OPEN_STAGES, STAGE_HINTS, STAGE_LABELS, STAGE_TONES, VIEW_LABELS, byUrgency, daysUntouched,
  formatMxn, inView, initials, isOverdue, isQualified, matchesSearch, personName, relativeDay, stageRequirements,
  type CrmBoardData, type CrmRecord, type CrmStage, type CrmView,
} from "@/lib/crm/model";

type Layout = "tablero" | "tabla";
const VIEWS: CrmView[] = ["abiertos", "por_calificar", "mis", "vencidos", "ganados", "cerrados", "descartados", "todos"];

function avatarTone(id: string | null): string { return String(id ? [...id].reduce((n, c) => n + c.charCodeAt(0), 0) % 6 : 6); }

export function CrmApp({ data, me, canEdit }: { data: CrmBoardData; me: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<CrmView>("abiertos");
  const [layout, setLayout] = useState<Layout>("tablero");
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("todos");
  const [stageFilter, setStageFilter] = useState<CrmStage | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [move, setMove] = useState<{ record: CrmRecord; stage: CrmStage } | null>(null);
  const [creating, setCreating] = useState(false);
  // Movimientos en vuelo; se descartan solos cuando llega la siguiente lectura del servidor.
  const [pending, setPending] = useState<{ key: string; stages: Record<string, CrmStage> }>({ key: data.generated_at, stages: {} });

  const [toast, setToast] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<CrmStage | null>(null);

  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 4500); return () => window.clearTimeout(t); }, [toast]);

  const now = useMemo(() => new Date(data.generated_at), [data.generated_at]);
  const records = useMemo(() => {
    const optimistic = pending.key === data.generated_at ? pending.stages : {};
    return data.records.map((r) => (optimistic[r.id] ? { ...r, stage: optimistic[r.id]! } : r));
  }, [data.records, data.generated_at, pending]);
  const visible = useMemo(() => records
    .filter((r) => inView(r, view, me, now) && matchesSearch(r, query) && (owner === "todos" || (owner === "sin" ? !r.owner_user_id : r.owner_user_id === owner))
      && (!stageFilter || r.stage === stageFilter))
    .sort(byUrgency(now)), [records, view, me, now, query, owner, stageFilter]);

  const kpis = useMemo(() => {
    const open = records.filter((r) => OPEN_STAGES.includes(r.stage));
    const won = records.filter((r) => r.stage === "GANADO");
    return {
      openValue: open.reduce((n, r) => n + (r.value_mxn ?? 0), 0), openCount: open.length,
      toQualify: records.filter((r) => r.stage === "RESPONDIO").length,
      overdue: open.filter((r) => isOverdue(r.next_action_at, now) || isOverdue(r.next_task_at, now)).length,
      wonValue: won.reduce((n, r) => n + (r.value_mxn ?? 0), 0), wonCount: won.length,
      replied: records.filter((r) => r.source === "CORREO").length,
      discarded: records.filter((r) => r.stage === "DESCARTADO").length,
    };
  }, [records, now]);
  const funnel = useMemo(() => BOARD_STAGES.map((stage) => {
    const items = records.filter((r) => r.stage === stage);
    return { stage, count: items.length, value: items.reduce((n, r) => n + (r.value_mxn ?? 0), 0) };
  }), [records]);
  const maxCount = Math.max(1, ...funnel.map((f) => f.count));

  const changeView = (next: CrmView) => {
    setView(next); setStageFilter(null);
    if (next === "descartados" || next === "todos") setLayout("tabla");
  };
  const changeLayout = (next: Layout) => setLayout(next);

  const refresh = useCallback((message?: string, tone: "ok" | "bad" = "ok") => {
    if (message) setToast({ tone, text: message });
    router.refresh();
  }, [router]);

  const requestMove = useCallback(async (record: CrmRecord, stage: CrmStage) => {
    if (!canEdit || record.stage === stage) return;
    if (stageRequirements(record, stage).length > 0) { setMove({ record, stage }); return; }
    const key = data.generated_at;
    setPending((p) => ({ key, stages: { ...(p.key === key ? p.stages : {}), [record.id]: stage } }));
    const outcome = await sendCrmCommand({ op: "MOVER", payload: { record_id: record.id, stage, expected_revision: record.revision } });
    if (!outcome.ok) setPending((p) => ({ key: p.key, stages: Object.fromEntries(Object.entries(p.stages).filter(([id]) => id !== record.id)) }));
    refresh(outcome.ok ? `${record.full_name}: ${STAGE_LABELS[stage]}.` : outcome.message, outcome.ok ? "ok" : "bad");
  }, [canEdit, refresh, data.generated_at]);

  function onDrop(event: DragEvent, stage: CrmStage) {
    event.preventDefault();
    setOver(null);
    const id = event.dataTransfer.getData("text/plain") || dragging;
    setDragging(null);
    const record = records.find((r) => r.id === id);
    if (record) void requestMove(record, stage);
  }

  const selectedRecord = records.find((r) => r.id === selected) ?? null;
  const columns = stageFilter ? BOARD_STAGES.filter((s) => s === stageFilter) : view === "ganados" ? ["GANADO" as CrmStage] : view === "cerrados" ? ["PERDIDO" as CrmStage]
    : view === "por_calificar" ? ["RESPONDIO" as CrmStage] : BOARD_STAGES.filter((s) => view === "todos" || OPEN_STAGES.includes(s) || s === "GANADO" || s === "PERDIDO");

  return (
    <div className="crm-app" data-drawer={selected ? "open" : "closed"}>
      <section className="crm-kpis" aria-label="Resumen del CRM">
        <div className="crm-kpi"><span>Pipeline abierto</span><strong>{formatMxn(kpis.openValue)}</strong><em>{kpis.openCount} contactos en proceso</em></div>
        <button type="button" className="crm-kpi" onClick={() => changeView("por_calificar")} aria-pressed={view === "por_calificar"}>
          <span>Por calificar</span><strong>{kpis.toQualify}</strong><em>respondieron y nadie los ha validado</em></button>
        <button type="button" className="crm-kpi" data-tone={kpis.overdue ? "bad" : undefined} onClick={() => changeView("vencidos")} aria-pressed={view === "vencidos"}>
          <span>Acciones vencidas</span><strong>{kpis.overdue}</strong><em>siguiente acción o tarea atrasada</em></button>
        <div className="crm-kpi" data-tone={kpis.wonCount ? "good" : undefined}><span>Ganado</span><strong>{formatMxn(kpis.wonValue)}</strong><em>{kpis.wonCount} ventas cerradas</em></div>
        <div className="crm-kpi"><span>Respondieron</span><strong>{kpis.replied}</strong><em>{kpis.discarded} descartados</em></div>
      </section>

      <section className="crm-funnel" aria-label="Embudo por etapa">
        {funnel.map((f) => (
          <button key={f.stage} type="button" className="crm-funnel-row" aria-pressed={stageFilter === f.stage} data-tone={STAGE_TONES[f.stage]}
            onClick={() => setStageFilter(stageFilter === f.stage ? null : f.stage)} title={STAGE_HINTS[f.stage]}>
            <span className="crm-funnel-label">{STAGE_LABELS[f.stage]}</span>
            <svg className="crm-funnel-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
              <rect className="crm-funnel-track" x="0" y="0" width="100" height="8" rx="4" />
              <rect className="crm-funnel-fill" x="0" y="0" width={Math.max(f.count ? 4 : 0, (f.count / maxCount) * 100)} height="8" rx="4" />
            </svg>
            <span className="crm-funnel-count">{f.count}</span>
            <span className="crm-funnel-value">{f.value ? formatMxn(f.value) : ""}</span>
          </button>
        ))}
      </section>

      <div className="crm-toolbar">
        <div className="crm-views" role="tablist" aria-label="Vistas">
          {VIEWS.map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className="crm-view" onClick={() => changeView(v)}>
              {VIEW_LABELS[v]}<span className="crm-view-count">{records.filter((r) => inView(r, v, me, now)).length}</span>
            </button>
          ))}
        </div>
        <div className="crm-toolbar-row">
          <input className="crm-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nombre, empresa, correo…" aria-label="Buscar en el CRM" />
          <select className="crm-select" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Responsable">
            <option value="todos">Todos los responsables</option>
            <option value="sin">Sin responsable</option>
            {data.users.map((u) => <option key={u.id} value={u.id}>{personName(u.email)}</option>)}
          </select>
          <div className="crm-segmented" role="radiogroup" aria-label="Forma de ver">
            <button type="button" role="radio" aria-checked={layout === "tablero"} onClick={() => changeLayout("tablero")}>Tablero</button>
            <button type="button" role="radio" aria-checked={layout === "tabla"} onClick={() => changeLayout("tabla")}>Tabla</button>
          </div>
          <a className="crm-button" href="/api/v1/operations/crm/export" download>Exportar Excel</a>
          {canEdit ? <button type="button" className="crm-button" data-primary="true" onClick={() => setCreating(true)}>+ Nuevo contacto</button> : null}
        </div>
        {stageFilter ? <p className="crm-filter-note">Filtrando por <strong>{STAGE_LABELS[stageFilter]}</strong>. <button type="button" className="crm-text-button" onClick={() => setStageFilter(null)}>Quitar filtro</button></p> : null}
      </div>

      {toast ? <p className={toast.tone === "ok" ? "crm-toast crm-ok" : "crm-toast crm-error"} role="status">{toast.text}</p> : null}

      {layout === "tablero" && view !== "descartados" ? (
        <div className="crm-board" aria-label="Tablero por etapa">
          {columns.map((stage) => {
            const cards = visible.filter((r) => r.stage === stage);
            return (
              <section key={stage} className="crm-column" data-tone={STAGE_TONES[stage]} data-over={over === stage}
                aria-label={`${STAGE_LABELS[stage]}: ${cards.length}`}
                onDragOver={(e) => { if (canEdit && dragging) { e.preventDefault(); setOver(stage); } }}
                onDragLeave={() => setOver((o) => (o === stage ? null : o))}
                onDrop={(e) => onDrop(e, stage)}>
                <header className="crm-column-head">
                  <span className="crm-stage-dot" aria-hidden="true" />
                  <h2>{STAGE_LABELS[stage]}</h2>
                  <span className="crm-column-count">{cards.length}</span>
                  <span className="crm-column-value">{cards.some((c) => c.value_mxn) ? formatMxn(cards.reduce((n, c) => n + (c.value_mxn ?? 0), 0)) : ""}</span>
                </header>
                <div className="crm-column-cards">
                  {cards.length === 0 ? <p className="crm-column-empty">{canEdit ? "Arrastra aquí" : "Vacío"}</p> : cards.map((record) => (
                    <Card key={record.id} record={record} now={now} canDrag={canEdit} selected={selected === record.id}
                      onOpen={() => setSelected(record.id)}
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", record.id); e.dataTransfer.effectAllowed = "move"; setDragging(record.id); }}
                      onDragEnd={() => { setDragging(null); setOver(null); }} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <Table records={visible} now={now} selected={selected} onOpen={setSelected} />
      )}

      {visible.length === 0 ? <p className="crm-empty">No hay contactos en esta vista.</p> : null}

      {selected ? (
        <CrmDrawer key={selected} recordId={selected} fallback={selectedRecord} users={data.users} canEdit={canEdit} refreshKey={data.generated_at}
          onClose={() => setSelected(null)} onMove={(record, stage) => void requestMove(record, stage)} onChanged={() => refresh()} />
      ) : null}

      {move ? <MoveDialog key={`${move.record.id}:${move.stage}`} record={move.record} stage={move.stage} users={data.users}
        onClose={() => setMove(null)} onDone={(message) => { setMove(null); refresh(message); }} /> : null}
      {creating ? <NewContactDialog users={data.users} defaultOwner={data.default_owner_user_id}
        onClose={() => setCreating(false)} onDone={(message, recordId) => { setCreating(false); refresh(message); if (recordId) setSelected(recordId); }} /> : null}
    </div>
  );
}

function Card({ record, now, canDrag, selected, onOpen, onDragStart, onDragEnd }: {
  record: CrmRecord; now: Date; canDrag: boolean; selected: boolean; onOpen: () => void;
  onDragStart: (e: DragEvent) => void; onDragEnd: () => void;
}) {
  const due = record.next_action_at ?? record.next_task_at;
  const overdue = isOverdue(record.next_action_at, now) || isOverdue(record.next_task_at, now);
  const untouched = daysUntouched(record, now);
  const name = personName(record.owner_email);
  return (
    <article className="crm-card" data-selected={selected} data-overdue={overdue} draggable={canDrag}
      onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <button type="button" className="crm-card-open" onClick={onOpen} aria-label={`Abrir ${record.full_name}`}>
        <span className="crm-card-name">{record.full_name}</span>
        <span className="crm-card-company">{[record.company_name, record.role_title].filter(Boolean).join(" · ") || "Sin empresa"}</span>
      </button>
      {record.stage === "RESPONDIO" && record.reply_intent ? <p className="crm-card-intent">{INTENT_LABELS[record.reply_intent] ?? record.reply_intent}</p> : null}
      {record.next_action ? (
        <p className="crm-card-next" data-overdue={overdue}><span>{record.next_action}</span>{due ? <em>{relativeDay(due, now)}</em> : null}</p>
      ) : null}
      <div className="crm-card-foot">
        <span className="crm-avatar" data-tone={avatarTone(record.owner_user_id)} title={name} aria-label={`Responsable: ${name}`}>{initials(name)}</span>
        {record.value_mxn ? <span className="crm-card-value">{formatMxn(record.value_mxn)}</span> : null}
        {OPEN_STAGES.includes(record.stage) && isQualified(record) ? <span className="crm-chip" data-tone="good">Calificado</span> : null}
        {record.open_tasks ? <span className="crm-chip">{record.open_tasks} tarea{record.open_tasks === 1 ? "" : "s"}</span> : null}
        {OPEN_STAGES.includes(record.stage) && untouched >= 7 ? <span className="crm-chip" data-tone="warn">sin tocar {untouched} días</span> : null}
      </div>
    </article>
  );
}

function Table({ records, now, selected, onOpen }: { records: CrmRecord[]; now: Date; selected: string | null; onOpen: (id: string) => void }) {
  return (
    <div className="table-wrap crm-table-wrap" role="region" tabIndex={0} aria-label="Contactos del CRM">
      <table className="crm-table">
        <thead><tr>
          <th scope="col">Contacto</th><th scope="col">Empresa</th><th scope="col">Etapa</th><th scope="col">Responsable</th>
          <th scope="col">Siguiente acción</th><th scope="col" className="num">Valor</th><th scope="col">Respondió</th><th scope="col">Clasificación</th>
        </tr></thead>
        <tbody>
          {records.map((r) => {
            const overdue = isOverdue(r.next_action_at, now) || isOverdue(r.next_task_at, now);
            return (
              <tr key={r.id} data-selected={selected === r.id}>
                <td data-label="Contacto"><button type="button" className="crm-row-open" onClick={() => onOpen(r.id)}>
                  <strong>{r.full_name}</strong><span>{r.email ?? r.phone ?? ""}</span></button></td>
                <td data-label="Empresa">{r.company_name ?? ""}{r.role_title ? <span className="crm-muted"> · {r.role_title}</span> : null}</td>
                <td data-label="Etapa"><span className="crm-stage" data-tone={STAGE_TONES[r.stage]}>{STAGE_LABELS[r.stage]}</span>
                  {r.close_reason && (r.stage === "PERDIDO" || r.stage === "DESCARTADO") ? <span className="crm-muted"> · {r.close_reason}</span> : null}</td>
                <td data-label="Responsable">{personName(r.owner_email)}</td>
                <td data-label="Siguiente acción">{r.next_action ? <>{r.next_action} {r.next_action_at ? <span className={overdue ? "crm-due" : "crm-muted"}>· {relativeDay(r.next_action_at, now)}</span> : null}</> : <span className="crm-muted">Sin definir</span>}</td>
                <td data-label="Valor" className="num">{r.value_mxn ? formatMxn(r.value_mxn) : ""}</td>
                <td data-label="Respondió">{relativeDay(r.last_reply_at ?? r.created_at, now)}</td>
                <td data-label="Clasificación">{r.reply_intent ? INTENT_LABELS[r.reply_intent] ?? r.reply_intent : r.source === "CORREO" ? "" : r.source === "REFERIDO" ? "Referido" : "Agregado a mano"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
