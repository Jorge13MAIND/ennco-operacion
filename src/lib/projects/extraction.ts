export interface ReceiptCandidate {
  field: string;
  value: string | number;
  sourceLine: string;
  reviewRequired: true;
}
export interface ReceiptExtraction {
  status: "REVIEW_REQUIRED" | "MANUAL_REQUIRED";
  method: "PDF_TEXT" | "LOCAL_OCR" | "MANUAL";
  reviewed: false;
  candidates: ReceiptCandidate[];
  fields: Record<string, string | number>;
  warnings: string[];
  pages?: number;
}
export function validateDocumentBytes(bytes: Uint8Array, mimeType: string) {
  const valid =
    mimeType === "application/pdf"
      ? new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"
      : mimeType === "image/png"
        ? bytes.length >= 8 &&
          bytes
            .slice(0, 8)
            .every((b, i) => b === [137, 80, 78, 71, 13, 10, 26, 10][i])
        : mimeType === "image/jpeg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : false;
  if (!valid) throw new Error("PROJECT_DOCUMENT_FORMAT_INVALID");
  if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024)
    throw new Error("PROJECT_DOCUMENT_SIZE_INVALID");
}
export function extractReceiptCandidates(text: string): ReceiptExtraction {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const candidates: ReceiptCandidate[] = [];
  const add = (field: string, value: string | number, sourceLine: string) => {
    if (!candidates.some((c) => c.field === field && c.value === value))
      candidates.push({
        field,
        value,
        sourceLine: sourceLine.slice(0, 300),
        reviewRequired: true,
      });
  };
  const numeric = (s: string) => Number(s.replace(/,/g, ""));
  for (const line of lines) {
    const tariff = line.match(
      /(?:tarifa)\s*[:\-]?\s*(GDMTH|GDMTO|PDBT|GDBT|DAC|1[A-F]?|2|3|HM|OM)\b/i,
    );
    if (tariff) add("tariff", tariff[1]!.toUpperCase(), line);
    const kwh = line.match(
      /(?:consumo\s*(?:total)?\s*(?:\(\s*kwh\s*\)|kwh)?|energ[ií]a\s*(?:total)?\s*kwh)\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\b/i,
    );
    if (kwh) add("kWh", numeric(kwh[1]!), line);
    const total = line.match(
      /(?:total\s*a\s*pagar|importe\s*total)\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
    );
    if (total) add("amountMxn", numeric(total[1]!), line);
    const demand = line.match(
      /(?:demanda\s*m[aá]xima)\s*(?:\(kw\)|kw)?\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i,
    );
    if (demand) add("demandKw", numeric(demand[1]!), line);
    const period = line.match(
      /(?:periodo|per[ií]odo).*?(20\d{2}-\d{2}-\d{2}).*?(20\d{2}-\d{2}-\d{2})/i,
    );
    if (period) {
      add("periodStart", period[1]!, line);
      add("periodEnd", period[2]!, line);
    }
  }
  const fields: Record<string, string | number> = {};
  for (const c of candidates) {
    if (candidates.filter((x) => x.field === c.field).length === 1)
      fields[c.field] = c.value;
  }
  return {
    status: candidates.length ? "REVIEW_REQUIRED" : "MANUAL_REQUIRED",
    method: "PDF_TEXT",
    reviewed: false,
    candidates,
    fields,
    warnings: [
      "Revisa cada campo contra el recibo antes de confirmar. La extracción no constituye una lectura validada.",
      ...(candidates.some(
        (c) => candidates.filter((x) => x.field === c.field).length > 1,
      )
        ? [
            "Hay valores ambiguos; captura manualmente los campos con más de una coincidencia.",
          ]
        : []),
    ],
  };
}
function manual(warning: string): ReceiptExtraction {
  return {
    status: "MANUAL_REQUIRED",
    method: "MANUAL",
    reviewed: false,
    candidates: [],
    fields: {},
    warnings: [warning],
  };
}
async function recognizeImage(
  bytes: Uint8Array,
  mimeType: "image/jpeg" | "image/png",
): Promise<ReceiptExtraction> {
  try {
    const { recognizeReceiptImage } = await import("./ocr");
    const result = await recognizeReceiptImage(bytes, mimeType);
    const parsed = extractReceiptCandidates(result.text);
    return {
      ...parsed,
      method: "LOCAL_OCR",
      warnings: [...result.warnings, ...parsed.warnings],
    };
  } catch {
    return manual(
      "No se obtuvo una lectura automática utilizable. Captura los campos y confirma contra el documento; el archivo original permanece guardado.",
    );
  }
}
export async function extractReceipt(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ReceiptExtraction> {
  validateDocumentBytes(bytes, mimeType);
  if (mimeType === "image/jpeg" || mimeType === "image/png")
    return recognizeImage(bytes, mimeType);
  try {
    const { getDocument, GlobalWorkerOptions } = await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    );
    const { createRequire } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    const { dirname, join } = await import("node:path");
    GlobalWorkerOptions.workerSrc = pathToFileURL(
      join(
        dirname(
          createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
        ),
        "legacy/build/pdf.worker.mjs",
      ),
    ).href;
    const task = getDocument({
      data: Uint8Array.from(bytes),
      isEvalSupported: false,
      useSystemFonts: true,
      useWorkerFetch: false,
      verbosity: 0,
    });
    const pdf = await task.promise;
    try {
      if (pdf.numPages > 20)
        return {
          ...manual(
            "El documento supera 20 páginas. Captura el recibo manualmente.",
          ),
          pages: pdf.numPages,
        };
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        for (const item of content.items) {
          if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
        }
        text += "\n";
      }
      if (text.trim().length < 24) {
        const page = await pdf.getPage(1),
          viewport = page.getViewport({ scale: 2 });
        if (viewport.width * viewport.height > 20_000_000)
          return manual(
            "La página supera el límite de resolución. Captura el recibo manualmente.",
          );
        const { createCanvas } = await import("@napi-rs/canvas");
        const canvas = createCanvas(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height),
        );
        await page.render({
          canvas: canvas as never,
          canvasContext: canvas.getContext("2d") as never,
          viewport,
        }).promise;
        const result = await recognizeImage(
          await canvas.encode("png"),
          "image/png",
        );
        return {
          ...result,
          pages: pdf.numPages,
          warnings: [
            ...result.warnings,
            "Se leyó por OCR la primera página escaneada. Revisa las demás páginas y captura los campos faltantes.",
          ],
        };
      }
      return { ...extractReceiptCandidates(text), pages: pdf.numPages };
    } finally {
      await pdf.destroy();
    }
  } catch {
    return manual(
      "No se pudo extraer texto de este PDF. Puedes registrar los campos manualmente.",
    );
  }
}
