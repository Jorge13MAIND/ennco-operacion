"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Route } from "next";

import { PageHeader, Panel } from "@/components/solar/ui";
import { computeConsumption, defaultConsumptionInput, type ConsumptionInput } from "@/lib/solar/consumption";

const nf = (d: number) => new Intl.NumberFormat("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d });
const n = (v: number, d = 2) => (Number.isFinite(v) ? nf(d).format(v) : "—");

/** Campo numérico de la tabla: vacío se lee como cero, sin pelear con el cursor. */
function Num({ value, onChange, step = 1, min = 0, label }: { value: number; onChange: (v: number) => void; step?: number; min?: number; label: string }) {
  return (
    <input
      aria-label={label}
      className="cons-input"
      inputMode="decimal"
      min={min}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      step={step}
      type="number"
      value={Number.isFinite(value) ? value : 0}
    />
  );
}

/** Une los renglones que comparten ubicación, como las celdas combinadas del libro. */
function groupRows<T extends { location: string }>(rows: T[]): Array<{ location: string; span: number; index: number }> {
  const out: Array<{ location: string; span: number; index: number }> = [];
  rows.forEach((r, i) => {
    const last = out[out.length - 1];
    if (last && rows[last.index]!.location === r.location) last.span += 1;
    else out.push({ location: r.location, span: 1, index: i });
  });
  return out;
}

export function ConsumptionCalculator() {
  const [input, setInput] = useState<ConsumptionInput>(defaultConsumptionInput);
  const result = useMemo(() => computeConsumption(input), [input]);

  const setAc = (i: number, patch: Partial<ConsumptionInput["ac"][number]>) =>
    setInput((s) => ({ ...s, ac: s.ac.map((r, k) => (k === i ? { ...r, ...patch } : r)) }));
  const setApp = (i: number, patch: Partial<ConsumptionInput["appliances"][number]>) =>
    setInput((s) => ({ ...s, appliances: s.appliances.map((r, k) => (k === i ? { ...r, ...patch } : r)) }));
  const setLight = (i: number, patch: Partial<ConsumptionInput["lighting"][number]>) =>
    setInput((s) => ({ ...s, lighting: s.lighting.map((r, k) => (k === i ? { ...r, ...patch } : r)) }));

  const appGroups = groupRows(input.appliances);
  const lightGroups = groupRows(input.lighting);
  const monthly = Math.round(result.monthlyTotal * 100) / 100;

  return (
    <main className="shell section operations-main projects-page" id="main-content" tabIndex={-1}>
      <PageHeader
        title="Calculadora de consumo"
        description="Para casas en construcción, donde todavía no hay recibo de CFE. Estima el consumo sumando aire acondicionado, electrodomésticos e iluminación, con las mismas fórmulas del libro. El total mensual se puede llevar a una cotización residencial."
      >
        <Link className="projects-button" href={"/operacion/proyectos" as Route}>Volver al cotizador</Link>
      </PageHeader>

      <div className="cons-summary">
        <div className="cons-total">
          <span>Total por día</span>
          <strong>{n(result.dailyTotal, 2)} <small>kWh</small></strong>
        </div>
        <div className="cons-total is-main">
          <span>Total por mes</span>
          <strong>{n(result.monthlyTotal, 2)} <small>kWh</small></strong>
        </div>
        <div className="cons-cta">
          <Link className="projects-button" href={`/operacion/proyectos/cotizar?segmento=RESIDENTIAL&consumo=${monthly}` as Route}>
            Usar en una cotización residencial
          </Link>
          <p className="projects-help">Llena los 12 periodos del historial con este consumo mensual, como hacía el botón del Excel.</p>
        </div>
      </div>

      <Panel title="Equipos de aire acondicionado" description="1 tonelada = 12,000 BTU. SEER es la eficiencia del equipo. Los meses de uso son los que se ocupa al año, para enfriar o calentar.">
        <div className="projects-table-wrap">
          <table className="projects-table cons-table">
            <thead>
              <tr>
                <th>Ubicación</th><th>Tipo</th><th className="num">Cantidad</th><th className="num">BTU</th><th className="num">SEER</th>
                <th className="num">Horas a la semana</th><th className="num">Meses de uso</th>
                <th className="num is-calc">Horas por día</th><th className="num is-calc">kWh/día</th><th className="num is-calc">kWh/mes</th>
              </tr>
            </thead>
            <tbody>
              {input.ac.map((r, i) => {
                const c = result.ac[i]!;
                return (
                  <tr key={`${r.location}-${i}`}>
                    <td>{r.location}</td>
                    <td>{r.kind}</td>
                    <td className="num"><Num label={`Cantidad ${r.location}`} onChange={(v) => setAc(i, { quantity: v })} value={r.quantity} /></td>
                    <td className="num"><Num label={`BTU ${r.location}`} onChange={(v) => setAc(i, { btu: v })} step={1000} value={r.btu} /></td>
                    <td className="num"><Num label={`SEER ${r.location}`} onChange={(v) => setAc(i, { seer: v })} value={r.seer} /></td>
                    <td className="num"><Num label={`Horas a la semana ${r.location}`} onChange={(v) => setAc(i, { hoursPerWeek: v })} step={0.5} value={r.hoursPerWeek} /></td>
                    <td className="num"><Num label={`Meses de uso ${r.location}`} onChange={(v) => setAc(i, { monthsOfUse: v })} value={r.monthsOfUse} /></td>
                    <td className="num is-calc">{n(c.hoursPerDay, 1)}</td>
                    <td className="num is-calc">{n(c.kwhDay, 1)}</td>
                    <td className="num is-calc">{n(c.kwhMonth, 1)}</td>
                  </tr>
                );
              })}
              <tr className="cons-total-row">
                <td colSpan={9}>Total kWh/mes</td>
                <td className="num is-calc">{n(result.acMonthlyTotal, 1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Electrodomésticos" description="Las horas a la semana son las que el aparato realmente trabaja, no las que está conectado.">
        <div className="projects-table-wrap">
          <table className="projects-table cons-table">
            <thead>
              <tr><th>Ubicación</th><th>Tipo</th><th className="num">Cantidad</th><th className="num">Horas a la semana</th><th className="num">kW</th><th className="num is-calc">kWh/día</th></tr>
            </thead>
            <tbody>
              {input.appliances.map((r, i) => {
                const g = appGroups.find((x) => x.index === i);
                return (
                  <tr key={`${r.kind}-${i}`}>
                    {g ? <td className="cons-group" rowSpan={g.span}>{g.location}</td> : null}
                    <td>{r.kind}</td>
                    <td className="num"><Num label={`Cantidad ${r.kind}`} onChange={(v) => setApp(i, { quantity: v })} value={r.quantity} /></td>
                    <td className="num"><Num label={`Horas ${r.kind}`} onChange={(v) => setApp(i, { hoursPerWeek: v })} step={0.5} value={r.hoursPerWeek} /></td>
                    <td className="num"><Num label={`kW ${r.kind}`} onChange={(v) => setApp(i, { kw: v })} step={0.05} value={r.kw} /></td>
                    <td className="num is-calc">{n(result.appliances[i] ?? 0, 2)}</td>
                  </tr>
                );
              })}
              <tr className="cons-total-row"><td colSpan={5}>Total kWh/día</td><td className="num is-calc">{n(result.applianceDailyTotal, 2)}</td></tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Iluminación" description="Por zona y por tipo de foco. Los watts vienen del tipo: incandescente 100, ahorrador 11, LED 7.">
        <div className="projects-table-wrap">
          <table className="projects-table cons-table">
            <thead>
              <tr><th>Ubicación</th><th>Tipo</th><th className="num">Cantidad</th><th className="num">Horas a la semana</th><th className="num">Watts</th><th className="num is-calc">kWh/día</th></tr>
            </thead>
            <tbody>
              {input.lighting.map((r, i) => {
                const g = lightGroups.find((x) => x.index === i);
                return (
                  <tr key={`${r.location}-${r.kind}-${i}`}>
                    {g ? <td className="cons-group" rowSpan={g.span}>{g.location}</td> : null}
                    <td>{r.kind}</td>
                    <td className="num"><Num label={`Cantidad ${r.location} ${r.kind}`} onChange={(v) => setLight(i, { quantity: v })} value={r.quantity} /></td>
                    <td className="num"><Num label={`Horas ${r.location} ${r.kind}`} onChange={(v) => setLight(i, { hoursPerWeek: v })} value={r.hoursPerWeek} /></td>
                    <td className="num"><Num label={`Watts ${r.location} ${r.kind}`} onChange={(v) => setLight(i, { watts: v })} value={r.watts} /></td>
                    <td className="num is-calc">{n(result.lighting[i] ?? 0, 3)}</td>
                  </tr>
                );
              })}
              <tr className="cons-total-row"><td colSpan={5}>Total kWh/día</td><td className="num is-calc">{n(result.lightingDailyTotal, 3)}</td></tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="projects-help cons-foot">
        El total por día suma el aire acondicionado prorrateado al mes ({n(result.acMonthlyTotal, 1)} ÷ 30), los electrodomésticos ({n(result.applianceDailyTotal, 2)}) y la iluminación ({n(result.lightingDailyTotal, 3)}). El total por mes son 30 días. Acomoda las cantidades y las horas a la casa que estás cotizando.
        {" "}<button className="cons-reset" onClick={() => setInput(defaultConsumptionInput())} type="button">Volver a los valores del libro</button>
      </p>
    </main>
  );
}
