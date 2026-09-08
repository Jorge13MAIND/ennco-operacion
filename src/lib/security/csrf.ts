import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { RuntimeConfig } from "@/lib/runtime/config";

/**
 * Token anti-CSRF del cierre de sesión (server action del panel).
 *
 * Las server actions ya comparan Origin contra Host; este token es la segunda
 * capa que exige el escaneo DAST (ZAP 10202, riesgo medio) y ata el formulario
 * al usuario de la sesión: HMAC con separación de dominio sobre el secreto de
 * estado OAuth, que en producción siempre existe. Sin secreto configurado (la
 * app sintética de CI) se usa uno por proceso; en ese modo el cierre redirige
 * antes de verificar, así que nada depende de él.
 */
const processSecret = randomBytes(32).toString("base64url");

export const SIGN_OUT_CSRF_FIELD = "csrf_token";

type CsrfConfig = Pick<RuntimeConfig, "gmailOauthStateSecret">;

function signOutKey(config: CsrfConfig): Buffer {
  return createHmac("sha256", config.gmailOauthStateSecret ?? processSecret).update("ennco-signout-csrf:v1").digest();
}

export function signOutCsrfToken(subject: string, config: CsrfConfig): string {
  return createHmac("sha256", signOutKey(config)).update(subject).digest("base64url");
}

export function signOutCsrfTokenMatches(candidate: unknown, subject: string, config: CsrfConfig): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  const expected = Buffer.from(signOutCsrfToken(subject, config));
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
