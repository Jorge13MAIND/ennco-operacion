"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import { money } from "@/components/projects/ui";
import { MONTH_NAMES } from "@/lib/solar/catalog";
import { isoToSerial, SEGMENT_TARIFFS, serialToIso } from "@/lib/solar/defaults";
import { computeQuote } from "@/lib/solar/quote";
import type { CatalogVersions, StoredQuote } from "@/lib/solar/server";
import type { QuoteInput, QuoteResult, SolarCatalog } from "@/lib/solar/types";

/**
 * Pantalla del cotizador. Todo se recalcula en el navegador con el motor de src/lib/solar y los
 * catálogos que manda el servidor; guardar envía las entradas y el servidor vuelve a calcular con
 * los mismos catálogos para dejar el resumen en la base.
 */

type Tab = "resumen" | "generacion" | "recibo" | "precio" | "proyeccion";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "resumen", label: "Resumen" }, { key: "generacion", label: "Generación" }, { key: "recibo", label: "Recibo CFE" }, { key: "precio", label: "Precio" }, { key: "proyeccion", label: "Proyección" },
];
const segmentLabel: Record<string, string> = { RESIDENTIAL: "Residencial", COMMERCIAL: "Comercial", INDUSTRIAL: "Industrial" };
const n0 = (v: number) => Math.round(v).toLocaleString("es-MX");
const n2 = (v: number) => v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number) => `${(v * 100).toFixed(1)} %`;

function Section({ title, hint, children, open = true }: { title: string; hint?: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="solar-section" open={open}>
      <summary><span>{title}</span>{hint ? <small>{hint}</small> : null}</summary>
      <div className="projects-form-grid solar-grid">{children}</div>
    </details>
  );
}
function Num({ label, value, onChange, step, min, max, suffix, wide }: { label: string; value: number | null | undefined; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string; wide?: boolean }) {
  return (
    <label className={`projects-field ${wide ? "solar-wide" : ""}`}>
      <span>{label}{suffix ? <small> {suffix}</small> : null}</span>
      <input type="number" inputMode="decimal" value={value ?? ""} step={step ?? "any"} min={min} max={max} onChange={(e) => onChange(e.currentTarget.value === "" ? 0 : Number(e.currentTarget.value))} />
    </label>
  );
}
function Text({ label, value, onChange, wide }: { label: string; value: string | null | undefined; onChange: (v: string) => void; wide?: boolean }) {
  return <label className={`projects-field ${wide ? "solar-wide" : ""}`}><span>{label}</span><input type="text" value={value ?? ""} onChange={(e) => onChange(e.currentTarget.value)} /></label>;
}
function Select({ label, value, onChange, options, wide }: { label: string; value: string | null | undefined; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; wide?: boolean }) {
  return (
    <label className={`projects-field ${wide ? "solar-wide" : ""}`}>
      <span>{label}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.currentTarget.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </label>
  );
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label className="projects-check solar-toggle"><input type="checkbox" checked={value} onChange={(e) => onChange(e.currentTarget.checked)} /><span>{label}</span></label>;
}
function Metric({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "good" | "bad" }) {
  return <div className="projects-metric" data-tone={tone}><span>{label}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}</div>;
}

function paybackLabel(result: QuoteResult): string {
  const p = result.projection;
  if (!p.recovers) return "no se recupera en 30 años con estos datos";
  const years = Math.floor(p.paybackTotal);
  const months = Math.round((p.paybackTotal - years) * 12);
  return `retorno ${years} año${years === 1 ? "" : "s"}${months > 0 ? ` y ${months} mes${months === 1 ? "" : "es"}` : ""}`;
}

function monthLabel(billedMonth: number, offset: number): string {
  return MONTH_NAMES[(((billedMonth - 1 - offset) % 12) + 12) % 12] ?? "";
}

export function SolarQuoteWorkspace({ catalog, versions, initial, defaults, example, live }: {
  catalog: SolarCatalog; versions: CatalogVersions; initial: StoredQuote | null; defaults: QuoteInput; example: QuoteInput | null; live: boolean;
}) {
  const router = useRouter();
  const [input, setInput] = useState<QuoteInput>(initial?.input ?? defaults);
  const [name, setName] = useState(initial?.name ?? "");
  const [quoteId, setQuoteId] = useState<string | null>(initial?.id ?? null);
  const [version, setVersion] = useState<number | null>(initial?.version ?? null);
  const [tab, setTab] = useState<Tab>("resumen");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "danger" | "success"; text: string } | null>(null);

  const computed = useMemo<{ result: QuoteResult | null; error: string | null }>(() => {
    try { return { result: computeQuote(input, catalog), error: null }; } catch (e) { return { result: null, error: e instanceof Error ? e.message : "No se pudo calcular" }; }
  }, [input, catalog]);
  const result = computed.result;
  const patch = (p: Partial<QuoteInput>) => setInput((prev) => ({ ...prev, ...p }));
  const setArray = <K extends "consumptionKwh" | "advances">(key: K, i: number, v: number) => setInput((prev) => {
    const arr = [...((prev[key] as number[] | null | undefined) ?? Array(12).fill(0))]; arr[i] = v; return { ...prev, [key]: arr };
  });
  const isRes = input.segment === "RESIDENTIAL"; const isInd = input.segment === "INDUSTRIAL";
  const bimonthly = !isInd && input.period === "Bimestral";

  async function save(status?: string) {
    if (!name.trim()) { setMessage({ tone: "danger", text: "Ponle nombre a la cotización antes de guardar." }); return; }
    setSaving(true); setMessage(null);
    try {
      const res = await fetch("/api/v1/solar/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: quoteId, name: name.trim(), expectedVersion: version, status, input }) });
      const data = await res.json();
      if (!res.ok) {
        const issues = Array.isArray(data?.issues) ? data.issues.map((i: { path?: string; message?: string }) => `${i.path ?? ""}: ${i.message ?? ""}`).join(" · ") : "";
        throw new Error(`${data?.message ?? data?.error ?? "No se pudo guardar"}${issues ? ` (${issues})` : ""}`);
      }
      setQuoteId(data.quote.id); setVersion(data.quote.version);
      setMessage({ tone: "success", text: `Guardada como versión ${data.quote.version}.` });
      if (!quoteId) router.replace(`/operacion/proyectos/cotizar?cotizacion=${data.quote.id}` as Route);
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof Error ? e.message : "No se pudo guardar" });
    } finally { setSaving(false); }
  }

  const tariffOptions = SEGMENT_TARIFFS[input.segment].map((t) => ({ value: t, label: t }));
  const cityOptions = catalog.cities.map((c) => ({ value: c.city, label: `${c.city} · ${c.division ?? ""}` }));
  const moduleOptions = catalog.modules.map((m) => ({ value: m.model, label: `${m.model} · ${m.pmaxW} W` }));
  const inverterOptions = [{ value: "", label: "— sin inversor —" }, ...catalog.inverters.map((i) => ({ value: i.model, label: `${i.model} · ${n0(i.nominalW)} W` }))];
  const mountingOptions = catalog.mounting.es.map((m) => ({ value: m.name, label: m.name }));
  const inverterWarnings = result ? result.inverters.filter((i) => i.inverter && (result.modulesTotal < i.minModules || result.modulesTotal > i.maxModules)).map((i) => `${i.model}: admite de ${i.minModules} a ${i.maxModules} módulos y el sistema tiene ${result.modulesTotal}.`) : [];

  return (
    <main className="shell section operations-main projects-page solar-page" id="main-content" tabIndex={-1}>
      <header className="projects-header">
        <div>
          <span className="projects-eyebrow">Proyectos ENNCO · Cotizador · {segmentLabel[input.segment]}</span>
          <h1>{name || "Nueva cotización"}</h1>
          <p>Captura como en el libro; todo lo demás se calcula al momento. {quoteId ? `Versión ${version}.` : "Sin guardar todavía."}</p>
        </div>
        <div className="projects-toolbar solar-toolbar">
          <input aria-label="Nombre de la cotización" className="solar-name" placeholder="Nombre de la cotización (cliente · sitio)" type="text" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          {example ? <button className="projects-button secondary" type="button" onClick={() => { setInput(example); if (!name) setName(`Ejemplo del libro · ${segmentLabel[input.segment]}`); }}>Cargar ejemplo del libro</button> : null}
          <button className="projects-button" type="button" disabled={saving || !live || !result} onClick={() => void save()}>{saving ? "Guardando…" : "Guardar"}</button>
          <Link className="projects-button secondary" href={"/operacion/proyectos" as Route}>Volver</Link>
        </div>
      </header>
      {message ? <div className="projects-notice" data-tone={message.tone} role="status">{message.text}</div> : null}
      {!live ? <div className="projects-disclosure"><strong>Modo demostración.</strong> Puedes calcular, pero no guardar.</div> : null}

      <div className="solar-layout">
        <form className="solar-form" onSubmit={(e) => e.preventDefault()}>
          <Section title="Datos generales del proyecto">
            <Text label="Nombre del cliente" value={input.customer.name} onChange={(v) => patch({ customer: { ...input.customer, name: v } })} wide />
            <Text label="Subtítulo (n° de servicio)" value={input.customer.subtitle} onChange={(v) => patch({ customer: { ...input.customer, subtitle: v } })} />
            <Text label="Suministrador" value={input.customer.supplier} onChange={(v) => patch({ customer: { ...input.customer, supplier: v } })} />
            <Select label="Ciudad" value={input.city} onChange={(v) => patch({ city: v })} options={cityOptions} wide />
            <Select label="Idioma del estudio" value={input.language ?? "Español"} onChange={(v) => patch({ language: v })} options={[{ value: "Español", label: "Español" }, { value: "Inglés", label: "Inglés" }]} />
          </Section>
          <Section title="Centro de carga" hint="Tarifa, periodo y último recibo">
            {isInd ? <div className="projects-field"><span>Periodo</span><div className="solar-suggested"><strong>Mensual</strong><small className="projects-help">el recibo industrial siempre es mensual</small></div></div> : <Select label="Periodo" value={input.period} onChange={(v) => patch({ period: v as QuoteInput["period"] })} options={[{ value: "Bimestral", label: "Bimestral" }, { value: "Mensual", label: "Mensual" }]} />}
            <Select label="Tarifa actual" value={input.currentTariff} onChange={(v) => patch({ currentTariff: v })} options={tariffOptions} />
            {isRes ? <Select label="Tarifa base" value={input.baseTariff ?? "1"} onChange={(v) => patch({ baseTariff: v })} options={SEGMENT_TARIFFS.RESIDENTIAL.filter((t) => t !== "DAC").map((t) => ({ value: t, label: t }))} /> : <Num label="Demanda contratada" suffix="kW" value={input.contractedDemandKw} onChange={(v) => patch({ contractedDemandKw: v })} />}
            {isRes ? <Toggle label="Tarifa de verano" value={input.summerTariff} onChange={(v) => patch({ summerTariff: v })} /> : null}
            {!isRes ? <label className="projects-field"><span>Inicio del último periodo</span><input type="date" value={serialToIso(input.periodStartSerial)} onChange={(e) => patch({ periodStartSerial: isoToSerial(e.currentTarget.value) })} /></label> : null}
            {!isRes ? <label className="projects-field"><span>Fin del último periodo</span><input type="date" value={serialToIso(input.periodEndSerial)} onChange={(e) => patch({ periodEndSerial: isoToSerial(e.currentTarget.value) })} /></label> : null}
            <Select label="Mes del último recibo" value={String(input.billedMonth)} onChange={(v) => patch({ billedMonth: Number(v) })} options={MONTH_NAMES.map((m, i) => ({ value: String(i + 1), label: m }))} />
            <Num label="Incremento anual de tarifa" suffix="(0.07 = 7 %)" min={0} max={1} value={input.annualIncrease} onChange={(v) => patch({ annualIncrease: v })} step={0.01} />
            <Select label="Tipo de medidor" value={input.meterType ?? "Digital"} onChange={(v) => patch({ meterType: v })} options={[{ value: "Digital", label: "Digital" }, { value: "Analógico", label: "Analógico" }]} />
            <Num label="Fases" value={input.phases} onChange={(v) => patch({ phases: v })} />
            <Num label="Tensión F-F" suffix="V" value={input.voltage} onChange={(v) => patch({ voltage: v })} />
            <Text label="Configuración eléctrica" value={input.electricalConfig} onChange={(v) => patch({ electricalConfig: v })} />
          </Section>
          <Section title="Historial de consumo" hint={bimonthly ? `6 recibos bimestrales; el más reciente (${monthLabel(input.billedMonth, 0)}) primero. Los meses intermedios van en cero, como en el libro` : `12 recibos mensuales, el más reciente (${monthLabel(input.billedMonth, 0)}) primero`}>
            <div className="solar-months solar-wide">
              {input.consumptionKwh.map((kwh, i) => {
                const skipped = bimonthly && i % 2 === 1;
                return (
                  <div className={`solar-month ${skipped ? "solar-month-skipped" : ""}`} key={i}>
                    <span>{monthLabel(input.billedMonth, i)}{skipped ? " · no facturado" : ""}</span>
                    <input aria-label={`kWh ${monthLabel(input.billedMonth, i)}`} disabled={skipped} min={0} type="number" inputMode="decimal" value={skipped ? 0 : kwh} onChange={(e) => setArray("consumptionKwh", i, Number(e.currentTarget.value || 0))} />
                  </div>
                );
              })}
            </div>
            {isInd ? (
              <>
                <Num label="kWh base" value={input.kwhBase} onChange={(v) => patch({ kwhBase: v })} />
                <Num label="kWh intermedio" value={input.kwhIntermediate} onChange={(v) => patch({ kwhIntermediate: v })} />
                <Num label="kWh punta" value={input.kwhPeak} onChange={(v) => patch({ kwhPeak: v })} />
                <Num label="kWh semipunta" value={input.kwhSemiPeak} onChange={(v) => patch({ kwhSemiPeak: v })} />
                <Num label="kW base" value={input.kwBase} onChange={(v) => patch({ kwBase: v })} />
                <Num label="kW intermedio" value={input.kwIntermediate} onChange={(v) => patch({ kwIntermediate: v })} />
                <Num label="kW punta" value={input.kwPeak} onChange={(v) => patch({ kwPeak: v })} />
                <Num label="kW semipunta" value={input.kwSemiPeak} onChange={(v) => patch({ kwSemiPeak: v })} />
                <Num label="kVArh del último recibo" value={input.kvarh} onChange={(v) => patch({ kvarh: v })} />
                <Num label="Factor de potencia objetivo" min={0.5} max={1} value={input.targetPowerFactor ?? 0.96} onChange={(v) => patch({ targetPowerFactor: v })} step={0.01} />
              </>
            ) : null}
          </Section>
          <Section title="Sistema fotovoltaico">
            <Select label="Módulo" value={input.moduleModel} onChange={(v) => patch({ moduleModel: v })} options={moduleOptions} wide />
            <Select label="Orientaciones" value={String(input.orientations.length)} onChange={(v) => { const n = Number(v); const arr = [...input.orientations]; while (arr.length < n) arr.push({ modules: 0, azimuth: 0, inclination: 15 }); patch({ orientations: arr.slice(0, n), orientationCount: n }); }} options={[1, 2, 3, 4].map((k) => ({ value: String(k), label: String(k) }))} />
            <Select label="Sistema de montaje" value={input.mountingSystem ?? ""} onChange={(v) => patch({ mountingSystem: v })} options={mountingOptions} />
            {input.orientations.map((o, i) => (
              <div className="solar-inline solar-wide" key={i}>
                <strong>Orientación {i + 1}</strong>
                <Num label="Módulos" value={o.modules} onChange={(v) => { const arr = [...input.orientations]; arr[i] = { ...o, modules: v }; patch({ orientations: arr }); }} />
                <Num label="Azimut" suffix="°" value={o.azimuth} onChange={(v) => { const arr = [...input.orientations]; arr[i] = { ...o, azimuth: v }; patch({ orientations: arr }); }} />
                <Num label="Inclinación" suffix="° (múltiplos de 5)" value={o.inclination} onChange={(v) => { const arr = [...input.orientations]; arr[i] = { ...o, inclination: v }; patch({ orientations: arr }); }} step={5} />
              </div>
            ))}
            <Num label="Degradación anual" suffix="(0.0042 = 0.42 %)" min={0} max={0.2} value={input.degradation} onChange={(v) => patch({ degradation: v })} step={0.0001} />
            {[0, 1, 2, 3, 4].map((i) => {
              const sel = input.inverters[i];
              if (i > 0 && !input.inverters[i - 1]?.model) return null;
              return (
                <div className="solar-inline solar-wide" key={i}>
                  <strong>Inversor {i + 1}</strong>
                  <Select label="Modelo" value={sel?.model ?? ""} onChange={(v) => { const arr = [...input.inverters]; arr[i] = { model: v, quantity: sel?.quantity || 1 }; patch({ inverters: arr.filter((x) => x.model) }); }} options={inverterOptions} wide />
                  <Num label="Cantidad" min={1} value={sel?.quantity ?? 0} onChange={(v) => { const arr = [...input.inverters]; arr[i] = { model: sel?.model ?? "", quantity: v }; patch({ inverters: arr }); }} />
                </div>
              );
            })}
            <details className="solar-wide solar-sub"><summary>Parámetros de generación (criterio de diseño del libro)</summary>
              <div className="projects-form-grid solar-grid">
                <Num label="PR" value={input.generation?.performanceRatio ?? result?.generation.parameters.performanceRatio ?? 0.8} onChange={(v) => patch({ generation: { ...(input.generation ?? {}), performanceRatio: v } })} step={0.01} />
                <Num label="Margen de seguridad" value={input.generation?.safetyMargin ?? result?.generation.parameters.safetyMargin ?? 0.93} onChange={(v) => patch({ generation: { ...(input.generation ?? {}), safetyMargin: v } })} step={0.01} />
                <Num label="Pérdida 1" value={input.generation?.loss1 ?? result?.generation.parameters.loss1 ?? 0} onChange={(v) => patch({ generation: { ...(input.generation ?? {}), loss1: v } })} step={0.001} />
                <Num label="Pérdida 2" value={input.generation?.loss2 ?? result?.generation.parameters.loss2 ?? 0} onChange={(v) => patch({ generation: { ...(input.generation ?? {}), loss2: v } })} step={0.001} />
              </div>
            </details>
          </Section>
          <Section title="Servicios adicionales" open={false}>
            {input.services.map((s, i) => (
              <div className="solar-inline solar-wide" key={i}>
                <Toggle label={`Incluir servicio ${i + 1}`} value={s.enabled} onChange={(v) => { const arr = [...input.services]; arr[i] = { ...s, enabled: v }; patch({ services: arr }); }} />
                <Text label="Concepto" value={s.concept} onChange={(v) => { const arr = [...input.services]; arr[i] = { ...s, concept: v }; patch({ services: arr }); }} wide />
                <Num label="Costo" suffix="MXN" value={s.costMxn} onChange={(v) => { const arr = [...input.services]; arr[i] = { ...s, costMxn: v }; patch({ services: arr }); }} />
              </div>
            ))}
          </Section>
          <Section title="Precio y condiciones">
            <Select label="Moneda de la oferta" value={input.currency ?? "MXN"} onChange={(v) => patch({ currency: v })} options={[{ value: "MXN", label: "MXN" }, { value: "USD", label: "USD" }]} />
            <Num label="Tipo de cambio" suffix="MXN/USD" min={0.01} value={input.exchangeRate} onChange={(v) => patch({ exchangeRate: v })} step={0.01} />
            <Num label="Costo sin IVA por watt" suffix="MXN/W" value={input.pricePerWatt} onChange={(v) => patch({ pricePerWatt: v })} step={0.01} />
            <div className="projects-field"><span>Precio sugerido</span><div className="solar-suggested"><strong>{result ? `${n2(result.pricing.suggestedPricePerWatt)} MXN/W` : "—"}</strong>{result ? <button className="projects-button secondary" type="button" onClick={() => patch({ pricePerWatt: Math.round(result.pricing.suggestedPricePerWatt * 100) / 100 })}>Usar</button> : null}</div></div>
            <Num label="Factor de utilidad" suffix="(0.5 = 50 %)" value={input.utilityFactor} onChange={(v) => patch({ utilityFactor: v })} step={0.05} />
            <Num label="Descuento al costo" suffix="(0.1 = 10 %)" value={input.discount} onChange={(v) => patch({ discount: v })} step={0.01} />
            <Toggle label="Agregar IVA" value={input.addIva} onChange={(v) => patch({ addIva: v })} />
            <Toggle label="Analizar con deducción fiscal" value={input.taxDeduction} onChange={(v) => patch({ taxDeduction: v })} />
            {["Anticipo", "Arribo de material", "Terminación de instalación", "Entrega del sistema"].map((l, i) => <Num key={l} label={l} suffix="(fracción)" value={input.advances[i]} onChange={(v) => setArray("advances", i, v)} step={0.05} />)}
            <Num label="Base para financiamiento" suffix="MXN (0 = precio de contado)" value={input.financingBase} onChange={(v) => patch({ financingBase: v })} />
            {input.financing.map((f, i) => (
              <div className="solar-inline solar-wide" key={i}>
                <strong>Renta {i + 1}</strong>
                <Num label="Fracción" value={f.share} onChange={(v) => { const arr = [...input.financing]; arr[i] = { ...f, share: v }; patch({ financing: arr }); }} step={0.05} />
                <Num label="Mensualidades" value={f.months} onChange={(v) => { const arr = [...input.financing]; arr[i] = { ...f, months: v }; patch({ financing: arr }); }} />
              </div>
            ))}
            <Num label="Garantía de estructura" suffix="años" value={input.structureWarrantyYears} onChange={(v) => patch({ structureWarrantyYears: v })} />
            <Text label="Inicio de obra" value={input.startTime} onChange={(v) => patch({ startTime: v })} />
            <Text label="Tiempo de entrega" value={input.deliveryTime} onChange={(v) => patch({ deliveryTime: v })} />
            <Num label="Vigencia de la oferta" suffix="días" value={input.validityDays} onChange={(v) => patch({ validityDays: v })} />
          </Section>
        </form>

        <section className="solar-results" aria-live="polite">
          {computed.error ? <div className="projects-notice" data-tone="danger">{computed.error.replace("SOLAR_CITY_NOT_FOUND", "Ciudad no encontrada").replace("SOLAR_MODULE_NOT_FOUND", "Módulo no encontrado").replace("SOLAR_TARIFF_NOT_FOUND", "Tarifa no encontrada para esa zona")}</div> : null}
          {result ? (
            <>
              <nav className="projects-tabs solar-tabs" aria-label="Resultados">
                {TABS.map((t) => <button aria-current={tab === t.key ? "page" : undefined} className="projects-button secondary" key={t.key} type="button" onClick={() => setTab(t.key)}>{t.label}</button>)}
              </nav>
              {tab === "resumen" ? (
                <>
                  <div className="projects-metrics solar-metrics">
                    <Metric label="Sistema" value={`${n2(result.systemKw)} kW`} note={`${result.modulesTotal} módulos de ${result.modulePowerW} W`} />
                    <Metric label="Generación anual" value={`${n0(result.annualGeneration)} kWh`} note={`cobertura ${pct(result.coverage)} de ${n0(result.annualConsumption)} kWh`} />
                    <Metric label="Recibo anual sin FV" value={money(result.bill.annualWithout)} note={`tarifa ${result.bill.tariff}`} />
                    <Metric label="Recibo anual con FV" value={money(result.bill.annualWith)} note={result.bill.annualWith > result.bill.annualWithout ? "sin ahorro con estos datos" : `ahorro ${pct(result.bill.savingsShare)}`} tone={result.bill.annualWith > result.bill.annualWithout ? "bad" : "good"} />
                    <Metric label="Precio de contado" value={money(result.pricing.cashPrice)} note={`${n2(input.pricePerWatt)} MXN/W · sugerido ${n2(result.pricing.suggestedPricePerWatt)}`} />
                    <Metric label="TIR" value={result.projection.recovers ? pct(result.projection.irr) : "—"} note={paybackLabel(result)} tone={result.projection.recovers && result.projection.irr > 0 ? "good" : "bad"} />
                    <Metric label="Módulos para cubrir el consumo" value={String(result.modulesNeeded)} note={`${n2(result.systemNeededKw)} kW necesarios`} />
                    <Metric label="Deducción fiscal" value={money(result.projection.deduction)} note={input.taxDeduction ? "ISR sobre costo sin IVA" : "no aplicada"} />
                    {result.powerFactor != null ? <Metric label="Factor de potencia" value={`${result.powerFactor.toFixed(2)} %`} note={result.powerFactor < 90 ? "penalización CFE" : "bonificación CFE"} tone={result.powerFactor < 90 ? "bad" : "good"} /> : null}
                  </div>
                  {result.demandWarning ? <div className="projects-notice" data-tone="warning">{result.demandWarning}</div> : null}
                  {[...result.warnings, ...inverterWarnings].map((w) => <div className="projects-notice" data-tone="warning" key={w}>{w}</div>)}
                  <div className="projects-table-wrap">
                    <table className="projects-table">
                      <thead><tr><th scope="col">Inversor</th><th className="num" scope="col">Cantidad</th><th className="num" scope="col">Mín. módulos</th><th className="num" scope="col">Máx. módulos</th><th className="num" scope="col">Pmax FV</th></tr></thead>
                      <tbody>{result.inverters.map((i, idx) => <tr key={`${i.model}-${idx}`}><td>{i.model}</td><td className="num">{i.quantity}</td><td className="num">{i.minModules}</td><td className="num">{i.maxModules}</td><td className="num">{i.inverter ? `${n0(i.inverter.pmaxFvW)} W` : "—"}</td></tr>)}</tbody>
                    </table>
                  </div>
                  <p className="projects-help">Catálogos: {Object.entries(versions).map(([k, v]) => `${k.replace("solar_", "")} ${v.source === "catalog" ? `${v.name} v${v.version}` : "libro"}`).join(" · ")}</p>
                </>
              ) : null}
              {tab === "generacion" ? (
                <div className="projects-table-wrap">
                  <table className="projects-table">
                    <thead><tr><th>Mes</th><th className="num">Irradiación</th>{result.generation.orientations.filter((o) => o.modules > 0).map((o, i) => <th className="num" key={i}>Or. {i + 1} · K / kWh</th>)}<th className="num">Generación</th><th className="num">Consumo</th><th className="num">Periodo</th></tr></thead>
                    <tbody>
                      {MONTH_NAMES.map((m, i) => (
                        <tr key={m}><td>{m}</td><td className="num">{(result.generation.orientations[0]?.irradiance[i] ?? 0).toFixed(2)}</td>
                          {result.generation.orientations.filter((o) => o.modules > 0).map((o, k) => <td className="num" key={k}>{(o.factorK[i] ?? 0).toFixed(2)} / {n2(o.energy[i] ?? 0)}</td>)}
                          <td className="num"><strong>{n2(result.generation.monthly[i] ?? 0)}</strong></td><td className="num">{n0(result.generation.consumptionByMonth[i] ?? 0)}</td><td className="num">{n2(result.generation.periodGeneration[i] ?? 0)}</td></tr>
                      ))}
                      <tr><td><strong>Anual</strong></td><td /><td colSpan={result.generation.orientations.filter((o) => o.modules > 0).length} /><td className="num"><strong>{n2(result.generation.annual)}</strong></td><td className="num">{n0(result.generation.annualConsumption)}</td><td /></tr>
                    </tbody>
                  </table>
                  <p className="projects-help">PR {result.generation.parameters.performanceRatio} · margen {result.generation.parameters.safetyMargin} · pérdidas {result.generation.parameters.loss1} + {result.generation.parameters.loss2} · latitud {result.generation.latitude}°.</p>
                </div>
              ) : null}
              {tab === "recibo" ? <BillTables result={result} /> : null}
              {tab === "precio" ? (
                <div className="projects-table-wrap">
                  <table className="projects-table">
                    <thead><tr><th>Concepto</th><th>Marca</th><th className="num">Cantidad</th><th className="num">Unitario USD</th><th className="num">Total USD con utilidad</th></tr></thead>
                    <tbody>{result.pricing.bom.map((l) => <tr key={l.concept}><td>{l.concept}</td><td>{l.brand ?? "—"}{l.powerW ? ` · ${l.powerW} W` : ""}</td><td className="num">{l.quantity}</td><td className="num">{n2(l.unitUsd)}</td><td className="num">{n2(l.totalUsd)}</td></tr>)}
                      <tr><td colSpan={4}><strong>BOM en MXN</strong></td><td className="num"><strong>{money(result.pricing.bomTotalMxn)}</strong></td></tr>
                      <tr><td colSpan={4}>Precio sugerido por watt</td><td className="num">{n2(result.pricing.suggestedPricePerWatt)} MXN/W</td></tr>
                      <tr><td colSpan={4}>Servicios adicionales</td><td className="num">{money(result.pricing.servicesMxn)}</td></tr>
                      <tr><td colSpan={4}><strong>Precio de contado {input.addIva ? "con IVA" : "sin IVA"}</strong></td><td className="num"><strong>{money(result.pricing.cashPrice)}</strong></td></tr>
                      {["Anticipo", "Arribo de material", "Terminación", "Entrega"].map((l, i) => <tr key={l}><td colSpan={4}>{l} ({pct(input.advances[i] ?? 0)})</td><td className="num">{money(result.pricing.advances[i] ?? 0)}</td></tr>)}
                      {result.pricing.financing.filter((f) => f.months > 0).map((f, i) => <tr key={i}><td colSpan={4}>Renta {i + 1}: {money(f.amount)} en {f.months} mensualidades</td><td className="num">{money(f.monthly)} / mes</td></tr>)}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {tab === "proyeccion" ? (
                <div className="projects-table-wrap">
                  <table className="projects-table">
                    <thead><tr><th>Año</th><th className="num">Pago sin FV</th><th className="num">Producción</th><th className="num">Pago con FV</th><th className="num">Ahorro</th><th className="num">Acumulado</th><th className="num">Flujo</th></tr></thead>
                    <tbody>{result.projection.years.map((y) => <tr key={y.year}><td>{y.year}</td><td className="num">{money(y.payment)}</td><td className="num">{n0(y.production)} kWh</td><td className="num">{money(y.paymentWithPv)}</td><td className="num">{money(y.savings)}</td><td className="num">{money(y.cumulative)}</td><td className="num">{money(y.cashFlow)}</td></tr>)}</tbody>
                  </table>
                  <p className="projects-help">TIR {result.projection.recovers ? pct(result.projection.irr) : "no aplica"} · {paybackLabel(result)} · deducción {money(result.projection.deduction)} en el año 1.</p>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function BillTables({ result }: { result: QuoteResult }) {
  const cols = (rows: Array<Record<string, unknown>>, keys: Array<[string, string]>) => (
    <div className="projects-table-wrap">
      <table className="projects-table solar-bill">
        <thead><tr><th>Concepto</th>{rows.map((r, i) => <th className="num" key={i}>{typeof r.month === "number" ? MONTH_NAMES[(r.month as number) - 1]?.slice(0, 3) : `P${i + 1}`}</th>)}<th className="num">Anual</th></tr></thead>
        <tbody>
          {keys.map(([key, label]) => (
            <tr key={key}><td>{label}</td>{rows.map((r, i) => <td className="num" key={i}>{typeof r[key] === "number" ? n2(r[key] as number) : String(r[key] ?? "—")}</td>)}<td className="num">{rows.every((r) => typeof r[key] === "number") ? n2(rows.reduce((a, r) => a + (r[key] as number), 0)) : ""}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const seg = result.input.segment;
  const withoutKeys: Array<[string, string]> = seg === "RESIDENTIAL"
    ? [["kwh", "kWh"], ["tiered", "Cargo por escalones"], ["dacTotal", "Cargo DAC"], ["subtotal", "Subtotal"], ["iva", "IVA"], ["dap", "DAP"], ["total", "Total"]]
    : seg === "COMMERCIAL"
      ? [["kwh", "kWh"], ["billableKw", "kW facturable"], ["fixed", "Cargo fijo"], ["distribution", "Distribución"], ["transmission", "Transmisión"], ["energy", "Energía"], ["capacity", "Capacidad"], ["supply", "Suministro"], ["powerFactorAdj", "Factor de potencia"], ["subtotal", "Subtotal"], ["iva", "IVA"], ["dap", "DAP"], ["total", "Total"]]
      : [["kwh", "kWh"], ["billableKw", "kW facturable"], ["powerFactor", "FP"], ["fixed", "Cargo fijo"], ["distribution", "Distribución"], ["transmission", "Transmisión"], ["energyBase", "Base"], ["energyIntermediate", "Intermedia"], ["energyPeak", "Punta"], ["capacity", "Capacidad"], ["supply", "Suministro"], ["powerFactorAdj", "Factor de potencia"], ["subtotal", "Subtotal"], ["iva", "IVA"], ["dap", "DAP"], ["total", "Total"]];
  const withKeys: Array<[string, string]> = seg === "RESIDENTIAL"
    ? [["generation", "Generación"], ["net", "Neto kWh"], ["rolling12m", "Consumo 12 m"], ["tariff", "Tarifa"], ["subtotal", "Subtotal"], ["iva", "IVA"], ["dap", "DAP"], ["total", "Total"]]
    : [["generation", "Generación"], ["net", "Neto kWh"], ["supply", "Suministro"], ["subtotal", "Subtotal"], ["iva", "IVA"], ["dap", "DAP"], ["total", "Total"]];
  return (
    <>
      <h3 className="solar-h3">Sin paneles · últimos 12 periodos ({money(result.bill.annualWithout)} al año)</h3>
      {cols(result.bill.without as Array<Record<string, unknown>>, withoutKeys)}
      <h3 className="solar-h3">Con paneles · siguientes 12 periodos ({money(result.bill.annualWith)} al año)</h3>
      {cols(result.bill.with as Array<Record<string, unknown>>, withKeys)}
      {result.bill.extra?.capacitorKvar != null ? <p className="projects-help">Banco de capacitores para FP {result.bill.extra.targetPowerFactor}: {n2(result.bill.extra.capacitorKvar)} kVAr (demanda promedio {n2(result.bill.extra.averageDemandKw ?? 0)} kW, FP promedio {((result.bill.extra.averagePowerFactor ?? 0) * 100).toFixed(2)} %).</p> : null}
      {result.bill.warnings.map((w) => <div className="projects-notice" data-tone="warning" key={w}>{w}</div>)}
    </>
  );
}
