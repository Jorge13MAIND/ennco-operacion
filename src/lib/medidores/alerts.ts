import { resolveThresholds, SEVERITY_RANK, type Rule, type Severity, type Thresholds } from "@/lib/medidores/model";

/**
 * Motor de alertas de los medidores (16-oct). Jorge en la junta #11: "hay alertas que son irrelevantes y
 * hay alertas que son urgentes; eso es lo que tenemos que parametrizar". Por eso cada regla tiene umbral,
 * tiempo sostenido y nivel, y "urgente" queda para lo que pide que alguien actúe hoy (corte, hueco
 * profundo, demanda arriba de lo contratado, inversor en falla, medidor sin datos). Lo crónico (factor
 * de potencia, desbalance) es "atención" o "informativa": cuesta dinero, no es emergencia.
 *
 * Es una función pura: recibe las lecturas de una ventana (como las devuelve EVAL_READ) y regresa los
 * eventos. Lecturas dudosas (frecuencia mínima de 50 Hz o THD de tensión arriba de 50 %, imposibles en
 * la red de México) no disparan nada: son artefactos del analizador.
 */
export type EvalReading = {
  ts: string;
  v_l1?: number | null; v_l2?: number | null; v_l3?: number | null; v_ln_min?: number | null; v_ln_max?: number | null;
  i_avg?: number | null; i_l1?: number | null; i_l2?: number | null; i_l3?: number | null;
  freq?: number | null; freq_min?: number | null;
  p_import_kw?: number | null; p_import_l1?: number | null; p_import_l2?: number | null; p_import_l3?: number | null; p_import_max_kw?: number | null;
  p_export_kw?: number | null; p_export_l1?: number | null; p_export_l2?: number | null; p_export_l3?: number | null;
  pf?: number | null; pf_l1?: number | null; pf_l2?: number | null; pf_l3?: number | null;
  thd_v_max?: number | null; thd_i_max?: number | null; pv_kw?: number | null; pv_kwh_today?: number | null;
  inverter_status?: string | null;
};

export type EvalContext = {
  meter: { kind: "ANALIZADOR" | "INVERSOR"; nominal_v_ln: number; interval_minutes: number | null; thresholds: unknown; name?: string };
  site: { timezone: string; work_days: number[]; work_start: string; work_end: string; contracted_demand_kw: number | null; paro_cost_mxn_h: number | null };
  readings: EvalReading[];
  history?: Array<{ d: string; h: number; imp: number | null; pv: number | null }>;
  lastReadingAt?: string | null;
  openEvents?: Array<{ rule: string; started_at: string }>;
};

export type AlertEvent = {
  rule: Rule; severity: Severity; started_at: string; ended_at: string | null;
  value: number | null; threshold: number | null; unit: string | null; message: string; detail: Record<string, unknown>;
};

/** Reglas que evalúa esta función (SIN_DATOS la arma el cron con staleEvent). */
export const EVALUATED_RULES: Rule[] = [
  "FP_BAJO", "TENSION_FUERA", "HUECO_TENSION", "CORTE", "DESBALANCE", "THD_TENSION", "THD_CORRIENTE", "FRECUENCIA",
  "DEMANDA", "EXPORTACION_NOCHE", "DIA_EXPORTADOR", "PARO", "CONSUMO_ATIPICO", "INVERSOR_FALLA", "GENERACION_BAJA",
];

type Local = { date: string; hour: number; minute: number; isodow: number };
const formatters = new Map<string, Intl.DateTimeFormat>();
export function localParts(iso: string, timeZone: string): Local {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false });
    formatters.set(timeZone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  const isodow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday ?? "") + 1;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, minute: Number(parts.minute), isodow };
}

const n = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const avg = (values: Array<number | null | undefined>) => { const xs = values.filter(n); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
const median = (values: number[]) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const percentile = (values: number[], p: number) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };
const round = (v: number, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits;
const maxSeverity = (a: Severity, b: Severity) => (SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b);

export function isDubious(r: EvalReading): boolean {
  return (n(r.freq_min) && r.freq_min <= 50.5) || (n(r.thd_v_max) && r.thd_v_max > 50);
}
export function unbalancePct(r: EvalReading): number | null {
  if (!n(r.i_l1) || !n(r.i_l2) || !n(r.i_l3)) return null;
  const mean = (r.i_l1 + r.i_l2 + r.i_l3) / 3;
  if (mean <= 5) return null;
  return Math.max(Math.abs(r.i_l1 - mean), Math.abs(r.i_l2 - mean), Math.abs(r.i_l3 - mean)) / mean * 100;
}
/** FP de las fases que están consumiendo (el "III" del Circutor mezcla fases que exportan). */
export function effectivePf(r: EvalReading): number | null {
  const pairs: Array<[number | null | undefined, number | null | undefined]> = [[r.pf_l1, r.p_import_l1], [r.pf_l2, r.p_import_l2], [r.pf_l3, r.p_import_l3]];
  const used = pairs.filter(([pf, p]) => n(pf) && pf !== 0 && n(p) && p > 0.5).map(([pf]) => Math.abs(pf as number));
  if (used.length) return used.reduce((a, b) => a + b, 0) / used.length;
  return n(r.pf) && r.pf !== 0 && n(r.p_import_kw) && r.p_import_kw > 0.5 ? Math.abs(r.pf) : null;
}
const phaseVolts = (r: EvalReading) => [r.v_l1, r.v_l2, r.v_l3];

export function durationText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rest = m % 60;
  if (h < 48) return rest ? `${h} h ${rest} min` : `${h} h`;
  return `${round(h / 24, 1)} días`;
}
function clock(iso: string, timeZone: string) {
  const l = localParts(iso, timeZone);
  return `${String(l.hour).padStart(2, "0")}:${String(l.minute).padStart(2, "0")}`;
}
function dayLabel(date: string) {
  return new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00Z`));
}

type Hit = { severity: Severity; value: number; detail?: Record<string, unknown> };

export function evaluateAlerts(ctx: EvalContext): AlertEvent[] {
  const th: Thresholds = resolveThresholds(ctx.meter.thresholds);
  const tz = ctx.site.timezone;
  const readings = [...ctx.readings].sort((a, b) => a.ts.localeCompare(b.ts));
  if (!readings.length) return [];
  const times = readings.map((r) => Date.parse(r.ts));
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) gaps.push((times[i]! - times[i - 1]!) / 60000);
  const intervalMin = ctx.meter.interval_minutes ?? median(gaps) ?? 10;
  const intervalMs = intervalMin * 60000;
  const lastTs = Date.parse(ctx.lastReadingAt ?? readings.at(-1)!.ts);
  const nominal = ctx.meter.nominal_v_ln;
  const events: AlertEvent[] = [];
  const locals = readings.map((r) => localParts(r.ts, tz));

  /** Agrupa lecturas seguidas que cumplen la condición; descarta las que no duran lo mínimo. */
  const runs = (rule: Rule, test: (r: EvalReading, i: number) => Hit | null, minMinutes: number, worst: "max" | "min",
    build: (g: { start: number; end: number; severity: Severity; value: number; minutes: number; ongoing: boolean; first: EvalReading; detail: Record<string, unknown> }) => Omit<AlertEvent, "rule" | "severity" | "started_at" | "ended_at">) => {
    let group: { start: number; end: number; severity: Severity; value: number; detail: Record<string, unknown> } | null = null;
    const close = () => {
      if (!group) return;
      const minutes = (times[group.end]! - times[group.start]!) / 60000 + intervalMin;
      if (minutes >= minMinutes) {
        const ongoing = times[group.end]! >= lastTs - 1;
        const body = build({ ...group, minutes, ongoing, first: readings[group.start]! });
        events.push({ rule, severity: group.severity, started_at: readings[group.start]!.ts,
          ended_at: ongoing ? null : new Date(times[group.end]! + intervalMs).toISOString(), ...body });
      }
      group = null;
    };
    readings.forEach((r, i) => {
      const hit = test(r, i);
      if (group && (!hit || times[i]! - times[group.end]! > intervalMs * 2.5)) close();
      if (!hit) return;
      if (!group) group = { start: i, end: i, severity: hit.severity, value: hit.value, detail: hit.detail ?? {} };
      else {
        group.end = i;
        group.severity = maxSeverity(group.severity, hit.severity);
        const better = worst === "max" ? hit.value > group.value : hit.value < group.value;
        if (better) { group.value = hit.value; group.detail = hit.detail ?? group.detail; }
      }
    });
    close();
  };

  const sustained = Math.max(th.minutos_sostenido, intervalMin);
  const iValues = readings.map((r) => r.i_avg).filter(n);
  const iP95 = percentile(iValues, 0.95) ?? 0;

  if (ctx.meter.kind === "ANALIZADOR") {
    // Corte: las tres fases sin tensión.
    runs("CORTE", (r) => {
      const v = avg(phaseVolts(r));
      return v !== null && v < nominal * 0.2 ? { severity: "URGENTE", value: v } : null;
    }, 0, "min", (g) => ({ value: round(g.value), threshold: round(nominal * 0.2), unit: "V",
      message: `Corte de energía desde las ${clock(g.first.ts, tz)} (${durationText(g.minutes)}${g.ongoing ? ", sigue" : ""}).`, detail: { minutes: Math.round(g.minutes) } }));

    // Hueco: la tensión mínima del intervalo cae debajo del umbral (una lectura basta).
    runs("HUECO_TENSION", (r) => {
      if (!n(r.v_ln_min) || isDubious(r)) return null;
      const v = avg(phaseVolts(r));
      if (v !== null && v < nominal * 0.2) return null; // eso es un corte
      const limit = nominal * (1 - th.hueco_pct / 100);
      if (r.v_ln_min >= limit) return null;
      return { severity: r.v_ln_min < nominal * 0.7 ? "URGENTE" : "ATENCION", value: r.v_ln_min };
    }, 0, "min", (g) => ({ value: round(g.value), threshold: round(nominal * (1 - th.hueco_pct / 100)), unit: "V",
      message: `Hueco de tensión: bajó a ${round(g.value)} V (${round((g.value / nominal) * 100, 0)} % de ${nominal} V) a las ${clock(g.first.ts, tz)}. Revisar arranques de motores grandes o fallas en la red.`,
      detail: { minutes: Math.round(g.minutes) } }));

    // Tensión fuera de rango, sostenida (promedio de cada fase contra la nominal).
    runs("TENSION_FUERA", (r) => {
      if (isDubious(r)) return null;
      const phases = phaseVolts(r).map((v, k) => ({ v, k })).filter((x): x is { v: number; k: number } => n(x.v) && x.v > nominal * 0.2);
      if (!phases.length) return null;
      const worst = phases.reduce((a, b) => (Math.abs(b.v - nominal) > Math.abs(a.v - nominal) ? b : a));
      const dev = (worst.v - nominal) / nominal * 100;
      const sev: Severity | null = Math.abs(dev) >= th.tension_urgente_pct ? "URGENTE" : Math.abs(dev) >= th.tension_atencion_pct ? "ATENCION" : null;
      return sev ? { severity: sev, value: Math.abs(dev), detail: { volts: round(worst.v), phase: `L${worst.k + 1}`, deviation_pct: round(dev) } } : null;
    }, sustained, "max", (g) => {
      const d = g.detail as { volts: number; phase: string; deviation_pct: number };
      return { value: d.volts, threshold: round(nominal * (1 + Math.sign(d.deviation_pct) * th.tension_atencion_pct / 100)), unit: "V",
        message: `Tensión ${d.deviation_pct > 0 ? "alta" : "baja"}: ${d.volts} V en ${d.phase} (${d.deviation_pct > 0 ? "+" : ""}${d.deviation_pct} % sobre ${nominal} V) durante ${durationText(g.minutes)}${g.ongoing ? " y sigue" : ""}.`,
        detail: { ...d, minutes: Math.round(g.minutes) } };
    });

    // Desbalance de corriente con carga (debajo del 10 % de la corriente típica no se mide).
    runs("DESBALANCE", (r) => {
      if (!n(r.i_avg) || r.i_avg < iP95 * 0.1) return null;
      const u = unbalancePct(r);
      if (u === null) return null;
      const sev: Severity | null = u >= th.desbalance_urgente_pct ? "URGENTE" : u >= th.desbalance_atencion_pct ? "ATENCION" : null;
      return sev ? { severity: sev, value: u } : null;
    }, Math.max(60, sustained), "max", (g) => ({ value: round(g.value), threshold: th.desbalance_atencion_pct, unit: "%",
      message: `Desbalance de corriente de hasta ${round(g.value)} % entre fases durante ${durationText(g.minutes)}. Conviene repartir cargas monofásicas entre las fases.`,
      detail: { minutes: Math.round(g.minutes) } }));

    // Distorsión de tensión.
    runs("THD_TENSION", (r) => {
      if (!n(r.thd_v_max) || isDubious(r)) return null;
      const sev: Severity | null = r.thd_v_max >= th.thd_v_urgente ? "URGENTE" : r.thd_v_max >= th.thd_v_atencion ? "ATENCION" : null;
      return sev ? { severity: sev, value: r.thd_v_max } : null;
    }, sustained, "max", (g) => ({ value: round(g.value, 2), threshold: th.thd_v_atencion, unit: "%",
      message: `Distorsión de tensión de ${round(g.value, 2)} % (límite ${th.thd_v_urgente} % en baja tensión) durante ${durationText(g.minutes)}.`,
      detail: { minutes: Math.round(g.minutes) } }));

    // Distorsión de corriente, solo con carga alta (con poca carga el porcentaje se dispara y no importa).
    runs("THD_CORRIENTE", (r) => {
      if (!n(r.thd_i_max) || !n(r.i_avg) || iP95 <= 0 || r.i_avg < iP95 * 0.5) return null;
      return r.thd_i_max >= th.thd_i_atencion ? { severity: "ATENCION", value: r.thd_i_max } : null;
    }, Math.max(60, sustained), "max", (g) => ({ value: round(g.value), threshold: th.thd_i_atencion, unit: "%",
      message: `Distorsión de corriente de hasta ${round(g.value)} % con la planta trabajando, durante ${durationText(g.minutes)}. Revisar variadores, cargas electrónicas o filtros.`,
      detail: { minutes: Math.round(g.minutes) } }));

    // Frecuencia promedio (la mínima instantánea del analizador trae artefactos de 50 Hz).
    runs("FRECUENCIA", (r) => {
      if (!n(r.freq) || r.freq < 40) return null;
      const dev = Math.abs(r.freq - 60);
      const sev: Severity | null = dev >= th.frecuencia_tolerancia_hz * 2.5 ? "URGENTE" : dev >= th.frecuencia_tolerancia_hz ? "ATENCION" : null;
      return sev ? { severity: sev, value: r.freq } : null;
    }, sustained, "max", (g) => ({ value: round(g.value, 2), threshold: 60, unit: "Hz",
      message: `Frecuencia de ${round(g.value, 2)} Hz durante ${durationText(g.minutes)}.`, detail: { minutes: Math.round(g.minutes) } }));

    // Exportación de noche: sin sol no hay generación; casi siempre es un TC al revés o fases cruzadas.
    runs("EXPORTACION_NOCHE", (r, i) => {
      const hour = locals[i]!.hour;
      if (hour >= 6 && hour < 20) return null;
      const phases = [r.p_export_l1, r.p_export_l2, r.p_export_l3].map((v, k) => ({ v, k })).filter((x): x is { v: number; k: number } => n(x.v));
      const worst = phases.length ? phases.reduce((a, b) => (b.v > a.v ? b : a)) : null;
      const total = n(r.p_export_kw) ? r.p_export_kw : 0;
      const value = Math.max(worst?.v ?? 0, total);
      return value >= th.exportacion_noche_kw ? { severity: "ATENCION", value, detail: { phase: worst && worst.v >= total ? `L${worst.k + 1}` : "total" } } : null;
    }, intervalMin * 2, "max", (g) => ({ value: round(g.value), threshold: th.exportacion_noche_kw, unit: "kW",
      message: `De noche marcó exportación de ${round(g.value)} kW (${String(g.detail.phase)}) desde las ${clock(g.first.ts, tz)}, por ${durationText(g.minutes)}. Sin sol no hay generación: revisar la polaridad de los TC o el orden de fases del analizador.`,
      detail: { ...g.detail, minutes: Math.round(g.minutes) } }));
  }

  // Demanda contra lo contratado.
  const contracted = ctx.site.contracted_demand_kw;
  if (contracted && contracted > 0) {
    runs("DEMANDA", (r) => {
      const kw = n(r.p_import_max_kw) ? r.p_import_max_kw : r.p_import_kw;
      if (!n(kw)) return null;
      return kw > contracted ? { severity: "URGENTE", value: kw } : kw > contracted * 0.9 ? { severity: "ATENCION", value: kw } : null;
    }, 0, "max", (g) => ({ value: round(g.value), threshold: contracted, unit: "kW",
      message: `Demanda de ${round(g.value)} kW contra ${contracted} kW contratados, a las ${clock(g.first.ts, tz)}.`, detail: { minutes: Math.round(g.minutes) } }));
  }

  // Por día local: factor de potencia, días exportadores y (para inversores) generación.
  const days = new Map<string, { first: number; last: number; imp: number; exp: number; pfw: number; pfe: number; pv: number; pvMax: number | null; lastHour: number }>();
  readings.forEach((r, i) => {
    const l = locals[i]!;
    const nextGap = i + 1 < readings.length ? Math.min((times[i + 1]! - times[i]!) / 3600000, intervalMin * 2 / 60) : intervalMin / 60;
    const d = days.get(l.date) ?? { first: i, last: i, imp: 0, exp: 0, pfw: 0, pfe: 0, pv: 0, pvMax: null, lastHour: l.hour };
    d.last = i; d.lastHour = l.hour;
    const imp = n(r.p_import_kw) ? r.p_import_kw * nextGap : 0;
    d.imp += imp;
    d.exp += n(r.p_export_kw) ? r.p_export_kw * nextGap : 0;
    d.pv += n(r.pv_kw) ? r.pv_kw * nextGap : 0;
    if (n(r.pv_kwh_today)) d.pvMax = Math.max(d.pvMax ?? 0, r.pv_kwh_today);
    const pf = effectivePf(r);
    if (pf !== null && imp > 0) { d.pfw += pf * imp; d.pfe += imp; }
    days.set(l.date, d);
  });
  const dayEvent = (date: string, d: { first: number; last: number }): Pick<AlertEvent, "started_at" | "ended_at"> => ({
    started_at: readings[d.first]!.ts, ended_at: new Date(times[d.last]! + intervalMs).toISOString(),
  });

  if (ctx.meter.kind === "ANALIZADOR") {
    for (const [date, d] of days) {
      if (d.pfe >= 5) {
        const pf = d.pfw / d.pfe;
        if (pf < th.pf_atencion) {
          const severity: Severity = pf < th.pf_urgente ? "ATENCION" : "INFO";
          events.push({ rule: "FP_BAJO", severity, ...dayEvent(date, d), value: round(pf, 3), threshold: th.pf_atencion, unit: "",
            message: `Factor de potencia del ${dayLabel(date)}: ${round(pf, 2)}. ${pf < th.pf_urgente ? `Debajo de ${th.pf_urgente.toFixed(2)} CFE cobra recargo, y el Código de Red pide ${th.pf_atencion.toFixed(2)}` : `Debajo del ${th.pf_atencion.toFixed(2)} que pide el Código de Red`}. Candidato a banco de capacitores.`,
            detail: { import_kwh: round(d.imp) } });
        }
      }
      if (d.exp >= 5 && d.exp > d.imp) {
        events.push({ rule: "DIA_EXPORTADOR", severity: "INFO", ...dayEvent(date, d), value: round(d.exp), threshold: round(d.imp), unit: "kWh",
          message: `El ${dayLabel(date)} envió ${round(d.exp, 0)} kWh a la red y tomó ${round(d.imp, 0)} kWh: lo que generaron los paneles se fue a la red.`,
          detail: { export_kwh: round(d.exp), import_kwh: round(d.imp) } });
      }
    }

    // Paro: en días y horas de trabajo, el consumo de la red cae muy por debajo de lo normal sin que la
    // planta esté exportando (si exporta, la baja es generación solar, no un paro).
    const [ws, we] = [ctx.site.work_start, ctx.site.work_end].map((t) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); });
    const atWork = (i: number) => { const l = locals[i]!; const mins = l.hour * 60 + l.minute; return ctx.site.work_days.includes(l.isodow) && mins >= ws! && mins < we!; };
    const workImport = readings.map((r, i) => (atWork(i) && n(r.p_import_kw) ? r.p_import_kw : null)).filter(n);
    const typical = median(workImport);
    if (typical !== null && typical >= 5) {
      const limit = typical * th.paro_pct / 100;
      runs("PARO", (r, i) => {
        if (!atWork(i) || !n(r.p_import_kw)) return null;
        const v = avg(phaseVolts(r));
        if (v !== null && v < nominal * 0.2) return null; // corte, no paro
        if (n(r.p_export_kw) && r.p_export_kw > 0.5) return null;
        return r.p_import_kw < limit ? { severity: "ATENCION", value: r.p_import_kw } : null;
      }, th.paro_min_minutos, "min", (g) => {
        const cost = ctx.site.paro_cost_mxn_h ? Math.round(ctx.site.paro_cost_mxn_h * g.minutes / 60) : null;
        return { value: round(g.value), threshold: round(limit), unit: "kW",
          message: `Posible paro desde las ${clock(g.first.ts, tz)}: el consumo bajó a ${round(g.value)} kW (lo normal en horario de trabajo es ${round(typical)} kW) durante ${durationText(g.minutes)}${cost ? `; a ${new Intl.NumberFormat("es-MX").format(ctx.site.paro_cost_mxn_h!)} pesos por hora son unos ${new Intl.NumberFormat("es-MX").format(cost)} pesos` : ""}. Si la planta tiene paneles, una baja a mediodía puede ser generación solar.`,
          detail: { minutes: Math.round(g.minutes), typical_kw: round(typical), cost_mxn: cost } };
      });
    }

    // Consumo atípico por hora (mantenimiento preventivo): contra la misma hora de días del mismo tipo.
    const hourly = new Map<string, { date: string; hour: number; kwh: number; first: number; last: number; work: boolean }>();
    readings.forEach((r, i) => {
      const l = locals[i]!;
      const key = `${l.date}|${l.hour}`;
      const step = i + 1 < readings.length ? Math.min((times[i + 1]! - times[i]!) / 3600000, intervalMin * 2 / 60) : intervalMin / 60;
      const h = hourly.get(key) ?? { date: l.date, hour: l.hour, kwh: 0, first: i, last: i, work: ctx.site.work_days.includes(l.isodow) };
      h.kwh += n(r.p_import_kw) ? r.p_import_kw * step : 0; h.last = i;
      hourly.set(key, h);
    });
    const isWorkDate = (date: string) => ctx.site.work_days.includes((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7 + 1);
    const samples = new Map<string, Array<{ date: string; kwh: number }>>();
    const addSample = (work: boolean, hour: number, date: string, kwh: number) => {
      const key = `${work}|${hour}`;
      const list = samples.get(key) ?? []; list.push({ date, kwh }); samples.set(key, list);
    };
    for (const h of hourly.values()) addSample(h.work, h.hour, h.date, h.kwh);
    for (const h of ctx.history ?? []) if (n(h.imp)) addSample(isWorkDate(h.d), h.h, h.d, h.imp);
    let prev: { hour: AlertEvent; endIndex: number } | null = null;
    for (const h of [...hourly.values()].sort((a, b) => a.first - b.first)) {
      const others = (samples.get(`${h.work}|${h.hour}`) ?? []).filter((s) => s.date !== h.date).map((s) => s.kwh);
      const base = others.length >= 3 ? median(others) : null;
      const hit = base !== null && h.kwh > Math.max(base, 0.1) * th.atipico_factor && h.kwh - base >= th.atipico_min_kwh;
      if (!hit) { prev = null; continue; }
      const message = `Consumo fuera de su patrón: ${round(h.kwh)} kWh entre las ${String(h.hour).padStart(2, "0")}:00 y las ${String((h.hour + 1) % 24).padStart(2, "0")}:00 del ${dayLabel(h.date)}, contra ${round(base!)} kWh normales a esa hora. Si es una máquina, revisar que no esté forzada.`;
      if (prev && h.first === prev.endIndex + 1) {
        prev.hour.ended_at = new Date(times[h.last]! + intervalMs).toISOString();
        prev.hour.value = Math.max(prev.hour.value ?? 0, round(h.kwh));
        prev.hour.detail = { ...prev.hour.detail, hours: Number(prev.hour.detail.hours ?? 1) + 1 };
        prev.endIndex = h.last;
        continue;
      }
      const ev: AlertEvent = { rule: "CONSUMO_ATIPICO", severity: "ATENCION", started_at: readings[h.first]!.ts,
        ended_at: new Date(times[h.last]! + intervalMs).toISOString(), value: round(h.kwh), threshold: round(base! * th.atipico_factor), unit: "kWh",
        message, detail: { baseline_kwh: round(base!), hours: 1 } };
      events.push(ev);
      prev = { hour: ev, endIndex: h.last };
    }
  }

  if (ctx.meter.kind === "INVERSOR") {
    runs("INVERSOR_FALLA", (r) => (r.inverter_status && /^(FALLA|FAULT|ERROR|3)$/i.test(r.inverter_status) ? { severity: "URGENTE", value: 1 } : null),
      0, "max", (g) => ({ value: null, threshold: null, unit: null,
        message: `El inversor reporta falla desde las ${clock(g.first.ts, tz)}${g.ongoing ? " y sigue" : ` (${durationText(g.minutes)})`}.`, detail: { minutes: Math.round(g.minutes) } }));
    const dailyPv = new Map<string, number>();
    for (const h of ctx.history ?? []) if (n(h.pv)) dailyPv.set(h.d, Math.max(dailyPv.get(h.d) ?? 0, h.pv));
    for (const [date, d] of days) {
      const pv = d.pvMax ?? d.pv;
      dailyPv.set(date, pv);
    }
    const ordered = [...dailyPv.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [date, d] of days) {
      if (d.lastHour < 19) continue; // el día no ha terminado
      const before = ordered.filter(([x]) => x < date).slice(-7).map(([, v]) => v).filter((v) => v > 0);
      const base = before.length >= 3 ? median(before) : null;
      const pv = d.pvMax ?? d.pv;
      if (base !== null && pv < base * th.generacion_baja_pct / 100) {
        events.push({ rule: "GENERACION_BAJA", severity: "ATENCION", ...dayEvent(date, d), value: round(pv), threshold: round(base * th.generacion_baja_pct / 100), unit: "kWh",
          message: `El ${dayLabel(date)} generó ${round(pv, 0)} kWh, contra ${round(base, 0)} kWh de mediana en los días anteriores. Si no fue un día nublado, revisar inversor, strings y limpieza de paneles.`,
          detail: { median_kwh: round(base) } });
      }
    }
  }

  // La tensión alta o baja en "atención" es común de noche, con poca carga: solo cuenta si dura una hora.
  for (let k = events.length - 1; k >= 0; k -= 1) {
    const ev = events[k]!;
    if (ev.rule === "TENSION_FUERA" && ev.severity === "ATENCION" && Number(ev.detail.minutes ?? 0) < Math.max(60, sustained)) events.splice(k, 1);
  }

  // Un evento que ya venía abierto antes de la ventana conserva su inicio (para no duplicarlo).
  const firstTs = readings[0]!.ts;
  for (const ev of events) {
    if (ev.started_at !== firstTs) continue;
    const open = ctx.openEvents?.find((o) => o.rule === ev.rule);
    if (open) ev.started_at = open.started_at;
  }
  return events.sort((a, b) => a.started_at.localeCompare(b.started_at));
}

/** Aviso de "sin datos" para un medidor en vivo que dejó de reportar. */
export function staleEvent(meter: { name: string; last_reading_at: string }, timeZone: string, now = new Date()): AlertEvent {
  const minutes = (now.getTime() - Date.parse(meter.last_reading_at)) / 60000;
  return { rule: "SIN_DATOS", severity: "URGENTE", started_at: meter.last_reading_at, ended_at: null, value: Math.round(minutes), threshold: null, unit: "min",
    message: `${meter.name} no manda lecturas desde ${new Intl.DateTimeFormat("es-MX", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(meter.last_reading_at))} (${durationText(minutes)}). Revisar la conexión del equipo.`,
    detail: {} };
}
