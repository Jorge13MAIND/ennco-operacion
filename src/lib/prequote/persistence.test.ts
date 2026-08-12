import { describe, expect, it } from "vitest";

import { getTrustedClientAddress, PrequotePersistenceError } from "@/lib/prequote/persistence";

describe("trusted prequote client address", () => {
  it("accepts the platform-owned address header", () => {
    const request = new Request("https://diagnostico.example.test", {
      headers: { "x-vercel-forwarded-for": "2001:db8::1, 198.51.100.4" },
    });
    expect(getTrustedClientAddress(request, "production")).toBe("2001:db8::1");
  });

  it("does not trust a generic forwarded header outside development", () => {
    const request = new Request("https://diagnostico.example.test", {
      headers: { "x-forwarded-for": "198.51.100.4" },
    });
    expect(() => getTrustedClientAddress(request, "production")).toThrowError(PrequotePersistenceError);
    expect(getTrustedClientAddress(request, "development")).toBe("198.51.100.4");
  });

  it("rejects malformed or missing addresses", () => {
    expect(() => getTrustedClientAddress(new Request("https://example.test"), "staging")).toThrow(
      "UNAVAILABLE",
    );
    expect(() =>
      getTrustedClientAddress(
        new Request("https://example.test", { headers: { "x-vercel-forwarded-for": "not-an-ip" } }),
        "production",
      ),
    ).toThrow("UNAVAILABLE");
  });
});
