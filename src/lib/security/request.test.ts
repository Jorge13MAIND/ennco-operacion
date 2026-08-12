import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, evaluateMutationRequest } from "@/lib/security/request";

describe("request security", () => {
  it("builds a nonce-bound production CSP without unsafe eval or unsafe inline", () => {
    const policy = buildContentSecurityPolicy("YWJjZGVmZ2hpamtsbW5vcA==", false);
    expect(policy).toContain("script-src 'self' 'nonce-YWJjZGVmZ2hpamtsbW5vcA==' 'strict-dynamic'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("unsafe-inline");
  });

  it("allows only the configured same origin for cookie-backed mutations", () => {
    const allowed = new Request("https://operacion.ennco.com.mx/api/v1/operations/tasks/x/complete", {
      method: "POST",
      headers: { origin: "https://operacion.ennco.com.mx", "sec-fetch-site": "same-origin" },
    });
    expect(evaluateMutationRequest(allowed, "https://operacion.ennco.com.mx")).toEqual({ decision: "ALLOW" });

    const crossOrigin = new Request("https://operacion.ennco.com.mx/api/v1/operations/tasks/x/complete", {
      method: "POST",
      headers: { origin: "https://evil.invalid", "sec-fetch-site": "cross-site" },
    });
    expect(evaluateMutationRequest(crossOrigin, "https://operacion.ennco.com.mx")).toEqual({
      decision: "REJECT",
      code: "MUTATION_ORIGIN_MISMATCH",
    });
  });

  it("fails closed when Origin is missing or Fetch Metadata is not same-origin", () => {
    expect(evaluateMutationRequest(new Request("https://operacion.ennco.com.mx/api", { method: "POST" }), "https://operacion.ennco.com.mx")).toEqual({
      decision: "REJECT",
      code: "MUTATION_ORIGIN_MISSING",
    });
    const sameSite = new Request("https://operacion.ennco.com.mx/api", {
      method: "POST",
      headers: { origin: "https://operacion.ennco.com.mx", "sec-fetch-site": "same-site" },
    });
    expect(evaluateMutationRequest(sameSite, "https://operacion.ennco.com.mx")).toEqual({
      decision: "REJECT",
      code: "MUTATION_FETCH_SITE_REJECTED",
    });
  });
});
