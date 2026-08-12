import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import type { PrequotePdfTokenPayload } from "@/lib/prequote/pdf-token";

const navy = rgb(0.015, 0.12, 0.23);
const blue = rgb(0.015, 0.29, 0.55);
const yellow = rgb(1, 0.74, 0.05);
const ink = rgb(0.06, 0.11, 0.18);
const muted = rgb(0.34, 0.42, 0.52);
const pale = rgb(0.95, 0.97, 0.99);

function mxn(value: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value);
}

function number(value: number): string {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(value);
}

function drawRange(
  page: ReturnType<PDFDocument["addPage"]>,
  fonts: { regular: Awaited<ReturnType<PDFDocument["embedFont"]>>; bold: Awaited<ReturnType<PDFDocument["embedFont"]>> },
  input: { x: number; y: number; width: number; label: string; value: string },
) {
  page.drawRectangle({ x: input.x, y: input.y, width: input.width, height: 58, color: pale, borderColor: rgb(0.84, 0.88, 0.92), borderWidth: 1 });
  page.drawText(input.label.toUpperCase(), { x: input.x + 16, y: input.y + 38, size: 8, font: fonts.bold, color: muted });
  page.drawText(input.value, { x: input.x + 16, y: input.y + 15, size: 16, font: fonts.bold, color: navy });
}

function wrapText(
  text: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  size: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function renderPrequotePdf(payload: PrequotePdfTokenPayload): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(`Referencia técnica ${payload.folio}`);
  document.setAuthor("ENNCO");
  document.setSubject("Diagnóstico preliminar no contractual");
  document.setProducer("ENNCO Revenue Platform");

  const page = document.addPage([612, 792]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular, bold };

  page.drawRectangle({ x: 0, y: 676, width: 612, height: 116, color: navy });
  page.drawRectangle({ x: 42, y: 716, width: 36, height: 36, color: blue });
  page.drawText("/", { x: 53, y: 724, size: 23, font: bold, color: yellow });
  page.drawText("ENNCO", { x: 90, y: 730, size: 19, font: bold, color: rgb(1, 1, 1) });
  page.drawText("REFERENCIA TÉCNICA PRELIMINAR", { x: 42, y: 691, size: 10, font: bold, color: yellow });
  page.drawText(payload.folio, { x: 400, y: 730, size: 13, font: bold, color: rgb(1, 1, 1) });
  page.drawText(payload.evidenceClass, { x: 448, y: 703, size: 8, font: regular, color: rgb(0.76, 0.84, 0.92) });

  page.drawText(
    payload.estimate.estimateKind === "SOLAR_RANGE"
      ? "Un rango para iniciar la revisión técnica"
      : "Este servicio requiere revisión técnica",
    { x: 42, y: 632, size: 22, font: bold, color: ink },
  );
  page.drawText("No es una cotización ni un compromiso comercial.", { x: 42, y: 610, size: 10, font: regular, color: muted });

  if (payload.estimate.estimateKind === "SOLAR_RANGE") {
    drawRange(page, fonts, {
      x: 42,
      y: 526,
      width: 252,
      label: "Capacidad estimada",
      value: `${number(payload.estimate.capacityKwp.min)} a ${number(payload.estimate.capacityKwp.max)} kWp`,
    });
    drawRange(page, fonts, {
      x: 318,
      y: 526,
      width: 252,
      label: "Inversión preliminar",
      value: `${mxn(payload.estimate.investmentMxn.min)} a ${mxn(payload.estimate.investmentMxn.max)}`,
    });
    drawRange(page, fonts, {
      x: 42,
      y: 452,
      width: 252,
      label: "Área aproximada",
      value: `${number(payload.estimate.roofAreaM2.min)} a ${number(payload.estimate.roofAreaM2.max)} m²`,
    });
    drawRange(page, fonts, {
      x: 318,
      y: 452,
      width: 252,
      label: "Módulos aproximados",
      value: `${number(payload.estimate.panelCount.min)} a ${number(payload.estimate.panelCount.max)}`,
    });
  } else {
    page.drawRectangle({ x: 42, y: 468, width: 528, height: 108, color: pale, borderColor: yellow, borderWidth: 2 });
    page.drawText("SIGUIENTE PASO", { x: 62, y: 542, size: 9, font: bold, color: blue });
    page.drawText("Revisión de alcance con el equipo técnico ENNCO", { x: 62, y: 514, size: 16, font: bold, color: navy });
    page.drawText("Sin precio, garantía ni fecha automáticos.", { x: 62, y: 488, size: 10, font: regular, color: muted });
  }

  page.drawText("Por qué es un rango", { x: 42, y: 406, size: 15, font: bold, color: navy });
  const limitations = payload.estimate.limitations.slice(0, 4);
  limitations.forEach((limitation, index) => {
    const y = 378 - index * 44;
    page.drawCircle({ x: 48, y: y + 4, size: 3, color: yellow });
    page.drawText(wrapText(limitation, regular, 9, 500).slice(0, 2).join("\n"), {
      x: 60,
      y,
      size: 9,
      font: regular,
      color: ink,
      lineHeight: 12,
    });
  });

  page.drawRectangle({ x: 42, y: 128, width: 528, height: 76, color: rgb(1, 0.97, 0.86) });
  page.drawText("REQUIERE VALIDACIÓN", { x: 60, y: 178, size: 9, font: bold, color: blue });
  page.drawText("Recibo CFE, revisión del sitio y validación del equipo técnico ENNCO.", { x: 60, y: 153, size: 11, font: bold, color: navy });

  page.drawText(payload.estimate.disclaimer, { x: 42, y: 88, size: 8, font: regular, color: muted, maxWidth: 528, lineHeight: 11 });
  page.drawLine({ start: { x: 42, y: 58 }, end: { x: 570, y: 58 }, thickness: 1, color: rgb(0.86, 0.89, 0.92) });
  page.drawText(`Modelo ${payload.estimate.modelVersion}`, { x: 42, y: 38, size: 7, font: regular, color: muted });
  page.drawText("ENNCO | Partners in power and progress", { x: 374, y: 38, size: 7, font: bold, color: navy });

  return document.save();
}
