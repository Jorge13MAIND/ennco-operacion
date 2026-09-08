import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pixel de apertura del carril directo. El token viaja en la URL de una
 * imagen de 1x1 dentro de la parte HTML del correo; al cargarse, la ruta
 * pública verifica la firma y registra la apertura del mensaje.
 *
 * Es una métrica DIRECCIONAL: Apple Mail precarga imágenes (aperturas
 * falsas), Gmail las sirve por proxy (cuenta mal) y Outlook las bloquea para
 * remitentes desconocidos (cuenta cero). Por eso se etiqueta así en el panel.
 * Por defecto se activa desde el toque 2 (ENNCO_OPEN_TRACKING=from_touch_2)
 * para no cargar el primer contacto con una carga externa.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function sign(organizationId: string, messageId: string, secret: string): string {
  return createHmac("sha256", secret).update(`open\n${organizationId}\n${messageId.toLowerCase()}`, "utf8").digest("base64url").slice(0, 32);
}

export function createOpenPixelToken(input: { organizationId: string; messageId: string; secret: string }): string {
  if (!UUID.test(input.messageId) || input.secret.length < 32) throw new Error("OPEN_PIXEL_INPUT_INVALID");
  return `${input.messageId.toLowerCase()}.${sign(input.organizationId, input.messageId, input.secret)}`;
}

export function verifyOpenPixelToken(input: { token: string; organizationId: string; secret: string }): string | null {
  const [messageId, signature] = input.token.split(".");
  if (!messageId || !signature || !UUID.test(messageId) || input.secret.length < 32) return null;
  const expected = sign(input.organizationId, messageId, input.secret);
  const a = Buffer.from(signature, "utf8"); const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return messageId.toLowerCase();
}

export function buildOpenPixelUrl(appUrl: string, token: string): string {
  return new URL(`/api/v1/public/correos/o/${token}.gif`, appUrl).toString();
}

export function openPixelAllowed(policy: "off" | "from_touch_2" | "all", touchNumber: number | null): boolean {
  if (policy === "off" || touchNumber === null) return false;
  if (policy === "all") return true;
  return touchNumber >= 2;
}

/** GIF transparente de 1x1 (43 bytes). */
export const TRANSPARENT_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
