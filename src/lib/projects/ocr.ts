import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";

export const RECEIPT_OCR_TIMEOUT_MS = 25_000;
export const RECEIPT_OCR_MAX_PIXELS = 20_000_000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const requireLocal = createRequire(import.meta.url);
type ImageMime = "image/jpeg" | "image/png";
export interface ReceiptOcrResult {
  text: string;
  elapsedMs: number;
  engine: "TESSERACT_LOCAL";
  warnings: string[];
}

function imageSize(
  width: number,
  height: number,
): { width: number; height: number } {
  if (
    !width ||
    !height ||
    width > 20_000 ||
    height > 20_000 ||
    width * height > RECEIPT_OCR_MAX_PIXELS
  ) {
    throw new Error("PROJECT_OCR_IMAGE_DIMENSIONS_INVALID");
  }
  return { width, height };
}

/** Inspect encoded dimensions before Tesseract/Leptonica can allocate decoded pixels. */
export function inspectReceiptImageDimensions(
  bytes: Uint8Array,
  mimeType: ImageMime,
): { width: number; height: number } {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new Error("PROJECT_OCR_IMAGE_SIZE_INVALID");
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mimeType === "image/png") {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (
      bytes.length < 33 ||
      !signature.every((b, i) => bytes[i] === b) ||
      data.getUint32(8) !== 13 ||
      String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
    ) {
      throw new Error("PROJECT_OCR_IMAGE_FORMAT_INVALID");
    }
    const dimensions = imageSize(data.getUint32(16), data.getUint32(20));
    let offset = 8;
    let headers = 0;
    while (offset + 12 <= bytes.length) {
      const length = data.getUint32(offset);
      const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (length > bytes.length - offset - 12)
        throw new Error("PROJECT_OCR_IMAGE_FORMAT_INVALID");
      if (type === "IHDR") headers++;
      if (headers > 1 || type === "acTL")
        throw new Error("PROJECT_OCR_IMAGE_FORMAT_INVALID");
      offset += 12 + length;
      if (type === "IEND") {
        if (length !== 0 || offset !== bytes.length)
          throw new Error("PROJECT_OCR_IMAGE_FORMAT_INVALID");
        return dimensions;
      }
    }
    throw new Error("PROJECT_OCR_IMAGE_FORMAT_INVALID");
  }
  if (
    mimeType !== "image/jpeg" ||
    bytes.length < 4 ||
    bytes[0] !== 255 ||
    bytes[1] !== 216
  ) {
    throw new Error("PROJECT_OCR_IMAGE_FORMAT_INVALID");
  }
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 255)
      throw new Error("PROJECT_OCR_IMAGE_FORMAT_INVALID");
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (
      marker === undefined ||
      marker === 0 ||
      marker === 0xda ||
      marker === 0xd9
    )
      break;
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = data.getUint16(offset);
    if (length < 2 || length > bytes.length - offset) break;
    if (startOfFrame.has(marker)) {
      if (length < 8 || length !== 8 + 3 * (bytes[offset + 7] ?? 0)) break;
      return imageSize(data.getUint16(offset + 5), data.getUint16(offset + 3));
    }
    offset += length;
  }
  throw new Error("PROJECT_OCR_IMAGE_FORMAT_INVALID");
}

type WorkerPacket = {
  action?: string;
  jobId?: string;
  status?: string;
  data?: unknown;
};
type PendingJob = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
};

/**
 * Server-only offline adapter for pinned tesseract.js 7 worker protocol.
 * Owning the Node worker immediately permits cancellation during model loading,
 * before the public createWorker promise would expose a termination handle.
 * No receipt bytes/text are logged or written to disk; network fetch is disabled
 * inside the OCR thread. Upgrade the protocol only with the real smoke test.
 */
export async function recognizeReceiptImage(
  bytes: Uint8Array,
  mimeType: ImageMime,
): Promise<ReceiptOcrResult> {
  inspectReceiptImageDimensions(bytes, mimeType);
  const started = performance.now();
  let workerPath: string, corePath: string, langPath: string;
  try {
    const packageInfo = requireLocal("tesseract.js/package.json") as {
      version?: string;
    };
    if (packageInfo.version !== "7.0.0")
      throw new Error("PROJECT_OCR_ENGINE_VERSION_UNSUPPORTED");
    workerPath = requireLocal.resolve(
      "tesseract.js/src/worker-script/node/index.js",
    );
    corePath = dirname(requireLocal.resolve("tesseract.js-core/package.json"));
    langPath = join(
      dirname(requireLocal.resolve("@tesseract.js-data/spa/package.json")),
      "4.0.0_best_int",
    );
    if (
      !existsSync(workerPath) ||
      !existsSync(join(langPath, "spa.traineddata.gz")) ||
      !existsSync(join(corePath, "tesseract-core-lstm.wasm"))
    )
      throw new Error("PROJECT_OCR_ASSETS_UNAVAILABLE");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "PROJECT_OCR_ENGINE_VERSION_UNSUPPORTED"
    )
      throw error;
    throw new Error("PROJECT_OCR_ASSETS_UNAVAILABLE");
  }

  const worker = new Worker(
    `
    const { workerData } = require('node:worker_threads');
    globalThis.fetch = async () => { throw new Error('PROJECT_OCR_NETWORK_DISABLED'); };
    require(workerData.entrypoint);
  `,
    {
      eval: true,
      workerData: { entrypoint: workerPath },
      stdout: true,
      stderr: true,
    },
  );
  // Native decoder diagnostics must not reach application logs or block pipes.
  worker.stdout?.resume();
  worker.stderr?.resume();
  const jobs = new Map<string, PendingJob>();
  let serial = 0;
  let stopped = false;
  const rejectAll = (code: string) => {
    stopped = true;
    for (const pending of jobs.values()) pending.reject(new Error(code));
    jobs.clear();
  };
  worker.on("error", () => rejectAll("PROJECT_OCR_WORKER_FAILED"));
  worker.on("exit", () => {
    if (!stopped) rejectAll("PROJECT_OCR_WORKER_FAILED");
  });
  worker.on("message", (packet: WorkerPacket) => {
    if (
      !packet.jobId ||
      (packet.status !== "resolve" && packet.status !== "reject")
    )
      return;
    const pending = jobs.get(packet.jobId);
    if (!pending) return;
    jobs.delete(packet.jobId);
    if (packet.status === "reject")
      pending.reject(new Error("PROJECT_OCR_RECOGNITION_FAILED"));
    else pending.resolve(packet.data);
  });
  const job = (
    action: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> => {
    if (stopped) return Promise.reject(new Error("PROJECT_OCR_WORKER_FAILED"));
    const jobId = `receipt-${++serial}`;
    return new Promise((resolve, reject) => {
      jobs.set(jobId, { resolve, reject });
      worker.postMessage({ workerId: "ennco-receipt", jobId, action, payload });
    });
  };
  const timeout = setTimeout(
    () => rejectAll("PROJECT_OCR_TIMEOUT"),
    RECEIPT_OCR_TIMEOUT_MS,
  );
  timeout.unref();
  try {
    // In tesseract.js 7's Node getCore, this value is the numeric LSTM OEM.
    await job("load", { options: { lstmOnly: 1, corePath, logging: false } });
    await job("loadLanguage", {
      langs: "spa",
      options: {
        langPath,
        cachePath: tmpdir(),
        cacheMethod: "none",
        gzip: true,
        lstmOnly: true,
      },
    });
    await job("initialize", { langs: "spa", oem: 1, config: {} });
    await job("setParameters", {
      params: {
        tessedit_pageseg_mode: "3",
        user_defined_dpi: "300",
        preserve_interword_spaces: "1",
      },
    });
    const output = (await job("recognize", {
      image: Uint8Array.from(bytes),
      options: {},
      output: { text: true },
    })) as { text?: unknown; confidence?: unknown };
    if (typeof output?.text !== "string" || output.text.length > 200_000)
      throw new Error("PROJECT_OCR_OUTPUT_INVALID");
    const text = output.text.trim();
    return {
      text,
      elapsedMs: Math.round(performance.now() - started),
      engine: "TESSERACT_LOCAL",
      warnings: [
        "Lectura automática local. Confirma cada campo contra la imagen antes de utilizarlo.",
        ...(text
          ? []
          : ["No se detectó texto legible; utiliza captura manual."]),
        ...(typeof output.confidence === "number" && output.confidence < 50
          ? [
              "El motor reportó baja confianza; revisa todos los valores. Su confianza no mide precisión comprobada con recibos de ENNCO.",
            ]
          : []),
      ],
    };
  } finally {
    clearTimeout(timeout);
    rejectAll("PROJECT_OCR_WORKER_STOPPED");
    await worker.terminate();
  }
}
