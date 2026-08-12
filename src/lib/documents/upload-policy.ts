import { createHash } from "node:crypto";
import { z } from "zod";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const uuid = z.uuid();

const signatures = [
  {
    mediaType: "application/pdf" as const,
    extension: "pdf",
    matches: (bytes: Uint8Array) => bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from("%PDF-")),
  },
  {
    mediaType: "image/jpeg" as const,
    extension: "jpg",
    matches: (bytes: Uint8Array) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    mediaType: "image/png" as const,
    extension: "png",
    matches: (bytes: Uint8Array) =>
      bytes.length >= 8 &&
      Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
];

export type AcceptedDocument = {
  organizationId: string;
  prequoteId: string;
  documentId: string;
  storagePath: string;
  mediaType: "application/pdf" | "image/jpeg" | "image/png";
  sha256: string;
  sizeBytes: number;
  scanStatus: "QUARANTINED";
  originalFilenameStored: false;
};

export type UploadPolicyDecision =
  | { decision: "ACCEPT_TO_QUARANTINE"; document: AcceptedDocument }
  | { decision: "REJECT"; reason: "EMPTY_FILE" | "FILE_TOO_LARGE" | "UNSUPPORTED_OR_MISMATCHED_TYPE" | "INVALID_IDENTIFIER" };

export function inspectDocumentUpload(input: {
  organizationId: string;
  prequoteId: string;
  documentId: string;
  declaredMediaType: string;
  bytes: Uint8Array;
}): UploadPolicyDecision {
  const ids = z
    .tuple([uuid, uuid, uuid])
    .safeParse([input.organizationId, input.prequoteId, input.documentId]);
  if (!ids.success) return { decision: "REJECT", reason: "INVALID_IDENTIFIER" };
  if (input.bytes.byteLength === 0) return { decision: "REJECT", reason: "EMPTY_FILE" };
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) return { decision: "REJECT", reason: "FILE_TOO_LARGE" };

  const signature = signatures.find((candidate) => candidate.matches(input.bytes));
  if (!signature || signature.mediaType !== input.declaredMediaType) {
    return { decision: "REJECT", reason: "UNSUPPORTED_OR_MISMATCHED_TYPE" };
  }

  return {
    decision: "ACCEPT_TO_QUARANTINE",
    document: {
      organizationId: input.organizationId,
      prequoteId: input.prequoteId,
      documentId: input.documentId,
      storagePath: `${input.organizationId}/prequotes/${input.prequoteId}/${input.documentId}.${signature.extension}`,
      mediaType: signature.mediaType,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      sizeBytes: input.bytes.byteLength,
      scanStatus: "QUARANTINED",
      originalFilenameStored: false,
    },
  };
}
