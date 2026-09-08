import { describe, expect, it } from "vitest";

import { signOutCsrfToken, signOutCsrfTokenMatches } from "@/lib/security/csrf";

describe("sign-out CSRF token", () => {
  const config = { gmailOauthStateSecret: "c2VjcmV0by1kZS1wcnVlYmE" };

  it("is deterministic per subject and secret, and never leaks either", () => {
    const token = signOutCsrfToken("user-1", config);
    expect(token).toBe(signOutCsrfToken("user-1", config));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain(config.gmailOauthStateSecret);
    expect(signOutCsrfToken("user-2", config)).not.toBe(token);
    expect(signOutCsrfToken("user-1", { gmailOauthStateSecret: "otro" })).not.toBe(token);
  });

  it("accepts only the exact token for the same subject", () => {
    const token = signOutCsrfToken("user-1", config);
    expect(signOutCsrfTokenMatches(token, "user-1", config)).toBe(true);
    expect(signOutCsrfTokenMatches(token, "user-2", config)).toBe(false);
    expect(signOutCsrfTokenMatches(`${token}x`, "user-1", config)).toBe(false);
    expect(signOutCsrfTokenMatches("", "user-1", config)).toBe(false);
    expect(signOutCsrfTokenMatches(null, "user-1", config)).toBe(false);
  });

  it("still works without a configured secret, with a per-process key", () => {
    const token = signOutCsrfToken("anonymous", { gmailOauthStateSecret: undefined });
    expect(signOutCsrfTokenMatches(token, "anonymous", { gmailOauthStateSecret: undefined })).toBe(true);
    expect(token).not.toBe(signOutCsrfToken("anonymous", config));
  });
});
