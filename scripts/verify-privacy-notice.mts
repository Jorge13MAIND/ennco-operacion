import { createHash } from "node:crypto";

import {
  PRIVACY_NOTICE_CONTENT_SHA256,
  serializePrivacyNotice,
} from "../src/lib/privacy/notice.ts";

const actual = createHash("sha256").update(serializePrivacyNotice(), "utf8").digest("hex");

if (actual !== PRIVACY_NOTICE_CONTENT_SHA256) {
  throw new Error(`PRIVACY_NOTICE_CONTENT_SHA256_MISMATCH:${actual}`);
}

process.stdout.write(`PRIVACY_NOTICE_CONTENT_SHA256_PASS ${actual}\n`);
