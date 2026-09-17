"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Route } from "next";

import { PageHeader, Panel } from "@/components/solar/ui";
import { computeAcCircuit, type AcCircuitInput } from "@/lib/solar/engineering/ac-circuit";
import { computeArray, MAX_MPPT, type ArrayInput } from "@/lib/solar/engineering/array";
import { computeDcCircuit, type DcCircuitInput } from "@/lib/solar/engineering/dc-circuit";
import { computePanelBoard } from "@/lib/solar/engineering/panel-board";
import { computePowerFactor, defaultPowerFactorInput, type PowerFactorInput } from "@/lib/solar/engineering/power-factor";
import { computeShading, DEFAULT_HOURS_WITHOUT_SHADE, type ShadingInput } from "@/lib/solar/engineering/shading";
import { ShadowScene } from "@/components/solar/ShadowScene";
import type { SolarCatalog } from "@/lib/solar/types";

/* Cálculos de ingeniería básicos: las seis herramientas del libro en una sola pantalla.
   Un encabezado de proyecto alimenta a todas; Arreglos alimenta a Corriente directa, y
   Corriente alterna y Corriente directa alimentan a Tableros, como en el Excel. */

export type EngineeringProject = { name: string; city: string; moduleModel: string; inverterModel: string; modulesToInstall: number; invertersCount: number };
export type QuoteRef = { id: string; name: string; segment: string };

type Tool = "sombras" | "arreglos" | "dc" | "ac" | "tableros" | "capacitores";
const TOOLS: Array<{ key: Tool; label: string; title: string }> = [
  { key: "sombras", label: "Sombras", title: "Calculadora de sombras" },
  { key: "arreglos", label: "Arreglos", title: "Arreglos de módulos en inversor" },
  { key: "dc", label: "Corriente directa", title: "Circuito eléctrico en corriente directa" },
  { key: "ac", label: "Corriente alterna", title: "Circuito eléctrico en corriente alterna" },
  { key: "tableros", label: "Tableros", title: "Tableros de distribución" },
  { key: "capacitores", label: "Capacitores", title: "Corrección de factor de potencia" },
];

const nf = (d: number) => new Intl.NumberFormat("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d });
const n = (v: number | null | undefined, d = 2, suffix = "") => (typeof v === "number" && Number.isFinite(v) ? `${nf(d).format(v)}${suffix}` : "—");
const pct = (v: number | null | undefined, d = 2) => (typeof v === "number" && Number.isFinite(v) ? `${nf(d).format(v * 100)} %` : "—");

function Num({ label, value, onChange, step = 1, min, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; hint?: string }) {
  return (
    <label className="eng-field">
      <span>{label}</span>
      <input inputMode="decimal" min={min} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} step={step} type="number" value={Number.isFinite(value) ? value : 0} />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}
function Sel<T extends string>({ label, value, onChange, options, hint }: { label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; hint?: string }) {
  return (
    <label className="eng-field">
      <span>{label}</span>
      <select onChange={(e) => onChange(e.target.value as T)} value={value}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}
function Txt({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="eng-field"><span>{label}</span><input onChange={(e) => onChange(e.target.value)} type="text" value={value} /></label>;
}
function Row({ label, value, tone, note }: { label: string; value: string; tone?: "ok" | "bad" | "warn"; note?: string }) {
  return <div className={`eng-row${tone ? ` is-${tone}` : ""}`}><span>{label}{note ? <small>{note}</small> : null}</span><strong>{value}</strong></div>;
}
function Big({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="eng-big"><span>{label}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}</div>;
}
function Warnings({ items }: { items: string[] }) {
  return items.length ? <ul className="eng-warnings">{items.map((w) => <li key={w}>{w}</li>)}</ul> : null;
}

/** Icono de cada herramienta, a trazo, con el mismo estilo que las tarjetas del cotizador. */
function ToolIcon({ tool }: { tool: Tool }) {
  const c = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <span aria-hidden="true" className="eng-tab-icon">
      <svg height="26" viewBox="0 0 48 48" width="26" xmlns="http://www.w3.org/2000/svg">
        {tool === "sombras" ? (
          <g {...c}>
            <circle cx="14" cy="13" r="4.5" />
            <path d="M14 4v3M14 19v3M5 13h3M20 13h3M7.6 6.6l2.1 2.1M18.3 17.4l2.1 2.1M20.4 6.6l-2.1 2.1M9.7 17.4l-2.1 2.1" />
            <path d="M22 36l10-11 12 0-10 11z" fill="currentColor" fillOpacity="0.18" />
            <path d="M27 36v6M39 36v6" />
            <path d="M6 42h38" />
            <path d="M8 42l10-5" strokeDasharray="2 3" />
          </g>
        ) : null}
        {tool === "arreglos" ? (
          <g {...c}>
            <path d="M6 10h36v22H6z" />
            <path d="M18 10v22M30 10v22M6 21h36" />
            <path d="M6 10h12v11H6z" fill="currentColor" fillOpacity="0.18" />
            <path d="M24 32v6M16 38h16" />
          </g>
        ) : null}
        {tool === "dc" ? (
          <g {...c}>
            <path d="M8 21h32" />
            <path d="M8 28h5M16 28h5M24 28h5M32 28h5" />
            <path d="M14 10h20v5H14z" fill="currentColor" fillOpacity="0.18" />
            <path d="M12 15h24v22H12z" />
            <path d="M19 26h10M24 21v10" />
          </g>
        ) : null}
        {tool === "ac" ? (
          <g {...c}>
            <path d="M6 24c4-12 8-12 12 0s8 12 12 0 8-12 12 0" />
            <path d="M6 36h36" strokeDasharray="3 3" />
            <path d="M6 12h36" strokeDasharray="3 3" />
          </g>
        ) : null}
        {tool === "tableros" ? (
          <g {...c}>
            <path d="M10 6h28v36H10z" />
            <path d="M15 12h8v6h-8zM25 12h8v6h-8zM15 21h8v6h-8zM25 21h8v6h-8zM15 30h8v6h-8z" />
            <path d="M25 30h8v6h-8z" fill="currentColor" fillOpacity="0.25" />
            <path d="M24 2v4" />
          </g>
        ) : null}
        {tool === "capacitores" ? (
          <g {...c}>
            <path d="M6 24h13M29 24h13" />
            <path d="M19 12v24M29 12v24" strokeWidth="2.4" />
            <path d="M12 10v6M9 13h6M36 13h6" />
            <path d="M6 24a18 18 0 0 1 36 0" strokeDasharray="3 3" />
          </g>
        ) : null}
      </svg>
    </span>
  );
}

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/SOLAR_CITY_NOT_FOUND.*/u, "Ciudad no encontrada en el catálogo.").replace(/SOLAR_MODULE_NOT_FOUND.*/u, "Módulo no encontrado en el catálogo.").replace(/SOLAR_INVERTER_NOT_FOUND.*/u, "Inversor no encontrado en el catálogo.") : "No se pudo calcular.");

export function EngineeringWorkspace({ catalog, quotes, initialProject, quoteId, initialTool }: { catalog: SolarCatalog; quotes: QuoteRef[]; initialProject: EngineeringProject | null; quoteId: string | null; initialTool?: string | null }) {
  const router = useRouter();
  const [tool, setTool] = useState<Tool>(TOOLS.some((t) => t.key === initialTool) ? (initialTool as Tool) : "sombras");
  const [project, setProject] = useState<EngineeringProject>(initialProject ?? {
    name: "", city: catalog.cities[0]?.city ?? "", moduleModel: catalog.modules[0]?.model ?? "", inverterModel: catalog.inverters[0]?.model ?? "", modulesToInstall: 0, invertersCount: 1,
  });
  const cityOptions = catalog.cities.map((c) => ({ value: c.city, label: c.city }));
  const moduleOptions = catalog.modules.map((m) => ({ value: m.model, label: m.model }));
  const inverterOptions = catalog.inverters.map((i) => ({ value: i.model, label: i.model }));

  // ---- Sombras
  const [sh, setSh] = useState<Omit<ShadingInput, "city" | "moduleModel">>({ obstacleHeightM: 0, inclinationDeg: 20, slopedSurface: false, slopeDeg: 0, modulesPerPanel: 2, orientation: "VERTICAL", hoursWithoutShade: DEFAULT_HOURS_WITHOUT_SHADE });
  const shading = useMemo(() => { try { return { r: computeShading({ ...sh, city: project.city, moduleModel: project.moduleModel }, catalog), e: null }; } catch (e) { return { r: null, e: errText(e) }; } }, [sh, project.city, project.moduleModel, catalog]);

  // ---- Arreglos
  const [arr, setArr] = useState<{ designMaxV: number | null; mppts: ArrayInput["mppts"] }>({ designMaxV: null, mppts: Array.from({ length: MAX_MPPT }, () => ({ strings: 0, modules: 0 })) });
  const array = useMemo(() => { try { return { r: computeArray({ projectName: project.name, city: project.city, moduleModel: project.moduleModel, inverterModel: project.inverterModel, modulesToInstall: project.modulesToInstall, invertersCount: project.invertersCount, designMaxV: arr.designMaxV, mppts: arr.mppts }, catalog), e: null }; } catch (e) { return { r: null, e: errText(e) }; } }, [arr, project, catalog]);

  // ---- Corriente alterna
  const [ac, setAc] = useState<Omit<AcCircuitInput, "projectName" | "city" | "inverterModel" | "invertersCount">>({ gridV: null, material: "Cobre", installation: "Tubería", ambientC: 30, conductorsPerRaceway: 3, insulation: "THHW-LS", tempRating: 75, onRooftop: false, roofSeparationMm: 40, selectedMm2: null, lengthM: 30 });
  const acr = useMemo(() => { try { return { r: computeAcCircuit({ ...ac, projectName: project.name, city: project.city, inverterModel: project.inverterModel, invertersCount: project.invertersCount }, catalog), e: null }; } catch (e) { return { r: null, e: errText(e) }; } }, [ac, project, catalog]);

  // ---- Corriente directa (toma el MPPT 1 de Arreglos y el ambiente de Alterna)
  const [dc, setDc] = useState<{ installation: DcCircuitInput["installation"]; awg: DcCircuitInput["awg"]; circuitsInRaceway: number; lengthM: number; combinedStrings: boolean; moduleMaxFuseA: number | null }>({ installation: "Tubería", awg: 10, circuitsInRaceway: 1, lengthM: 20, combinedStrings: false, moduleMaxFuseA: null });
  const mppt1 = array.r?.mppts[0] ?? null;
  const panel = catalog.modules.find((m) => m.model === project.moduleModel) ?? null;
  // Fusible máximo: el capturado manda; si no, el de la ficha del módulo en el catálogo.
  const effectiveFuse = dc.moduleMaxFuseA ?? panel?.maxSeriesFuseA ?? null;
  const dcr = useMemo(() => {
    if (!array.r) return { r: null, e: array.e };
    const series = mppt1 && mppt1.strings > 0 ? mppt1.modulesPerString : array.r.maxSeries;
    return { r: computeDcCircuit({ modulesInSeries: series, strings: Math.max(mppt1?.strings ?? 0, 1), iscStcA: array.r.stc.isc, impStcA: array.r.stc.imp, vocColdV: array.r.cold.voc, vmpHotV: array.r.hot.vmp, inverterMaxV: array.r.inverter.maxDcInputV, installation: dc.installation, awg: dc.awg, circuitsInRaceway: dc.circuitsInRaceway, insulationC: 90, ambientC: ac.ambientC, onRooftop: ac.onRooftop, roofSeparationMm: ac.roofSeparationMm, lengthM: dc.lengthM, combinedStrings: dc.combinedStrings, moduleMaxFuseA: effectiveFuse }), e: null, series };
  }, [array, mppt1, dc, effectiveFuse, ac.ambientC, ac.onRooftop, ac.roofSeparationMm]);

  // ---- Tableros
  const [tb, setTb] = useState({ busbarA: 250, mainBreakerA: 200, interconnection: "Barras" as "Barras" | "Lado de línea" });
  const tbr = useMemo(() => {
    if (!acr.r || !dcr.r) return null;
    return computePanelBoard({ config: acr.r.config, lineToLineV: acr.r.lineToLineV, inverterModel: project.inverterModel, invertersCount: project.invertersCount, inverterOutputA: acr.r.maxOutputA, feederMm2: acr.r.selected?.mm2 ?? null, feederAwg: acr.r.selected?.awg ?? null, feederCorrectedA: acr.r.selected?.correctedA ?? null, acDropFraction: acr.r.voltageDropFraction, dcDropFraction: dcr.r.voltageDropFraction, dcStringCurrentA: dcr.r.circuitMaxA, dcMinimumAwg: dcr.r.minimumAwg, dcFuseA: dcr.r.fuseA, arrayInverterModel: project.inverterModel, busbarA: tb.busbarA, mainBreakerA: tb.mainBreakerA, interconnection: tb.interconnection });
  }, [acr, dcr, project.inverterModel, project.invertersCount, tb]);

  // ---- Capacitores
  const [pf, setPf] = useState<PowerFactorInput>(defaultPowerFactorInput);
  const pfr = useMemo(() => computePowerFactor(pf), [pf]);

  const active = TOOLS.find((t) => t.key === tool)!;
  return (
    <main className="shell section operations-main projects-page eng-page" id="main-content" tabIndex={-1}>
      <PageHeader title="Cálculos de ingeniería básicos" description="Las herramientas de ingeniería del libro: sombras, arreglos en inversor, circuitos en corriente directa y alterna, tableros y banco de capacitores. Un mismo proyecto alimenta a todas.">
        <button className="projects-button" onClick={() => window.print()} type="button">Imprimir / PDF</button>
      </PageHeader>

      <section className="eng-project">
        <div className="eng-project-grid">
          <Txt label="Nombre del proyecto" onChange={(v) => setProject({ ...project, name: v })} value={project.name} />
          <Sel label="Ciudad" onChange={(v) => setProject({ ...project, city: v })} options={cityOptions} value={project.city} />
          <Sel label="Módulo solar" onChange={(v) => setProject({ ...project, moduleModel: v })} options={moduleOptions} value={project.moduleModel} />
          <Sel label="Inversor" onChange={(v) => setProject({ ...project, inverterModel: v })} options={inverterOptions} value={project.inverterModel} />
          <Num label="Módulos a instalar" min={0} onChange={(v) => setProject({ ...project, modulesToInstall: v })} value={project.modulesToInstall} />
          <Num label="Inversores" min={1} onChange={(v) => setProject({ ...project, invertersCount: v })} value={project.invertersCount} />
        </div>
        <div className="eng-project-load">
          <label className="eng-field"><span>Cargar desde una cotización guardada</span>
            <select onChange={(e) => { if (e.target.value) router.push(`/operacion/proyectos/ingenieria?cotizacion=${e.target.value}` as Route); }} value={quoteId ?? ""}>
              <option value="">Sin cotización</option>
              {quotes.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
          </label>
          {quoteId ? <Link className="projects-button secondary" href={`/operacion/proyectos/cotizar?cotizacion=${quoteId}` as Route}>Abrir la cotización</Link> : null}
        </div>
      </section>

      <nav className="projects-tabs eng-tabs" aria-label="Herramientas">
        {TOOLS.map((t) => (
          <button aria-current={tool === t.key ? "page" : undefined} className="projects-button secondary eng-tab" key={t.key} onClick={() => setTool(t.key)} type="button">
            <ToolIcon tool={t.key} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <h2 className="eng-print-title">{active.title}{project.name ? ` · ${project.name}` : ""}</h2>

      {tool === "sombras" ? (
        <div className="eng-grid">
          <Panel title="Información de instalación" description="Distancia mínima entre filas para que no se hagan sombra en el solsticio de invierno durante la ventana de horas sin sombra.">
            <div className="eng-form">
              <Num hint="Árbol, muro o edificio frente a la primera fila. Su distancia se ajusta en el simulador." label="Altura del obstáculo frontal (m)" min={0} onChange={(v) => setSh({ ...sh, obstacleHeightM: v })} step={0.1} value={sh.obstacleHeightM} />
              <Num label="Inclinación del panel (°)" min={0} onChange={(v) => setSh({ ...sh, inclinationDeg: v })} value={sh.inclinationDeg} />
              <Sel label="¿Inclinación en la superficie?" onChange={(v) => setSh({ ...sh, slopedSurface: v === "SI" })} options={[{ value: "NO", label: "No" }, { value: "SI", label: "Sí" }]} value={sh.slopedSurface ? "SI" : "NO"} />
              <Num hint="Positiva si el terreno sube hacia atrás." label="Ángulo de la pendiente (°)" min={-30} onChange={(v) => setSh({ ...sh, slopeDeg: v })} value={sh.slopeDeg} />
              <Num label="Módulos por panel" min={0} onChange={(v) => setSh({ ...sh, modulesPerPanel: v })} value={sh.modulesPerPanel} />
              <Sel label="Orientación del módulo" onChange={(v) => setSh({ ...sh, orientation: v })} options={[{ value: "VERTICAL", label: "Vertical" }, { value: "HORIZONTAL", label: "Horizontal" }]} value={sh.orientation} />
              <Num hint="El libro usa 9.25 h centradas al mediodía solar." label="Horas sin sombra" min={1} onChange={(v) => setSh({ ...sh, hoursWithoutShade: v })} step={0.25} value={sh.hoursWithoutShade ?? DEFAULT_HOURS_WITHOUT_SHADE} />
            </div>
          </Panel>
          <Panel title="Resultado">
            {shading.e ? <div className="projects-notice" data-tone="danger">{shading.e}</div> : shading.r ? (
              <>
                <div className="eng-bigs">
                  <Big label="Longitud total del panel" value={n(shading.r.panelLengthM, 2, " m")} note={`${n(shading.r.modulesLengthM, 3, " m")} de módulos más 2 cm por módulo`} />
                  <Big label="Distancia mínima de pie a pie" value={n(shading.r.rowDistanceM, 2, " m")} note={sh.slopedSurface ? `sin pendiente sería ${n(shading.r.rowDistanceFlatM, 2, " m")}` : "superficie plana"} />
                  <Big label="Distancia al obstáculo" value={n(shading.r.obstacleDistanceM, 2, " m")} note={sh.obstacleHeightM > 0 ? "libre entre el obstáculo y la primera fila" : "sin obstáculo capturado"} />
                </div>
                <div className="eng-rows">
                  <Row label="Latitud del sitio" value={n(shading.r.latitude, 0, "°")} />
                  <Row label="Altura solar al inicio de la ventana" value={n(shading.r.solarAltitudeDeg, 2, "°")} note="solsticio de invierno, declinación −23.43°" />
                  <Row label="Azimut solar" value={n(shading.r.solarAzimuthDeg, 2, "°")} />
                  <Row label="Comprobación con criterio de colectores" value={n(shading.r.collectorCheckM, 2, " m")} />
                </div>
                <Warnings items={shading.r.warnings} />
              </>
            ) : null}
          </Panel>
          {shading.r ? (
            <div className="eng-span">
              <Panel title="Simulador de sombra" description="El 21 de diciembre el sol va más bajo que cualquier otro día: si las filas no se hacen sombra ese día, no se la hacen nunca. Mueve la hora para ver la sombra y prueba otra distancia entre filas.">
                <ShadowScene inclinationDeg={sh.inclinationDeg} obstacleHeightM={sh.obstacleHeightM} result={shading.r} site={{ city: project.city, moduleModel: project.moduleModel, orientation: sh.orientation, modulesPerPanel: sh.modulesPerPanel }} slopeDeg={sh.slopedSurface ? sh.slopeDeg : 0} />
              </Panel>
            </div>
          ) : null}
        </div>
      ) : null}

      {tool === "arreglos" ? (
        array.e ? <div className="projects-notice" data-tone="danger">{array.e}</div> : array.r ? (
          <div className="eng-grid eng-grid-wide">
            <Panel title="Propiedades eléctricas del módulo" description={`Celda a ${n(array.r.cellTempMaxC, 1, " °C")} máx y ${n(array.r.cellTempMinC, 1, " °C")} mín según la ciudad y el TONC del módulo.`}>
              <table className="projects-table eng-table">
                <thead><tr><th></th><th className="num">STC</th><th className="num">Máx temp</th><th className="num">Mín temp</th></tr></thead>
                <tbody>
                  {([["Voc (V)", "voc", 2], ["Isc (A)", "isc", 2], ["Vmp (V)", "vmp", 2], ["Imp (A)", "imp", 2], ["Pmp (W)", "pmp", 1]] as const).map(([lb, k, d]) => (
                    <tr key={k}><td>{lb}</td><td className="num">{n(array.r!.stc[k], d)}</td><td className="num">{n(array.r!.hot[k], d)}</td><td className="num">{n(array.r!.cold[k], d)}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="eng-rows">
                <Row label="Voltaje de entrada del inversor" value={`${n(array.r.inverter.mpptMinV, 0)} a ${n(array.r.inverter.maxDcInputV, 0)} V`} />
                <Row label="MPPT · cadenas totales · potencia FV máx" value={`${array.r.inverter.mpptCount} · ${array.r.inverter.totalStrings} · ${n(array.r.inverter.pmaxFvW, 0, " W")}`} />
                <Num label="Tensión máxima de diseño (V)" min={0} onChange={(v) => setArr({ ...arr, designMaxV: v || null })} value={array.r.designMaxV} hint="Por defecto la máxima de entrada del inversor." />
              </div>
            </Panel>
            <Panel title="Límites del sistema">
              <div className="eng-rows">
                <Row label="Módulos máximo en inversor (por potencia)" value={String(array.r.maxModulesByPower)} />
                <Row label="Módulos mínimo en inversor (por tensión)" value={String(array.r.minModulesByVoltage)} />
                <Row label="Módulos en serie" value={`${array.r.minSeries} a ${array.r.maxSeries}`} tone={array.r.maxSeries >= array.r.minSeries ? "ok" : "bad"} />
                <Row label="Total de módulos acomodados" value={String(array.r.totalModules)} tone={array.r.placementDelta === 0 ? "ok" : "warn"} note={array.r.placementDelta < 0 ? `faltan ${-array.r.placementDelta}` : array.r.placementDelta > 0 ? `${array.r.placementDelta} de más` : "completo"} />
                <Row label="Potencia FV" value={n(array.r.pvKw, 2, " kWp")} />
                <Row label="Relación DC/AC" value={pct(array.r.dcAcRatio, 0)} tone={array.r.dcAcRatio > 1.5 ? "warn" : undefined} />
              </div>
              <Warnings items={array.r.warnings} />
            </Panel>
            <Panel title="Arreglo por MPPT" description="Captura cadenas y módulos por MPPT. La tabla muestra los tamaños permitidos (módulos en serie × cadenas en paralelo) y abajo la revisión contra el inversor.">
              <div className="eng-mppts">
                {array.r.mppts.filter((m) => m.index < Math.max(1, array.r!.inverter.mpptCount)).map((m) => (
                  <div className="eng-mppt" key={m.index}>
                    <h4>MPPT {m.index + 1} <small>{n(m.refMaxA, 0, " A")} máx</small></h4>
                    <div className="eng-form is-tight">
                      <Num label="Cadenas" min={0} onChange={(v) => setArr({ ...arr, mppts: arr.mppts.map((x, k) => (k === m.index ? { ...x, strings: v } : x)) })} value={m.strings} />
                      <Num label="Módulos" min={0} onChange={(v) => setArr({ ...arr, mppts: arr.mppts.map((x, k) => (k === m.index ? { ...x, modules: v } : x)) })} value={m.modules} />
                    </div>
                    {m.seriesOptions.length && m.parallelOptions.length ? (
                      <details className="eng-details">
                        <summary>Tamaños permitidos: {m.seriesOptions[0]} a {m.seriesOptions[m.seriesOptions.length - 1]} en serie × hasta {m.parallelOptions.length} en paralelo</summary>
                        <table className="eng-matrix"><thead><tr><th>serie ╲ paralelo</th>{m.parallelOptions.map((p) => <th key={p}>{p}</th>)}</tr></thead>
                          <tbody>{m.seriesOptions.map((s) => <tr key={s}><th>{s}</th>{m.parallelOptions.map((p) => <td className={m.strings === p && m.modulesPerString === s ? "is-current" : ""} key={p}>{s * p}</td>)}</tr>)}</tbody></table>
                      </details>
                    ) : <p className="projects-help">{m.seriesOptions.length ? "Sin cadenas en paralelo posibles: la corriente del módulo supera la del MPPT." : "Sin tamaños permitidos con este módulo e inversor."}</p>}
                    {m.strings > 0 || m.modules > 0 ? (
                      <div className="eng-rows is-compact">
                        <Row label="Módulos por cadena" value={n(m.modulesPerString, 2)} note={n(m.powerKw, 2, " kW")} />
                        <Row label="Imp @ SRC" value={`${n(m.impAtSrc, 2, " A")} / ${n(m.refMaxA, 0, " A")}`} tone={m.impAtSrc <= m.refMaxA ? "ok" : "bad"} />
                        <Row label="Isc @ SRC · máximo 690.8" value={`${n(m.iscAtSrc, 2, " A")} · ${n(m.maxIsc, 2, " A")}`} />
                        <Row label="Máximo Voc [690.7]" value={`${n(m.maxVoc, 1, " V")} / ${n(m.refMaxV, 0, " V")}`} tone={m.maxVoc <= m.refMaxV ? "ok" : "bad"} />
                        <Row label="Vmp @ SRC" value={`${n(m.vmpAtSrc, 1, " V")} / ${n(m.refVmpMaxV, 0, " V")}`} tone={m.vmpAtSrc <= m.refVmpMaxV ? "ok" : "bad"} />
                        <Row label="Vmp @ mínimo" value={`${n(m.vmpAtMin, 1, " V")} / ${n(m.refMinV, 0, " V")}`} tone={m.vmpAtMin >= m.refMinV ? "ok" : "bad"} />
                      </div>
                    ) : null}
                    <Warnings items={m.issues} />
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        ) : null
      ) : null}

      {tool === "ac" ? (
        <div className="eng-grid">
          <Panel title="Datos de instalación para el inversor" description={acr.r ? `${acr.r.config} · ${n(acr.r.lineToLineV, 0, " V")} L-L · ${n(acr.r.lineToNeutralV, 0, " V")} L-N · ${n(acr.r.maxOutputA, 1, " A")} máx de salida · ${n(acr.r.maxOutputW, 0, " W")}` : ""}>
            <div className="eng-form">
              <Num hint="Vacío usa la del inversor." label="Tensión de salida L-L (V)" min={0} onChange={(v) => setAc({ ...ac, gridV: v || null })} value={ac.gridV ?? acr.r?.lineToLineV ?? 0} />
              <Sel label="Material del conductor" onChange={(v) => setAc({ ...ac, material: v })} options={[{ value: "Cobre", label: "Cobre" }, { value: "Aluminio", label: "Aluminio" }]} value={ac.material} />
              <Sel label="Instalación del conductor" onChange={(v) => setAc({ ...ac, installation: v })} options={[{ value: "Tubería", label: "En canalización (tubería)" }, { value: "Aire libre", label: "Al aire libre" }]} value={ac.installation} />
              <Num label="Temperatura ambiente de cálculo (°C)" onChange={(v) => setAc({ ...ac, ambientC: v })} value={ac.ambientC} />
              <Num label="Conductores por canalización" min={1} onChange={(v) => setAc({ ...ac, conductorsPerRaceway: v })} value={ac.conductorsPerRaceway} />
              <Txt label="Tipo de aislamiento" onChange={(v) => setAc({ ...ac, insulation: v })} value={ac.insulation} />
              <Sel label="Temperatura máxima de operación" onChange={(v) => setAc({ ...ac, tempRating: Number(v) as 60 | 75 | 90 })} options={[{ value: "60", label: "60 °C" }, { value: "75", label: "75 °C" }, { value: "90", label: "90 °C" }]} value={String(ac.tempRating)} />
              <Sel label="¿Sobre techumbre o suelo?" onChange={(v) => setAc({ ...ac, onRooftop: v === "Si" })} options={[{ value: "No", label: "No" }, { value: "Si", label: "Sí" }]} value={ac.onRooftop ? "Si" : "No"} />
              <Num label="Separación al techo (mm)" min={0} onChange={(v) => setAc({ ...ac, roofSeparationMm: v })} value={ac.roofSeparationMm} />
              <Num label="Longitud del conductor por fase (m)" min={0} onChange={(v) => setAc({ ...ac, lengthM: v })} value={ac.lengthM} />
              {acr.r ? <Sel hint="Por defecto el recomendado." label="Calibre seleccionado" onChange={(v) => setAc({ ...ac, selectedMm2: Number(v) })} options={acr.r.table.map((t) => ({ value: String(t.mm2), label: `${t.awg} · ${n(t.mm2, 2, " mm²")} · ${n(t.correctedA, 0, " A")}` }))} value={String(acr.r.selected?.mm2 ?? acr.r.recommended?.mm2 ?? "")} /> : null}
            </div>
          </Panel>
          <Panel title="Resultado">
            {acr.e ? <div className="projects-notice" data-tone="danger">{acr.e}</div> : acr.r ? (
              <>
                <div className="eng-bigs">
                  <Big label="Calibre recomendado" value={acr.r.recommended?.awg ?? "—"} note={acr.r.recommended ? `${n(acr.r.recommended.mm2, 2, " mm²")} · ${n(acr.r.recommended.correctedA, 0, " A")} corregidos` : "sin calibre que alcance"} />
                  <Big label="Interruptor termomagnético" value={n(acr.r.breakerA, 0, " A")} note="siguiente normalizado ≥ 1.25 × corriente" />
                  <Big label="Tierra" value={acr.r.egc?.awg ?? "—"} note={acr.r.egc ? `${n(acr.r.egc.mm2, 2, " mm²")} · hasta ${n(acr.r.egcMaxA, 0, " A")}` : ""} />
                </div>
                <div className="eng-rows">
                  <Row label="Corriente máxima en el conductor" value={n(acr.r.maxCurrentA, 1, " A")} />
                  <Row label="Corriente compensada (× 1.25)" value={n(acr.r.compensatedA, 1, " A")} />
                  <Row label="Temperatura de diseño · factor" value={`${n(acr.r.designTempC, 0, " °C")} · ${n(acr.r.tempFactor, 2)}`} tone={acr.r.tempFactor === 0 ? "bad" : undefined} />
                  <Row label="Factor por agrupamiento" value={n(acr.r.groupingFactor, 2)} />
                  <Row label="Conductores por fase" value={String(acr.r.conductorsPerPhase)} />
                  <Row label="Calibre seleccionado · ampacidad corregida" value={acr.r.selected ? `${acr.r.selected.awg} · ${n(acr.r.selected.correctedA, 0, " A")}` : "—"} tone={acr.r.selected && acr.r.breakerA != null ? (acr.r.selected.correctedA >= acr.r.breakerA ? "ok" : "warn") : undefined} />
                  <Row label="Impedancia del conductor" value={n(acr.r.impedanceOhmKm, 3, " Ω/km")} />
                  <Row label="Caída de tensión" value={pct(acr.r.voltageDropFraction, 2)} tone={acr.r.voltageDropFraction <= 0.03 ? "ok" : "bad"} note={`tensión final ${n(acr.r.finalV, 2, " V")}`} />
                </div>
                <Warnings items={acr.r.warnings} />
              </>
            ) : null}
          </Panel>
        </div>
      ) : null}

      {tool === "dc" ? (
        <div className="eng-grid">
          <Panel title="Datos de instalación del circuito DC" description={array.r ? `Del arreglo (MPPT 1): ${dcr.series ?? array.r.maxSeries} módulos en serie, ${Math.max(mppt1?.strings ?? 0, 1)} cadena(s), Isc ${n(array.r.stc.isc, 2, " A")}, Voc frío ${n(array.r.cold.voc, 2, " V")}, Vmp caliente ${n(array.r.hot.vmp, 2, " V")}. Ambiente y techumbre vienen de Corriente alterna.` : ""}>
            <div className="eng-form">
              <Sel label="Tipo de canalización" onChange={(v) => setDc({ ...dc, installation: v })} options={[{ value: "Tubería", label: "Tubería" }, { value: "Aire libre", label: "Aire libre" }]} value={dc.installation} />
              <Sel label="Calibre del cable PV (AWG)" onChange={(v) => setDc({ ...dc, awg: Number(v) as DcCircuitInput["awg"] })} options={[14, 12, 10, 8, 6, 4].map((a) => ({ value: String(a), label: `${a} AWG` }))} value={String(dc.awg)} />
              <Num label="Circuitos DC en la misma canalización" min={1} onChange={(v) => setDc({ ...dc, circuitsInRaceway: v })} value={dc.circuitsInRaceway} />
              <Num label="Longitud de ida del circuito (m)" min={0} onChange={(v) => setDc({ ...dc, lengthM: v })} value={dc.lengthM} />
              <Sel label="¿Las cadenas se combinan en un solo conductor?" onChange={(v) => setDc({ ...dc, combinedStrings: v === "Si" })} options={[{ value: "No", label: "No" }, { value: "Si", label: "Sí" }]} value={dc.combinedStrings ? "Si" : "No"} />
              <Num hint={panel?.maxSeriesFuseA != null ? `Ficha: ${panel.maxSeriesFuseA} A · ${panel.fuseSource ?? ""}. Cambia el valor solo si tu ficha dice otra cosa.` : `${panel?.fuseSource ?? "Sin ficha pública"}; captura el de la ficha del proveedor.`} label="Fusible máximo de serie del módulo (A)" min={0} onChange={(v) => setDc({ ...dc, moduleMaxFuseA: v || null })} value={effectiveFuse ?? 0} />
            </div>
          </Panel>
          <Panel title="Resultados conforme a NOM-001-SEDE-2012" description="690-7, 690-8, 690-9, 690-31, 310-15, 240-6 y Capítulo 10.">
            {dcr.e ? <div className="projects-notice" data-tone="danger">{dcr.e}</div> : dcr.r ? (
              <>
                <div className="eng-bigs">
                  <Big label="Calibre mínimo que cumple" value={dcr.r.minimumAwg != null ? `${dcr.r.minimumAwg} AWG` : "—"} note={dcr.r.complies ? "el capturado cumple 690-8(b)(2)" : "el capturado no cumple"} />
                  <Big label="Fusible por cadena" value={n(dcr.r.fuseA, 0, " A")} note={dcr.r.fuseRequired ? "requerido: más de 2 cadenas" : "no requerido (2 cadenas o menos)"} />
                  <Big label="Tubería mínima" value={dcr.r.conduit ?? (dc.installation === "Aire libre" ? "N/A" : "—")} note={dc.installation === "Aire libre" ? "aire libre" : `${n(dcr.r.cableAreaMm2, 1, " mm²")} de cables`} />
                </div>
                <div className="eng-rows">
                  <Row label="Corriente máxima por cadena (1.25 × Isc)" value={n(dcr.r.stringMaxA, 2, " A")} />
                  <Row label="Corriente máxima del circuito" value={n(dcr.r.circuitMaxA, 2, " A")} />
                  <Row label="Corriente para el fusible (× 1.25)" value={n(dcr.r.fuseCurrentA, 2, " A")} />
                  <Row label="Temperatura de diseño · factor 90 °C" value={`${n(dcr.r.designTempC, 0, " °C")} · ${n(dcr.r.tempFactor, 2)}`} tone={dcr.r.tempFactor === 0 ? "bad" : undefined} />
                  <Row label="Factor por agrupamiento" value={n(dcr.r.groupingFactor, 2)} />
                  <Row label="Ampacidad base · corregida" value={`${n(dcr.r.baseAmpacityA, 0, " A")} · ${n(dcr.r.correctedAmpacityA, 1, " A")}`} tone={dcr.r.complies ? "ok" : "bad"} />
                  <Row label="Ampacidad base requerida" value={n(dcr.r.requiredBaseA, 2, " A")} />
                  <Row label="Fusible elegido vs máximo del módulo" value={dcr.r.fuseCheck === "ok" ? "Cumple" : dcr.r.fuseCheck === "exceeds" ? "No cumple" : dcr.r.fuseCheck === "unknown" ? "Captura el máximo del módulo" : "—"} tone={dcr.r.fuseCheck === "ok" ? "ok" : dcr.r.fuseCheck === "exceeds" ? "bad" : undefined} />
                  <Row label="Tensión máxima del arreglo (Voc frío × serie)" value={n(dcr.r.arrayMaxV, 1, " V")} tone={dcr.r.voltageOk ? "ok" : "bad"} note="≤ 1000 V y ≤ máxima del inversor" />
                  <Row label="Resistencia corregida a 90 °C" value={n(dcr.r.resistanceOhmKm90, 4, " Ω/km")} />
                  <Row label="Corriente de operación (Imp × cadenas)" value={n(dcr.r.operatingA, 2, " A")} />
                  <Row label="Caída de tensión" value={`${n(dcr.r.voltageDropV, 2, " V")} · ${pct(dcr.r.voltageDropFraction, 2)}`} tone={dcr.r.dropOk ? "ok" : "bad"} note="recomendación ≤ 3 %" />
                </div>
                <Warnings items={dcr.r.warnings} />
              </>
            ) : null}
          </Panel>
        </div>
      ) : null}

      {tool === "tableros" ? (
        <div className="eng-grid">
          <Panel title="Datos de la interconexión" description={acr.r ? `${acr.r.config} · ${n(acr.r.lineToLineV, 0, " V")} · ${project.invertersCount} inversor(es) de ${n(acr.r.maxOutputA, 1, " A")}` : ""}>
            <div className="eng-form">
              <Num label="Capacidad de barras del tablero existente (A)" min={0} onChange={(v) => setTb({ ...tb, busbarA: v })} value={tb.busbarA} />
              <Num label="Interruptor principal existente (A)" min={0} onChange={(v) => setTb({ ...tb, mainBreakerA: v })} value={tb.mainBreakerA} />
              <Sel label="Tipo de interconexión" onChange={(v) => setTb({ ...tb, interconnection: v })} options={[{ value: "Barras", label: "Barras" }, { value: "Lado de línea", label: "Lado de línea" }]} value={tb.interconnection} />
            </div>
          </Panel>
          <Panel title="Resultados" description="NOM-001-SEDE-2012 Art. 240, 250, 310 y 690; regla del 120 % NEC 705.12(D)(2).">
            {!tbr ? <div className="projects-notice" data-tone="danger">{acr.e ?? dcr.e ?? "Completa Arreglos y Corriente alterna primero."}</div> : (
              <>
                <div className="eng-bigs">
                  <Big label="Interruptor FV en el tablero" value={n(tbr.pvBreakerA, 0, " A")} note={`corriente de diseño ${n(tbr.designA, 2, " A")}`} />
                  <Big label="Regla de barras (120 %)" value={tbr.busbarRule === "ok" ? "Cumple" : tbr.busbarRule === "fail" ? "No cumple" : "N/A"} note={tbr.busbarRule === "fail" ? "tablero nuevo o lado de línea" : tbr.busbarRule === "na" ? "interconexión en lado de línea" : `${tb.mainBreakerA} + ${tbr.pvBreakerA} ≤ ${n(1.2 * tb.busbarA, 0)}`} />
                  <Big label="Caída acumulada DC + AC" value={pct(tbr.totalDropFraction, 2)} note="recomendación ≤ 5 %" />
                </div>
                <div className="eng-rows">
                  <Row label="Corriente total FV" value={n(tbr.totalPvA, 1, " A")} />
                  <Row label="Alimentador FV" value={acr.r?.selected ? `${acr.r.selected.awg} · ${n(acr.r.selected.mm2, 2, " mm²")} · ${n(acr.r.selected.correctedA, 0, " A")}` : "—"} />
                  <Row label="Conductor de puesta a tierra de equipos [250-122]" value={tbr.egc ? `${tbr.egc.awg} · ${n(tbr.egc.mm2, 2, " mm²")}` : "—"} />
                  <Row label="Conductor del electrodo de puesta a tierra [250-66]" value={tbr.gec ?? "—"} />
                  <Row label="Coherencia de inversor" value={tbr.sameInverter ? "Mismo inversor en Alterna y Arreglos" : "Inversores distintos"} tone={tbr.sameInverter ? "ok" : "warn"} />
                </div>
                <table className="projects-table eng-table"><thead><tr><th>Circuito</th><th className="num">Corriente de diseño (A)</th><th>Conductor</th><th className="num">Protección (A)</th><th>Tierra</th></tr></thead>
                  <tbody>{tbr.summary.map((s) => <tr key={s.circuit}><td>{s.circuit}</td><td className="num">{n(s.designA, 3)}</td><td>{s.conductor}</td><td className="num">{n(s.protectionA, 0)}</td><td>{s.ground}</td></tr>)}</tbody></table>
                <Warnings items={tbr.warnings} />
              </>
            )}
          </Panel>
        </div>
      ) : null}

      {tool === "capacitores" ? (
        <div className="eng-stack">
          <Panel title="Datos de entrada" description="Doce meses del recibo: demanda máxima, energía activa y reactiva. El factor de potencia medido se calcula al momento.">
            <div className="eng-form is-tight">
              <Num label="Factor de potencia deseado" min={0} onChange={(v) => setPf({ ...pf, targetPf: v })} step={0.01} value={pf.targetPf} />
              <Num label="Factor de potencia normado" min={0} onChange={(v) => setPf({ ...pf, requiredPf: v })} step={0.01} value={pf.requiredPf} />
              <Num label="Capacitor fijo a instalar (kVAr)" min={0} onChange={(v) => setPf({ ...pf, fixedBankKvar: v })} value={pf.fixedBankKvar} />
            </div>
            <div className="eng-bigs">
              <Big label="Capacitor promedio necesario" value={n(pfr.averageBankKvar, 2, " kVAr")} />
              <Big label="Capacitor mínimo necesario" value={n(pfr.minBankKvar, 2, " kVAr")} />
              <Big label="Capacitor máximo necesario" value={n(pfr.maxBankKvar, 2, " kVAr")} />
            </div>
            <div className="projects-table-wrap">
              <table className="projects-table eng-table">
                <thead><tr><th>Mes</th><th className="num">Demanda máx (kW)</th><th className="num">Energía activa (kWh)</th><th className="num">Energía reactiva (kVArh)</th><th className="num">FP medido</th><th className="num">Banco automático (kVAr)</th><th className="num">FP con banco fijo</th></tr></thead>
                <tbody>
                  {pfr.rows.map((r, i) => (
                    <tr key={r.month}>
                      <td>{r.month}</td>
                      <td className="num"><input className="cons-input" inputMode="decimal" onChange={(e) => setPf({ ...pf, months: pf.months.map((m, k) => (k === i ? { ...m, demandKw: Number(e.target.value) || 0 } : m)) })} type="number" value={r.demandKw} /></td>
                      <td className="num"><input className="cons-input" inputMode="decimal" onChange={(e) => setPf({ ...pf, months: pf.months.map((m, k) => (k === i ? { ...m, activeKwh: Number(e.target.value) || 0 } : m)) })} type="number" value={r.activeKwh} /></td>
                      <td className="num"><input className="cons-input" inputMode="decimal" onChange={(e) => setPf({ ...pf, months: pf.months.map((m, k) => (k === i ? { ...m, reactiveKvarh: Number(e.target.value) || 0 } : m)) })} type="number" value={r.reactiveKvarh} /></td>
                      <td className="num is-calc">{pct(r.pf, 2)}</td>
                      <td className="num is-calc">{n(r.autoBankKvar, 2)}</td>
                      <td className={`num is-calc${r.fixedBelowRequired ? " is-bad" : ""}`}>{pct(r.fixedPf, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Warnings items={pfr.warnings} />
          </Panel>
        </div>
      ) : null}
    </main>
  );
}
