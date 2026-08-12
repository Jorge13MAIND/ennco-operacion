export const M9_LOCAL_CRITERIA = [
  "SOURCE_PACKAGE_LOCAL",
  "EXPORT_REIMPORT_LOCAL",
  "SECOND_RESTORE_LOCAL",
  "SECURITY_REGRESSION_LOCAL",
  "RUNBOOK_INDEX_LOCAL",
  "TRAINING_SCRIPT_LOCAL",
] as const;

export const M9_LIVE_CRITERIA = [
  "SOURCE_CONTROL_OWNERSHIP",
  "PRODUCTION_ACCESS_TRANSFER",
  "PROVIDER_INVENTORY_ACCEPTED",
  "SECOND_RESTORE_LIVE",
  "SECURITY_AUDIT_LIVE",
  "UAT_CLIENT",
  "TRAINING_OPERATOR_LIVE",
  "EXPORT_REIMPORT_LIVE",
  "RUNBOOK_WALKTHROUGH",
  "ZERO_P0_P1",
] as const;

export type M9CriterionCode =
  | (typeof M9_LOCAL_CRITERIA)[number]
  | (typeof M9_LIVE_CRITERIA)[number];

export type M9CriterionStatus = "UNKNOWN" | "PASS" | "EXTEND" | "KILL";

export type M9Criterion = {
  code: M9CriterionCode;
  status: M9CriterionStatus;
  evidenceClass: "synthetic_demo" | "live";
  evidenceReference: string | null;
};

export type M9HandoffInput = {
  evidenceClass: "synthetic_demo" | "live";
  criteria: M9Criterion[];
  openP0: number;
  openP1: number;
  finalAcceptanceRecorded: boolean;
};

export type M9HandoffDecision = {
  localEvidenceReady: boolean;
  readyForClientAcceptance: boolean;
  accepted: boolean;
  gate: "PASS" | "EXTEND" | "KILL";
  missingLocal: M9CriterionCode[];
  missingLive: M9CriterionCode[];
  reasons: string[];
};

function indexCriteria(criteria: M9Criterion[]): Map<M9CriterionCode, M9Criterion> {
  const result = new Map<M9CriterionCode, M9Criterion>();
  for (const criterion of criteria) {
    if (result.has(criterion.code)) throw new Error(`M9_DUPLICATE_CRITERION:${criterion.code}`);
    result.set(criterion.code, criterion);
  }
  return result;
}
function criterionPasses(
  indexed: Map<M9CriterionCode, M9Criterion>,
  code: M9CriterionCode,
  requiredEvidence: "synthetic_demo" | "live",
): boolean {
  const criterion = indexed.get(code);
  return criterion?.status === "PASS"
    && criterion.evidenceClass === requiredEvidence
    && Boolean(criterion.evidenceReference);
}

export function evaluateM9Handoff(input: M9HandoffInput): M9HandoffDecision {
  if (!Number.isInteger(input.openP0) || input.openP0 < 0) throw new Error("M9_OPEN_P0_INVALID");
  if (!Number.isInteger(input.openP1) || input.openP1 < 0) throw new Error("M9_OPEN_P1_INVALID");

  const indexed = indexCriteria(input.criteria);
  const killed = input.criteria.some((criterion) => criterion.status === "KILL");
  const missingLocal = M9_LOCAL_CRITERIA.filter((code) => !criterionPasses(indexed, code, "synthetic_demo"));
  const missingLive = M9_LIVE_CRITERIA.filter((code) => !criterionPasses(indexed, code, "live"));
  const localEvidenceReady = missingLocal.length === 0 && !killed;
  const readyForClientAcceptance = input.evidenceClass === "live"
    && missingLive.length === 0
    && input.openP0 === 0
    && input.openP1 === 0
    && !killed;
  const accepted = readyForClientAcceptance && input.finalAcceptanceRecorded;
  const reasons: string[] = [];

  if (killed) reasons.push("Existe un criterio en KILL.");
  if (missingLocal.length > 0) reasons.push(`Faltan ${missingLocal.length} criterios locales con evidencia.`);
  if (input.evidenceClass !== "live") reasons.push("La preparación local no puede convertirse en aceptación del cliente.");
  if (missingLive.length > 0) reasons.push(`Faltan ${missingLive.length} criterios live.`);
  if (input.openP0 > 0 || input.openP1 > 0) reasons.push(`Hay ${input.openP0} P0 y ${input.openP1} P1 abiertos.`);
  if (readyForClientAcceptance && !input.finalAcceptanceRecorded) reasons.push("Falta la aceptación final explícita de ENNCO.");

  return {
    localEvidenceReady,
    readyForClientAcceptance,
    accepted,
    gate: killed ? "KILL" : accepted ? "PASS" : "EXTEND",
    missingLocal: [...missingLocal],
    missingLive: [...missingLive],
    reasons,
  };
}
