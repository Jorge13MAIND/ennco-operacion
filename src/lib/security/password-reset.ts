import { createHmac, timingSafeEqual } from "node:crypto";

import type { RuntimeConfig } from "@/lib/runtime/config";

/**
 * Prueba de que la sesión viene de una liga de recuperación (2-oct, auditoría de seguridad).
 *
 * Antes, cualquier sesión abierta podía cambiar la contraseña sin dar la actual: quien tomara
 * una sesión (computadora compartida, cookie robada) dejaba fuera al dueño. Ahora /auth/callback
 * sella esta cookie cuando el destino es /ingreso/nueva-contrasena, atada al usuario y válida
 * 15 minutos; sin ella, el cambio exige la contraseña actual.
 */
export const PASSWORD_RESET_COOKIE = "ennco_pw_reset";
export const PASSWORD_RESET_TTL_SECONDS = 15 * 60;

type ResetConfig = Pick<RuntimeConfig, "gmailOauthStateSecret">;

function key(config: ResetConfig): Buffer | null {
  if (!config.gmailOauthStateSecret) return null;
  return createHmac("sha256", config.gmailOauthStateSecret).update("ennco-password-reset:v1").digest();
}

export function sealPasswordReset(subject: string, config: ResetConfig, now = Date.now()): string | null {
  const k = key(config);
  if (!k) return null;
  const expires = Math.floor(now / 1000) + PASSWORD_RESET_TTL_SECONDS;
  const mac = createHmac("sha256", k).update(`${subject}.${expires}`).digest("base64url");
  return `${expires}.${mac}`;
}

export function passwordResetIsValid(value: string | undefined, subject: string, config: ResetConfig, now = Date.now()): boolean {
  const k = key(config);
  if (!k || !value) return false;
  const [expiresText, mac] = value.split(".");
  const expires = Number(expiresText);
  if (!mac || !Number.isInteger(expires) || expires < Math.floor(now / 1000)) return false;
  const expected = Buffer.from(createHmac("sha256", k).update(`${subject}.${expires}`).digest("base64url"));
  const received = Buffer.from(mac);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
