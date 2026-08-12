export type RtmValidationResult = {
  status: "PASS" | "FAIL";
  rows: number;
  columns: number;
  checklist_coverage: string;
  unique_ids: number;
  source_status_counts: Record<string, number>;
  delivery_status_counts: Record<string, number>;
  enterprise_requirements: Array<{
    id: string;
    name: string;
    tracked: boolean;
    delivery_status: string;
    source_status: string;
    gate: string;
  }>;
  enterprise_gap_count: number;
  failures: string[];
};

export type RiskRecord = {
  id: string;
  priority: string;
  risk: string;
  trigger: string;
  mitigation: string;
  owner: string;
  status: string;
  line: number;
};

export type RiskValidationResult = {
  status: "PASS" | "FAIL";
  records: RiskRecord[];
  open_records: RiskRecord[];
  open_counts: { P0: number; P1: number; P2: number };
  status_counts: Record<string, number>;
  failures: string[];
};

export const ENTERPRISE_REQUIREMENTS: ReadonlyArray<{ id: string; name: string }>;
export const OPEN_RISK_STATUSES: ReadonlySet<string>;
export function parseCsv(input: string): string[][];
export function validateRtm(input: { text: string; repo: string }): RtmValidationResult;
export function parseRiskRegister(text: string): RiskValidationResult;
