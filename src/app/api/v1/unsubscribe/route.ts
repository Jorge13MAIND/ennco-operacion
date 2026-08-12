import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { persistOneClickUnsubscribe } from "@/lib/unsubscribe/persistence";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe/token";
import { getRuntimeConfig } from "@/lib/runtime/config";

const unsubscribeHtmlHeaders = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

function response(status: number, error?: string): NextResponse {
  return error
    ? NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } })
    : new NextResponse(null, { status, headers: { "Cache-Control": "private, no-store" } });
}

function htmlResponse(status: number, title: string, message: string, formAction?: string): NextResponse {
  const form = formAction
    ? `<form action="${formAction}" method="post"><input name="List-Unsubscribe" type="hidden" value="One-Click"><button type="submit">Confirmar baja</button></form>`
    : "";
  return new NextResponse(
    `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p>${form}</main></body></html>`,
    { status, headers: unsubscribeHtmlHeaders },
  );
}

function readReleasedToken(request: Request):
  | { ok: true; config: ReturnType<typeof getRuntimeConfig>; token: string; enrollmentId: string; tokenNonce: string }
  | { ok: false; status: number; error: string } {
  let config;
  try {
    config = getRuntimeConfig();
  } catch {
    return { ok: false, status: 503, error: "UNSUBSCRIBE_RUNTIME_NOT_READY" };
  }
  if (
    !config.unsubscribeReleased
    || !config.unsubscribeSigningSecret
    || !config.unsubscribeIngestSecret
    || config.demoMode
  ) {
    return { ok: false, status: 503, error: "UNSUBSCRIBE_NOT_RELEASED" };
  }
  const token = new URL(request.url).searchParams.get("token");
  if (!token || token.length > 2048) return { ok: false, status: 400, error: "UNSUBSCRIBE_TOKEN_INVALID" };
  try {
    const payload = verifyUnsubscribeToken(token, config.unsubscribeSigningSecret);
    if (payload.organizationId !== config.organizationId) {
      return { ok: false, status: 400, error: "UNSUBSCRIBE_TOKEN_INVALID" };
    }
    return {
      ok: true,
      config,
      token,
      enrollmentId: payload.enrollmentId,
      tokenNonce: payload.nonce,
    };
  } catch {
    return { ok: false, status: 400, error: "UNSUBSCRIBE_TOKEN_INVALID" };
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const released = readReleasedToken(request);
  if (!released.ok) {
    return htmlResponse(released.status, "Enlace no disponible", "No fue posible validar esta solicitud de baja.");
  }
  const action = `/api/v1/unsubscribe?token=${encodeURIComponent(released.token)}`;
  return htmlResponse(200, "Dejar de recibir correos", "Confirma que quieres detener todos los correos de esta secuencia.", action);
}

export async function POST(request: Request): Promise<NextResponse> {
  const released = readReleasedToken(request);
  if (!released.ok) return response(released.status, released.error);

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const rawBody = await request.text();
  if (rawBody.length > 128) return response(400, "UNSUBSCRIBE_REQUEST_INVALID");
  const oneClickConfirmed = contentType === "application/x-www-form-urlencoded"
    && new URLSearchParams(rawBody).get("List-Unsubscribe") === "One-Click";
  if (!oneClickConfirmed) return response(400, "UNSUBSCRIBE_REQUEST_INVALID");

  const idempotencyKey = `unsubscribe:${createHash("sha256").update(released.token).digest("hex")}`;
  try {
    await persistOneClickUnsubscribe({
      config: released.config,
      enrollmentId: released.enrollmentId,
      tokenNonce: released.tokenNonce,
      idempotencyKey,
    });
    if (request.headers.get("sec-fetch-mode") === "navigate") {
      return htmlResponse(200, "Baja confirmada", "La secuencia quedó detenida y no recibirás más correos.");
    }
    return response(204);
  } catch {
    return response(503, "UNSUBSCRIBE_PERSISTENCE_UNAVAILABLE");
  }
}
