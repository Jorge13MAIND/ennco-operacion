import { describe, expect, it } from "vitest";

import {
  legalNameMatchKey,
  normalizeDomain,
  normalizeEmail,
  normalizeLegalName,
} from "@/lib/research/normalization";

describe("research identity normalization", () => {
  it("preserves a readable legal name and creates a stable suffix-free match key", () => {
    expect(normalizeLegalName("  Energía   Alfa, S.A. de C.V.  ")).toBe("Energía Alfa, S.A. de C.V.");
    expect(legalNameMatchKey("Energía Alfa, S.A. de C.V.")).toBe("energia-alfa");
    expect(legalNameMatchKey("ENERGIA ALFA SA DE CV")).toBe("energia-alfa");
  });

  it("rejects empty, control-only and suffix-only legal names", () => {
    expect(() => normalizeLegalName("   ")).toThrow("LEGAL_NAME_INVALID");
    expect(() => normalizeLegalName("Alfa\u0000Industrial")).toThrow("LEGAL_NAME_INVALID");
    expect(() => legalNameMatchKey("S.A. de C.V.")).toThrow("LEGAL_NAME_KEY_EMPTY");
  });

  it("normalizes a root domain and strips only the conventional www label", () => {
    expect(normalizeDomain("HTTPS://WWW.Example.Invalid/")).toBe("example.invalid");
    expect(normalizeDomain("plant.example.invalid")).toBe("plant.example.invalid");
  });

  it("rejects URLs with path, credentials, port, IP or a single label", () => {
    for (const value of [
      "example.invalid/path",
      "https://user:secret@example.invalid",
      "example.invalid:8443",
      "127.0.0.1",
      "localhost",
    ]) {
      expect(() => normalizeDomain(value)).toThrow("DOMAIN_INVALID");
    }
  });

  it("normalizes email deterministically without accepting display names", () => {
    expect(normalizeEmail("  PERSONA+QA@Sub.Example.Invalid  ")).toBe("persona+qa@sub.example.invalid");
    for (const value of [
      "Persona <persona@example.invalid>",
      ".persona@example.invalid",
      "persona..qa@example.invalid",
      "persona@localhost",
      "persona@@example.invalid",
    ]) {
      expect(() => normalizeEmail(value)).toThrow("EMAIL_INVALID");
    }
  });
});
