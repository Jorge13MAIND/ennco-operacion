import { evaluateAlerts, effectivePf, isDubious, localParts, unbalancePct, type EvalReading } from "@/lib/medidores/alerts";
import type { EnergyAlert, Meter, MeterView, Overview, Reading, Site, SiteCore } from "@/lib/medidores/model";

/**
 * Ejemplo operativo de la pestaña (sin Supabase o fuera de producción): una planta SIMULACION con un
 * analizador en el tablero general, una línea con API y una planta solar de Growatt. Las lecturas se
 * generan con una semilla fija y se agregan aquí igual que lo hace read_energy_meter en la base, para que
 * la pantalla se vea como con datos reales. No contiene datos de ningún cliente.
 */
const SITE_ID = "00000000-0000-4000-8000-00000000e001";
const METERS = {
  general: "00000000-0000-4000-8000-00000000e101",
  linea: "00000000-0000-4000-8000-00000000e102",
  solar: "00000000-0000-4000-8000-00000000e103",
} as const;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const site: SiteCore = {
  id: SITE_ID, client_name: "SIMULACION Lácteos del Bajío", site_name: "Planta León", city: "León", state: "Guanajuato",
  timezone: "America/Mexico_City", price_mxn_kwh: 2.8, contracted_demand_kw: 130, paro_cost_mxn_h: 18000,
  work_days: [1, 2, 3, 4, 5, 6], work_start: "07:00", work_end: "19:00", crm_record_id: null,
  notes: "Ejemplo para mostrar la pantalla.", revision: 1,
};

function baseMeter(id: string, patch: Partial<Meter>): Meter {
  return {
    id, site_id: SITE_ID, name: "", kind: "ANALIZADOR", scope: "GENERAL", source: "ARCHIVO", device_brand: "Circutor",
    device_model: "MYeBOX 1500", device_serial: null, nominal_v_ln: 127, interval_minutes: 10, thresholds: {}, has_key: false,
    key_hint: null, key_created_at: null, integration_id: null, external_id: null, active: true, first_reading_at: null,
    last_reading_at: null, readings_count: 0, evaluated_at: null, revision: 1, open_alerts: { URGENTE: 0, ATENCION: 0, INFO: 0 }, ...patch,
  };
}

/** Siete días de lecturas cada 10 min (o 15 para el inversor) que terminan en `end`. */
export function demoReadings(meterId: string, end = new Date()): Reading[] {
  const random = rng(meterId.charCodeAt(meterId.length - 1) * 7919);
  const step = meterId === METERS.solar ? 15 : 10;
  const endMs = Math.floor(end.getTime() / (step * 60000)) * step * 60000;
  const out: Reading[] = [];
  const scale = meterId === METERS.linea ? 0.35 : 1;
  for (let t = endMs - 7 * 86400000; t <= endMs; t += step * 60000) {
    const ts = new Date(t).toISOString();
    const l = localParts(ts, site.timezone);
    const hour = l.hour + l.minute / 60;
    const workday = l.isodow <= 6;
    const sun = Math.max(0, Math.sin(((hour - 7) / 12) * Math.PI));
    const solar = sun * 60 * (l.isodow === 3 ? 0.4 : 1) * (0.9 + random() * 0.2);
    if (meterId === METERS.solar) {
      out.push({ ts, pv_kw: Math.round(solar * 10) / 10, pv_kwh_today: null, inverter_status: hour >= 6.5 && hour <= 19 ? "NORMAL" : "ESPERA" });
      continue;
    }
    const shift = workday && hour >= 7 && hour < 19 ? 1 : 0;
    const paro = l.isodow === 2 && hour >= 10 && hour < 11 ? 0.1 : 1;
    let load = (12 + shift * (48 + 10 * Math.sin(hour)) * paro + random() * 6) * scale;
    if (l.isodow === 4 && hour >= 15 && hour < 16) load *= 1.9; // una máquina forzada el jueves
    const net = meterId === METERS.general ? load - solar * (l.isodow === 7 ? 1.4 : 0.55) : load;
    const imp = Math.max(0, net), exp = Math.max(0, -net);
    const night = hour < 6 || hour >= 22;
    const v = 127 + (night ? 6.5 : 1.5) + (random() - 0.5) * 2;
    const i = (imp + 2) * 1000 / (3 * 127 * 0.82);
    const unb = 0.05 + random() * 0.07;
    const sag = l.isodow === 3 && hour >= 9.2 && hour < 9.4 && meterId === METERS.general;
    out.push({
      ts,
      v_ln: round(v), v_l1: round(v + 0.4), v_l2: round(v - 0.2), v_l3: round(v - 0.6), v_ln_min: round(sag ? 88 : v - 1.5), v_ln_max: round(v + 1.2),
      i_avg: round(i), i_l1: round(i * (1 + unb)), i_l2: round(i), i_l3: round(i * (1 - unb)), i_max: round(i * 1.4),
      freq: round(60 + (random() - 0.5) * 0.04, 2), freq_min: random() < 0.02 ? 50 : 59.95, freq_max: 60.05,
      p_import_kw: round(imp), p_import_l1: round(imp / 3 * (1 + unb)), p_import_l2: round(imp / 3), p_import_l3: round(imp / 3 * (1 - unb)),
      p_import_max_kw: round(imp * 1.3), p_export_kw: round(exp), p_export_l1: round(exp / 3), p_export_l2: round(exp / 3), p_export_l3: round(exp / 3),
      pf: 0.78, pf_l1: round(0.76 + random() * 0.05, 2), pf_l2: round(0.8 + random() * 0.05, 2), pf_l3: round(0.78 + random() * 0.05, 2),
      thd_v_l1: round(2 + random()), thd_v_l2: round(2 + random()), thd_v_l3: round(2 + random()), thd_v_max: round(3 + random()),
      thd_i_l1: round(11 + random() * 6), thd_i_l2: round(11 + random() * 6), thd_i_l3: round(11 + random() * 6), thd_i_max: round(13 + random() * 6),
      harmonics: l.minute % 30 === 0 ? {
        v: Object.fromEntries([3, 5, 7, 11, 13].map((o) => [String(o), [round(2.4 / o * 3), round(2.2 / o * 3), round(2.5 / o * 3)]])),
        i: Object.fromEntries([3, 5, 7, 11, 13].map((o) => [String(o), [round(18 / o * 2), round(16 / o * 2), round(19 / o * 2)]])),
      } : null,
    });
  }
  return out;
}
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

function demoMeters(now: Date): Meter[] {
  const last = (id: string) => demoReadings(id, now).at(-1)!.ts;
  const first = (id: string) => demoReadings(id, now)[0]!.ts;
  return [
    baseMeter(METERS.general, { name: "Tablero general", first_reading_at: first(METERS.general), last_reading_at: last(METERS.general), readings_count: 1009 }),
    baseMeter(METERS.linea, { name: "Línea de envasado", scope: "AREA", source: "API", has_key: true, key_hint: "…9f2a", key_created_at: now.toISOString(),
      first_reading_at: first(METERS.linea), last_reading_at: last(METERS.linea), readings_count: 1009 }),
    baseMeter(METERS.solar, { name: "Planta solar (Growatt)", kind: "INVERSOR", source: "GROWATT", device_brand: "Growatt", device_model: "MAX 60KTL3",
      interval_minutes: 15, external_id: "PLANT", first_reading_at: first(METERS.solar), last_reading_at: last(METERS.solar), readings_count: 673 }),
  ];
}

export function demoOverview(now = new Date()): Overview {
  const meters = demoMeters(now).map((m) => {
    const view = demoMeterView(m.id, now);
    const open = { URGENTE: 0, ATENCION: 0, INFO: 0 };
    for (const a of view?.alerts ?? []) if (a.status === "ABIERTA") open[a.severity] += 1;
    return { ...m, open_alerts: open };
  });
  const s: Site = { ...site, meters, integrations: [] };
  return {
    settings: { telegram_enabled: false, telegram_chats: 1, telegram_min_severity: "URGENTE" },
    sites: [s], storage: { rows: 2691, bytes: 1_200_000, all_rows: 2691 }, generated_at: now.toISOString(),
  };
}

export function demoMeterView(meterId: string, now = new Date(), since?: string | null, until?: string | null): MeterView | null {
  const meter = demoMeters(now).find((m) => m.id === meterId);
  if (!meter) return null;
  const all = demoReadings(meterId, now);
  const t1 = until ?? new Date(Date.parse(all.at(-1)!.ts) + 1000).toISOString();
  const t0 = since ?? all[0]!.ts;
  const readings = all.filter((r) => r.ts >= t0 && r.ts < t1);
  const events = evaluateAlerts({ meter, site, readings: readings as EvalReading[], lastReadingAt: meter.last_reading_at });
  const alerts: EnergyAlert[] = events.map((e, i) => ({
    id: `00000000-0000-4000-8000-${String(900000000000 + i).padStart(12, "0")}`, rule: e.rule, severity: e.severity,
    started_at: e.started_at, ended_at: e.ended_at, value: e.value, threshold: e.threshold, unit: e.unit, message: e.message,
    detail: e.detail, status: "ABIERTA" as const, acknowledged_at: null, note: null, telegram_sent_at: null,
  })).reverse();
  return aggregateView(meter, site, readings, t0, t1, alerts);
}

/** Espejo en TypeScript de read_energy_meter (migración 113), para el ejemplo y las pruebas. */
export function aggregateView(meter: Meter, s: SiteCore, readings: Reading[], since: string, until: string, alerts: EnergyAlert[]): MeterView {
  const nominalMin = meter.interval_minutes ?? 10;
  const rangeMin = (Date.parse(until) - Date.parse(since)) / 60000;
  const stepMin = Math.max(nominalMin, Math.ceil(rangeMin / 720));
  const sorted = [...readings].sort((a, b) => a.ts.localeCompare(b.ts));
  const rows = sorted.map((r, i) => {
    const next = sorted[i + 1];
    const gapMin = next ? (Date.parse(next.ts) - Date.parse(r.ts)) / 60000 : nominalMin;
    const h = Math.min(gapMin, nominalMin * 2) / 60;
    return { r, h, l: localParts(r.ts, s.timezone), pf: effectivePf(r as EvalReading), unb: unbalancePct(r as EvalReading), dubious: isDubious(r as EvalReading) };
  });
  const v = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const sum = (xs: Array<number | null>) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
  const mean = (xs: Array<number | null>) => { const f = xs.filter((x): x is number => x !== null); return f.length ? f.reduce((a, b) => a + b, 0) / f.length : null; };
  const pct = (xs: Array<number | null>, p: number) => { const f = xs.filter((x): x is number => x !== null).sort((a, b) => a - b); if (!f.length) return null; const pos = (f.length - 1) * p; const lo = Math.floor(pos); return f[lo]! + (f[Math.min(lo + 1, f.length - 1)]! - f[lo]!) * (pos - lo); };
  const max = (xs: Array<number | null>) => { const f = xs.filter((x): x is number => x !== null); return f.length ? Math.max(...f) : null; };
  const min = (xs: Array<number | null>) => { const f = xs.filter((x): x is number => x !== null); return f.length ? Math.min(...f) : null; };
  const byMax = (key: (x: (typeof rows)[number]) => number | null) => rows.reduce<(typeof rows)[number] | null>((best, x) => (key(x) !== null && (best === null || key(x)! > key(best)!) ? x : best), null);

  const imp = sum(rows.map((x) => (v(x.r.p_import_kw) ?? 0) * x.h));
  const exp = sum(rows.map((x) => (v(x.r.p_export_kw) ?? 0) * x.h));
  const pfw = rows.filter((x) => x.pf !== null);
  const pfAvg = pfw.length ? sum(pfw.map((x) => x.pf! * (v(x.r.p_import_kw) ?? 0) * x.h)) / (sum(pfw.map((x) => (v(x.r.p_import_kw) ?? 0) * x.h)) || NaN) : null;
  const iP95 = pct(rows.map((x) => v(x.r.i_avg)), 0.95) ?? 0;
  const peak = byMax((x) => v(x.r.p_import_max_kw) ?? v(x.r.p_import_kw));
  const peakExp = byMax((x) => v(x.r.p_export_max_kw) ?? v(x.r.p_export_kw));
  const clean = rows.filter((x) => !x.dubious);
  const vMinRow = clean.reduce<(typeof rows)[number] | null>((best, x) => (v(x.r.v_ln_min) !== null && (best === null || x.r.v_ln_min! < best.r.v_ln_min!) ? x : best), null);
  const pfCounted = rows.filter((x) => x.pf !== null && (v(x.r.p_import_kw) ?? 0) > 1);

  const days = new Map<string, typeof rows>();
  const heat = new Map<string, typeof rows>();
  const buckets = new Map<number, typeof rows>();
  for (const x of rows) {
    days.set(x.l.date, [...(days.get(x.l.date) ?? []), x]);
    heat.set(`${x.l.date}|${x.l.hour}`, [...(heat.get(`${x.l.date}|${x.l.hour}`) ?? []), x]);
    const b = Date.parse(since) + Math.floor((Date.parse(x.r.ts) - Date.parse(since)) / (stepMin * 60000)) * stepMin * 60000;
    buckets.set(b, [...(buckets.get(b) ?? []), x]);
  }
  const dayPv = (xs: typeof rows) => max(xs.map((x) => v(x.r.pv_kwh_today))) ?? sum(xs.map((x) => (v(x.r.pv_kw) ?? 0) * x.h));
  const daily = [...days.entries()].map(([d, xs]) => {
    const w = xs.filter((x) => x.pf !== null);
    return { d, imp: round(sum(xs.map((x) => (v(x.r.p_import_kw) ?? 0) * x.h))), exp: round(sum(xs.map((x) => (v(x.r.p_export_kw) ?? 0) * x.h))),
      pv: round(dayPv(xs)), peak: max(xs.map((x) => v(x.r.p_import_max_kw) ?? v(x.r.p_import_kw))),
      pf: w.length ? round(sum(w.map((x) => x.pf! * (v(x.r.p_import_kw) ?? 0) * x.h)) / (sum(w.map((x) => (v(x.r.p_import_kw) ?? 0) * x.h)) || NaN), 3) : null, n: xs.length };
  }).map((d) => ({ ...d, pf: Number.isNaN(d.pf as number) ? null : d.pf }));
  const harm = (family: "v" | "i") => {
    const orders = new Map<number, Array<Array<number | null>>>();
    for (const x of rows) for (const [o, arr] of Object.entries(x.r.harmonics?.[family] ?? {})) orders.set(Number(o), [...(orders.get(Number(o)) ?? []), arr]);
    return [...orders.entries()].sort((a, b) => a[0] - b[0]).map(([order, arrs]) => ({
      order, l1: round(pct(arrs.map((a) => a[0] ?? null), 0.95) ?? 0, 2), l2: round(pct(arrs.map((a) => a[1] ?? null), 0.95) ?? 0, 2), l3: round(pct(arrs.map((a) => a[2] ?? null), 0.95) ?? 0, 2),
    }));
  };
  const r1 = (x: number | null) => (x === null || Number.isNaN(x) ? null : round(x));
  const first = rows[0]?.r.ts ?? null, last = rows.at(-1)?.r.ts ?? null;
  return {
    meter, site: s, range: { since, until, step_minutes: stepMin },
    kpis: rows.length ? {
      readings: rows.length, first_ts: first, last_ts: last,
      expected: first && last ? Math.floor((Date.parse(last) - Date.parse(first)) / (nominalMin * 60000)) + 1 : 0,
      import_kwh: round(imp), export_kwh: round(exp), pv_kwh: round(sum(daily.map((d) => d.pv))), cost_mxn: Math.round(imp * s.price_mxn_kwh),
      peak_kw: peak ? r1(v(peak.r.p_import_max_kw) ?? v(peak.r.p_import_kw)) : null, peak_avg_kw: r1(max(rows.map((x) => v(x.r.p_import_kw)))), peak_at: peak?.r.ts ?? null,
      peak_export_kw: peakExp ? r1(v(peakExp.r.p_export_max_kw) ?? v(peakExp.r.p_export_kw)) : null, peak_export_at: peakExp?.r.ts ?? null,
      peak_pv_kw: r1(max(rows.map((x) => v(x.r.pv_kw)))),
      pf_avg: pfAvg === null || Number.isNaN(pfAvg) ? null : round(pfAvg, 3),
      pf_below_share: pfCounted.length ? round(pfCounted.filter((x) => x.pf! < 0.95).length / pfCounted.length, 3) : null,
      v_min: r1(min(clean.map((x) => v(x.r.v_ln_min)))), v_max: r1(max(clean.map((x) => v(x.r.v_ln_max)))), v_avg: r1(mean(rows.map((x) => v(x.r.v_ln)))),
      v_min_at: vMinRow?.r.ts ?? null,
      unbalance_avg: r1(mean(rows.map((x) => x.unb))), unbalance_p95: r1(pct(rows.map((x) => x.unb), 0.95)),
      thd_v_p95: r1(pct(clean.map((x) => v(x.r.thd_v_max)), 0.95)), thd_i_p95: r1(pct(rows.filter((x) => (v(x.r.i_avg) ?? 0) >= 0.3 * iP95 && iP95 > 0).map((x) => v(x.r.thd_i_max)), 0.95)),
      dubious: rows.filter((x) => x.dubious).length, freq_out: rows.filter((x) => v(x.r.freq) !== null && (x.r.freq! < 59.8 || x.r.freq! > 60.2)).length,
      freq_avg: mean(rows.map((x) => v(x.r.freq))) === null ? null : round(mean(rows.map((x) => v(x.r.freq)))!, 2),
    } : null,
    series: [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([b, xs]) => ({
      t: new Date(b).toISOString(), imp: r1(mean(xs.map((x) => v(x.r.p_import_kw)))), imp_max: r1(max(xs.map((x) => v(x.r.p_import_max_kw) ?? v(x.r.p_import_kw)))),
      exp: r1(mean(xs.map((x) => v(x.r.p_export_kw)))), exp_max: r1(max(xs.map((x) => v(x.r.p_export_max_kw) ?? v(x.r.p_export_kw)))), pv: r1(mean(xs.map((x) => v(x.r.pv_kw)))),
      v1: r1(mean(xs.map((x) => v(x.r.v_l1)))), v2: r1(mean(xs.map((x) => v(x.r.v_l2)))), v3: r1(mean(xs.map((x) => v(x.r.v_l3)))),
      vmin: r1(min(xs.filter((x) => !x.dubious).map((x) => v(x.r.v_ln_min)))), vmax: r1(max(xs.filter((x) => !x.dubious).map((x) => v(x.r.v_ln_max)))),
      i1: r1(mean(xs.map((x) => v(x.r.i_l1)))), i2: r1(mean(xs.map((x) => v(x.r.i_l2)))), i3: r1(mean(xs.map((x) => v(x.r.i_l3)))),
      pf: mean(xs.map((x) => x.pf)) === null ? null : round(mean(xs.map((x) => x.pf))!, 3), thdv: r1(mean(xs.filter((x) => !x.dubious).map((x) => v(x.r.thd_v_max)))),
      thdi: r1(mean(xs.map((x) => v(x.r.thd_i_max)))), unb: r1(mean(xs.map((x) => x.unb))),
    })),
    daily,
    heatmap: [...heat.entries()].map(([key, xs]) => {
      const [d, h] = key.split("|");
      return { d: d!, h: Number(h), imp: round(sum(xs.map((x) => (v(x.r.p_import_kw) ?? 0) * x.h)), 2), exp: round(sum(xs.map((x) => (v(x.r.p_export_kw) ?? 0) * x.h)), 2), pv: round(sum(xs.map((x) => (v(x.r.pv_kw) ?? 0) * x.h)), 2) };
    }).sort((a, b) => a.d.localeCompare(b.d) || a.h - b.h),
    harmonics: { v: harm("v"), i: harm("i") },
    alerts,
  };
}

export const DEMO_IDS = { site: SITE_ID, ...METERS };
