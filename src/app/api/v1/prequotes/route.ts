import { NextResponse } from "next/server";
import { z } from "zod";

import { calculatePrequote, prequoteInputSchema } from "@/lib/domain/prequote";
import { createPrequotePdfToken } from "@/lib/prequote/pdf-token";
import {
  getTrustedClientAddress,
  persistPrequote,
  PrequotePersistenceError,
} from "@/lib/prequote/persistence";
import { getPdfSigningSecret, getRuntimeConfig } from "@/lib/runtime/config";

const idempotencyKeySchema = z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9_.:-]+$/);

function unavailable(error: string, correlationId: string): NextResponse {
  return NextResponse.json(
    { error, correlation_id: correlationId },
    { status: 503, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = crypto.randomUUID();
  let config;
  try {
    config = getRuntimeConfig();
  } catch {
    return unavailable("PREQUOTE_RUNTIME_NOT_READY", correlationId);
  }

  const rawBody: unknown = await request.json().catch(() => null);
  if (
    typeof rawBody === "object"
    && rawBody !== null
    && "website" in rawBody
    && typeof rawBody.website === "string"
    && rawBody.website.trim() !== ""
  ) {
    return NextResponse.json(
      { status: "ACCEPTED" },
      { status: 202, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const parsed = prequoteInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_PREQUOTE_INPUT", correlation_id: correlationId, details: parsed.error.flatten() },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const rawIdempotencyKey = request.headers.get("Idempotency-Key");
  const idempotencyKey = idempotencyKeySchema.safeParse(
    rawIdempotencyKey ?? (config.demoMode ? crypto.randomUUID() : ""),
  );
  if (!idempotencyKey.success) {
    return NextResponse.json(
      { error: "IDEMPOTENCY_KEY_REQUIRED", correlation_id: correlationId },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const estimate = calculatePrequote(parsed.data);
  if (parsed.data.receiptUploadId) {
    return unavailable("PREQUOTE_DOCUMENT_UPLOAD_NOT_READY", correlationId);
  }
  if (!config.demoMode && estimate.modelStatus !== "APPROVED") {
    return unavailable(
      estimate.modelStatus === "EXPIRED" ? "PREQUOTE_MODEL_EXPIRED" : "PREQUOTE_MODEL_NOT_APPROVED",
      correlationId,
    );
  }
  if (!config.demoMode && !config.privacyNoticeApproved) {
    return unavailable("PREQUOTE_PRIVACY_NOTICE_NOT_APPROVED", correlationId);
  }
  let recordId: string;
  let folio: string;
  let requestStatus: "CREATED" | "DUPLICATE";
  let evidenceClass: "synthetic_demo" | "live";
  if (config.demoMode) {
    recordId = crypto.randomUUID();
    folio = `ENN-PRE-${recordId.slice(0, 8).toUpperCase()}`;
    requestStatus = "CREATED";
    evidenceClass = "synthetic_demo";
  } else {
    try {
      const persisted = await persistPrequote({
        config,
        idempotencyKey: idempotencyKey.data,
        clientAddress: getTrustedClientAddress(request, config.appEnv),
        payload: { correlationId, input: parsed.data, estimate },
      });
      recordId = persisted.record_id;
      folio = persisted.folio;
      requestStatus = persisted.status;
      evidenceClass = "live";
    } catch (caught) {
      if (caught instanceof PrequotePersistenceError && caught.code === "RATE_LIMIT") {
        return NextResponse.json(
          { error: "PREQUOTE_RATE_LIMITED", correlation_id: correlationId },
          { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": "3600" } },
        );
      }
      if (caught instanceof PrequotePersistenceError && caught.code === "MODEL_NOT_APPROVED") {
        return unavailable("PREQUOTE_MODEL_NOT_APPROVED", correlationId);
      }
      return unavailable("PREQUOTE_PERSISTENCE_UNAVAILABLE", correlationId);
    }
  }

  const pdf = createPrequotePdfToken({
    folio,
    estimate,
    evidenceClass,
    secret: getPdfSigningSecret(config),
  });

  return NextResponse.json(
    {
      record_id: recordId,
      correlation_id: correlationId,
      idempotency_key: idempotencyKey.data,
      request_status: requestStatus,
      folio,
      estimate,
      evidence_class: evidenceClass,
      persistence_status: config.demoMode ? "SYNTHETIC_NOT_PERSISTED" : "PERSISTED",
      pdf_url: `/api/v1/prequotes/${folio}/pdf?token=${encodeURIComponent(pdf.token)}`,
      pdf_expires_at: pdf.expiresAt,
    },
    { status: requestStatus === "CREATED" ? 201 : 200, headers: { "Cache-Control": "private, no-store" } },
  );
}
