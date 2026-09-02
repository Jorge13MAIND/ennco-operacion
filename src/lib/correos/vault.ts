import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Bóveda del carril directo (M041): cifrado AES-256-GCM con una llave de
 * aplicación que vive SOLO en el ambiente de Vercel (ENNCO_DIRECT_LANE_VAULT_KEY,
 * 32 bytes en base64). Sustituye al sobre KMS del carril híbrido, que nunca
 * llegó a existir porque el proyecto de Google Cloud no tiene facturación.
 *
 * El refresh token en claro sólo vive en memoria durante el callback y durante
 * el tick que lo usa. En la base queda el ciphertext, el identificador de la
 * llave y un hash; jamás el secreto.
 */

export type DirectLaneEnvelope = {
  ciphertext: string;
  keyId: string;
};

export class DirectLaneVaultError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "DirectLaneVaultError";
  }
}

function decodeKey(rawKey: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(rawKey.trim(), "base64");
  } catch {
    throw new DirectLaneVaultError("DIRECT_LANE_VAULT_KEY_INVALID");
  }
  if (key.length !== 32) throw new DirectLaneVaultError("DIRECT_LANE_VAULT_KEY_INVALID");
  return key;
}

export function directLaneKeyId(rawKey: string): string {
  const fingerprint = createHash("sha256").update(decodeKey(rawKey)).digest("hex").slice(0, 16);
  return `app-aes256gcm:v1:${fingerprint}`;
}

export function sealDirectLaneSecret(plaintext: string, rawKey: string): DirectLaneEnvelope {
  if (!plaintext || plaintext.trim().length < 20) throw new DirectLaneVaultError("DIRECT_LANE_PLAINTEXT_INVALID");
  const key = decodeKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const ciphertext = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
  return { ciphertext, keyId: directLaneKeyId(rawKey) };
}

export function openDirectLaneSecret(envelope: DirectLaneEnvelope, rawKey: string): string {
  if (envelope.keyId !== directLaneKeyId(rawKey)) throw new DirectLaneVaultError("DIRECT_LANE_VAULT_KEY_MISMATCH");
  const [version, ivValue, tagValue, dataValue, extra] = envelope.ciphertext.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !dataValue || extra) {
    throw new DirectLaneVaultError("DIRECT_LANE_CIPHERTEXT_INVALID");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", decodeKey(rawKey), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(dataValue, "base64url")), decipher.final()]).toString("utf8");
    if (plaintext.length < 20) throw new DirectLaneVaultError("DIRECT_LANE_PLAINTEXT_INVALID");
    return plaintext;
  } catch (error) {
    if (error instanceof DirectLaneVaultError) throw error;
    throw new DirectLaneVaultError("DIRECT_LANE_CIPHERTEXT_INVALID");
  }
}

/** Hash que la base guarda y audita en lugar del secreto. */
export function directLaneCredentialSha256(input: {
  ciphertext: string;
  keyId: string;
  subjectSha256: string;
  normalizedEmail: string;
  scopes: readonly string[];
}): string {
  return createHash("sha256").update([
    input.ciphertext,
    input.keyId,
    input.subjectSha256,
    input.normalizedEmail.trim().toLowerCase(),
    [...new Set(input.scopes.map((scope) => scope.trim()).filter(Boolean))].sort().join(" "),
  ].join("\n")).digest("hex");
}
