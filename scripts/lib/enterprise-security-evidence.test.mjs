import assert from "node:assert/strict";
import test from "node:test";
import {
  assessSarifDocuments,
  assessZapJson,
  auditCiConfiguration,
  canonicalJson,
  normalizeCycloneDx,
  sha256,
} from "./enterprise-security-evidence.mjs";

function sbom(overrides = {}) {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    serialNumber: "urn:uuid:changes-every-run",
    metadata: {
      timestamp: "2026-08-12T00:00:00.000Z",
      component: { "bom-ref": "app@1.0.0", type: "application", name: "app", version: "1.0.0" },
    },
    components: [{ "bom-ref": "dependency@1.0.0", type: "library", name: "dependency", version: "1.0.0" }],
    dependencies: [{ ref: "app@1.0.0", dependsOn: ["dependency@1.0.0"] }],
    ...overrides,
  };
}

test("CycloneDX normalization removes volatile fields and is deterministic", () => {
  const first = normalizeCycloneDx(sbom(), { name: "app", version: "1.0.0" });
  const second = normalizeCycloneDx(
    sbom({ serialNumber: "urn:uuid:another", metadata: { ...sbom().metadata, timestamp: "2026-08-13T00:00:00.000Z" } }),
    { name: "app", version: "1.0.0" },
  );
  assert.equal(sha256(canonicalJson(first.document)), sha256(canonicalJson(second.document)));
  assert.equal(first.document.serialNumber, undefined);
  assert.equal(first.document.metadata.timestamp, undefined);
});

test("CycloneDX rejects empty components and a mismatched root", () => {
  assert.throws(() => normalizeCycloneDx(sbom({ components: [] }), { name: "app", version: "1.0.0" }), /SBOM_COMPONENTS_EMPTY/);
  assert.throws(() => normalizeCycloneDx(sbom(), { name: "other", version: "1.0.0" }), /SBOM_ROOT_COMPONENT_MISMATCH/);
});

test("CycloneDX deterministically collapses duplicate npm instances without losing their paths", () => {
  const duplicate = sbom({
    components: [
      { "bom-ref": "dependency@1.0.0", type: "library", name: "dependency", version: "1.0.0", properties: [{ name: "cdx:npm:package:path", value: "node_modules/a/node_modules/dependency" }] },
      { "bom-ref": "dependency@1.0.0", type: "library", name: "dependency", version: "1.0.0", properties: [{ name: "cdx:npm:package:path", value: "node_modules/b/node_modules/dependency" }] },
    ],
    dependencies: [
      { ref: "app@1.0.0", dependsOn: ["dependency@1.0.0"] },
      { ref: "dependency@1.0.0", dependsOn: [] },
      { ref: "dependency@1.0.0", dependsOn: [] },
    ],
  });
  const normalized = normalizeCycloneDx(duplicate, { name: "app", version: "1.0.0" });
  assert.equal(normalized.counts.raw_components, 2);
  assert.equal(normalized.counts.unique_components, 1);
  assert.equal(normalized.counts.duplicate_component_instances_collapsed, 1);
  const installPaths = normalized.document.components[0].properties.find((property) => property.name === "ennco:normalized:npm:install-paths");
  assert.deepEqual(JSON.parse(installPaths.value), [
    "node_modules/a/node_modules/dependency",
    "node_modules/b/node_modules/dependency",
  ]);
});

test("SARIF fails closed for high security severity and passes an empty findings run", () => {
  const base = {
    version: "2.1.0",
    runs: [{ tool: { driver: { name: "CodeQL", rules: [] } }, results: [] }],
  };
  assert.equal(assessSarifDocuments([base]).status, "PASS");
  const high = structuredClone(base);
  high.runs[0].tool.driver.rules = [{ id: "js/example", properties: { "security-severity": "8.1" } }];
  high.runs[0].results = [{ ruleId: "js/example", level: "warning" }];
  assert.equal(assessSarifDocuments([high]).status, "FAIL");
});

test("SARIF rejects malformed or empty evidence", () => {
  assert.throws(() => assessSarifDocuments([]), /SARIF_DOCUMENTS_EMPTY/);
  assert.throws(() => assessSarifDocuments([{ version: "2.1.0", runs: [] }]), /SARIF_RUNS_EMPTY/);
});

test("SARIF fails closed when a finding has no classifiable security severity", () => {
  const unknown = {
    version: "2.1.0",
    runs: [{ tool: { driver: { name: "CodeQL", rules: [] } }, results: [{ ruleId: "unknown", level: "warning" }] }],
  };
  const assessment = assessSarifDocuments([unknown]);
  assert.equal(assessment.status, "FAIL");
  assert.equal(assessment.counts.unclassified, 1);
});

test("SARIF fails closed when the tool reports an unsuccessful invocation", () => {
  const failed = {
    version: "2.1.0",
    runs: [{ tool: { driver: { name: "CodeQL", rules: [] } }, invocations: [{ executionSuccessful: false }], results: [] }],
  };
  const assessment = assessSarifDocuments([failed]);
  assert.equal(assessment.status, "FAIL");
  assert.equal(assessment.counts.failed_invocations, 1);
});

test("ZAP blocks medium and high findings and rejects unknown risk codes", () => {
  const pass = { site: [{ "@name": "http://127.0.0.1:3000", alerts: [{ riskcode: "1", name: "Low" }] }] };
  assert.equal(assessZapJson(pass, "http://127.0.0.1:3000").status, "PASS");
  const fail = { site: [{ "@name": "http://127.0.0.1:3000", alerts: [{ riskcode: "2", name: "Medium" }] }] };
  assert.equal(assessZapJson(fail, "http://127.0.0.1:3000").status, "FAIL");
  assert.throws(() => assessZapJson({ site: [{ "@name": "local", alerts: [{ riskcode: "9" }] }] }), /ZAP_RISK_CODE_INVALID/);
  assert.throws(() => assessZapJson(pass, "http://127.0.0.1:4000"), /ZAP_TARGET_MISMATCH/);
});

test("CI audit fails when release evidence and database gates are absent", () => {
  const result = auditCiConfiguration("fail_action: true");
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((finding) => finding.code === "CODEQL_EVIDENCE_GATE"));
  assert.ok(result.findings.some((finding) => finding.code === "DATABASE_GATE_verify:research-db"));
  assert.ok(result.findings.some((finding) => finding.code === "RELEASE_MANUAL_TRIGGER"));
  assert.ok(result.findings.some((finding) => finding.code === "RELEASE_VERSION_TAG_TRIGGER"));
  assert.equal(result.requirement_status, "EXTEND");
});
