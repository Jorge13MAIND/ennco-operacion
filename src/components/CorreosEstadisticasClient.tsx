"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useState, type KeyboardEvent } from "react";

import { pct, rate, type DirectLaneStatsRow } from "@/lib/correos/stats";

/**
 * Piezas interactivas de Estadísticas. Todo lo que muestran también existe sin
 * JavaScript: el selector va dentro de un formulario GET con botón, y las
 * pestañas sólo esconden tablas que el servidor ya mandó completas.
 */

export function CampaignSelect({ name, value, options }: { name: string; value: string; options: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const id = useId();
  return (
    <label className="cr-stats-select" htmlFor={id}>
      <span>Campaña</span>
      <select
        defaultValue={value}
        id={id}
        name={name}
        onChange={(event) => {
          const next = new URLSearchParams(params.toString());
          next.set(name, event.currentTarget.value);
          router.push(`${pathname}?${next.toString()}` as Route);
        }}
      >
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}

export type BreakdownTab = { key: string; label: string; rows: Array<DirectLaneStatsRow & { label: string }> };

function Meter({ value }: { value: number | null }) {
  const width = value === null ? 0 : Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <svg aria-hidden="true" className="cr-meter" height="6" width="72">
      <rect className="cr-meter-track" height="6" rx="3" width="72" />
      {width > 0 ? <rect className="cr-meter-fill" height="6" rx="3" width={`${Math.max(width, 6)}%`} /> : null}
    </svg>
  );
}

export function BreakdownTabs({ tabs }: { tabs: BreakdownTab[] }) {
  const [active, setActive] = useState(tabs[0]?.key ?? "");
  const baseId = useId();
  const current = tabs.find((tab) => tab.key === active) ?? tabs[0];
  if (!current) return null;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setActive(tabs[next]!.key);
    document.getElementById(`${baseId}-tab-${tabs[next]!.key}`)?.focus();
  };
  const maxReply = Math.max(...current.rows.map((row) => rate(row.replied, row.reached) ?? 0), 0);
  return (
    <div className="cr-tabs">
      <div aria-label="Cortes de la campaña" className="cr-tablist" role="tablist">
        {tabs.map((tab, index) => (
          <button
            aria-controls={`${baseId}-panel`}
            aria-selected={tab.key === current.key}
            className="cr-tab"
            id={`${baseId}-tab-${tab.key}`}
            key={tab.key}
            onClick={() => setActive(tab.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
            role="tab"
            tabIndex={tab.key === current.key ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div aria-labelledby={`${baseId}-tab-${current.key}`} className="table-wrap" id={`${baseId}-panel`} role="tabpanel" tabIndex={0}>
        {current.rows.length === 0 ? <p className="cr-stats-empty">Sin envíos en este corte todavía.</p> : (
          <table className="cr-stats-table">
            <thead>
              <tr>
                <th scope="col">{current.label}</th>
                <th className="num" scope="col">Alcanzados</th>
                <th className="num" scope="col">Enviados</th>
                <th className="num" scope="col">Fallos</th>
                <th className="num" scope="col">Respuestas</th>
                <th scope="col">Tasa de respuesta</th>
                <th scope="col">Apertura</th>
              </tr>
            </thead>
            <tbody>
              {current.rows.map((row) => {
                const reply = rate(row.replied, row.reached);
                const open = rate(row.opened, row.tracked);
                const best = maxReply > 0 && reply === maxReply;
                return (
                  <tr key={row.key}>
                    <th scope="row">{row.label}{best && current.rows.length > 1 ? <span className="cr-best"> mejor</span> : null}</th>
                    <td className="num" data-label="Alcanzados">{row.reached}</td>
                    <td className="num" data-label="Enviados">{row.sends}</td>
                    <td className="num" data-label="Fallos">{row.failed}</td>
                    <td className="num" data-label="Respuestas">{row.replied}</td>
                    <td data-label="Tasa de respuesta"><span className="cr-meter-cell"><Meter value={reply} /><span>{pct(reply)}</span></span></td>
                    <td data-label="Apertura">{row.tracked > 0 ? <span className="cr-meter-cell"><Meter value={open} /><span>{pct(open)} <small>({row.opened}/{row.tracked})</small></span></span> : <span className="cr-stats-muted">sin pixel</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function CopyTextButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  return (
    <button
      className="button secondary cr-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("done");
        } catch {
          setState("failed");
        }
        window.setTimeout(() => setState("idle"), 2500);
      }}
      type="button"
    >
      {state === "done" ? "Copiado" : state === "failed" ? "No se pudo copiar" : "Copiar resumen"}
    </button>
  );
}
