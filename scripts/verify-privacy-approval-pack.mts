import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  PRIVACY_NOTICE_CONTENT_SHA256,
  PRIVACY_NOTICE_VERSION,
} from "../src/lib/privacy/notice.ts";

const repoIndex = process.argv.indexOf("--repo");
const repo = resolve(repoIndex >= 0 ? process.argv[repoIndex + 1] : ".");
const packet = JSON.parse(await readFile(resolve(repo, "data/privacy/approval-request-2026-08-20.json"), "utf8"));
const expectedDecisions = [
  "RESPONSIBLE_IDENTITY_AND_ADDRESS",
  "DATA_CATEGORIES_AND_NO_SENSITIVE_DATA",
  "PRIMARY_AND_SECONDARY_PURPOSES",
  "PROCESSORS_TRANSFERS_AND_DPA",
  "RETENTION_90_12_24_MONTHS",
  "ARCO_CHANNEL_AND_IDENTITY_VERIFICATION",
  "B2B_OUTREACH_LEGAL_BASIS",
  "PRIVACY_OWNER_AND_RESPONSE_PROCESS",
].sort();

const failures: string[] = [];
if (packet.status !== "AWAITING_ENNCO_AND_LEGAL_REVIEW") failures.push("PACKET_STATUS_INVALID");
if (packet.notice_version !== PRIVACY_NOTICE_VERSION) failures.push("NOTICE_VERSION_DRIFT");
if (packet.notice_content_sha256 !== PRIVACY_NOTICE_CONTENT_SHA256) failures.push("NOTICE_SHA256_DRIFT");
if (packet.preview_state !== "NOINDEX_SYNTHETIC_DEMO") failures.push("PREVIEW_STATE_INVALID");
if (JSON.stringify([...packet.required_decisions].sort()) !== JSON.stringify(expectedDecisions)) failures.push("DECISION_COVERAGE_INVALID");
if (Object.values(packet.approvals).some((value) => value !== null)) failures.push("UNVERIFIED_APPROVAL_PRESENT");
if (Object.values(packet.release_effect).some((value) => value !== false)) failures.push("RELEASE_EFFECT_MUST_REMAIN_FALSE");

const result = {
  status: failures.length === 0 ? "PASS" : "FAIL",
  packet_id: packet.packet_id,
  notice_version: packet.notice_version,
  notice_content_sha256: packet.notice_content_sha256,
  required_decision_count: packet.required_decisions.length,
  approval_state: packet.status,
  public_surface_released: packet.release_effect.public_surface_released,
  external_send_authorized: packet.release_effect.external_send_authorized,
  failures,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
