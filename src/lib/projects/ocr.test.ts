import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { Worker } from "node:worker_threads";
import {
  inspectReceiptImageDimensions,
  recognizeReceiptImage,
  RECEIPT_OCR_TIMEOUT_MS,
} from "./ocr";

function fixtureImage(format: "png" | "jpeg" = "png"): Uint8Array {
  const canvas = createCanvas(1600, 800);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 1600, 800);
  context.fillStyle = "#000";
  context.font = "48px sans-serif";
  const lines = [
    "RECIBO SINTETICO DE PRUEBA",
    "Tarifa PDBT",
    "Consumo total kWh 1250",
    "TOTAL A PAGAR $3456.78",
    "PERIODO 2026-01-01 A 2026-02-01",
  ];
  for (const [index, line] of lines.entries())
    context.fillText(line, 80, 100 + index * 120);
  return format === "png"
    ? canvas.toBuffer("image/png")
    : canvas.toBuffer("image/jpeg");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("offline receipt image bounds", () => {
  it("reads real PNG and JPEG dimensions without decoding pixels", () => {
    expect(inspectReceiptImageDimensions(fixtureImage(), "image/png")).toEqual({
      width: 1600,
      height: 800,
    });
    expect(
      inspectReceiptImageDimensions(fixtureImage("jpeg"), "image/jpeg"),
    ).toEqual({ width: 1600, height: 800 });
  });
  it("rejects a forged PNG pixel bomb and truncated signature before starting a worker", async () => {
    const image = Uint8Array.from(fixtureImage());
    new DataView(image.buffer).setUint32(16, 30_000);
    await expect(recognizeReceiptImage(image, "image/png")).rejects.toThrow(
      "PROJECT_OCR_IMAGE_DIMENSIONS_INVALID",
    );
    expect(() =>
      inspectReceiptImageDimensions(Uint8Array.from([137]), "image/png"),
    ).toThrow("PROJECT_OCR_IMAGE_FORMAT_INVALID");
  });
  it("rejects JPEG dimensions over twenty megapixels and malformed segments", () => {
    const jpeg = Uint8Array.from([
      255, 216, 255, 192, 0, 11, 8, 0x13, 0x88, 0x13, 0x88, 1, 1, 0x11, 0, 255,
      217,
    ]);
    expect(() => inspectReceiptImageDimensions(jpeg, "image/jpeg")).toThrow(
      "PROJECT_OCR_IMAGE_DIMENSIONS_INVALID",
    );
    expect(() =>
      inspectReceiptImageDimensions(
        Uint8Array.from([255, 216, 255, 192, 255, 255]),
        "image/jpeg",
      ),
    ).toThrow("PROJECT_OCR_IMAGE_FORMAT_INVALID");
  });
  it("rejects PNG missing its ending chunk and images over the route size limit", () => {
    const png = fixtureImage();
    expect(() =>
      inspectReceiptImageDimensions(png.slice(0, -12), "image/png"),
    ).toThrow("PROJECT_OCR_IMAGE_FORMAT_INVALID");
    expect(() =>
      inspectReceiptImageDimensions(
        new Uint8Array(4 * 1024 * 1024 + 1),
        "image/jpeg",
      ),
    ).toThrow("PROJECT_OCR_IMAGE_SIZE_INVALID");
  });
});

describe("local Tesseract worker", () => {
  it.each(["png", "jpeg"] as const)(
    "recognizes synthetic %s receipt digits using bundled Spanish data with network disabled",
    async (format) => {
      const result = await recognizeReceiptImage(
        fixtureImage(format),
        format === "png" ? "image/png" : "image/jpeg",
      );
      expect(result.engine).toBe("TESSERACT_LOCAL");
      expect(result.text).toMatch(/1250/);
      expect(result.text).toMatch(/3456[.,]78/);
      expect(result.text).toMatch(/2026-01-01/);
      expect(result.warnings.join(" ")).toMatch(/Confirma cada campo/);
      expect(result.elapsedMs).toBeGreaterThan(0);
      expect(result.elapsedMs).toBeLessThan(RECEIPT_OCR_TIMEOUT_MS);
    },
    35_000,
  );
  it("terminates a real worker if initialization stalls, rather than merely abandoning a promise", async () => {
    vi.useFakeTimers();
    vi.spyOn(Worker.prototype, "postMessage").mockImplementation(
      () => undefined,
    );
    const terminate = vi.spyOn(Worker.prototype, "terminate");
    const recognition = recognizeReceiptImage(fixtureImage(), "image/png");
    const rejected = expect(recognition).rejects.toThrow("PROJECT_OCR_TIMEOUT");
    await vi.advanceTimersByTimeAsync(RECEIPT_OCR_TIMEOUT_MS);
    await rejected;
    expect(terminate).toHaveBeenCalledOnce();
  }, 10_000);
});
