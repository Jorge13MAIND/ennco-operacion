import { z } from "zod";

const nonceSchema = z.string().regex(/^[A-Za-z0-9+/=]{16,128}$/);

export function buildContentSecurityPolicy(nonce: string, development: boolean): string {
  const safeNonce = nonceSchema.parse(nonce);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${safeNonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${safeNonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");
}

export type MutationRequestDecision =
  | { decision: "ALLOW" }
  | { decision: "REJECT"; code: "MUTATION_ORIGIN_MISSING" | "MUTATION_ORIGIN_MISMATCH" | "MUTATION_FETCH_SITE_REJECTED" };

export function evaluateMutationRequest(request: Request, appUrl: string): MutationRequestDecision {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(appUrl).origin;
  } catch {
    return { decision: "REJECT", code: "MUTATION_ORIGIN_MISMATCH" };
  }

  const origin = request.headers.get("origin");
  if (!origin) return { decision: "REJECT", code: "MUTATION_ORIGIN_MISSING" };

  let actualOrigin: string;
  try {
    actualOrigin = new URL(origin).origin;
  } catch {
    return { decision: "REJECT", code: "MUTATION_ORIGIN_MISMATCH" };
  }
  if (actualOrigin !== expectedOrigin) {
    return { decision: "REJECT", code: "MUTATION_ORIGIN_MISMATCH" };
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return { decision: "REJECT", code: "MUTATION_FETCH_SITE_REJECTED" };
  }
  return { decision: "ALLOW" };
}
