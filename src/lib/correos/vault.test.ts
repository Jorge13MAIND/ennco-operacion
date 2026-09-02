import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  directLaneCredentialSha256,
  directLaneKeyId,
  openDirectLaneSecret,
  sealDirectLaneSecret,
} from "@/lib/correos/vault";

const key = randomBytes(32).toString("base64");
const otherKey = randomBytes(32).toString("base64");
const refreshToken = "1//synthetic-refresh-token-never-real-0123456789";

describe("direct lane vault", () => {
  it("round-trips a secret and never leaks it in the envelope", () => {
    const envelope = sealDirectLaneSecret(refreshToken, key);
    expect(envelope.ciphertext).not.toContain(refreshToken);
    expect(envelope.keyId).toBe(directLaneKeyId(key));
    expect(openDirectLaneSecret(envelope, key)).toBe(refreshToken);
  });

  it("produces a different ciphertext on every seal", () => {
    expect(sealDirectLaneSecret(refreshToken, key).ciphertext).not.toBe(sealDirectLaneSecret(refreshToken, key).ciphertext);
  });

  it("rejects the wrong key, a tampered ciphertext and a malformed key", () => {
    const envelope = sealDirectLaneSecret(refreshToken, key);
    expect(() => openDirectLaneSecret(envelope, otherKey)).toThrow("DIRECT_LANE_VAULT_KEY_MISMATCH");
    const tampered = { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}AA` };
    expect(() => openDirectLaneSecret(tampered, key)).toThrow("DIRECT_LANE_CIPHERTEXT_INVALID");
    expect(() => sealDirectLaneSecret(refreshToken, "short")).toThrow("DIRECT_LANE_VAULT_KEY_INVALID");
    expect(() => sealDirectLaneSecret("tiny", key)).toThrow("DIRECT_LANE_PLAINTEXT_INVALID");
  });

  it("hashes the credential deterministically with canonical scopes", () => {
    const base = {
      ciphertext: "v1.a.b.c",
      keyId: "app-aes256gcm:v1:deadbeef",
      subjectSha256: "0".repeat(64),
      normalizedEmail: "Francisco@EnncoIndustrial.com",
    };
    const first = directLaneCredentialSha256({ ...base, scopes: ["openid", "email", " openid "] });
    const second = directLaneCredentialSha256({ ...base, scopes: ["email", "openid"], normalizedEmail: "francisco@enncoindustrial.com" });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
  });
});
