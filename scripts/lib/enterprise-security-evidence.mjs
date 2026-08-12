import { createHash } from "node:crypto";

export const REQUIRED_DATABASE_GATES = Object.freeze([
  "verify:retention-live",
  "verify:capacity-db",
  "verify:research-db",
  "verify:operations-sla-db",
  "verify:cadence-db",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, code) {
  if (!isRecord(value)) throw new Error(code);
  return value;
}

function requireArray(value, code) {
  if (!Array.isArray(value)) throw new Error(code);
  return value;
}

function requireNonEmptyString(value, code) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(code);
  return value;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function validateSourceCommit(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error("SOURCE_COMMIT_INVALID");
  }
  return value;
}

export function normalizeCycloneDx(raw, packageManifest) {
  const document = structuredClone(requireRecord(raw, "SBOM_DOCUMENT_INVALID"));
  if (document.bomFormat !== "CycloneDX") throw new Error("SBOM_FORMAT_INVALID");
  if (document.specVersion !== "1.5") throw new Error("SBOM_SPEC_VERSION_INVALID");
  if (document.version !== 1) throw new Error("SBOM_DOCUMENT_VERSION_INVALID");

  const components = requireArray(document.components, "SBOM_COMPONENTS_INVALID");
  const dependencies = requireArray(document.dependencies, "SBOM_DEPENDENCIES_INVALID");
  if (components.length === 0) throw new Error("SBOM_COMPONENTS_EMPTY");
  if (dependencies.length === 0) throw new Error("SBOM_DEPENDENCIES_EMPTY");

  const metadata = requireRecord(document.metadata, "SBOM_METADATA_INVALID");
  const root = requireRecord(metadata.component, "SBOM_ROOT_COMPONENT_INVALID");
  const expectedName = requireNonEmptyString(packageManifest?.name, "PACKAGE_NAME_INVALID");
  const expectedVersion = requireNonEmptyString(packageManifest?.version, "PACKAGE_VERSION_INVALID");
  if (root.name !== expectedName || root.version !== expectedVersion) {
    throw new Error("SBOM_ROOT_COMPONENT_MISMATCH");
  }

  const componentGroups = new Map();
  for (const componentValue of components) {
    const component = requireRecord(componentValue, "SBOM_COMPONENT_INVALID");
    const ref = requireNonEmptyString(component["bom-ref"], "SBOM_COMPONENT_REF_MISSING");
    requireNonEmptyString(component.name, "SBOM_COMPONENT_NAME_MISSING");
    requireNonEmptyString(component.version, "SBOM_COMPONENT_VERSION_MISSING");
    const group = componentGroups.get(ref) ?? [];
    group.push(component);
    componentGroups.set(ref, group);
  }

  const normalizedComponents = [];
  for (const group of componentGroups.values()) {
    const stripped = group.map((component) => {
      const copy = structuredClone(component);
      delete copy.properties;
      return canonicalJson(copy);
    });
    if (new Set(stripped).size !== 1) throw new Error("SBOM_DUPLICATE_COMPONENT_CONFLICT");
    const merged = structuredClone(group[0]);
    const paths = new Set();
    const properties = new Map();
    for (const component of group) {
      for (const propertyValue of Array.isArray(component.properties) ? component.properties : []) {
        const property = requireRecord(propertyValue, "SBOM_COMPONENT_PROPERTY_INVALID");
        const name = requireNonEmptyString(property.name, "SBOM_COMPONENT_PROPERTY_NAME_MISSING");
        const value = requireNonEmptyString(property.value, "SBOM_COMPONENT_PROPERTY_VALUE_MISSING");
        if (name === "cdx:npm:package:path") paths.add(value);
        else properties.set(`${name}\u0000${value}`, { name, value });
      }
    }
    if (paths.size > 0) {
      properties.set("ennco:normalized:npm:install-paths", {
        name: "ennco:normalized:npm:install-paths",
        value: JSON.stringify([...paths].sort()),
      });
    }
    merged.properties = [...properties.values()].sort((left, right) =>
      `${left.name}\u0000${left.value}`.localeCompare(`${right.name}\u0000${right.value}`),
    );
    normalizedComponents.push(merged);
  }

  const rootRef = requireNonEmptyString(root["bom-ref"], "SBOM_ROOT_REF_MISSING");
  const knownRefs = new Set([rootRef, ...componentGroups.keys()]);
  const normalizedDependencies = new Map();
  for (const dependencyValue of dependencies) {
    const dependency = requireRecord(dependencyValue, "SBOM_DEPENDENCY_INVALID");
    const ref = requireNonEmptyString(dependency.ref, "SBOM_DEPENDENCY_REF_MISSING");
    if (!knownRefs.has(ref)) throw new Error("SBOM_DEPENDENCY_REF_UNKNOWN");
    for (const childRef of requireArray(dependency.dependsOn, "SBOM_DEPENDS_ON_INVALID")) {
      requireNonEmptyString(childRef, "SBOM_DEPENDS_ON_REF_MISSING");
      if (!knownRefs.has(childRef)) throw new Error("SBOM_DEPENDS_ON_REF_UNKNOWN");
    }
    const existing = normalizedDependencies.get(ref) ?? new Set();
    for (const childRef of dependency.dependsOn) existing.add(childRef);
    normalizedDependencies.set(ref, existing);
  }

  delete document.serialNumber;
  delete metadata.timestamp;
  document.components = normalizedComponents.sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"]));
  document.dependencies = [...normalizedDependencies]
    .map(([ref, children]) => ({ ref, dependsOn: [...children].sort() }))
    .sort((left, right) => left.ref.localeCompare(right.ref));
  return {
    document: canonicalize(document),
    counts: {
      raw_components: components.length,
      unique_components: normalizedComponents.length,
      duplicate_component_instances_collapsed: components.length - normalizedComponents.length,
      raw_dependencies: dependencies.length,
      unique_dependencies: normalizedDependencies.size,
    },
  };
}

function securitySeverityByRule(run) {
  const driver = isRecord(run?.tool) && isRecord(run.tool.driver) ? run.tool.driver : {};
  const rules = Array.isArray(driver.rules) ? driver.rules : [];
  const values = new Map();
  for (const rule of rules) {
    if (!isRecord(rule) || typeof rule.id !== "string" || !isRecord(rule.properties)) continue;
    const parsed = Number(rule.properties["security-severity"]);
    if (Number.isFinite(parsed)) values.set(rule.id, parsed);
  }
  return values;
}

export function assessSarifDocuments(documents) {
  const inputs = requireArray(documents, "SARIF_DOCUMENTS_INVALID");
  if (inputs.length === 0) throw new Error("SARIF_DOCUMENTS_EMPTY");
  let findings = 0;
  let highOrCritical = 0;
  let errorLevel = 0;
  let unclassified = 0;
  let failedInvocations = 0;
  const blocking = [];

  for (const documentValue of inputs) {
    const document = requireRecord(documentValue, "SARIF_DOCUMENT_INVALID");
    if (document.version !== "2.1.0") throw new Error("SARIF_VERSION_INVALID");
    const runs = requireArray(document.runs, "SARIF_RUNS_INVALID");
    if (runs.length === 0) throw new Error("SARIF_RUNS_EMPTY");
    for (const runValue of runs) {
      const run = requireRecord(runValue, "SARIF_RUN_INVALID");
      const driver = requireRecord(requireRecord(run.tool, "SARIF_TOOL_INVALID").driver, "SARIF_DRIVER_INVALID");
      requireNonEmptyString(driver.name, "SARIF_TOOL_NAME_MISSING");
      const severityByRule = securitySeverityByRule(run);
      const rules = Array.isArray(driver.rules) ? driver.rules : [];
      const invocations = Array.isArray(run.invocations) ? run.invocations : [];
      for (const invocation of invocations) {
        if (isRecord(invocation) && invocation.executionSuccessful === false) {
          failedInvocations += 1;
          blocking.push({ rule_id: "TOOL_EXECUTION_FAILED", level: "error", security_severity: null });
        }
      }
      const results = Array.isArray(run.results) ? run.results : [];
      for (const resultValue of results) {
        const result = requireRecord(resultValue, "SARIF_RESULT_INVALID");
        findings += 1;
        const ruleIndex = isRecord(result.rule) && Number.isInteger(result.rule.index) ? result.rule.index : null;
        const indexedRule = ruleIndex !== null && isRecord(rules[ruleIndex]) ? rules[ruleIndex] : null;
        const ruleId = typeof result.ruleId === "string"
          ? result.ruleId
          : indexedRule && typeof indexedRule.id === "string"
            ? indexedRule.id
            : "UNKNOWN_RULE";
        const level = typeof result.level === "string" ? result.level : "warning";
        const severity = severityByRule.get(ruleId) ?? null;
        if (level === "error") errorLevel += 1;
        if (severity !== null && severity >= 7) highOrCritical += 1;
        if (severity === null) unclassified += 1;
        if (level === "error" || severity === null || severity >= 7) {
          blocking.push({ rule_id: ruleId, level, security_severity: severity });
        }
      }
    }
  }

  return {
    status: blocking.length === 0 ? "PASS" : "FAIL",
    counts: {
      documents: inputs.length,
      findings,
      high_or_critical: highOrCritical,
      error_level: errorLevel,
      unclassified,
      failed_invocations: failedInvocations,
    },
    blocking_findings: blocking.slice(0, 100),
  };
}

export function assessZapJson(raw, expectedTarget = null) {
  const document = requireRecord(raw, "ZAP_DOCUMENT_INVALID");
  const sites = requireArray(document.site, "ZAP_SITES_INVALID");
  if (sites.length === 0) throw new Error("ZAP_SITES_EMPTY");
  let expectedOrigin = null;
  if (expectedTarget !== null) {
    try {
      expectedOrigin = new URL(expectedTarget).origin;
    } catch {
      throw new Error("ZAP_EXPECTED_TARGET_INVALID");
    }
  }
  const counts = { informational: 0, low: 0, medium: 0, high: 0 };
  const blocking = [];

  for (const siteValue of sites) {
    const site = requireRecord(siteValue, "ZAP_SITE_INVALID");
    const siteName = requireNonEmptyString(site["@name"], "ZAP_SITE_NAME_MISSING");
    if (expectedOrigin !== null) {
      let actualOrigin;
      try {
        actualOrigin = new URL(siteName).origin;
      } catch {
        throw new Error("ZAP_SITE_NAME_INVALID");
      }
      if (actualOrigin !== expectedOrigin) throw new Error("ZAP_TARGET_MISMATCH");
    }
    const alerts = Array.isArray(site.alerts) ? site.alerts : [];
    for (const alertValue of alerts) {
      const alert = requireRecord(alertValue, "ZAP_ALERT_INVALID");
      const riskCode = Number(alert.riskcode);
      if (!Number.isInteger(riskCode) || riskCode < 0 || riskCode > 3) {
        throw new Error("ZAP_RISK_CODE_INVALID");
      }
      const key = ["informational", "low", "medium", "high"][riskCode];
      counts[key] += 1;
      if (riskCode >= 2) {
        blocking.push({
          alert_ref: typeof alert.alertRef === "string" ? alert.alertRef : null,
          name: typeof alert.name === "string" ? alert.name : "UNKNOWN_ALERT",
          risk_code: riskCode,
        });
      }
    }
  }

  return {
    status: blocking.length === 0 ? "PASS" : "FAIL",
    counts: { sites: sites.length, ...counts },
    blocking_findings: blocking.slice(0, 100),
  };
}

export function auditCiConfiguration(workflow) {
  requireNonEmptyString(workflow, "CI_WORKFLOW_EMPTY");
  const activeWorkflow = workflow
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  const requiredTokens = [
    ["RELEASE_MANUAL_TRIGGER", "workflow_dispatch:"],
    ["RELEASE_VERSION_TAG_TRIGGER", 'tags: ["v*", "enterprise-*"]'],
    ["CODEQL_SARIF_OUTPUT", "output: codeql-results"],
    ["CODEQL_EVIDENCE_GATE", "security-evidence-gate.mjs sarif"],
    ["CODEQL_COMMIT_ARTIFACT", "codeql-evidence-${{ github.sha }}"],
    ["SOURCE_SNAPSHOT_GATE", "security-evidence-gate.mjs snapshot"],
    ["SOURCE_SNAPSHOT_BINDING", "--source-snapshot security-evidence/source.json"],
    ["SBOM_OFFLINE", "npm sbom --offline --sbom-format cyclonedx"],
    ["SBOM_EVIDENCE_GATE", "security-evidence-gate.mjs sbom"],
    ["SBOM_COMMIT_ARTIFACT", "cyclonedx-sbom-${{ github.sha }}"],
    ["ZAP_FAIL_ACTION", "fail_action: true"],
    ["ZAP_JSON_REPORT", "-J zap-report.json"],
    ["ZAP_EVIDENCE_GATE", "security-evidence-gate.mjs zap"],
    ["ZAP_EXPECTED_TARGET", "--expected-target http://127.0.0.1:3000"],
    ["ZAP_COMMIT_ARTIFACT", "zap-evidence-${{ github.sha }}"],
    ...REQUIRED_DATABASE_GATES.map((token) => [`DATABASE_GATE_${token}`, `npm run ${token}`]),
  ];
  const findings = requiredTokens
    .filter(([, token]) => !activeWorkflow.includes(token))
    .map(([code, token]) => ({ severity: "P1", code, missing_token: token }));
  const pinnedActions = [
    ["CHECKOUT_ACTION_NOT_PINNED", /actions\/checkout@[0-9a-f]{40}/],
    ["SETUP_NODE_ACTION_NOT_PINNED", /actions\/setup-node@[0-9a-f]{40}/],
    ["CODEQL_INIT_ACTION_NOT_PINNED", /github\/codeql-action\/init@[0-9a-f]{40}/],
    ["CODEQL_ANALYZE_ACTION_NOT_PINNED", /github\/codeql-action\/analyze@[0-9a-f]{40}/],
    ["UPLOAD_ACTION_NOT_PINNED", /actions\/upload-artifact@[0-9a-f]{40}/],
    ["ZAP_ACTION_NOT_PINNED", /zaproxy\/action-baseline@[0-9a-f]{40}/],
  ];
  for (const [code, pattern] of pinnedActions) {
    if (!pattern.test(activeWorkflow)) findings.push({ severity: "P1", code, missing_token: pattern.source });
  }
  const commitBindings = activeWorkflow.match(/--expected-commit "\$GITHUB_SHA"/g) ?? [];
  if (commitBindings.length < 3) {
    findings.push({ severity: "P1", code: "SECURITY_EVIDENCE_COMMIT_BINDING_INCOMPLETE", expected: 3, actual: commitBindings.length });
  }
  return {
    status: findings.length === 0 ? "PASS" : "FAIL",
    evidence_class: "LOCAL_CONFIGURATION_ONLY",
    requirement_status: "EXTEND",
    findings,
    limitations: [
      "A configuration PASS does not prove that GitHub Actions ran for the release commit.",
      "ENT-002 still requires an authenticated DAST run in isolated staging.",
    ],
  };
}

export function buildEvidenceManifest({
  control,
  sourceCommit,
  sourceTree,
  sourceTreeClean,
  executionContext,
  artifact,
  assessment,
  scope,
  requirementStatus,
  limitations,
}) {
  validateSourceCommit(sourceCommit);
  if (!["local", "github_actions"].includes(executionContext)) throw new Error("EXECUTION_CONTEXT_INVALID");
  if (!["PASS", "FAIL", "EXTEND"].includes(requirementStatus)) throw new Error("REQUIREMENT_STATUS_INVALID");
  return canonicalize({
    schema_version: "1.0.0",
    control,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    source_tree_clean: sourceTreeClean,
    execution_context: executionContext,
    evidence_class: executionContext === "github_actions" ? "REMOTE_CI_TOOL_OUTPUT" : "LOCAL_TOOL_OUTPUT",
    release_eligible: executionContext === "github_actions" && sourceTreeClean === true && requirementStatus === "PASS",
    requirement_status: requirementStatus,
    artifact,
    assessment,
    scope,
    limitations,
  });
}
