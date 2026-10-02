import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";

import { createDispatchProof } from "@/lib/dispatch/proof";
import { getRuntimeConfig } from "@/lib/runtime/config";

/**
 * Límite de intentos de inicio de sesión y de recuperación (2-oct, auditoría de seguridad).
 *
 * Los dos formularios llaman a Supabase desde el servidor de Vercel, así que el límite propio de
 * Supabase ve la IP de Vercel y no la del atacante. Aquí se cuenta por correo y por IP real
 * (x-vercel-forwarded-for) en ventanas de 15 minutos, en la base y con prueba HMAC
 * (public.check_auth_attempt). Si el contador no responde se deja pasar: este freno no debe
 * dejar fuera a nadie por una falla propia.
 */
export type AuthAttemptKind = "login" | "recovery";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0]?.trim() || "unknown";
}

export async function authAttemptAllowed(kind: AuthAttemptKind, email: string): Promise<boolean> {
  const config = getRuntimeConfig();
  if (!config.supabaseUrl || !config.supabasePublishableKey || !config.organizationId || !config.dispatchSecret) return true;
  try {
    const emailHash = sha256(`email:${email.trim().toLowerCase()}`);
    const ipHash = sha256(`ip:${await clientIp()}`);
    const proof = createDispatchProof({
      organizationId: config.organizationId, commandName: "check_auth_attempt",
      payloadParts: [config.organizationId, kind, emailHash, ipHash], secret: config.dispatchSecret,
    });
    const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await client.rpc("check_auth_attempt", {
      target_organization_id: config.organizationId, target_kind: kind,
      target_email_hash: emailHash, target_ip_hash: ipHash, ...proof,
    });
    if (error) return true;
    return (data as { allowed?: boolean } | null)?.allowed !== false;
  } catch {
    return true;
  }
}
