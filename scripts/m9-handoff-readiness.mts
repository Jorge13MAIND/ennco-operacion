import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

import { createCsv } from "../src/lib/exports/csv.ts";
import { parseCsv } from "../src/lib/handoff/csv-roundtrip.ts";
import {
  evaluateM9Handoff,
  M9_LIVE_CRITERIA,
  M9_LOCAL_CRITERIA,
} from "../src/lib/handoff/readiness.ts";
import { parseRiskRegister } from "./lib/governance.mjs";

type ArchiveFile = {
  path: string;
  data: Buffer;
  sha256: string;
  size_bytes: number;
};

type ArchiveInspection = {
  entries: string[];
  files: ArchiveFile[];
  duplicate_entries: string[];
  unsafe_entries: string[];
  symlink_entries: string[];
};

type SecretFinding = {
  path: string;
  line: number;
  rule: string;
};

type Check = {
  id: string;
  pass: boolean;
  expected?: unknown;
  actual?: unknown;
};

const repoArgument = process.argv.indexOf("--repo");
const repo = resolve(repoArgument >= 0 ? process.argv[repoArgument + 1] : ".");
const sourceArgument = process.argv.indexOf("--source-commit");
const writeProvisional =
  process.argv.includes("--write-provisional") || process.argv.includes("--write-evidence");
const freezeFinal = process.argv.includes("--freeze-final");
const selfTest = process.argv.includes("--self-test");
const writeEvidence = writeProvisional || freezeFinal;
const evidenceRoot = resolve(repo, "evidence/m9-handoff");
const artifactsRoot = resolve(evidenceRoot, "artifacts");
const manifestPath = resolve(evidenceRoot, "manifest.json");
const verificationPath = resolve(repo, "docs/evidence/M9-handoff-verification.json");
const checksumsPath = resolve(repo, "docs/evidence/M9-checksums.sha256");
const controlScriptPath = resolve(repo, "scripts/m9-handoff-readiness.mts");

if (writeProvisional && freezeFinal) throw new Error("M9_CAPTURE_MODE_CONFLICT");

const ROOT_CONFIG_ALLOWLIST = [
  ".env.example",
  ".gitattributes",
  ".gitignore",
  ".github/workflows/ci.yml",
  "eslint.config.mjs",
  "next-env.d.ts",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "tsconfig.json",
  "vitest.config.ts",
] as const;

const SAFE_RUNTIME_CONFIG_ALLOWLIST = [
  "data/assistant/eval-cases-v1.json",
  "data/campaigns/campaign-manifest-draft-v1.json",
  "data/campaigns/response-playbook-v1.json",
  "data/campaigns/sequence-draft-v1.json",
  "data/release/domain-readiness-ledger-v1.json",
  "data/release/first-send-readiness-v1.json",
  "data/release/fixtures/first-send-synthetic-v1.json",
] as const;

const SOURCE_ALLOWLIST_POLICY = [
  { id: "ROOT_CONFIG_EXACT", kind: "exact", paths: [...ROOT_CONFIG_ALLOWLIST] },
  { id: "SAFE_RUNTIME_CONFIG_EXACT", kind: "exact", paths: [...SAFE_RUNTIME_CONFIG_ALLOWLIST] },
  { id: "APPLICATION_SOURCE", kind: "prefix", prefix: "src/", extensions: [".css", ".ts", ".tsx"] },
  { id: "E2E_TESTS", kind: "prefix", prefix: "tests/", extensions: [".ts", ".tsx"] },
  { id: "DATABASE_CONFIG", kind: "exact", paths: ["supabase/config.toml", "supabase/seed.sql"] },
  { id: "DATABASE_MIGRATIONS", kind: "prefix", prefix: "supabase/migrations/", extensions: [".sql"] },
  { id: "DATABASE_ROLLBACKS", kind: "prefix", prefix: "supabase/rollbacks/", extensions: [".sql"] },
  { id: "DATABASE_TESTS", kind: "prefix", prefix: "supabase/tests/", extensions: [".sh", ".sql"] },
  { id: "OPERATOR_RUNBOOKS", kind: "prefix", prefix: "docs/runbooks/", extensions: [".md"] },
] as const;

const RESTRICTED_EXCLUSION_POLICY = [
  { id: "CANONICAL_IMPORT_DATA", pattern: "data/imports/**", prefix: "data/imports/", reason: "real ENNCO import sources and normalized derivatives" },
  { id: "LEGACY_IMPORT_EVIDENCE", pattern: "evidence/data-import/**", prefix: "evidence/data-import/", reason: "real-source import verification" },
  { id: "DERIVED_PREQUOTE_DATA", pattern: "data/prequote/**", prefix: "data/prequote/", reason: "historical proposal-derived calibration inputs" },
  { id: "DERIVED_PREQUOTE_SOURCE", pattern: "src/lib/domain/prequote*", prefix: "src/lib/domain/prequote", reason: "source embeds statements and enums derived from historical proposal calibration" },
  { id: "HISTORICAL_REFERENCE_DATA", pattern: "data/content/**", prefix: "data/content/", reason: "historical evidence-derived content" },
  { id: "M9_GENERATED_EVIDENCE", pattern: "docs/evidence/M9*", prefix: "docs/evidence/M9", reason: "M9 evidence must remain external to the source archive" },
  { id: "M9_HANDOFF_OUTPUTS", pattern: "evidence/m9-handoff/**", prefix: "evidence/m9-handoff/", reason: "prevents self-reference and stale embedded packages" },
  { id: "ALL_OTHER_EVIDENCE", pattern: "evidence/**", prefix: "evidence/", reason: "operational evidence is transferred separately" },
] as const;

const RESTRICTED_CONTENT_MARKERS = [
  "WELDCOAT",
  "HEWELDCOAT",
  "VALLE DE LOS REYES",
  "VIÑA DEL MAR",
  "clientes....xlsx",
  "Directorio_Empresas_Corredor",
  "/Users/Jorge/Downloads",
  "HISTORICAL_EVIDENCE",
  "ANON-PROP-",
  "OBSERVED_30_TO_55_KWP",
] as const;

const KNOWN_IDENTITY_MARKERS = [
  "Francisco Cuellar",
  "Francisco Cuéllar",
  "Paco",
  "francisco.cuellar@ennco.com.mx",
  "Jorge Rojas",
  "Jorge Ariel",
] as const;

const requiredRunbooks = [
  "docs/runbooks/incident-response.md",
  "docs/runbooks/m2-local-backup-restore.md",
  "docs/runbooks/prequote-release.md",
  "docs/runbooks/gmail-reply-sync.md",
  "docs/runbooks/m5-shadow-canary.md",
  "docs/runbooks/m6-first-send-release.md",
  "docs/runbooks/m7-controlled-scaling.md",
  "docs/runbooks/m8-contractual-reporting.md",
  "docs/runbooks/m9-final-handoff.md",
  "docs/runbooks/m9-operator-training.md",
];

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function git(args: string[], encoding?: BufferEncoding): string | Buffer {
  return execFileSync("git", args, {
    cwd: repo,
    encoding,
    maxBuffer: 256 * 1024 * 1024,
  });
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

function isAllowedSourceFile(filePath: string): boolean {
  if (filePath.startsWith("src/lib/domain/prequote")) return false;
  if ((ROOT_CONFIG_ALLOWLIST as readonly string[]).includes(filePath)) return true;
  if ((SAFE_RUNTIME_CONFIG_ALLOWLIST as readonly string[]).includes(filePath)) return true;
  const extension = extname(filePath).toLowerCase();
  if (filePath.startsWith("src/")) return [".css", ".ts", ".tsx"].includes(extension);
  if (filePath.startsWith("tests/")) return [".ts", ".tsx"].includes(extension);
  if (["supabase/config.toml", "supabase/seed.sql"].includes(filePath)) return true;
  if (filePath.startsWith("supabase/migrations/")) return extension === ".sql";
  if (filePath.startsWith("supabase/rollbacks/")) return extension === ".sql";
  if (filePath.startsWith("supabase/tests/")) return [".sh", ".sql"].includes(extension);
  if (filePath.startsWith("docs/runbooks/")) return extension === ".md";
  return false;
}

function restrictedPathMatches(paths: string[]): Array<{ path: string; policy_id: string }> {
  const findings: Array<{ path: string; policy_id: string }> = [];
  for (const filePath of paths) {
    for (const policy of RESTRICTED_EXCLUSION_POLICY) {
      if (filePath.startsWith(policy.prefix)) findings.push({ path: filePath, policy_id: policy.id });
    }
  }
  return findings;
}

function sourceArchivePathFailures(actualFiles: string[], expectedFiles: string[]) {
  const actual = new Set(actualFiles);
  const expected = new Set(expectedFiles);
  return {
    unexpected: [...actual].filter((filePath) => !expected.has(filePath)).sort(),
    missing: [...expected].filter((filePath) => !actual.has(filePath)).sort(),
    restricted: restrictedPathMatches(actualFiles),
    self_referential: actualFiles
      .filter((filePath) => filePath.startsWith("docs/evidence/M9") || filePath.startsWith("evidence/m9-handoff/"))
      .sort(),
  };
}

async function walkExtracted(root: string, current = root): Promise<ArchiveFile[]> {
  const files: ArchiveFile[] = [];
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = resolve(current, entry.name);
    const archivePath = relative(root, absolute).split(sep).join("/");
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) {
      files.push({ path: `${archivePath}::SYMLINK`, data: Buffer.alloc(0), sha256: "", size_bytes: 0 });
    } else if (metadata.isDirectory()) {
      files.push(...await walkExtracted(root, absolute));
    } else if (metadata.isFile()) {
      const data = await readFile(absolute);
      files.push({ path: archivePath, data, sha256: sha256(data), size_bytes: data.byteLength });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function inspectTar(archive: Buffer): Promise<ArchiveInspection> {
  const tempRoot = await mkdtemp(resolve(tmpdir(), "ennco-m9-tar-"));
  const archivePath = resolve(tempRoot, "artifact.tar");
  const extractRoot = resolve(tempRoot, "extract");
  await mkdir(extractRoot);
  try {
    await writeFile(archivePath, archive);
    const listing = execFileSync("tar", ["-tf", archivePath], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
      maxBuffer: 64 * 1024 * 1024,
    }).split(/\r?\n/).filter(Boolean);
    const unsafeEntries = listing.filter((entry) =>
      entry.startsWith("/") || entry.split("/").includes("..") || entry.includes("\\"),
    );
    const counts = new Map<string, number>();
    for (const entry of listing) counts.set(entry, (counts.get(entry) ?? 0) + 1);
    const duplicateEntries = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([entry]) => entry)
      .sort();
    if (unsafeEntries.length > 0 || duplicateEntries.length > 0) {
      return {
        entries: listing,
        files: [],
        duplicate_entries: duplicateEntries,
        unsafe_entries: unsafeEntries,
        symlink_entries: [],
      };
    }
    execFileSync("tar", ["-xf", archivePath, "-C", extractRoot], {
      env: { ...process.env, LC_ALL: "C" },
      maxBuffer: 64 * 1024 * 1024,
    });
    const extracted = await walkExtracted(extractRoot);
    const symlinks = extracted
      .filter((file) => file.path.endsWith("::SYMLINK"))
      .map((file) => file.path.replace(/::SYMLINK$/, ""));
    return {
      entries: listing,
      files: extracted.filter((file) => !file.path.endsWith("::SYMLINK")),
      duplicate_entries: duplicateEntries,
      unsafe_entries: unsafeEntries,
      symlink_entries: symlinks,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function writeTarString(header: Buffer, offset: number, length: number, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength > length) throw new Error(`M9_TAR_FIELD_TOO_LONG:${value}`);
  bytes.copy(header, offset);
}

function writeTarOctal(header: Buffer, offset: number, length: number, value: number): void {
  const encoded = value.toString(8).padStart(length - 1, "0");
  writeTarString(header, offset, length, `${encoded}\0`);
}

function buildDeterministicTar(inputFiles: Array<{ path: string; data: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  const files = [...inputFiles].sort((left, right) => left.path.localeCompare(right.path));
  for (const file of files) {
    if (file.path.startsWith("/") || file.path.includes("..") || file.path.includes("\\")) {
      throw new Error(`M9_AUDIT_TAR_UNSAFE_PATH:${file.path}`);
    }
    const header = Buffer.alloc(512, 0);
    writeTarString(header, 0, 100, file.path);
    writeTarOctal(header, 100, 8, 0o644);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, file.data.byteLength);
    writeTarOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = "0".charCodeAt(0);
    writeTarString(header, 257, 6, "ustar\0");
    writeTarString(header, 263, 2, "00");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    chunks.push(header, file.data);
    const padding = (512 - (file.data.byteLength % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function scanSecrets(files: ArchiveFile[]): { files_scanned: number; findings: SecretFinding[] } {
  const tokenPrefixes = [
    ["g", "h", "o", "_"].join(""),
    ["g", "h", "p", "_"].join(""),
    ["github", "_pat", "_"].join(""),
    ["xox", "b", "-"].join(""),
    ["xox", "p", "-"].join(""),
    ["sb", "_secret", "_"].join(""),
    ["sk", "_live", "_"].join(""),
    ["AK", "IA"].join(""),
  ];
  const sensitiveNames = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_KMS_KEY_NAME",
    "GMAIL_CLIENT_SECRET",
  ];
  const findings: SecretFinding[] = [];
  for (const file of files) {
    const lines = file.data.toString("utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const prefixHit = tokenPrefixes.some((prefix) => {
        const offset = line.indexOf(prefix);
        if (offset < 0) return false;
        return Boolean(line.slice(offset + prefix.length).match(/^[A-Za-z0-9_\-]{16,}/)?.[0]);
      });
      const privateKeyParts = [[66, 69, 71, 73, 78], [80, 82, 73, 86, 65, 84, 69], [75, 69, 89]]
        .map((codes) => String.fromCharCode(...codes));
      const privateKeyHit = privateKeyParts.every((part) => line.includes(part));
      const assignmentHit = sensitiveNames.some((name) => {
        const match = line.match(new RegExp(`^\\s*${name}\\s*[:=]\\s*["']?([^\\s"']+)`));
        if (!match?.[1]) return false;
        const value = match[1];
        return !value.includes("${{") &&
          !value.startsWith("process.env") &&
          !/^(example|placeholder|changeme|unknown)$/i.test(value);
      });
      if (prefixHit || privateKeyHit || assignmentHit) {
        findings.push({
          path: file.path,
          line: index + 1,
          rule: prefixHit ? "TOKEN_PREFIX" : privateKeyHit ? "PRIVATE_KEY" : "SECRET_ASSIGNMENT",
        });
      }
    });
  }
  return { files_scanned: files.length, findings };
}

function restrictedContentFindings(files: ArchiveFile[]): Array<{ path: string; marker_id: number }> {
  const findings: Array<{ path: string; marker_id: number }> = [];
  for (const file of files) {
    const content = file.data.toString("utf8");
    RESTRICTED_CONTENT_MARKERS.forEach((marker, index) => {
      if (content.includes(marker)) findings.push({ path: file.path, marker_id: index + 1 });
    });
  }
  return findings;
}

function knownIdentityFindings(files: ArchiveFile[]): Array<{ path: string; marker_id: number }> {
  const findings: Array<{ path: string; marker_id: number }> = [];
  for (const file of files) {
    const content = file.data.toString("utf8").toLocaleLowerCase("en-US");
    KNOWN_IDENTITY_MARKERS.forEach((marker, index) => {
      if (content.includes(marker.toLocaleLowerCase("en-US"))) {
        findings.push({ path: file.path, marker_id: index + 1 });
      }
    });
  }
  return findings;
}

function fileInventory(files: ArchiveFile[]) {
  return files.map((file) => ({ path: file.path, sha256: file.sha256, size_bytes: file.size_bytes }));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function runSelfTest(): Promise<void> {
  const safeTarA = buildDeterministicTar([{ path: "src/example.ts", data: Buffer.from("export const ok = true;\n") }]);
  const safeTarB = buildDeterministicTar([{ path: "src/example.ts", data: Buffer.from("export const ok = true;\n") }]);
  const safeInspection = await inspectTar(safeTarA);
  const restrictedTar = buildDeterministicTar([{ path: "data/imports/forbidden.json", data: Buffer.from("{}\n") }]);
  const restrictedInspection = await inspectTar(restrictedTar);
  const selfReferenceTar = buildDeterministicTar([{ path: "docs/evidence/M9-stale.json", data: Buffer.from("{}\n") }]);
  const selfReferenceInspection = await inspectTar(selfReferenceTar);
  const unknownTar = buildDeterministicTar([{ path: "unknown/file.txt", data: Buffer.from("unknown\n") }]);
  const unknownInspection = await inspectTar(unknownTar);
  const secretValue = `${["g", "h", "p", "_"].join("")}${"A".repeat(24)}`;
  const secretTar = buildDeterministicTar([{ path: "src/secret.ts", data: Buffer.from(`export const value = "${secretValue}";\n`) }]);
  const secretInspection = await inspectTar(secretTar);
  const identityTar = buildDeterministicTar([{ path: "src/identity.ts", data: Buffer.from("export const reviewer = 'Paco';\n") }]);
  const identityInspection = await inspectTar(identityTar);
  const checks: Check[] = [
    { id: "DETERMINISTIC_AUDIT_TAR", pass: safeTarA.equals(safeTarB) },
    { id: "SAFE_TAR_INSPECTED", pass: safeInspection.files.length === 1 },
    { id: "RESTRICTED_PATH_REJECTED", pass: restrictedPathMatches(restrictedInspection.files.map((file) => file.path)).length === 1 },
    { id: "M9_SELF_REFERENCE_REJECTED", pass: sourceArchivePathFailures(selfReferenceInspection.files.map((file) => file.path), []).self_referential.length === 1 },
    { id: "UNKNOWN_PATH_REJECTED", pass: sourceArchivePathFailures(unknownInspection.files.map((file) => file.path), ["src/example.ts"]).unexpected.length === 1 },
    { id: "SECRET_REJECTED", pass: scanSecrets(secretInspection.files).findings.length === 1 },
    { id: "KNOWN_IDENTITY_REJECTED", pass: knownIdentityFindings(identityInspection.files).length === 1 },
  ];
  const failed = checks.filter((check) => !check.pass);
  process.stdout.write(json({ status: failed.length === 0 ? "PASS" : "FAIL", checks }));
  if (failed.length > 0) process.exitCode = 1;
}

if (selfTest) {
  await runSelfTest();
} else {
  const storedManifest = writeEvidence
    ? null
    : JSON.parse(await readFile(manifestPath, "utf8"));
  const sourceCommit = sourceArgument >= 0
    ? String(process.argv[sourceArgument + 1] ?? "")
    : String(storedManifest?.source?.commit_sha ?? git(["rev-parse", "HEAD"], "utf8")).trim();
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("M9_SOURCE_COMMIT_INVALID");
  git(["cat-file", "-e", `${sourceCommit}^{commit}`]);

  const headAtCapture = String(git(["rev-parse", "HEAD"], "utf8")).trim();
  const worktreeCleanAtCapture = String(git(["status", "--porcelain"], "utf8")).trim() === "";
  const controlWorktreeSha = sha256(await readFile(controlScriptPath));
  let controlSourceSha: string | null = null;
  try {
    controlSourceSha = sha256(git(["show", `${sourceCommit}:scripts/m9-handoff-readiness.mts`]) as Buffer);
  } catch {
    controlSourceSha = null;
  }
  const finalFreezePreconditions = {
    worktree_clean: worktreeCleanAtCapture,
    source_commit_is_head: sourceCommit === headAtCapture,
    control_script_committed: controlSourceSha !== null,
    control_script_matches_source_commit: controlSourceSha === controlWorktreeSha,
  };
  if (freezeFinal && !Object.values(finalFreezePreconditions).every(Boolean)) {
    throw new Error(`M9_FINAL_FREEZE_PRECONDITION_FAILED:${JSON.stringify(finalFreezePreconditions)}`);
  }

  const trackedFiles = String(git(["ls-tree", "-r", "--name-only", sourceCommit], "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();
  const allowlistCandidates = trackedFiles.filter(isAllowedSourceFile);
  const identityBearingExclusions: Array<{ path: string; marker_ids: number[] }> = [];
  for (const filePath of allowlistCandidates) {
    const content = (git(["show", `${sourceCommit}:${filePath}`]) as Buffer)
      .toString("utf8")
      .toLocaleLowerCase("en-US");
    const markerIds = KNOWN_IDENTITY_MARKERS
      .map((marker, index) => content.includes(marker.toLocaleLowerCase("en-US")) ? index + 1 : null)
      .filter((markerId): markerId is number => markerId !== null);
    if (markerIds.length > 0) identityBearingExclusions.push({ path: filePath, marker_ids: markerIds });
  }
  const identityExcludedSet = new Set(identityBearingExclusions.map((finding) => finding.path));
  const allowedFiles = allowlistCandidates.filter((filePath) => !identityExcludedSet.has(filePath));
  if (allowedFiles.length === 0) throw new Error("M9_SOURCE_ALLOWLIST_EMPTY");
  const sourceArchive = git([
    "archive",
    "--format=tar",
    sourceCommit,
    "--",
    ...allowedFiles.map((filePath) => `:(literal)${filePath}`),
  ]) as Buffer;
  const sourceInspection = await inspectTar(sourceArchive);
  const sourcePathFailures = sourceArchivePathFailures(
    sourceInspection.files.map((file) => file.path),
    allowedFiles,
  );
  const sourceSecretScan = scanSecrets(sourceInspection.files);
  const sourceRestrictedContent = restrictedContentFindings(sourceInspection.files);
  const sourceKnownIdentity = knownIdentityFindings(sourceInspection.files);
  const sourceArchiveSha = sha256(sourceArchive);

  const companiesCsv = createCsv([
    "evidence_class", "account_name", "contact_name", "role_title", "normalized_email", "verified",
  ], [
    { evidence_class: "synthetic_demo", account_name: "Cuenta sintética sin contacto", contact_name: "", role_title: "", normalized_email: "", verified: false },
    { evidence_class: "synthetic_demo", account_name: "Cuenta sintética con contacto", contact_name: "Persona sintética", role_title: "CEO", normalized_email: "synthetic@example.invalid", verified: true },
  ]);
  const pipelineCsv = createCsv([
    "evidence_class", "account_name", "stage", "value_mxn", "next_action", "result_status",
  ], [
    { evidence_class: "synthetic_demo", account_name: "Cuenta sintética", stage: "QUALIFIED", value_mxn: 1000000, next_action: "Revisión sintética", result_status: "NOT_REAL" },
  ]);

  const restrictedExclusions = [...RESTRICTED_EXCLUSION_POLICY.map((policy) => ({
    id: policy.id,
    pattern: policy.pattern,
    reason: policy.reason,
    tracked_file_count: trackedFiles.filter((filePath) => filePath.startsWith(policy.prefix)).length,
  })), {
    id: "KNOWN_IDENTITY_BEARING_SOURCE",
    pattern: "<content-based known identity markers>",
    reason: "known personal or operator identity is excluded from the synthetic_demo source archive",
    tracked_file_count: identityBearingExclusions.length,
    excluded_paths: identityBearingExclusions,
  }];
  const allowedSet = new Set(allowedFiles);
  const excludedFiles = trackedFiles.filter((filePath) => !allowedSet.has(filePath));
  const capture = storedManifest?.capture ?? {
    mode: freezeFinal ? "final" : "provisional",
    final_artifact: freezeFinal,
    head_at_capture: headAtCapture,
    worktree_clean_at_capture: worktreeCleanAtCapture,
    control_worktree_sha256: controlWorktreeSha,
    control_source_sha256: controlSourceSha,
    control_script_matches_source_commit: controlSourceSha === controlWorktreeSha,
  };
  const sourceInventoryDocument = {
    schema_version: "2.0.0",
    evidence_class: "synthetic_demo",
    source_commit_sha: sourceCommit,
    source_archive_sha256: sourceArchiveSha,
    archive_entries: sourceInspection.entries,
    files: fileInventory(sourceInspection.files),
  };
  const sourceScanDocument = {
    schema_version: "2.0.0",
    scope: "every regular file extracted from the allowlisted source archive",
    secret_patterns_scanned: true,
    files_scanned: sourceSecretScan.files_scanned,
    secret_findings: sourceSecretScan.findings,
    restricted_content_marker_count: RESTRICTED_CONTENT_MARKERS.length,
    restricted_content_findings: sourceRestrictedContent,
    known_identity_marker_count: KNOWN_IDENTITY_MARKERS.length,
    known_identity_findings: sourceKnownIdentity,
    pii_absence_proven: false,
    limitation: "Pattern scanning cannot prove universal absence of PII; restricted paths and known real-data markers are separately rejected.",
  };
  const auditBundleInput = [
    { path: "audit/source-archive-inventory.json", data: Buffer.from(json(sourceInventoryDocument)) },
    { path: "audit/source-archive-secret-scan.json", data: Buffer.from(json(sourceScanDocument)) },
    { path: "exports/companies-contacts-synthetic.csv", data: Buffer.from(companiesCsv) },
    { path: "exports/pipeline-attribution-synthetic.csv", data: Buffer.from(pipelineCsv) },
  ];
  const auditBundle = buildDeterministicTar(auditBundleInput);
  const auditInspection = await inspectTar(auditBundle);
  const auditBundleSha = sha256(auditBundle);
  const sourceTreeSha = String(git(["rev-parse", `${sourceCommit}^{tree}`], "utf8")).trim();
  const expectedManifest = {
    schema_version: "2.0.0",
    package_id: "ENNCO-M9-HANDOFF-LOCAL",
    evidence_class: "synthetic_demo",
    capture,
    source: {
      commit_sha: sourceCommit,
      tree_sha: sourceTreeSha,
      archive_format: "posix_tar",
      allowlist_policy: SOURCE_ALLOWLIST_POLICY,
      archive_entries: sourceInspection.entries,
      files: fileInventory(sourceInspection.files),
      excluded_file_count: excludedFiles.length,
      restricted_exclusions: restrictedExclusions,
      other_excluded_paths: excludedFiles.filter((filePath) =>
        !RESTRICTED_EXCLUSION_POLICY.some((policy) => filePath.startsWith(policy.prefix)) &&
        !identityExcludedSet.has(filePath),
      ),
      identity_bearing_exclusions: identityBearingExclusions,
      build_limitations: [
        "data/prequote/** is excluded because it contains historical proposal-derived calibration inputs",
        "src/lib/domain/prequote* is excluded because the source embeds proposal-derived assumptions",
        "files with known personal or operator identity markers are excluded by content",
        "the archive is a privacy-bounded source review package, not a complete production deployment bundle",
      ],
    },
    privacy_assessment: {
      restricted_paths_in_source_archive: sourcePathFailures.restricted,
      known_restricted_content_findings: sourceRestrictedContent,
      known_identity_findings: sourceKnownIdentity,
      secret_findings: sourceSecretScan.findings,
      pii_absence_claimed: false,
      claim: "restricted real-data paths and files with known identity markers excluded; every archived regular file inspected for known restricted markers and secret patterns",
      limitation: "No automated scanner proves universal absence of PII. Final live transfer still requires a separate human privacy review.",
    },
    external_side_effects: 0,
    artifacts: [
      {
        key: "SOURCE_PACKAGE_LOCAL",
        path: "artifacts/ennco-revenue-platform-source.tar",
        sha256: sourceArchiveSha,
        classification: "allowlisted_source_code_config_tests_runbooks",
        entries: sourceInspection.entries,
      },
      {
        key: "AUDIT_BUNDLE_LOCAL",
        path: "artifacts/m9-audit-bundle.tar",
        sha256: auditBundleSha,
        classification: "synthetic_demo_audit_only",
        entries: auditInspection.entries,
      },
      {
        key: "EXPORT_COMPANIES_CONTACTS_LOCAL",
        path: "artifacts/companies-contacts-synthetic.csv",
        sha256: sha256(companiesCsv),
        classification: "synthetic_demo",
      },
      {
        key: "EXPORT_PIPELINE_ATTRIBUTION_LOCAL",
        path: "artifacts/pipeline-attribution-synthetic.csv",
        sha256: sha256(pipelineCsv),
        classification: "synthetic_demo",
      },
    ],
  };
  const manifestText = json(expectedManifest);

  if (writeEvidence) {
    await mkdir(artifactsRoot, { recursive: true });
    await writeFile(resolve(artifactsRoot, "ennco-revenue-platform-source.tar"), sourceArchive);
    await writeFile(resolve(artifactsRoot, "m9-audit-bundle.tar"), auditBundle);
    await writeFile(resolve(artifactsRoot, "companies-contacts-synthetic.csv"), companiesCsv);
    await writeFile(resolve(artifactsRoot, "pipeline-attribution-synthetic.csv"), pipelineCsv);
    await writeFile(manifestPath, manifestText);
  }

  const checkedManifest = writeEvidence
    ? expectedManifest
    : JSON.parse(await readFile(manifestPath, "utf8"));
  const checkedSourceArchive = writeEvidence
    ? sourceArchive
    : await readFile(resolve(artifactsRoot, "ennco-revenue-platform-source.tar"));
  const checkedAuditBundle = writeEvidence
    ? auditBundle
    : await readFile(resolve(artifactsRoot, "m9-audit-bundle.tar"));
  const checkedCompanies = writeEvidence
    ? companiesCsv
    : await readFile(resolve(artifactsRoot, "companies-contacts-synthetic.csv"), "utf8");
  const checkedPipeline = writeEvidence
    ? pipelineCsv
    : await readFile(resolve(artifactsRoot, "pipeline-attribution-synthetic.csv"), "utf8");
  const checkedSourceInspection = await inspectTar(checkedSourceArchive);
  const checkedAuditInspection = await inspectTar(checkedAuditBundle);
  const checkedPathFailures = sourceArchivePathFailures(
    checkedSourceInspection.files.map((file) => file.path),
    allowedFiles,
  );
  const checkedSecretScan = scanSecrets(checkedSourceInspection.files);
  const checkedRestrictedContent = restrictedContentFindings(checkedSourceInspection.files);
  const checkedKnownIdentity = knownIdentityFindings(checkedSourceInspection.files);
  const checkedCompaniesParsed = parseCsv(checkedCompanies);
  const checkedPipelineParsed = parseCsv(checkedPipeline);
  const auditFileMap = new Map(checkedAuditInspection.files.map((file) => [file.path, file.data]));
  const expectedAuditPaths = auditBundleInput.map((file) => file.path).sort();
  const actualAuditPaths = checkedAuditInspection.files.map((file) => file.path).sort();
  const manifestArtifactMap = new Map(
    (checkedManifest.artifacts ?? []).map((artifact: { key: string; sha256: string }) => [artifact.key, artifact]),
  );

  const migration = await readFile(resolve(repo, "supabase/migrations/202608120011_handoff_acceptance.sql"), "utf8");
  const rollback = await readFile(resolve(repo, "supabase/rollbacks/202608120011_handoff_acceptance.down.sql"), "utf8");
  const gateTest = await readFile(resolve(repo, "supabase/tests/011_handoff_acceptance_gate.sql"), "utf8");
  const runbookIndex = await readFile(resolve(repo, "docs/runbooks/README.md"), "utf8");
  const riskRegister = parseRiskRegister(await readFile(resolve(repo, "docs/03-risk-register.md"), "utf8"));
  const m8Evidence = JSON.parse(await readFile(resolve(repo, "docs/evidence/M8-contractual-reporting-verification.json"), "utf8"));

  const checks: Check[] = [
    { id: "M8_GLOBAL_GATE_EXTEND", pass: m8Evidence.global_gate === "EXTEND" },
    { id: "SOURCE_COMMIT_EXISTS", pass: /^[a-f0-9]{40}$/.test(sourceCommit) },
    { id: "SOURCE_ALLOWLIST_NONEMPTY", pass: allowedFiles.length > 0, actual: allowedFiles.length },
    { id: "SOURCE_ARCHIVE_REPRODUCIBLE", pass: checkedSourceArchive.equals(sourceArchive) },
    { id: "SOURCE_ARCHIVE_SHA_MATCH", pass: manifestArtifactMap.get("SOURCE_PACKAGE_LOCAL")?.sha256 === sha256(checkedSourceArchive) },
    { id: "SOURCE_ARCHIVE_FILES_EXACT", pass: checkedPathFailures.unexpected.length === 0 && checkedPathFailures.missing.length === 0, actual: checkedPathFailures },
    {
      id: "SOURCE_ARCHIVE_NO_UNSAFE_ENTRIES",
      pass: checkedSourceInspection.unsafe_entries.length === 0 &&
        checkedSourceInspection.duplicate_entries.length === 0 &&
        checkedSourceInspection.symlink_entries.length === 0,
      actual: {
        entry_count: checkedSourceInspection.entries.length,
        file_count: checkedSourceInspection.files.length,
        unsafe_entries: checkedSourceInspection.unsafe_entries,
        duplicate_entries: checkedSourceInspection.duplicate_entries,
        symlink_entries: checkedSourceInspection.symlink_entries,
      },
    },
    { id: "SOURCE_ARCHIVE_RESTRICTED_PATHS_ABSENT", pass: checkedPathFailures.restricted.length === 0, actual: checkedPathFailures.restricted },
    { id: "SOURCE_ARCHIVE_M9_SELF_REFERENCE_ABSENT", pass: checkedPathFailures.self_referential.length === 0, actual: checkedPathFailures.self_referential },
    { id: "SOURCE_ARCHIVE_RESTRICTED_CONTENT_ABSENT", pass: checkedRestrictedContent.length === 0, actual: checkedRestrictedContent },
    { id: "SOURCE_ARCHIVE_KNOWN_IDENTITY_ABSENT", pass: checkedKnownIdentity.length === 0, actual: checkedKnownIdentity },
    { id: "SOURCE_ARCHIVE_SECRET_SCAN_PASS", pass: checkedSecretScan.findings.length === 0, actual: checkedSecretScan.findings },
    { id: "SOURCE_ARCHIVE_MANIFEST_INVENTORY_EXACT", pass: sameJson(checkedManifest.source?.files, fileInventory(checkedSourceInspection.files)) },
    { id: "SOURCE_ARCHIVE_MANIFEST_ENTRIES_EXACT", pass: sameJson(checkedManifest.source?.archive_entries, checkedSourceInspection.entries) },
    { id: "RESTRICTED_EXCLUSIONS_DECLARED", pass: sameJson(checkedManifest.source?.restricted_exclusions, restrictedExclusions) },
    { id: "PRIVACY_CLAIM_BOUNDED", pass: checkedManifest.privacy_assessment?.pii_absence_claimed === false && String(checkedManifest.privacy_assessment?.limitation ?? "").includes("No automated scanner proves") },
    { id: "AUDIT_BUNDLE_REPRODUCIBLE", pass: checkedAuditBundle.equals(auditBundle) },
    { id: "AUDIT_BUNDLE_SHA_MATCH", pass: manifestArtifactMap.get("AUDIT_BUNDLE_LOCAL")?.sha256 === sha256(checkedAuditBundle) },
    { id: "AUDIT_BUNDLE_ENTRIES_EXACT", pass: sameJson(actualAuditPaths, expectedAuditPaths), actual: actualAuditPaths },
    { id: "AUDIT_BUNDLE_NO_UNSAFE_ENTRIES", pass: checkedAuditInspection.unsafe_entries.length === 0 && checkedAuditInspection.duplicate_entries.length === 0 && checkedAuditInspection.symlink_entries.length === 0 },
    { id: "AUDIT_INVENTORY_MATCH", pass: auditFileMap.get("audit/source-archive-inventory.json")?.equals(Buffer.from(json(sourceInventoryDocument))) === true },
    { id: "AUDIT_SECRET_SCAN_MATCH", pass: auditFileMap.get("audit/source-archive-secret-scan.json")?.equals(Buffer.from(json(sourceScanDocument))) === true },
    { id: "COMPANIES_EXPORT_MATCHES_AUDIT_BUNDLE", pass: auditFileMap.get("exports/companies-contacts-synthetic.csv")?.equals(Buffer.from(checkedCompanies)) === true },
    { id: "PIPELINE_EXPORT_MATCHES_AUDIT_BUNDLE", pass: auditFileMap.get("exports/pipeline-attribution-synthetic.csv")?.equals(Buffer.from(checkedPipeline)) === true },
    { id: "COMPANIES_EXPORT_REIMPORT", pass: checkedCompaniesParsed.rows.length === 2 },
    { id: "ACCOUNT_WITHOUT_CONTACT_PRESERVED", pass: checkedCompaniesParsed.rows[0]?.contact_name === "" },
    { id: "PIPELINE_EXPORT_REIMPORT", pass: checkedPipelineParsed.rows.length === 1 && checkedPipelineParsed.rows[0]?.result_status === "NOT_REAL" },
    { id: "SYNTHETIC_EXPORTS_ONLY", pass: [...checkedCompaniesParsed.rows, ...checkedPipelineParsed.rows].every((row) => row.evidence_class === "synthetic_demo") },
    { id: "MANIFEST_EXACT", pass: sameJson(checkedManifest, expectedManifest) },
    { id: "NO_EXTERNAL_EFFECTS", pass: checkedManifest.external_side_effects === 0 },
    { id: "HANDOFF_DB_CONTRACT", pass: migration.includes("final_acceptances") && migration.includes("READY_FOR_ACCEPTANCE") },
    { id: "ENNCO_ADMIN_ACCEPTANCE_ONLY", pass: migration.includes("HANDOFF_ACCEPTANCE_ENNCO_ADMIN_REQUIRED") },
    { id: "ACCEPTANCE_APPEND_ONLY", pass: migration.includes("final_acceptances_append_only") },
    { id: "ROLLBACK_RESTORES_M8", pass: rollback.includes("contractual_monthly_report_issue") },
    { id: "ADVERSARIAL_DB_GATE", pass: gateTest.includes("cross-tenant acceptance accepted") && gateTest.includes("synthetic package accepted") },
    { id: "RUNBOOK_INDEX_COMPLETE", pass: requiredRunbooks.every((filePath) => runbookIndex.includes(filePath.replace("docs/runbooks/", ""))) },
    { id: "SECOND_RESTORE_EVIDENCE", pass: await exists(resolve(repo, "evidence/m9-restore/summary.json")) },
    { id: "RISK_REGISTER_VALID", pass: riskRegister.failures.length === 0 },
  ];
  const failures = checks.filter((check) => !check.pass);
  const finalArtifact = checkedManifest.capture?.final_artifact === true;
  const localCriteriaPass = failures.length === 0 && finalArtifact;
  const localCriteria = M9_LOCAL_CRITERIA.map((code) => ({
    code,
    status: localCriteriaPass ? "PASS" as const : "EXTEND" as const,
    evidenceClass: "synthetic_demo" as const,
    evidenceReference: localCriteriaPass ? `docs/evidence/M9-handoff-verification.json#${code}` : null,
  }));
  const liveCriteria = M9_LIVE_CRITERIA.map((code) => ({
    code,
    status: "EXTEND" as const,
    evidenceClass: "live" as const,
    evidenceReference: null,
  }));
  const decision = evaluateM9Handoff({
    evidenceClass: "synthetic_demo",
    criteria: [...localCriteria, ...liveCriteria],
    openP0: riskRegister.open_counts.P0,
    openP1: riskRegister.open_counts.P1,
    finalAcceptanceRecorded: false,
  });
  const report = {
    verification_status: failures.length === 0 ? "PASS" : "FAIL",
    package_capture_status: finalArtifact ? "FINAL_FREEZE" : "PROVISIONAL_NOT_FINAL",
    local_m9_status: localCriteriaPass ? "EVIDENCE_READY" : "EXTEND",
    global_m9_gate: decision.gate,
    evidence_class: "synthetic_demo",
    source_commit_sha: sourceCommit,
    source_tree_sha: sourceTreeSha,
    handoff_manifest_sha256: sha256(manifestText),
    privacy_assessment: checkedManifest.privacy_assessment,
    final_freeze_preconditions: checkedManifest.capture,
    external_side_effects: 0,
    real_client_uat_sessions: 0,
    real_client_training_sessions: 0,
    real_final_acceptances: 0,
    real_access_transfers: 0,
    production_restores_proven: 0,
    local_restore_drills_proven: 2,
    open_risk_counts: riskRegister.open_counts,
    open_risk_ids: riskRegister.open_records.map((record) => record.id),
    checks_passed: checks.length - failures.length,
    checks_failed: failures.length,
    local_criteria: localCriteria,
    live_criteria: liveCriteria,
    decision,
    checks,
  };

  if (writeEvidence) {
    await writeFile(verificationPath, json(report));
    const checksumTargets = [
      "evidence/m9-handoff/artifacts/ennco-revenue-platform-source.tar",
      "evidence/m9-handoff/artifacts/m9-audit-bundle.tar",
      "evidence/m9-handoff/artifacts/companies-contacts-synthetic.csv",
      "evidence/m9-handoff/artifacts/pipeline-attribution-synthetic.csv",
      "evidence/m9-handoff/manifest.json",
      "docs/evidence/M9-handoff-verification.json",
    ];
    const checksumLines = [];
    for (const relativePath of checksumTargets) {
      checksumLines.push(`${sha256(await readFile(resolve(repo, relativePath)))}  ${relativePath}`);
    }
    await writeFile(checksumsPath, `${checksumLines.join("\n")}\n`);
  }

  process.stdout.write(json(report));
  if (failures.length > 0) process.exitCode = 1;
}
