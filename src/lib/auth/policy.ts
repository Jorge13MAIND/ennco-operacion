import { z } from "zod";

export const userRoleSchema = z.enum([
  "ennco_admin",
  "ennco_operator",
  "teckel_admin",
  "teckel_operator",
  "auditor_readonly",
]);

export type UserRole = z.infer<typeof userRoleSchema>;
export type AccessDecision =
  | { decision: "ALLOW"; userId: string; organizationId: string; role: UserRole }
  | { decision: "UNAUTHENTICATED" }
  | { decision: "MFA_REQUIRED" }
  | { decision: "FORBIDDEN" };

type Claims = {
  sub?: unknown;
  aal?: unknown;
  is_anonymous?: unknown;
};

type Membership = {
  organization_id?: unknown;
  user_id?: unknown;
  role?: unknown;
  active?: unknown;
} | null;

export function evaluateOperationsAccess(input: {
  claims: Claims | null;
  membership: Membership;
  organizationId: string;
  requireMfa: boolean;
}): AccessDecision {
  const userId = z.uuid().safeParse(input.claims?.sub);
  if (!userId.success || input.claims?.is_anonymous === true) {
    return { decision: "UNAUTHENTICATED" };
  }
  if (input.requireMfa && input.claims?.aal !== "aal2") {
    return { decision: "MFA_REQUIRED" };
  }

  const role = userRoleSchema.safeParse(input.membership?.role);
  if (
    !input.membership ||
    input.membership.active !== true ||
    input.membership.user_id !== userId.data ||
    input.membership.organization_id !== input.organizationId ||
    !role.success
  ) {
    return { decision: "FORBIDDEN" };
  }

  return {
    decision: "ALLOW",
    userId: userId.data,
    organizationId: input.organizationId,
    role: role.data,
  };
}

export function canMutateOperations(role: UserRole): boolean {
  return role !== "auditor_readonly";
}

export function safeInternalNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/operacion";
  }
  try {
    const parsed = new URL(value, "https://internal.invalid");
    return parsed.origin === "https://internal.invalid" ? `${parsed.pathname}${parsed.search}` : "/operacion";
  } catch {
    return "/operacion";
  }
}
