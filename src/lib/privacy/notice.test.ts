import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  PRIVACY_NOTICE_CONTENT_SHA256,
  PRIVACY_NOTICE_SECTIONS,
  PRIVACY_NOTICE_VERSION,
  serializePrivacyNotice,
} from "@/lib/privacy/notice";

describe("privacy notice release snapshot", () => {
  it("binds the visible legal content to one versioned SHA256", () => {
    const actual = createHash("sha256").update(serializePrivacyNotice(), "utf8").digest("hex");

    expect(PRIVACY_NOTICE_VERSION).toBe("2026-08-11-v1");
    expect(PRIVACY_NOTICE_SECTIONS).toHaveLength(7);
    expect(actual).toBe(PRIVACY_NOTICE_CONTENT_SHA256);
  });
});
