#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import {
  assessSarifDocuments,
  assessWorktreeDrift,
  assessZapJson,
  auditCiConfiguration,
  buildEvidenceManifest,
  canonicalJson,
  normalizeCycloneDx,
  sha256,
  validateSourceCommit,
} from "./lib/enterprise-security-evidence.mjs";

function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`ARGUMENT_VALUE_MISSING:${name}`);
  return value;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`ARGUMENT_REQUIRED:${name}`);
  return value;
}

function argumentsFor(name) {
  return process.argv.flatMap((value, index) => value === name ? [process.argv[index + 1]] : [])
    .map((value) => {
      if (!value || value.startsWith("--")) throw new Error(`ARGUMENT_VALUE_MISSING:${name}`);
      return value;
    });
}

function readJson(path, code) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(code);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canonicalJson(value), "utf8");
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function sourceIdentity(repo, expected) {
  const expectedCommit = validateSourceCommit(expected);
  const actualCommit = validateSourceCommit(git(repo, ["rev-parse", "HEAD"]));
  if (actualCommit !== expectedCommit) throw new Error("SOURCE_COMMIT_MISMATCH");
  return {
    sourceCommit: actualCommit,
    sourceTree: validateSourceCommit(git(repo, ["rev-parse", "HEAD^{tree}"])),
  };
}

function buildEnvironmentViolations(repo) {
  const envFiles = readdirSync(repo, { withFileTypes: true })
    .filter((entry) => entry.name.startsWith(".env") && entry.name !== ".env.example")
    .map((entry) => entry.name)
    .sort();
  const environmentVariables = Object.keys(process.env)
    .filter((name) => name === "NODE_ENV" || /^(ENNCO_|NEXT_PUBLIC_|SUPABASE_|VERCEL_)/.test(name))
    .sort();
  return { envFiles, environmentVariables };
}

function sourceState(repo, expected) {
  const violations = buildEnvironmentViolations(repo);
  return {
    ...sourceIdentity(repo, expected),
    sourceTreeClean: git(repo, ["status", "--porcelain"]).length === 0
      && violations.envFiles.length === 0
      && violations.environmentVariables.length === 0,
    buildEnvironmentClean: violations.envFiles.length === 0 && violations.environmentVariables.length === 0,
    buildEnvironmentViolations: violations,
  };
}

function changedWorktreePaths(repo) {
  const tracked = git(repo, ["diff", "--name-only", "HEAD", "--"]);
  const untracked = git(repo, ["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([...tracked.split("\n"), ...untracked.split("\n")].filter(Boolean))].sort();
}

function repoRelativePath(repo, path) {
  const absolute = resolve(repo, path);
  const prefix = `${repo}/`;
  if (absolute !== repo && !absolute.startsWith(prefix)) throw new Error("ARTIFACT_PATH_OUTSIDE_REPOSITORY");
  return absolute === repo ? "." : absolute.slice(prefix.length);
}

function sourceStateFromSnapshot(repo, expected, path, context, allowedPaths = []) {
  const snapshot = readJson(path, "SOURCE_SNAPSHOT_JSON_INVALID");
  const current = sourceIdentity(repo, expected);
  if (snapshot.schema_version !== "1.0.0") throw new Error("SOURCE_SNAPSHOT_SCHEMA_INVALID");
  if (snapshot.source_commit !== current.sourceCommit) throw new Error("SOURCE_SNAPSHOT_COMMIT_MISMATCH");
  if (snapshot.source_tree !== current.sourceTree) throw new Error("SOURCE_SNAPSHOT_TREE_MISMATCH");
  if (snapshot.source_tree_clean !== true) throw new Error("SOURCE_SNAPSHOT_NOT_CLEAN");
  if (snapshot.build_environment_clean !== true) throw new Error("SOURCE_SNAPSHOT_BUILD_ENVIRONMENT_NOT_CLEAN");
  if (snapshot.execution_context !== context) throw new Error("SOURCE_SNAPSHOT_CONTEXT_MISMATCH");
  const environmentViolations = buildEnvironmentViolations(repo);
  if (environmentViolations.envFiles.length > 0 || environmentViolations.environmentVariables.length > 0) {
    throw new Error(`SOURCE_BUILD_ENVIRONMENT_DRIFT:${[
      ...environmentViolations.envFiles.map((value) => `file:${value}`),
      ...environmentViolations.environmentVariables.map((value) => `variable:${value}`),
    ].join(",")}`);
  }
  const drift = assessWorktreeDrift(changedWorktreePaths(repo), [repoRelativePath(repo, path), ...allowedPaths]);
  if (drift.status !== "PASS") throw new Error(`SOURCE_WORKTREE_DRIFT:${drift.unexpected_paths.join(",")}`);
  return { sourceCommit: current.sourceCommit, sourceTree: current.sourceTree, sourceTreeClean: true };
}

function executionContext() {
  const value = argument("--context", "local");
  if (!new Set(["local", "github_actions"]).has(value)) throw new Error("EXECUTION_CONTEXT_INVALID");
  return value;
}

function booleanArgument(name) {
  const value = requiredArgument(name);
  if (value !== "true" && value !== "false") throw new Error(`BOOLEAN_ARGUMENT_INVALID:${name}`);
  return value === "true";
}

function collectFiles(path, extension) {
  if (!existsSync(path)) throw new Error("EVIDENCE_INPUT_MISSING");
  if (statSync(path).isFile()) return extname(path) === extension ? [path] : [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? collectFiles(child, extension) : extname(child) === extension ? [child] : [];
  });
}

function emit(value) {
  process.stdout.write(canonicalJson(value));
}

function gateConfig(repo) {
  const workflow = readFileSync(resolve(repo, ".github/workflows/ci.yml"), "utf8");
  const assessment = auditCiConfiguration(workflow);
  emit(assessment);
  if (assessment.status !== "PASS") process.exitCode = 1;
}

function gateSourceSnapshot(repo, state, context) {
  const evidencePath = resolve(repo, requiredArgument("--evidence"));
  const snapshot = {
    schema_version: "1.0.0",
    source_commit: state.sourceCommit,
    source_tree: state.sourceTree,
    source_tree_clean: state.sourceTreeClean,
    build_environment_clean: state.buildEnvironmentClean,
    build_environment_violations: state.buildEnvironmentViolations,
    execution_context: context,
    evidence_class: context === "github_actions" ? "REMOTE_CI_SOURCE_SNAPSHOT" : "LOCAL_SOURCE_SNAPSHOT",
    status: state.sourceTreeClean ? "PASS" : "FAIL",
  };
  writeJson(evidencePath, snapshot);
  emit(snapshot);
  if (!state.sourceTreeClean) process.exitCode = 1;
}

function gateSbom(repo, state, context) {
  const rawPath = resolve(repo, requiredArgument("--raw"));
  const outputPath = resolve(repo, requiredArgument("--output"));
  const evidencePath = resolve(repo, requiredArgument("--evidence"));
  const packageManifest = readJson(resolve(repo, "package.json"), "PACKAGE_MANIFEST_INVALID");
  const normalized = normalizeCycloneDx(readJson(rawPath, "SBOM_JSON_INVALID"), packageManifest);
  writeJson(outputPath, normalized.document);
  const artifactText = readFileSync(outputPath, "utf8");
  const requirementStatus = context === "github_actions" && state.sourceTreeClean ? "PASS" : "EXTEND";
  const manifest = buildEvidenceManifest({
    control: "ENT-003",
    ...state,
    executionContext: context,
    artifact: {
      raw: { path: rawPath.slice(repo.length + 1), sha256: sha256(readFileSync(rawPath)) },
      normalized: { path: outputPath.slice(repo.length + 1), sha256: sha256(artifactText) },
    },
    assessment: { status: "PASS", counts: normalized.counts },
    scope: { format: "CycloneDX", spec_version: "1.5", dependency_tree: "package-lock.json" },
    requirementStatus,
    limitations: requirementStatus === "PASS" ? [] : ["Local output is not an archived remote CI artifact."],
  });
  writeJson(evidencePath, manifest);
  emit(manifest);
  if (context === "github_actions" && requirementStatus !== "PASS") process.exitCode = 1;
}

function gateSarif(repo, state, context) {
  const inputPath = resolve(repo, requiredArgument("--input"));
  const evidencePath = resolve(repo, requiredArgument("--evidence"));
  const files = collectFiles(inputPath, ".sarif");
  if (files.length === 0) throw new Error("SARIF_FILES_EMPTY");
  const assessment = assessSarifDocuments(files.map((path) => readJson(path, "SARIF_JSON_INVALID")));
  const artifactHashes = files.sort().map((path) => ({ path: path.slice(repo.length + 1), sha256: sha256(readFileSync(path)) }));
  const requirementStatus = assessment.status !== "PASS"
    ? "FAIL"
    : context === "github_actions" && state.sourceTreeClean
      ? "PASS"
      : "EXTEND";
  const manifest = buildEvidenceManifest({
    control: "ENT-001",
    ...state,
    executionContext: context,
    artifact: { files: artifactHashes },
    assessment,
    scope: { languages: ["javascript-typescript"], severity_threshold: "security-severity >= 7.0 or SARIF level error" },
    requirementStatus,
    limitations: context === "github_actions" ? [] : ["Local SARIF does not prove the remote release workflow."],
  });
  writeJson(evidencePath, manifest);
  emit(manifest);
  if (assessment.status !== "PASS" || (context === "github_actions" && !state.sourceTreeClean)) process.exitCode = 1;
}

function gateZap(repo, state, context) {
  const inputPath = resolve(repo, requiredArgument("--input"));
  const evidencePath = resolve(repo, requiredArgument("--evidence"));
  const authenticated = booleanArgument("--authenticated");
  const expectedTarget = requiredArgument("--expected-target");
  const assessment = assessZapJson(readJson(inputPath, "ZAP_JSON_INVALID"), expectedTarget);
  const scanPassed = assessment.status === "PASS";
  const requirementStatus = scanPassed && authenticated && context === "github_actions" && state.sourceTreeClean ? "PASS" : scanPassed ? "EXTEND" : "FAIL";
  const manifest = buildEvidenceManifest({
    control: "ENT-002",
    ...state,
    executionContext: context,
    artifact: { path: inputPath.slice(repo.length + 1), sha256: sha256(readFileSync(inputPath)) },
    assessment,
    scope: {
      target_class: argument("--target-class", "synthetic_localhost"),
      expected_target: expectedTarget,
      authenticated,
      scan_type: "passive_baseline",
      severity_threshold: "medium or high",
    },
    requirementStatus,
    limitations: authenticated ? [] : ["Unauthenticated synthetic baseline does not satisfy authenticated staging DAST."],
  });
  writeJson(evidencePath, manifest);
  emit(manifest);
  if (!scanPassed || (context === "github_actions" && !state.sourceTreeClean)) process.exitCode = 1;
}

try {
  const mode = process.argv[2];
  const repo = resolve(argument("--repo", "."));
  if (mode === "config") {
    gateConfig(repo);
  } else {
    const context = executionContext();
    const expectedCommit = requiredArgument("--expected-commit");
    const directState = sourceState(repo, expectedCommit);
    if (mode === "snapshot") {
      gateSourceSnapshot(repo, directState, context);
    } else {
      const snapshotPath = mode === "verify-snapshot" ? requiredArgument("--source-snapshot") : argument("--source-snapshot");
      const modeArtifactPaths = mode === "sbom"
        ? [requiredArgument("--raw"), requiredArgument("--output"), requiredArgument("--evidence")]
        : mode === "sarif" || mode === "zap"
          ? [requiredArgument("--input"), requiredArgument("--evidence")]
          : mode === "verify-snapshot"
            ? [argument("--allow-prefix")].filter(Boolean)
            : [];
      const allowedPaths = [...modeArtifactPaths, ...argumentsFor("--allow-prefix")]
        .map((value) => repoRelativePath(repo, value));
      const state = snapshotPath
        ? sourceStateFromSnapshot(repo, expectedCommit, resolve(repo, snapshotPath), context, allowedPaths)
        : directState;
      if (mode === "verify-snapshot") emit({ status: "PASS", source_commit: state.sourceCommit, source_tree: state.sourceTree, source_tree_clean: true });
      else if (mode === "sbom") gateSbom(repo, state, context);
      else if (mode === "sarif") gateSarif(repo, state, context);
      else if (mode === "zap") gateZap(repo, state, context);
      else throw new Error("MODE_INVALID");
    }
  }
} catch (error) {
  const code = error instanceof Error ? error.message : "SECURITY_EVIDENCE_GATE_FAILED";
  process.stderr.write(canonicalJson({ status: "FAIL", code }));
  process.exitCode = 1;
}
