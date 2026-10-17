import { fmt, fmtDay, fmtMxn, fmtWhen, RULE_LABELS, workDaysLabel, type MeterView, type Rule } from "@/lib/medidores/model";

/**
 * "Lectura automática" de un medidor en un periodo (Paco, junta #9: "en cuanto se suban los datos, que
 * ya los analice y te muestre toda la información"). Son reglas fijas sobre los indicadores que calcula
 * la base, sin modelo de IA: cada frase dice qué pasó, con el número, y qué hacer.
 */
export type InsightTone = "bien" | "info" | "atencion" | "urgente";
export type Insight = { tone: InsightTone; title: string; body: string };

export function meterInsights(view: MeterView): Insight[] {
  const k = view.kpis;
  const tz = view.site.timezone;
  const out: Insight[] = [];
  if (!k || k.readings === 0) {
    return [{ tone: "info", title: "Sin lecturas en este periodo", body: "Carga un archivo del analizador o conecta el equipo por API para ver el análisis." }];
  }
  const nominal = view.meter.nominal_v_ln;
  const interval = view.meter.interval_minutes;
  const coverage = k.expected > 0 ? Math.min(100, (k.readings / k.expected) * 100) : 100;
  out.push({
    tone: coverage < 90 ? "atencion" : "info",
    title: "Qué se midió",
    body: `Del ${fmtWhen(k.first_ts, tz)} al ${fmtWhen(k.last_ts, tz)}${interval ? `, una lectura cada ${fmt(interval)} min` : ""}: ${fmt(k.readings)} lecturas (${fmt(coverage, 1)} % de las esperadas).`
      + (k.dubious > 0 ? ` ${fmt(k.dubious)} traen valores imposibles en la red de México (frecuencia de 50 Hz o THD arriba de 50 %); son artefactos del equipo y no cuentan en el análisis.` : ""),
  });

  if (view.meter.kind === "INVERSOR") {
    out.push({ tone: "info", title: "Generación", body: `Generó ${fmt(k.pv_kwh)} kWh en el periodo, con un máximo de ${fmt(k.peak_pv_kw, 1)} kW.` });
    return out.concat(alertInsights(view));
  }

  const imp = k.import_kwh ?? 0, exp = k.export_kwh ?? 0;
  out.push({
    tone: "info",
    title: "Energía",
    body: `Tomó ${fmt(imp)} kWh de la red (unos ${fmtMxn(k.cost_mxn)} a ${fmt(view.site.price_mxn_kwh, 2)} pesos por kWh) y envió ${fmt(exp)} kWh a la red.`
      + (exp > 0 && imp > 0 ? ` Lo enviado equivale al ${fmt((exp / imp) * 100, 0)} % de lo que tomó.` : ""),
  });

  const exportDays = view.daily.filter((d) => (d.exp ?? 0) >= 5 && (d.exp ?? 0) > (d.imp ?? 0));
  if (exportDays.length) {
    out.push({
      tone: "info",
      title: exportDays.length === 1 ? "Un día casi todo se fue a la red" : `${exportDays.length} días casi todo se fue a la red`,
      body: exportDays.slice(0, 3).map((d) => `${fmtDay(d.d)}: envió ${fmt(d.exp)} kWh y tomó ${fmt(d.imp)} kWh`).join("; ")
        + ". Ese día la generación solar superó al consumo: conviene revisar si el contrato con CFE paga esa energía o si se puede mover producción a esas horas.",
    });
  }

  const profile = workProfile(view);
  if (profile) {
    out.push({ tone: "info", title: "Horario de la planta", body: profile });
  }

  if (k.peak_kw !== null) {
    const contracted = view.site.contracted_demand_kw;
    out.push({
      tone: contracted && k.peak_kw > contracted ? "urgente" : "info",
      title: "Demanda máxima",
      body: `${fmt(k.peak_kw, 1)} kW el ${fmtWhen(k.peak_at, tz)}${k.peak_avg_kw !== null && k.peak_avg_kw !== k.peak_kw ? ` (en promedio de ${fmt(interval)} min, ${fmt(k.peak_avg_kw, 1)} kW)` : ""}.`
        + (contracted ? ` La demanda contratada es de ${fmt(contracted)} kW.` : " Captura la demanda contratada de la planta para avisar si se rebasa."),
    });
  }

  if (k.pf_avg !== null) {
    const pf = k.pf_avg;
    const share = (k.pf_below_share ?? 0) * 100;
    out.push(pf >= 0.95
      ? { tone: "bien", title: "Factor de potencia", body: `Promedio de ${fmt(pf, 2)}, arriba del 0.95 que pide el Código de Red.` }
      : {
        tone: pf < 0.9 ? "atencion" : "info",
        title: "Factor de potencia bajo",
        body: `Promedio de ${fmt(pf, 2)} con carga; debajo de 0.95 el ${fmt(share, 0)} % del tiempo. ${pf < 0.9 ? "CFE cobra recargo debajo de 0.90. " : ""}Es candidato a un banco de capacitores (el hub tiene la calculadora en Proyectos).`,
      });
  }

  if (k.v_min !== null && k.v_max !== null) {
    const hi = ((k.v_max - nominal) / nominal) * 100;
    const lo = ((k.v_min - nominal) / nominal) * 100;
    const tone: InsightTone = lo < -30 ? "urgente" : Math.max(hi, -lo) > 10 ? "atencion" : Math.max(hi, -lo) > 5 ? "info" : "bien";
    out.push({
      tone,
      title: "Tensión",
      body: `Promedio de ${fmt(k.v_avg, 1)} V contra ${fmt(nominal)} V nominales; máxima de ${fmt(k.v_max, 1)} V (${hi >= 0 ? "+" : ""}${fmt(hi, 1)} %) y mínima de ${fmt(k.v_min, 1)} V (${fmt(lo, 1)} %) el ${fmtWhen(k.v_min_at, tz)}.`
        + (lo < -15 ? " Esa caída es un hueco de tensión: revisar arranques de motores grandes o fallas de la red." : "")
        + (hi > 5 ? " La tensión alta suele aparecer de noche, con poca carga." : ""),
    });
  }

  if (k.unbalance_avg !== null) {
    const u = k.unbalance_avg;
    out.push({
      tone: (k.unbalance_p95 ?? 0) >= 30 ? "atencion" : u >= 10 ? "info" : "bien",
      title: "Desbalance de corriente",
      body: `Promedio de ${fmt(u, 1)} % entre fases (95 % del tiempo debajo de ${fmt(k.unbalance_p95, 1)} %).${u >= 10 ? " Repartir cargas monofásicas entre fases baja pérdidas y calentamiento." : ""}`,
    });
  }

  if (k.thd_v_p95 !== null || k.thd_i_p95 !== null) {
    const v = k.thd_v_p95, i = k.thd_i_p95;
    const tone: InsightTone = (v ?? 0) >= 8 ? "atencion" : (i ?? 0) >= 20 || (v ?? 0) >= 5 ? "info" : "bien";
    out.push({
      tone,
      title: "Distorsión armónica",
      body: `Tensión: ${v === null ? "sin dato" : `${fmt(v, 1)} %`} el 95 % del tiempo (límite de 8 % en baja tensión). Corriente con la planta trabajando: ${i === null ? "sin dato" : `${fmt(i, 0)} %`}.`
        + ((i ?? 0) >= 20 ? " La distorsión de corriente alta viene de variadores y cargas electrónicas; si crece, conviene un estudio de filtros." : ""),
    });
    const topV = [...view.harmonics.v].sort((a, b) => Math.max(b.l1 ?? 0, b.l2 ?? 0, b.l3 ?? 0) - Math.max(a.l1 ?? 0, a.l2 ?? 0, a.l3 ?? 0))[0];
    if (topV) out[out.length - 1]!.body += ` El armónico de tensión más alto es el ${topV.order}.º.`;
  }

  return out.concat(alertInsights(view));
}

function alertInsights(view: MeterView): Insight[] {
  const counts = new Map<Rule, { n: number; urgent: number; sample: string }>();
  for (const a of view.alerts) {
    const c = counts.get(a.rule) ?? { n: 0, urgent: 0, sample: a.message };
    c.n += 1; if (a.severity === "URGENTE") c.urgent += 1;
    counts.set(a.rule, c);
  }
  const out: Insight[] = [];
  const night = counts.get("EXPORTACION_NOCHE");
  if (night) out.push({ tone: "atencion", title: "Revisar la instalación del analizador", body: night.sample });
  const outages = counts.get("CORTE");
  if (outages) out.push({ tone: "urgente", title: `${outages.n} corte${outages.n === 1 ? "" : "s"} de energía`, body: outages.sample });
  const paros = counts.get("PARO");
  if (paros) out.push({ tone: "atencion", title: `${paros.n} posible${paros.n === 1 ? "" : "s"} paro${paros.n === 1 ? "" : "s"}`, body: paros.sample });
  const atypical = counts.get("CONSUMO_ATIPICO");
  if (atypical) out.push({ tone: "info", title: `${atypical.n} hora${atypical.n === 1 ? "" : "s"} con consumo fuera de su patrón`, body: atypical.sample });
  const fault = counts.get("INVERSOR_FALLA");
  if (fault) out.push({ tone: "urgente", title: RULE_LABELS.INVERSOR_FALLA, body: fault.sample });
  const low = counts.get("GENERACION_BAJA");
  if (low) out.push({ tone: "atencion", title: RULE_LABELS.GENERACION_BAJA, body: low.sample });
  return out;
}

/** "Arranca hacia las 7:00 y baja hacia las 19:00", de los días de trabajo con el mapa de calor. */
function workProfile(view: MeterView): string | null {
  const work = new Set(view.site.work_days);
  const isWork = (d: string) => work.has((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7 + 1);
  const sums = new Array(24).fill(0), counts = new Array(24).fill(0);
  for (const c of view.heatmap) {
    if (!isWork(c.d)) continue;
    sums[c.h] += c.imp ?? 0; counts[c.h] += 1;
  }
  const avgByHour = sums.map((s, h) => (counts[h] ? s / counts[h] : 0));
  const peak = Math.max(...avgByHour);
  if (peak <= 0 || counts.filter(Boolean).length < 12) return null;
  const on = avgByHour.map((v) => v >= peak * 0.5);
  const start = on.indexOf(true);
  const end = 23 - [...on].reverse().indexOf(true);
  const peakHour = avgByHour.indexOf(peak);
  const base = Math.min(...avgByHour.filter((_, h) => counts[h]));
  return `En días de trabajo (${workDaysLabel(view.site.work_days).toLowerCase()}) el consumo sube hacia las ${start}:00, llega a su punto más alto hacia las ${peakHour}:00 (${fmt(peak, 1)} kWh en esa hora) y baja después de las ${end + 1}:00. La carga mínima es de ${fmt(base, 1)} kWh por hora.`;
}
