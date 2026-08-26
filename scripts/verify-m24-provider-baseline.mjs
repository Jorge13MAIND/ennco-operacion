import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoIndex = process.argv.indexOf("--repo");
const repo = path.resolve(repoIndex >= 0 ? process.argv[repoIndex + 1] : ".");
const baselinePath = path.join(repo, "data/infrastructure/provider-baseline-v1.json");
const sourceText = await readFile(baselinePath, "utf8");
const source = JSON.parse(sourceText);
const failures = [];

const exactCandidates = [
  "enncoindustrial.com",
  "enncoenergia.com",
  "enncoindustrial.com.mx",
  "enncoenergia.com.mx",
];
const externalActionCodes = new Set((source.external_actions ?? []).map((item) => item.action));

if (source.status !== "HOLD" || !["synthetic_demo", "live"].includes(source.evidence_class)) failures.push("BASELINE_MUST_REMAIN_HOLD");
if (source.external_effects !== 0) failures.push("EXTERNAL_EFFECTS_MUST_BE_ZERO");
if (source.decision?.provider !== "Apollo" || source.decision?.plan !== "Professional") failures.push("APOLLO_PROFESSIONAL_REQUIRED");
if (source.decision?.billing_frequency !== "MONTHLY" || source.decision?.annual_review_after_days !== 90) failures.push("APOLLO_MONTHLY_90_DAY_REVIEW_REQUIRED");
if (source.decision?.legal_owner !== "TECKEL" || source.decision?.seat_count !== 1) failures.push("TECKEL_ADMIN_ONE_SEAT_REQUIRED");
if (source.decision?.custody_model !== "TECKEL_MANAGED_FOR_ENNCO"
  || source.decision?.workspace_mode !== "ENNCO_DEDICATED"
  || source.decision?.terms_risk !== "ACCEPTED_BY_TECKEL") failures.push("APOLLO_DEDICATED_CUSTODY_INVALID");
if (source.decision?.legacy_contact_count !== 192 || source.decision?.legacy_sequence_count !== 13) failures.push("APOLLO_LEGACY_BASELINE_DRIFT");
if (source.decision?.shared_credentials_allowed !== false) failures.push("SHARED_CREDENTIALS_FORBIDDEN");
if (source.managed_service_exception?.written_confirmation_status !== "RISK_ACCEPTED_BY_TECKEL") failures.push("MANAGED_SERVICE_RISK_NOT_ACCEPTED");
if (source.managed_service_exception?.response_deadline_business_days !== 0
  || source.managed_service_exception?.permitted_if_approved?.length !== 0
  || source.managed_service_exception?.real_send_engine_if_approved !== null
) failures.push("MANAGED_SERVICE_EXCEPTION_MUST_BE_CLOSED");
if (source.managed_service_exception?.profile_rename_allowed !== true) failures.push("PROFILE_RENAME_MUST_BE_ALLOWED");
if (source.apollo_credit_policy?.available_credits !== 4010
  || source.apollo_credit_policy?.research_credit_cap !== 300
  || source.apollo_credit_policy?.infrastructure_credit_allocation !== 3600
  || source.apollo_credit_policy?.minimum_credit_buffer !== 110) failures.push("APOLLO_CREDIT_ALLOCATION_INVALID");
if (source.apollo_credit_policy?.phone_enrichment_allowed !== false) failures.push("PHONE_ENRICHMENT_MUST_BE_DISABLED");
if (source.apollo_credit_policy?.apollo_domain_credits_allowed !== true
  || source.apollo_credit_policy?.apollo_mailbox_credits_allowed !== true) failures.push("APOLLO_INFRASTRUCTURE_CREDITS_REQUIRED");
if (source.domain_target !== 2 || source.mailbox_target !== 3) failures.push("ASSET_TARGETS_INVALID");
if (!Array.isArray(source.selected_domains) || source.selected_domains.length !== 0) failures.push("UNPURCHASED_DOMAINS_MUST_NOT_BE_SELECTED");
if (JSON.stringify((source.domain_candidates ?? []).map((item) => item.domain)) !== JSON.stringify(exactCandidates)) failures.push("DOMAIN_PRIORITY_DRIFT");
if ((source.domain_candidates ?? []).some((item) => !["PENDING_APOLLO_CHECKOUT", "UNKNOWN"].includes(item.availability)
  || item.purchase_status !== "NOT_PURCHASED")) failures.push("DOMAIN_STATUS_FALSE_CLAIM");
if (JSON.stringify(source.mailbox_local_parts) !== JSON.stringify(["francisco", "fcuellar"])) failures.push("MAILBOX_LOCAL_PARTS_INVALID");
if (source.sender_identity !== "Francisco Cuellar" || source.workspace_plan !== "APOLLO_EXISTING_TECKEL_WORKSPACE") failures.push("MAILBOX_IDENTITY_OR_PLAN_INVALID");
if (source.warmup_required_days !== 42 || source.initial_daily_cap_per_mailbox !== 2 || source.maximum_daily_cap_per_mailbox !== 10) failures.push("WARMUP_OR_CAP_INVALID");
if (source.tracking_opens_initially_enabled !== false) failures.push("OPEN_TRACKING_MUST_START_DISABLED");
if (source.tool_boundaries?.resend_cold_outreach_allowed !== false) failures.push("RESEND_COLD_OUTREACH_FORBIDDEN");
for (const required of ["RECONVERT_APOLLO", "PURCHASE_DOMAINS", "CREATE_SHARED_SMTP_MAILBOXES", "CHANGE_DNS", "CONNECT_OAUTH", "SEND_PILOT"]) {
  if (!externalActionCodes.has(required)) failures.push(`EXTERNAL_ACTION_MISSING_${required}`);
}
const apolloConversion = (source.external_actions ?? []).find((item) => item.action === "RECONVERT_APOLLO");
if (apolloConversion?.status !== "IN_PROGRESS" || apolloConversion?.owner !== "TECKEL") failures.push("APOLLO_CONVERSION_STATUS_INVALID");
if (source.outreach_eligible_records !== 0 || source.real_recipients_enrolled !== 0 || source.real_messages_sent !== 0) failures.push("COMMERCIAL_EFFECTS_MUST_BE_ZERO");

const result = {
  status: failures.length === 0 ? "PASS" : "FAIL",
  baseline_id: source.baseline_id,
  snapshot_sha256: createHash("sha256").update(sourceText).digest("hex"),
  plan: source.decision?.plan,
  billing_frequency: source.decision?.billing_frequency,
  legal_owner: source.decision?.legal_owner,
  domain_target: source.domain_target,
  selected_domain_count: source.selected_domains?.length ?? 0,
  mailbox_target: source.mailbox_target,
  warmup_required_days: source.warmup_required_days,
  monthly_credit_cap: source.apollo_credit_policy?.research_credit_cap,
  external_action_count: source.external_actions?.length ?? 0,
  external_effects: source.external_effects,
  release_state: source.status,
  failures,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
