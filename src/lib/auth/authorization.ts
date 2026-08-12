import { evaluateOperationsAccess, type UserRole } from "@/lib/auth/policy";
import { redirectTo } from "@/lib/auth/navigation";
import { getRuntimeConfig, hasDedicatedSupabase } from "@/lib/runtime/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type OperationsAccessContext = {
  evidenceClass: "synthetic_demo" | "live";
  userId: string | null;
  organizationId: string | null;
  role: UserRole | "synthetic_admin";
};

export async function requireOperationsAccess(): Promise<OperationsAccessContext> {
  const config = getRuntimeConfig();
  if (config.demoMode && config.appEnv !== "production") {
    return {
      evidenceClass: "synthetic_demo",
      userId: null,
      organizationId: null,
      role: "synthetic_admin",
    };
  }
  if (!hasDedicatedSupabase(config)) {
    redirectTo("/ingreso?reason=unavailable");
  }

  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) {
    redirectTo("/ingreso?reason=auth");
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("organization_users")
    .select("organization_id,user_id,role,active")
    .eq("organization_id", config.organizationId)
    .eq("user_id", claimsData.claims.sub)
    .eq("active", true)
    .limit(2);

  if (membershipError) {
    redirectTo("/ingreso?reason=unavailable");
  }

  const decision = evaluateOperationsAccess({
    claims: claimsData.claims,
    membership: memberships?.length === 1 ? (memberships[0] ?? null) : null,
    organizationId: config.organizationId,
    requireMfa: config.requireMfa,
  });

  if (decision.decision === "UNAUTHENTICATED") redirectTo("/ingreso?reason=auth");
  if (decision.decision === "MFA_REQUIRED") redirectTo("/ingreso/mfa");
  if (decision.decision === "FORBIDDEN") redirectTo("/ingreso?reason=forbidden");

  return {
    evidenceClass: "live",
    userId: decision.userId,
    organizationId: decision.organizationId,
    role: decision.role,
  };
}
