import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inspectDocumentUpload } from "@/lib/documents/upload-policy";

const ids = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  prequoteId: "22222222-2222-4222-8222-222222222222",
  documentId: "33333333-3333-4333-8333-333333333333",
};

describe("document upload policy", () => {
  it("accepts a signed PDF only into quarantine with an opaque path", () => {
    const bytes = Buffer.from("%PDF-1.7\nsynthetic test fixture");
    const result = inspectDocumentUpload({ ...ids, declaredMediaType: "application/pdf", bytes });

    expect(result).toEqual({
      decision: "ACCEPT_TO_QUARANTINE",
      document: {
        ...ids,
        storagePath: `${ids.organizationId}/prequotes/${ids.prequoteId}/${ids.documentId}.pdf`,
        mediaType: "application/pdf",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: bytes.length,
        scanStatus: "QUARANTINED",
        originalFilenameStored: false,
      },
    });
  });

  it("does not trust a declared MIME type", () => {
    expect(
      inspectDocumentUpload({
        ...ids,
        declaredMediaType: "application/pdf",
        bytes: Buffer.from("<script>alert(1)</script>"),
      }),
    ).toEqual({ decision: "REJECT", reason: "UNSUPPORTED_OR_MISMATCHED_TYPE" });
  });

  it("rejects mismatch, empty, oversized and invalid identifiers", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(inspectDocumentUpload({ ...ids, declaredMediaType: "image/jpeg", bytes: png })).toEqual({
      decision: "REJECT",
      reason: "UNSUPPORTED_OR_MISMATCHED_TYPE",
    });
    expect(inspectDocumentUpload({ ...ids, declaredMediaType: "image/png", bytes: Buffer.alloc(0) })).toEqual({
      decision: "REJECT",
      reason: "EMPTY_FILE",
    });
    expect(
      inspectDocumentUpload({ ...ids, declaredMediaType: "image/png", bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }),
    ).toEqual({ decision: "REJECT", reason: "FILE_TOO_LARGE" });
    expect(
      inspectDocumentUpload({ ...ids, organizationId: "../other", declaredMediaType: "image/png", bytes: png }),
    ).toEqual({ decision: "REJECT", reason: "INVALID_IDENTIFIER" });
  });
});
