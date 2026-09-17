import { MONTH_NAMES } from "@/lib/solar/catalog";
import type { QuoteResult, Segment } from "@/lib/solar/types";

/* Hoja de captura del libro (Inf_Vac_Res / Com / Ind) lista para imprimir a PDF.
   Reproduce el orden, las etiquetas y el formato de la hoja original: los recuadros
   blancos son capturas y los grises son celdas calculadas, igual que en el Excel. */

const TITLES: Record<Segment, string> = {
  RESIDENTIAL: "PROYECTOS FOTOVOLTAICOS\nRESIDENCIALES",
  COMMERCIAL: "PROYECTOS FOTOVOLTAICOS\nCOMERCIALES",
  INDUSTRIAL: "PROYECTOS FOTOVOLTAICOS\nINDUSTRIALES",
};

const nf = (d: number) => new Intl.NumberFormat("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d });
const n0 = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? nf(0).format(v) : "");
const n2 = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? nf(2).format(v) : "");
const money = (v: number | null | undefined, d = 2) => (typeof v === "number" && Number.isFinite(v) ? `$ ${nf(d).format(v)}` : "$ -");
const dash = (v: number | null | undefined, d = 2) => (typeof v === "number" && Number.isFinite(v) && v !== 0 ? `$ ${nf(d).format(v)}` : "$ -");
const pct0 = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? `${Math.round(v * 100)}%` : "0%");

/** Celda blanca = captura del operador. */
function In({ v, w, align = "center" }: { v: React.ReactNode; w?: string; align?: "center" | "left" }) {
  return <span className="hj-in" style={{ width: w, textAlign: align }}>{v}</span>;
}
/** Celda gris = la calcula el sistema, como en el libro. */
function Calc({ v, w, strong }: { v: React.ReactNode; w?: string; strong?: boolean }) {
  return <span className={`hj-calc${strong ? " is-strong" : ""}`} style={{ width: w }}>{v}</span>;
}
/** Celda azul = elección de catálogo (lista desplegable en el libro). */
function Pick({ v, w }: { v: React.ReactNode; w?: string }) {
  return <span className="hj-pick" style={{ width: w }}>{v}</span>;
}
function Label({ children, w }: { children: React.ReactNode; w?: string }) {
  return <span className="hj-lb" style={{ width: w }}>{children}</span>;
}
function Band({ children }: { children: React.ReactNode }) {
  return <div className="hj-band">{children}</div>;
}

/** Gráfica de consumo contra generación, una barra por mes, como la del libro. */
function Chart({ consumption, generation }: { consumption: number[]; generation: number[] }) {
  const W = 880, H = 190, padL = 46, padB = 34, padT = 10;
  const max = Math.max(1, ...consumption, ...generation);
  // Escalones redondos (100, 200, 250, 500 ...) como los del libro.
  const ticks = 7;
  const raw = max / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10;
  const top = nice * mag * ticks;
  const plotH = H - padB - padT, plotW = W - padL - 8;
  const slot = plotW / 12, bw = Math.min(17, slot / 3);
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  return (
    <svg className="hj-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Consumo de energía contra generación fotovoltaica por mes">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (top / ticks) * i;
        return (
          <g key={i}>
            <line x1={padL} x2={W - 8} y1={y(v)} y2={y(v)} stroke="#d9d9d9" strokeWidth="1" />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#595959">{n0(v)}</text>
          </g>
        );
      })}
      {MONTH_NAMES.map((m, i) => {
        const cx = padL + slot * i + slot / 2;
        const c = consumption[i] ?? 0, g = generation[i] ?? 0;
        return (
          <g key={m}>
            {c > 0 ? <rect x={cx - bw - 1} y={y(c)} width={bw} height={plotH + padT - y(c)} fill="#4472c4" /> : null}
            {g > 0 ? <rect x={cx + 1} y={y(g)} width={bw} height={plotH + padT - y(g)} fill="#ed7d31" /> : null}
            {c > 0 ? (() => { const bx = cx - bw / 2 - 1, by = Math.min(y(0) - 3, y(c) + 4 + n0(c).length * 5.4); return <text x={bx} y={by} fontSize="8" fill="#fff" fontWeight="700" textAnchor="start" transform={`rotate(-90 ${bx} ${by})`}>{n0(c)}</text>; })() : null}
            {g > 0 ? (() => { const bx = cx + bw / 2 + 1, by = Math.min(y(0) - 3, y(g) + 4 + n0(g).length * 5.4); return <text x={bx} y={by} fontSize="8" fill="#fff" fontWeight="700" textAnchor="start" transform={`rotate(-90 ${bx} ${by})`}>{n0(g)}</text>; })() : null}
            <text x={cx} y={H - padB + 14} textAnchor="middle" fontSize="9" fill="#404040">{m}</text>
          </g>
        );
      })}
      <line x1={padL} x2={W - 8} y1={y(0)} y2={y(0)} stroke="#a6a6a6" strokeWidth="1" />
      <g transform={`translate(${W / 2 - 110} ${H - 8})`}>
        <rect x="0" y="-8" width="9" height="9" fill="#4472c4" /><text x="13" y="0" fontSize="9" fill="#404040">Consumo de Energía</text>
        <rect x="120" y="-8" width="9" height="9" fill="#ed7d31" /><text x="133" y="0" fontSize="9" fill="#404040">Generación PV</text>
      </g>
    </svg>
  );
}

export function SolarQuoteSheet({ result }: { result: QuoteResult }) {
  const i = result.input;
  const monthsBack = i.period === "Bimestral" ? 2 : 1;
  // Historial: el libro lista de diciembre hacia atrás desde el mes facturado.
  const history = Array.from({ length: 12 }, (_, k) => {
    const monthIndex = ((i.billedMonth - 1 - k) % 12 + 12) % 12;
    const value = i.consumptionKwh[k] ?? 0;
    const shown = i.period === "Bimestral" ? (k % 1 === 0 ? value : 0) : value;
    return { month: MONTH_NAMES[monthIndex] ?? "", value: shown };
  });
  const average = result.averageConsumption;
  const bom = result.pricing;
  const servicesUsd = i.services.map((s) => (s.enabled && i.exchangeRate ? s.costMxn / i.exchangeRate : 0));
  const suggested = bom.suggestedPricePerWatt;
  const advances = i.advances;
  const firstInverter = result.inverters[0]?.inverter ?? null;
  const panel = result.module;
  const terms = [
    `Tiempo de entrega del proyecto de ${i.deliveryTime ?? "2 a 3 semanas"}.`,
    `El inicio de los trabajos será de ${i.startTime ?? "2 a 3 semanas"} posterior a la firma de contrato y pago de anticipo.`,
    `Vigencia de cotización de ${i.validityDays ?? 30} días.`,
    "No incluye obra civil, de ser necesario se cotizará por separado.",
    "No incluye trabajos de albañilería, de ser necesario se cotizará por separado.",
    "Las garantías son para los componentes del sistema fotovoltaico y están sujetas al criterio de cada fabricante.",
    "El cliente es responsable de asegurar la firmeza y resistencia de la superficie donde se instalará el sistema fotovoltaico.",
  ];
  const warranties = [
    ["Módulo Solar:", "Garantía por 25 años en defectos de fabricación y 15 años por el rendimiento del producto."],
    ["Inversor:", `${firstInverter?.warrantyYears ?? 10} años de garantía del producto.`],
    ["Estructura:", `${i.structureWarrantyYears ?? 20} años de garantía por defectos de fabricación.`],
    ["Instalación:", "2 años de garantía por defectos de mano de obra."],
    ["Soporte Técnico:", "2 años de soporte técnico a partir de la fecha de entrega."],
  ];

  return (
    <>
      <section className="hj-page">
        <header className="hj-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="hj-logo" src="/brand/ennco-lockup-knockout.svg" alt="ENNCO" />
          <h1>{TITLES[i.segment].split("\n").map((l) => <span key={l}>{l}</span>)}</h1>
        </header>

        <Band>Datos Generales del Proyecto:</Band>
        <div className="hj-body">
          <div className="hj-row"><Label w="170px">Nombre del Cliente:</Label><In v={i.customer.name} w="440px" /></div>
          <div className="hj-row"><Label w="170px">Subtítulo:</Label><In v={i.customer.subtitle ?? ""} w="440px" /></div>
          <div className="hj-row"><Label w="170px">Suministrador Eléctrico:</Label><In v={i.customer.supplier ?? "Comisión Federal de Electricidad"} w="230px" /></div>
          <div className="hj-row hj-row-tight"><Label w="170px">Ubicación:</Label>
            <span className="hj-stack"><In v={result.city.city} w="155px" /><em>Ciudad</em></span>
            <span className="hj-stack"><In v={result.city.region} w="140px" /><em>Región</em></span>
            <span className="hj-stack"><In v={result.city.division} w="150px" /><em>División</em></span>
            <span className="hj-stack"><In v={n0(result.generation.latitude)} w="60px" /><em>Latitud</em></span>
          </div>
        </div>

        <Band>Información del Centro de Carga:</Band>
        <div className="hj-body">
          <div className="hj-row"><Label w="80px">Periodo:</Label><Pick v={i.period} w="86px" />
            <span className="hj-pair"><Label w="118px">Tarifa de Verano</Label><In v={i.summerTariff ? "Si" : "No"} w="80px" /></span>
          </div>
          <div className="hj-row"><span className="hj-spacer" />
            <span className="hj-pair"><Label w="118px">Tarifa Actual:</Label><In v={i.currentTariff} w="80px" /></span>
          </div>
          <div className="hj-row"><span className="hj-spacer" />
            <span className="hj-pair"><Label w="118px">Tarifa Base:</Label><In v={i.baseTariff ?? (i.contractedDemandKw != null ? `${n0(i.contractedDemandKw)} kW` : "")} w="80px" /></span>
          </div>
          <div className="hj-row"><Label w="130px">Periodo Facturado:</Label><In v={MONTH_NAMES[i.billedMonth - 1] ?? ""} w="96px" />
            <Label w="120px">Tipo De Medidor:</Label><In v={i.meterType ?? ""} w="96px" />
            <Label w="92px">N° de Fases:</Label><In v={n0(i.phases)} w="80px" />
          </div>
          <div className="hj-row"><Label w="130px">Nivel de Voltaje (F-F):</Label><In v={n0(i.voltage)} w="96px" />
            <Label w="120px">Configuración Eléctrica:</Label><In v={i.electricalConfig ?? ""} w="215px" />
          </div>
          <div className="hj-cols">
            <div className="hj-history">
              <div className="hj-hhead"><span>Historial de Facturación</span><span>Historial de Consumo</span></div>
              {history.map((h, k) => (
                <div className="hj-hrow" key={`${h.month}-${k}`}><span className="hj-hm">{h.month}</span><span className="hj-hv">{h.value ? `${n0(h.value)} kWh` : "0 kWh"}</span></div>
              ))}
              <div className="hj-hrow is-total"><span className="hj-hm">Promedio</span><span className="hj-hv">{n0(average)} kWh</span></div>
            </div>
            <div className="hj-side">
              <div className="hj-sider"><Label w="150px">Simulador de Energía a Utilizar.</Label><In v="ENNCO" w="86px" /></div>
              <div className="hj-sider"><Label w="150px">Incremento Anual en Tarifa de Suministrador.</Label><In v={pct0(i.annualIncrease)} w="86px" /></div>
            </div>
          </div>
        </div>

        <Band>Información del Sistema Fotovoltaico:</Band>
        <div className="hj-body">
          <div className="hj-row hj-row-top">
            <span className="hj-stack is-top"><Label>Marca de Módulo:</Label><Pick v={panel.brand} w="148px" /></span>
            <span className="hj-stack is-top"><Label>Modelo:</Label><Pick v={panel.model} w="172px" /></span>
            <span className="hj-stack is-top"><Label>Potencia del Módulo:</Label><Calc v={n0(result.modulePowerW)} w="168px" /></span>
            <span className="hj-stack is-top"><Label>Cantidad de Módulos Necesarios:</Label><Calc v={n0(result.modulesNeeded)} w="200px" /></span>
          </div>
          <div className="hj-row hj-row-top">
            <span className="hj-stack is-top"><Label>N° De Orientaciones</Label><In v={n0(i.orientationCount ?? i.orientations.length)} w="148px" /></span>
            <span className="hj-orients">
              <span className="hj-orow"><Label w="130px">N° de Módulos</Label><Calc v={n0(result.modulesTotal)} w="80px" /></span>
              {i.orientations.slice(0, Math.max(1, i.orientationCount ?? i.orientations.length)).map((o, k) => (
                <span key={k}>
                  <span className="hj-orow"><Label w="130px">Orientación #{k + 1}</Label><In v={n0(o.azimuth)} w="80px" /></span>
                  <span className="hj-orow"><Label w="130px">Inclinación #{k + 1}</Label><In v={n0(o.inclination)} w="80px" /></span>
                </span>
              ))}
            </span>
            <span className="hj-stack is-top hj-right"><Label>Capacidad del Sistema Necesario:</Label><Calc v={`${n2(result.systemNeededKw)} kWp`} w="230px" strong /></span>
          </div>
          <div className="hj-row"><Label w="170px">Tipo De Sistema de Montaje</Label><Pick v={i.mountingSystem ?? ""} w="230px" />
            <Label w="200px">Degradación Anual Del Módulo:</Label><Calc v={`${n2(i.degradation * 100)} %`} w="90px" />
          </div>
          <table className="hj-inv">
            <thead><tr><th>Inversor:</th><th>Cantidad:</th><th>N° Min De Módulos:</th><th>N° Max. de Módulos:</th><th>Cantidad Real:</th><th>Tamaño De Sistema Real:</th></tr></thead>
            <tbody>
              {Array.from({ length: 5 }, (_, k) => {
                const inv = result.inverters[k];
                return (
                  <tr key={k}>
                    <td>{inv ? <Pick v={inv.model} /> : <span className="hj-calc is-empty" />}</td>
                    <td>{inv ? <In v={n0(inv.quantity)} /> : <span className="hj-calc is-empty" />}</td>
                    <td>{inv ? n0(inv.minModules) : ""}</td>
                    <td>{inv ? n0(inv.maxModules) : ""}</td>
                    <td>{inv ? <Calc v={n0(inv.modules)} /> : <span className="hj-calc is-empty" />}</td>
                    <td className="hj-kwp">{inv ? `${n2(inv.systemKw)} kWp` : ""}</td>
                  </tr>
                );
              })}
              <tr className="is-total"><td /><td>{n0(result.inverters.reduce((a, x) => a + x.quantity, 0))}</td><td /><td /><td>{n0(result.modulesTotal)}</td><td className="hj-kwp">{n2(result.systemKw)} kWp</td></tr>
            </tbody>
          </table>
          <div className="hj-row"><Label w="330px">Producción anual del sistema fotovoltaico (kWh):</Label><In v={n0(result.annualGeneration)} w="170px" /></div>
          <div className="hj-row"><Label w="330px">Consumo anual del Centro de Carga (kWh):</Label><In v={n0(result.annualConsumption)} w="170px" /></div>
          <div className="hj-row"><Label w="330px">Cobertura Energética:</Label><In v={`${Math.round(result.coverage * 100)}%`} w="170px" /></div>
          <Chart consumption={result.generation.consumptionByMonth} generation={result.generation.periodGeneration} />
        </div>
        <p className="hj-foot">Periodo de facturación {i.period.toLowerCase()} · {monthsBack === 2 ? "dos meses por recibo" : "un mes por recibo"}</p>
      </section>

      <section className="hj-page">
        <Band>Servicios Adicionales Al Sistema Fotovoltaico:</Band>
        <div className="hj-body">
          <div className="hj-services">
            <div className="hj-svc-list">
              {i.services.map((s, k) => (
                <div className="hj-srow" key={k}>
                  <In v={s.concept} w="300px" align="left" />
                  <In v={dash(s.enabled ? s.costMxn : 0)} w="150px" />
                  <span className="hj-chk"><i className={s.enabled ? "on" : ""} />{s.enabled ? "Si" : "No"}</span>
                  <span className="hj-usd">{money(servicesUsd[k] ?? 0)} USD</span>
                </div>
              ))}
            </div>
            <div className="hj-svc-side">
              <span className="hj-stack is-top"><Label>Moneda para oferta:</Label><In v={i.currency ?? "MXN"} w="150px" /></span>
              <span className="hj-stack is-top"><Label>Tipo de Cambio</Label><In v={money(i.exchangeRate)} w="150px" /></span>
            </div>
          </div>
          <div className="hj-row hj-gap"><Label w="255px">Costo SIN iva por watt instalado (MXN):</Label><In v={money(i.pricePerWatt)} w="105px" />
            <Label w="245px">Descuento al costo SIN iva del SFV (%):</Label><In v={pct0(i.discount)} w="78px" />
          </div>
          <div className="hj-row"><Label w="255px">Factor de Utilidad (%):</Label><In v={pct0(i.utilityFactor)} w="105px" />
            <Label w="245px">¿Agregar IVA?</Label><In v={i.addIva ? "Si" : "No"} w="78px" />
          </div>
          <p className="hj-note">El precio sugerido para éste proyecto es de ${n2(suggested)} (MXN) más IVA.</p>
          <p className="hj-note">El descuento otorgado es {pct0(bom.discountVsSuggested)} del precio sugerido</p>
        </div>

        <Band>Condiciones de Proyecto:</Band>
        <div className="hj-body">
          <div className="hj-row"><Label w="215px">Precio de Contado con IVA (MXN):</Label><In v={money(bom.cashPrice)} w="180px" />
            <Label w="235px">¿Analizar Estudio con Deducción Fiscal?</Label><In v={i.taxDeduction ? "Si" : "No"} w="70px" />
          </div>
          <div className="hj-adv">
            <div className="hj-advcol">
              {advances.map((a, k) => (
                <div className="hj-arow" key={k}>
                  <In v={pct0(a)} w="80px" />
                  <Label w="200px">{["Por pago de anticipo (MXN):", "Por arribo de material (MXN):", "Por terminación de instalación (MXN):", "Por entrega de sistema (MXN):"][k] ?? ""}</Label>
                  <In v={money(bom.advances[k] ?? 0)} w="150px" />
                </div>
              ))}
              <div className="hj-arow is-sum"><span style={{ width: "80px" }}>{pct0(advances.reduce((a, b) => a + b, 0))}</span></div>
            </div>
            <div className="hj-advside">
              <span className="hj-stack is-top"><Label>Idioma del Estudio</Label><In v={String(i.language ?? "Español")} w="120px" /></span>
              <span className="hj-stack is-top"><Label>Garantía de Estructura</Label><In v={`${i.structureWarrantyYears ?? 20} Años`} w="120px" /></span>
            </div>
          </div>
          <div className="hj-row hj-gap"><Label w="255px">Precio por financiamiento con iva (MXN):</Label><In v={dash(i.financingBase)} w="180px" /></div>
          <div className="hj-finhead"><span /><span>Renta Inicial:</span><span>Mensualidad:</span><span>Renta Mensual:</span></div>
          {i.financing.map((f, k) => {
            const row = bom.financing[k];
            return (
              <div className="hj-finrow" key={k}>
                <In v={pct0(f.share)} w="80px" /><Label w="200px">Por pago de anticipo (MXN):</Label>
                <In v={dash(row?.amount)} w="150px" />
                <In v={f.months ? n0(f.months) : ""} w="90px" />
                <In v={row?.monthly ? money(row.monthly) : ""} w="130px" />
              </div>
            );
          })}
        </div>

        <Band>Garantías del Proyecto:</Band>
        <div className="hj-body">
          {warranties.map(([k, v]) => (
            <div className="hj-wrow" key={k}><Label w="150px">{k}</Label><span className="hj-wtext">{v}</span></div>
          ))}
          <div className="hj-row hj-gap"><Label w="128px">Tiempo Inicio de la Obra:</Label><In v={i.startTime ?? ""} w="106px" />
            <Label w="168px">Tiempo de Entrega del proyecto:</Label><In v={i.deliveryTime ?? ""} w="106px" />
            <Label w="104px">Vigencia de la Oferta:</Label><In v={`${i.validityDays ?? 30} Días`} w="62px" />
          </div>
        </div>

        <Band>Términos generales:</Band>
        <div className="hj-body">
          {terms.map((t, k) => (
            <div className="hj-trow" key={k}><span className="hj-tn">{k + 1}.-</span><span className="hj-wtext">{t}</span></div>
          ))}
        </div>
      </section>
    </>
  );
}
