import { createHash, randomBytes } from "node:crypto";

import type { RuntimeConfig } from "@/lib/runtime/config";

/**
 * Consentimiento por invitación (M041). El operador genera una liga con un
 * token aleatorio de 256 bits; la base guarda sólo su hash. Quien tiene el
 * buzón la abre, autoriza en Google y la cookie sellada (PKCE + estado) cierra
 * el círculo en el callback. Sirve igual para los buzones propios (los abre
 * Grant o Jorge con la contraseña del Workspace) y para el de Paco.
 */

export const DIRECT_LANE_OAUTH_COOKIE = "ennco_correos_oauth";
export const DIRECT_LANE_OAUTH_COOKIE_PATH = "/api/v1/operations/infrastructure/gmail/oauth";
export const DIRECT_LANE_INVITATION_DAYS = 7;

export function createInvitationToken(): { token: string; tokenSha256: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenSha256: createHash("sha256").update(token).digest("hex") };
}

export function invitationTokenSha256(token: string): string | null {
  if (!/^[A-Za-z0-9_-]{40,64}$/u.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}

export function buildInvitationUrl(appUrl: string, token: string): string {
  const url = new URL("/correos/conectar", appUrl);
  url.searchParams.set("t", token);
  return url.toString();
}

export type DirectLaneOAuthClient = { clientId: string; clientSecret: string; redirectUri: string; stateSecret: string; vaultKey: string };

/** La misma URI de callback que el broker M030: es la que está registrada en Google. */
export function requireDirectLaneOAuthClient(config: RuntimeConfig): DirectLaneOAuthClient {
  if (!config.directLaneReleased || !config.googleOauthClientId || !config.googleOauthClientSecret || !config.googleOauthRedirectUri || !config.directLaneVaultKey) {
    throw new Error("DIRECT_LANE_OAUTH_NOT_CONFIGURED");
  }
  // La cookie se sella con un derivado de la llave de la bóveda: no hace falta
  // un secreto adicional en Vercel, y la llave nunca sale al cliente.
  const stateSecret = createHash("sha256").update(`ennco-direct-lane-cookie:${config.directLaneVaultKey}`).digest("hex");
  return {
    clientId: config.googleOauthClientId,
    clientSecret: config.googleOauthClientSecret,
    redirectUri: config.googleOauthRedirectUri,
    stateSecret,
    vaultKey: config.directLaneVaultKey,
  };
}
