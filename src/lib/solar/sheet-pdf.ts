import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { MONTH_NAMES } from "@/lib/solar/catalog";
import type { QuoteResult, Segment } from "@/lib/solar/types";

/* Hoja de captura del libro (Inf_Vac_Res / Com / Ind) dibujada como PDF de dos paginas carta.
   Se genera con pdf-lib, no imprimiendo la pantalla: asi el corte de pagina, las cajas y las cotas
   quedan siempre iguales. Las coordenadas van en puntos desde la esquina superior izquierda. */

const W = 612, H = 792;                    // carta
const M = 20;                              // margen lateral
const INK = rgb(0, 0, 0);
const NAVY = rgb(0.122, 0.22, 0.392);      // #1F3864 titulos y etiquetas
const BLUE = rgb(0.122, 0.306, 0.475);     // #1F4E79 celdas de catalogo
const BLUE_BG = rgb(0.867, 0.922, 0.969);  // #DDEBF7
const BLUE_BORDER = rgb(0.18, 0.459, 0.714);
const GRAY_BG = rgb(0.851, 0.851, 0.851);  // #D9D9D9
const GRAY_LINE = rgb(0.498, 0.498, 0.498);
const MUTED = rgb(0.502, 0.502, 0.502);
const RED = rgb(0.753, 0, 0);
const BAR_BLUE = rgb(0.267, 0.447, 0.769);
const BAR_ORANGE = rgb(0.929, 0.49, 0.192);

const TITLES: Record<Segment, string[]> = {
  RESIDENTIAL: ["PROYECTOS FOTOVOLTAICOS", "RESIDENCIALES"],
  COMMERCIAL: ["PROYECTOS FOTOVOLTAICOS", "COMERCIALES"],
  INDUSTRIAL: ["PROYECTOS FOTOVOLTAICOS", "INDUSTRIALES"],
};

const nf = (d: number) => new Intl.NumberFormat("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d });
const n0 = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? nf(0).format(v) : "");
const n2 = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? nf(2).format(v) : "");
const money = (v: number | null | undefined, d = 2) => (typeof v === "number" && Number.isFinite(v) ? `$ ${nf(d).format(v)}` : "$ -");
const dash = (v: number | null | undefined, d = 2) => (typeof v === "number" && Number.isFinite(v) && v !== 0 ? `$ ${nf(d).format(v)}` : "$ -");
const pct0 = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? `${Math.round(v * 100)}%` : "0%");
/** WinAnsi no tiene todos los signos; se sustituyen los que usa la hoja. */
const safe = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/–|—/g, "-").replace(/ /g, " ");

type Ctx = { page: PDFPage; font: PDFFont; bold: PDFFont };

function drawText(c: Ctx, s: string, x: number, yTop: number, opts: { size?: number; color?: ReturnType<typeof rgb>; bold?: boolean; align?: "left" | "center" | "right"; italic?: boolean } = {}) {
  const size = opts.size ?? 7;
  const font = opts.bold ? c.bold : c.font;
  const text = safe(s);
  const w = font.widthOfTextAtSize(text, size);
  const x0 = opts.align === "center" ? x - w / 2 : opts.align === "right" ? x - w : x;
  c.page.drawText(text, { x: x0, y: H - yTop - size, size, font, color: opts.color ?? INK });
  return w;
}
function rect(c: Ctx, x: number, yTop: number, w: number, h: number, fill?: ReturnType<typeof rgb>, border?: ReturnType<typeof rgb>, borderWidth = 0.5, dashed = false) {
  c.page.drawRectangle({ x, y: H - yTop - h, width: w, height: h, color: fill, borderColor: border, borderWidth: border ? borderWidth : 0, borderDashArray: dashed ? [1.5, 1.5] : undefined });
}
function line(c: Ctx, x1: number, y1: number, x2: number, y2: number, color = INK, thickness = 0.5, dashed = false) {
  c.page.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, color, thickness, dashArray: dashed ? [1.5, 1.5] : undefined });
}
/** Celda blanca = captura del operador. */
function inBox(c: Ctx, v: string, x: number, yTop: number, w: number, h = 11, align: "center" | "left" = "center") {
  rect(c, x, yTop, w, h, rgb(1, 1, 1), GRAY_LINE);
  drawText(c, v, align === "center" ? x + w / 2 : x + 4, yTop + 3, { size: 6.5, align: align === "center" ? "center" : "left" });
}
/** Celda gris = la calcula el sistema. */
function calcBox(c: Ctx, v: string, x: number, yTop: number, w: number, h = 11, strong = false) {
  rect(c, x, yTop, w, h, GRAY_BG, GRAY_LINE, 0.5, true);
  drawText(c, v, x + w / 2, yTop + (strong ? 3.5 : 3), { size: strong ? 8 : 6.5, align: "center", bold: true, color: strong ? BLUE : INK });
}
/** Celda azul = eleccion de catalogo. */
function pickBox(c: Ctx, v: string, x: number, yTop: number, w: number, h = 11) {
  rect(c, x, yTop, w, h, BLUE_BG, BLUE_BORDER);
  const size = c.bold.widthOfTextAtSize(safe(v), 6.5) > w - 4 ? 5.2 : 6.5;
  drawText(c, v, x + w / 2, yTop + (size === 6.5 ? 3 : 3.5), { size, align: "center", bold: true, color: BLUE });
}
function label(c: Ctx, s: string, x: number, yTop: number, size = 6.5, align: "left" | "right" = "left") {
  drawText(c, s, x, yTop, { size, bold: true, color: NAVY, align });
}
/** Banda de seccion con las lineas gruesas del libro. */
function band(c: Ctx, title: string, yTop: number) {
  line(c, 0, yTop, W, yTop, INK, 1.4);
  drawText(c, title, M + 4, yTop + 3, { size: 7, bold: true, color: NAVY });
  line(c, 0, yTop + 13, W, yTop + 13, INK, 0.7);
  return yTop + 13;
}

export async function buildQuoteSheetPdf(result: QuoteResult): Promise<Uint8Array> {
  const i = result.input;
  const doc = await PDFDocument.create();
  doc.setTitle(`Cotización ${i.customer.name || "ENNCO"}`);
  doc.setCreator("ENNCO Hub");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  let logo: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  try { logo = await doc.embedPng(await readFile(path.join(process.cwd(), "public/brand/ennco-lockup-knockout.png"))); } catch { logo = null; }

  /* ---------------- pagina 1 ---------------- */
  const p1 = doc.addPage([W, H]);
  const c: Ctx = { page: p1, font, bold };
  // encabezado
  const headH = 46;
  p1.drawRectangle({ x: 0, y: H - headH, width: W, height: headH, color: rgb(0.086, 0.259, 0.325) });
  if (logo) { const s = logo.scaleToFit(96, 30); p1.drawImage(logo, { x: M, y: H - headH / 2 - s.height / 2, width: s.width, height: s.height }); }
  else drawText(c, "ENNCO", M + 10, 16, { size: 13, bold: true, color: rgb(1, 1, 1) });
  const [t1, t2] = TITLES[i.segment];
  drawText(c, t1!, W / 2, 10, { size: 11.5, bold: true, color: rgb(1, 1, 1), align: "center" });
  drawText(c, t2!, W / 2, 25, { size: 11.5, bold: true, color: rgb(1, 1, 1), align: "center" });

  let y = band(c, "Datos Generales del Proyecto:", headH);
  y += 8;
  label(c, "Nombre del Cliente:", M + 10, y + 2); inBox(c, i.customer.name, M + 110, y, 300, 11, "center"); y += 17;
  label(c, "Subtítulo:", M + 10, y + 2); inBox(c, i.customer.subtitle ?? "", M + 110, y, 300, 11, "center"); y += 17;
  label(c, "Suministrador Eléctrico:", M + 10, y + 2); inBox(c, i.customer.supplier ?? "Comisión Federal de Electricidad", M + 110, y, 170, 11, "center"); y += 17;
  label(c, "Ubicación:", M + 10, y + 2);
  const ubic: Array<[string, string, number]> = [[result.city.city, "Ciudad", 100], [result.city.region ?? "", "Región", 90], [result.city.division ?? "", "División", 95], [n0(result.generation.latitude), "Latitud", 40]];
  let ux = M + 110;
  for (const [v, cap, w] of ubic) { inBox(c, v, ux, y, w); drawText(c, cap, ux + w / 2, y + 12.5, { size: 5.5, align: "center", color: rgb(0.25, 0.25, 0.25) }); ux += w + 6; }
  y += 24;

  y = band(c, "Información del Centro de Carga:", y);
  y += 8;
  label(c, "Periodo:", M + 10, y + 2); pickBox(c, i.period, M + 70, y, 56);
  label(c, "Tarifa de Verano", M + 150, y + 2); inBox(c, i.summerTariff ? "Si" : "No", M + 235, y, 50); y += 15;
  label(c, "Tarifa Actual:", M + 150, y + 2); inBox(c, i.currentTariff, M + 235, y, 50); y += 15;
  label(c, "Tarifa Base:", M + 150, y + 2); inBox(c, i.baseTariff ?? (i.contractedDemandKw != null ? `${n0(i.contractedDemandKw)} kW` : ""), M + 235, y, 50); y += 17;
  label(c, "Periodo Facturado:", M + 10, y + 2); inBox(c, MONTH_NAMES[i.billedMonth - 1] ?? "", M + 95, y, 62);
  label(c, "Tipo De Medidor:", M + 168, y + 2); inBox(c, i.meterType ?? "", M + 245, y, 60);
  label(c, "N° de Fases:", M + 318, y + 2); inBox(c, n0(i.phases), M + 375, y, 40); y += 17;
  label(c, "Nivel de Voltaje (F-F):", M + 10, y + 2); inBox(c, n0(i.voltage), M + 95, y, 62);
  label(c, "Configuración Eléctrica:", M + 168, y + 2); inBox(c, i.electricalConfig ?? "", M + 260, y, 150); y += 18;

  // historial
  const histTop = y;
  label(c, "Historial de Facturación", M + 40, y, 6.5); label(c, "Historial de Consumo", M + 155, y, 6.5);
  y += 10;
  const monthsBack = Array.from({ length: 12 }, (_, k) => {
    const mi = ((i.billedMonth - 1 - k) % 12 + 12) % 12;
    return { month: MONTH_NAMES[mi] ?? "", value: i.consumptionKwh[k] ?? 0 };
  });
  rect(c, M + 145, y - 1, 105, 12 * 9.2 + 2, GRAY_BG);
  monthsBack.forEach((h, k) => {
    const ly = y + k * 9.2;
    drawText(c, h.month, M + 138, ly, { size: 6, color: MUTED, align: "right" });
    drawText(c, `${n0(h.value)} kWh`, M + 243, ly, { size: 6, align: "right" });
  });
  const totY = y + 12 * 9.2 + 2;
  label(c, "Promedio", M + 138, totY, 6.5, "right");
  drawText(c, `${n0(result.averageConsumption)} kWh`, M + 243, totY, { size: 6.5, bold: true, align: "right" });
  // lado derecho
  label(c, "Simulador de Energía a", M + 300, histTop + 12, 6); label(c, "Utilizar.", M + 300, histTop + 20, 6);
  inBox(c, "ENNCO", M + 420, histTop + 13, 60);
  label(c, "Incremento Anual en Tarifa", M + 300, histTop + 38, 6); label(c, "de Suministrador.", M + 300, histTop + 46, 6);
  inBox(c, pct0(i.annualIncrease), M + 420, histTop + 39, 60);
  y = totY + 14;

  y = band(c, "Información del Sistema Fotovoltaico:", y);
  y += 8;
  const cols = [M + 10, M + 130, M + 255, M + 390];
  label(c, "Marca de Módulo:", cols[0]!, y); label(c, "Modelo:", cols[1]!, y); label(c, "Potencia del Módulo:", cols[2]!, y); label(c, "Cantidad de Módulos Necesarios:", cols[3]!, y);
  y += 10;
  pickBox(c, result.module.brand ?? "", cols[0]!, y, 110); pickBox(c, result.module.model, cols[1]!, y, 118);
  calcBox(c, n0(result.modulePowerW), cols[2]!, y, 110); calcBox(c, n0(result.modulesNeeded), cols[3]!, y, 120);
  y += 20;
  label(c, "N° De Orientaciones", cols[0]!, y); inBox(c, n0(i.orientationCount ?? i.orientations.length), cols[0]!, y + 10, 110);
  label(c, "N° de Módulos", M + 150, y + 12, 6.5, "right"); calcBox(c, n0(result.modulesTotal), M + 158, y + 9, 56);
  const orients = i.orientations.slice(0, Math.max(1, i.orientationCount ?? i.orientations.length));
  let oy = y + 22;
  orients.forEach((o, k) => {
    label(c, `Orientación #${k + 1}`, M + 150, oy + 3, 6.5, "right"); inBox(c, n0(o.azimuth), M + 158, oy, 56);
    label(c, `Inclinación #${k + 1}`, M + 150, oy + 16, 6.5, "right"); inBox(c, n0(o.inclination), M + 158, oy + 13, 56);
    oy += 26;
  });
  label(c, "Capacidad del Sistema Necesario:", M + 330, y + 8, 6.5); calcBox(c, `${n2(result.systemNeededKw)} kWp`, M + 330, y + 18, 150, 15, true);
  y = Math.max(oy, y + 40) + 4;
  label(c, "Tipo De Sistema de Montaje", M + 10, y + 3); pickBox(c, i.mountingSystem ?? "", M + 130, y, 150);
  label(c, "Degradación Anual Del Módulo:", M + 300, y + 3); calcBox(c, `${n2(i.degradation * 100)} %`, M + 420, y, 60);
  y += 20;

  // tabla de inversores
  const invCols = [M + 10, M + 118, M + 205, M + 290, M + 375, M + 460];
  const invHead = ["Inversor:", "Cantidad:", "N° Min De Módulos:", "N° Max. de Módulos:", "Cantidad Real:", "Tamaño De Sistema Real:"];
  invHead.forEach((h, k) => drawText(c, h, invCols[k]! + (k === 0 ? 45 : k === 5 ? 55 : 35), y, { size: 5.8, bold: true, color: NAVY, align: "center" }));
  y += 9;
  for (let k = 0; k < 5; k += 1) {
    const inv = result.inverters[k];
    if (inv) {
      pickBox(c, inv.model, invCols[0]!, y, 100); inBox(c, n0(inv.quantity), invCols[1]!, y, 70);
      drawText(c, n0(inv.minModules), invCols[2]! + 35, y + 3, { size: 6.5, align: "center" });
      drawText(c, n0(inv.maxModules), invCols[3]! + 35, y + 3, { size: 6.5, align: "center" });
      calcBox(c, n0(inv.modules), invCols[4]!, y, 70);
      drawText(c, `${n2(inv.systemKw)} kWp`, invCols[5]! + 55, y + 3, { size: 6.5, bold: true, color: BLUE, align: "center" });
    } else {
      calcBox(c, "", invCols[0]!, y, 100); calcBox(c, "", invCols[1]!, y, 70); calcBox(c, "", invCols[4]!, y, 70);
    }
    y += 13;
  }
  line(c, M + 10, y, W - M - 10, y, rgb(0.75, 0.75, 0.75), 0.5); y += 3;
  drawText(c, n0(result.inverters.reduce((a, x) => a + x.quantity, 0)), invCols[1]! + 35, y, { size: 6.5, bold: true, align: "center" });
  drawText(c, n0(result.modulesTotal), invCols[4]! + 35, y, { size: 6.5, bold: true, align: "center" });
  drawText(c, `${n2(result.systemKw)} kWp`, invCols[5]! + 55, y, { size: 6.5, bold: true, color: BLUE, align: "center" });
  y += 16;

  label(c, "Producción anual del sistema fotovoltaico (kWh):", M + 10, y + 3); inBox(c, n0(result.annualGeneration), M + 230, y, 100); y += 15;
  label(c, "Consumo anual del Centro de Carga (kWh):", M + 10, y + 3); inBox(c, n0(result.annualConsumption), M + 230, y, 100); y += 15;
  label(c, "Cobertura Energética:", M + 10, y + 3); inBox(c, `${Math.round(result.coverage * 100)}%`, M + 230, y, 100); y += 20;

  drawChart(c, result, M + 30, y, W - 2 * M - 40, 120);
  drawText(c, `Periodo de facturación ${i.period.toLowerCase()} · ${i.period === "Bimestral" ? "dos meses por recibo" : "un mes por recibo"}`, W - M - 10, H - 26, { size: 5.5, color: MUTED, align: "right" });
  // marco de pagina
  rect(c, 1, 1, W - 2, H - 2, undefined, INK, 1.2);

  /* ---------------- pagina 2 ---------------- */
  const p2 = doc.addPage([W, H]);
  const c2: Ctx = { page: p2, font, bold };
  let y2 = band(c2, "Servicios Adicionales Al Sistema Fotovoltaico:", 14);
  y2 += 8;
  i.services.forEach((s, k) => {
    const ly = y2 + k * 14;
    inBox(c2, s.concept, M + 10, ly, 210, 11, "left");
    inBox(c2, dash(s.enabled ? s.costMxn : 0), M + 228, ly, 100);
    rect(c2, M + 338, ly + 2, 7, 7, s.enabled ? INK : rgb(1, 1, 1), INK);
    drawText(c2, s.enabled ? "Si" : "No", M + 350, ly + 3, { size: 6 });
    drawText(c2, `${money(s.enabled && i.exchangeRate ? s.costMxn / i.exchangeRate : 0)} USD`, M + 440, ly + 3, { size: 6.5, bold: true, align: "right" });
  });
  label(c2, "Moneda para oferta:", M + 460, y2, 6.5); inBox(c2, i.currency ?? "MXN", M + 460, y2 + 10, 90);
  label(c2, "Tipo de Cambio", M + 460, y2 + 32, 6.5); inBox(c2, money(i.exchangeRate), M + 460, y2 + 42, 90);
  y2 += i.services.length * 14 + 10;
  label(c2, "Costo SIN iva por watt instalado (MXN):", M + 10, y2 + 3); inBox(c2, money(i.pricePerWatt), M + 190, y2, 75);
  label(c2, "Descuento al costo SIN iva del SFV (%):", M + 285, y2 + 3); inBox(c2, pct0(i.discount), M + 460, y2, 55); y2 += 15;
  label(c2, "Factor de Utilidad (%):", M + 10, y2 + 3); inBox(c2, pct0(i.utilityFactor), M + 190, y2, 75);
  label(c2, "¿Agregar IVA?", M + 285, y2 + 3); inBox(c2, i.addIva ? "Si" : "No", M + 460, y2, 55); y2 += 20;
  const note1 = `El precio sugerido para éste proyecto es de $${n2(result.pricing.suggestedPricePerWatt)} (MXN) más IVA.`;
  const note2 = `El descuento otorgado es ${pct0(result.pricing.discountVsSuggested)} del precio sugerido`;
  for (const [k, t] of [note1, note2].entries()) {
    const wid = oblique.widthOfTextAtSize(safe(t), 7);
    p2.drawText(safe(t), { x: W / 2 - wid / 2, y: H - (y2 + k * 12) - 7, size: 7, font: oblique, color: RED });
    line(c2, W / 2 - wid / 2, y2 + k * 12 + 9, W / 2 + wid / 2, y2 + k * 12 + 9, RED, 0.4);
  }
  y2 += 28;

  y2 = band(c2, "Condiciones de Proyecto:", y2); y2 += 8;
  label(c2, "Precio de Contado con IVA (MXN):", M + 10, y2 + 3); inBox(c2, money(result.pricing.cashPrice), M + 160, y2, 130);
  label(c2, "¿Analizar Estudio con Deducción Fiscal?", M + 305, y2 + 3); inBox(c2, i.taxDeduction ? "Si" : "No", M + 480, y2, 45); y2 += 18;
  const advLabels = ["Por pago de anticipo (MXN):", "Por arribo de material (MXN):", "Por terminación de instalación (MXN):", "Por entrega de sistema (MXN):"];
  i.advances.forEach((a, k) => {
    const ly = y2 + k * 14;
    inBox(c2, pct0(a), M + 10, ly, 55);
    drawText(c2, advLabels[k] ?? "", M + 75, ly + 3, { size: 6.5 });
    inBox(c2, money(result.pricing.advances[k] ?? 0), M + 230, ly, 110);
  });
  label(c2, "Idioma del Estudio", M + 430, y2, 6.5); inBox(c2, String(i.language ?? "Español"), M + 430, y2 + 10, 90);
  label(c2, "Garantía de Estructura", M + 430, y2 + 32, 6.5); inBox(c2, `${i.structureWarrantyYears ?? 20} Años`, M + 430, y2 + 42, 90);
  y2 += i.advances.length * 14 + 2;
  const sumPct = i.advances.reduce((a, b) => a + b, 0);
  p2.drawText(safe(pct0(sumPct)), { x: M + 26, y: H - y2 - 7, size: 7, font: oblique, color: INK }); y2 += 16;
  label(c2, "Precio por financiamiento con iva (MXN):", M + 10, y2 + 3); inBox(c2, dash(i.financingBase), M + 190, y2, 110); y2 += 18;
  drawText(c2, "Renta Inicial:", M + 285, y2, { size: 6.5, bold: true, color: NAVY, align: "center" });
  drawText(c2, "Mensualidad:", M + 390, y2, { size: 6.5, bold: true, color: NAVY, align: "center" });
  drawText(c2, "Renta Mensual:", M + 480, y2, { size: 6.5, bold: true, color: NAVY, align: "center" });
  y2 += 10;
  i.financing.forEach((f, k) => {
    const ly = y2 + k * 14; const row = result.pricing.financing[k];
    inBox(c2, pct0(f.share), M + 10, ly, 55);
    drawText(c2, "Por pago de anticipo (MXN):", M + 75, ly + 3, { size: 6.5 });
    inBox(c2, dash(row?.amount), M + 230, ly, 110);
    inBox(c2, f.months ? n0(f.months) : "", M + 355, ly, 70);
    inBox(c2, row?.monthly ? money(row.monthly) : "", M + 440, ly, 90);
  });
  y2 += i.financing.length * 14 + 8;

  y2 = band(c2, "Garantías del Proyecto:", y2); y2 += 8;
  const inv0 = result.inverters[0]?.inverter ?? null;
  const warranties: Array<[string, string]> = [
    ["Módulo Solar:", "Garantía por 25 años en defectos de fabricación y 15 años por el rendimiento del producto."],
    ["Inversor:", `${inv0?.warrantyYears ?? 10} años de garantía del producto.`],
    ["Estructura:", `${i.structureWarrantyYears ?? 20} años de garantía por defectos de fabricación.`],
    ["Instalación:", "2 años de garantía por defectos de mano de obra."],
    ["Soporte Técnico:", "2 años de soporte técnico a partir de la fecha de entrega."],
  ];
  warranties.forEach(([k, v], idx) => {
    const ly = y2 + idx * 14;
    label(c2, k, M + 10, ly + 3);
    rect(c2, M + 100, ly, W - 2 * M - 110, 11, rgb(1, 1, 1), GRAY_LINE);
    const wid = oblique.widthOfTextAtSize(safe(v), 6.5);
    p2.drawText(safe(v), { x: M + 100 + (W - 2 * M - 110) / 2 - wid / 2, y: H - ly - 9.5, size: 6.5, font: oblique, color: INK });
  });
  y2 += warranties.length * 14 + 6;
  label(c2, "Tiempo Inicio de la Obra:", M + 10, y2 + 3); inBox(c2, i.startTime ?? "", M + 110, y2, 80);
  label(c2, "Tiempo de Entrega del proyecto:", M + 205, y2 + 3); inBox(c2, i.deliveryTime ?? "", M + 340, y2, 80);
  label(c2, "Vigencia de la Oferta:", M + 435, y2 + 3); inBox(c2, `${i.validityDays ?? 30} Días`, M + 520, y2, 50);
  y2 += 20;

  y2 = band(c2, "Términos generales:", y2); y2 += 8;
  const terms = [
    `Tiempo de entrega del proyecto de ${i.deliveryTime ?? "2 a 3 semanas"}.`,
    `El inicio de los trabajos será de ${i.startTime ?? "2 a 3 semanas"} posterior a la firma de contrato y pago de anticipo.`,
    `Vigencia de cotización de ${i.validityDays ?? 30} días.`,
    "No incluye obra civil, de ser necesario se cotizará por separado.",
    "No incluye trabajos de albañilería, de ser necesario se cotizará por separado.",
    "Las garantías son para los componentes del sistema fotovoltaico y están sujetas al criterio de cada fabricante.",
    "El cliente es responsable de asegurar la firmeza y resistencia de la superficie donde se instalará el sistema fotovoltaico.",
  ];
  terms.forEach((t, idx) => {
    const ly = y2 + idx * 14;
    drawText(c2, `${idx + 1}.-`, M + 30, ly + 3, { size: 6.5, bold: true, align: "right" });
    rect(c2, M + 40, ly, W - 2 * M - 50, 11, rgb(1, 1, 1), GRAY_LINE);
    const wid = oblique.widthOfTextAtSize(safe(t), 6.5);
    p2.drawText(safe(t), { x: M + 40 + (W - 2 * M - 50) / 2 - wid / 2, y: H - ly - 9.5, size: 6.5, font: oblique, color: INK });
  });
  rect(c2, 1, 1, W - 2, H - 2, undefined, INK, 1.2);

  return doc.save();
}

/** Grafica de consumo contra generacion por mes, como la del libro. */
function drawChart(c: Ctx, result: QuoteResult, x: number, yTop: number, w: number, h: number) {
  const cons = result.generation.consumptionByMonth, gen = result.generation.periodGeneration;
  const max = Math.max(1, ...cons, ...gen);
  const ticks = 7;
  const mag = Math.pow(10, Math.floor(Math.log10(max / ticks)));
  const nice = [1, 2, 2.5, 5, 10].find((m) => m * mag >= max / ticks) ?? 10;
  const top = nice * mag * ticks;
  const padL = 34, plotH = h - 22, plotW = w - padL;
  const yv = (v: number) => yTop + plotH - (v / top) * plotH;
  for (let k = 0; k <= ticks; k += 1) {
    const v = (top / ticks) * k;
    line(c, x + padL, yv(v), x + w, yv(v), rgb(0.85, 0.85, 0.85), 0.4);
    drawText(c, n0(v), x + padL - 4, yv(v) - 2.5, { size: 5, color: MUTED, align: "right" });
  }
  const slot = plotW / 12, bw = Math.min(9, slot / 3);
  MONTH_NAMES.forEach((m, k) => {
    const cx = x + padL + slot * k + slot / 2;
    const cv = cons[k] ?? 0, gv = gen[k] ?? 0;
    if (cv > 0) rect(c, cx - bw - 0.5, yv(cv), bw, yTop + plotH - yv(cv), BAR_BLUE);
    if (gv > 0) rect(c, cx + 0.5, yv(gv), bw, yTop + plotH - yv(gv), BAR_ORANGE);
    drawText(c, m, cx, yTop + plotH + 3, { size: 4.6, color: rgb(0.25, 0.25, 0.25), align: "center" });
  });
  line(c, x + padL, yTop + plotH, x + w, yTop + plotH, rgb(0.65, 0.65, 0.65), 0.5);
  const lx = x + w / 2 - 60;
  rect(c, lx, yTop + plotH + 12, 6, 6, BAR_BLUE); drawText(c, "Consumo de Energía", lx + 9, yTop + plotH + 13, { size: 5.5, color: rgb(0.25, 0.25, 0.25) });
  rect(c, lx + 78, yTop + plotH + 12, 6, 6, BAR_ORANGE); drawText(c, "Generación PV", lx + 87, yTop + plotH + 13, { size: 5.5, color: rgb(0.25, 0.25, 0.25) });
}
