import { describe, expect, it } from "vitest";
import { canMutateOperations, evaluateOperationsAccess, safeInternalNextPath } from "@/lib/auth/policy";

const userId = "99999999-9999-4999-8999-999999999999";
const organizationId = "11111111-1111-4111-8111-111111111111";
const membership = {
  organization_id: organizationId,
  user_id: userId,
  role: "ennco_operator",
  active: true,
};

describe("operations authorization policy", () => {
  it("requires a verified, non-anonymous identity", () => {
    expect(
      evaluateOperationsAccess({ claims: null, membership, organizationId, requireMfa: false }),
    ).toEqual({ decision: "UNAUTHENTICATED" });
    expect(
      evaluateOperationsAccess({
        claims: { sub: userId, aal: "aal2", is_anonymous: true },
        membership,
        organizationId,
        requireMfa: true,
      }),
    ).toEqual({ decision: "UNAUTHENTICATED" });
  });

  it("requires aal2 when MFA is enabled", () => {
    expect(
      evaluateOperationsAccess({
        claims: { sub: userId, aal: "aal1" },
        membership,
        organizationId,
        requireMfa: true,
      }),
    ).toEqual({ decision: "MFA_REQUIRED" });
  });

  it("rejects cross-tenant, inactive and unknown memberships", () => {
    for (const invalidMembership of [
      { ...membership, organization_id: "22222222-2222-4222-8222-222222222222" },
      { ...membership, active: false },
      { ...membership, role: "owner" },
    ]) {
      expect(
        evaluateOperationsAccess({
          claims: { sub: userId, aal: "aal2" },
          membership: invalidMembership,
          organizationId,
          requireMfa: true,
        }),
      ).toEqual({ decision: "FORBIDDEN" });
    }
  });

  it("allows an active membership and preserves read-only audit access", () => {
    expect(
      evaluateOperationsAccess({
        claims: { sub: userId, aal: "aal2" },
        membership,
        organizationId,
        requireMfa: true,
      }),
    ).toEqual({ decision: "ALLOW", userId, organizationId, role: "ennco_operator" });
    expect(canMutateOperations("auditor_readonly")).toBe(false);
    expect(canMutateOperations("ennco_operator")).toBe(true);
  });

  it("rejects open redirects", () => {
    expect(safeInternalNextPath("/operacion?tab=leads")).toBe("/operacion?tab=leads");
    expect(safeInternalNextPath("https://evil.example")).toBe("/operacion");
    expect(safeInternalNextPath("//evil.example")).toBe("/operacion");
  });
});
