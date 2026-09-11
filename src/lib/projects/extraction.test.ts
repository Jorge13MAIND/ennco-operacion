import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  extractReceipt,
  extractReceiptCandidates,
  validateDocumentBytes,
} from "./extraction";
import { resolveEngineeringRules } from "./calculation";
describe("extracción asistida", () => {
  it("propone valores, nunca confirma", () => {
    const v = extractReceiptCandidates(
      "Tarifa: GDMTH\nConsumo kWh: 12,300\nTotal a pagar: $38,401.16",
    );
    expect(v.fields).toEqual({
      tariff: "GDMTH",
      kWh: 12300,
      amountMxn: 38401.16,
    });
    expect(v.reviewed).toBe(false);
  });
  it("no elige arbitrariamente entre valores ambiguos", () => {
    const v = extractReceiptCandidates("Consumo kWh: 120\nConsumo kWh: 180");
    expect(v.fields.kWh).toBeUndefined();
  });
  it("rechaza archivo disfrazado", () => {
    expect(() =>
      validateDocumentBytes(
        new TextEncoder().encode("<html>"),
        "application/pdf",
      ),
    ).toThrow();
  });
  it("ningún reviewed:true del navegador aprueba una tarifa", () => {
    const input = {
      segment: "RESIDENTIAL" as const,
      consumption: {
        months: [],
        tariff: {
          name: "Escenario",
          sourceRef: "fabricado",
          version: "1",
          reviewed: true,
          energyRateMxnKwh: 3,
          fixedMonthlyMxn: 0,
          demandMonthlyMxn: 0,
          validFrom: "2026-01",
          validTo: "2026-12",
        },
      },
    };
    expect(
      resolveEngineeringRules(input, []).input.consumption?.tariff?.reviewed,
    ).toBe(false);
  });
});

it("extrae texto de un PDF real local sin confirmar automáticamente", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Tarifa: GDMTH\nConsumo kWh: 12300\nTotal a pagar: $38401.16", {
    x: 40,
    y: 700,
    font,
    lineHeight: 20,
    size: 12,
  });
  const result = await extractReceipt(await pdf.save(), "application/pdf");
  expect(result.method).toBe("PDF_TEXT");
  expect(result.fields.kWh).toBe(12300);
  expect(result.reviewed).toBe(false);
});

it("lee por OCR la primera página de un PDF escaneado sin declarar validación", async () => {
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(1200, 500),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1200, 500);
  ctx.fillStyle = "black";
  ctx.font = "48px sans-serif";
  ctx.fillText("Tarifa: GDMTH", 40, 90);
  ctx.fillText("Consumo kWh: 12300", 40, 180);
  ctx.fillText("Total a pagar: $38401.16", 40, 270);
  const pdf = await PDFDocument.create(),
    embedded = await pdf.embedPng(await canvas.encode("png"));
  pdf
    .addPage([600, 250])
    .drawImage(embedded, { x: 0, y: 0, width: 600, height: 250 });
  const result = await extractReceipt(await pdf.save(), "application/pdf");
  expect(result.method).toBe("LOCAL_OCR");
  expect(result.fields.kWh).toBe(12300);
  expect(result.reviewed).toBe(false);
  expect(result.warnings.some((w) => w.includes("primera página"))).toBe(true);
}, 40000);
