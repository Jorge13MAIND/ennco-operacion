export const NEED_TYPES = [
  "SOLAR_NEW",
  "SOLAR_EXISTING",
  "MAINTENANCE_THERMOGRAPHY",
  "ELECTRICAL_INFRASTRUCTURE",
  "TRANSFORMERS",
  "STORAGE",
] as const;

export const TARIFFS = ["GDMTH", "GDMTO", "PDBT", "UNKNOWN"] as const;
export const ZONES = ["URBAN", "SUBURBAN", "RURAL"] as const;
export const COMMERCIAL_STAGES = [
  "PROSPECTING",
  "CONVERSATION",
  "MEETING_CONFIRMED",
  "DISCOVERY_HELD",
  "QUALIFIED",
  "TECHNICAL_VISIT",
  "PROPOSAL",
  "DECISION",
  "CLOSED_WON",
  "CLOSED_LOST",
] as const;

export const DELIVERY_STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "BLOCKED",
  "EVIDENCE_READY",
  "ACCEPTED",
  "REJECTED",
] as const;

export const GATE_DECISIONS = ["PASS", "EXTEND", "KILL"] as const;

export type NeedType = (typeof NEED_TYPES)[number];
export type Tariff = (typeof TARIFFS)[number];
export type Zone = (typeof ZONES)[number];
export type CommercialStage = (typeof COMMERCIAL_STAGES)[number];
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type GateDecision = (typeof GATE_DECISIONS)[number];

export type AttributionInput = {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
};

export type ContactInput = {
  company: string;
  fullName: string;
  role: string;
  email: string;
  phone: string;
};

export type PrequoteInput = {
  needType: NeedType;
  monthlySpendMxn: number;
  tariff: Tariff;
  existingCapacityKwp: number;
  coverageTargetPct: number;
  city: string;
  state: string;
  zone: Zone;
  contact: ContactInput;
  consent: boolean;
  privacyNoticeVersion: string;
  receiptUploadId?: string;
  attribution?: AttributionInput;
};

export type PrequoteAssumption = {
  key: string;
  label: string;
  value: number | string;
  unit: string;
  source: string;
  sourceDate: string;
};

export type PrequoteEstimate = {
  estimateKind: "SOLAR_RANGE" | "SERVICE_REVIEW";
  capacityKwp: { min: number; max: number };
  investmentMxn: { min: number; max: number };
  roofAreaM2: { min: number; max: number };
  estimatedMonthlyKwh: { min: number; max: number };
  panelCount: { min: number; max: number };
  verdict: "OUT_OF_SCOPE" | "COMMERCIAL_REVIEW" | "INDUSTRIAL_REVIEW" | "TECHNICAL_REVIEW";
  evidenceConfidence: "SOURCE_RANGE" | "EXTRAPOLATED_REVIEW_REQUIRED" | "TECHNICAL_REVIEW_REQUIRED";
  strictLeadStatus: "DOES_NOT_COUNT_WITHOUT_HUMAN_EVIDENCE";
  modelVersion: string;
  modelStatus: "DRAFT_REVIEW_REQUIRED" | "APPROVED" | "EXPIRED";
  modelValidUntil: string;
  calculatedAt: string;
  assumptions: PrequoteAssumption[];
  limitations: string[];
  disclaimer: string;
};

export type QualificationEvidence = {
  industrialOver100Kwp: boolean;
  outsideAnnexA: boolean;
  verifiedTargetRole: boolean;
  explicitInterest: boolean;
  monthlySpendMxn: number | null;
  evidenceRecordIds: string[];
};

export type ForecastQualification = {
  economicBuyer: boolean;
  activePain: boolean;
  businessImpact: boolean;
  timingUnder90Days: boolean;
  valueMxn: number | null;
  nextAction: string | null;
  nextActionDate: string | null;
};

export type CompanyFixture = {
  id: string;
  organizationId: string;
  legalName: string;
  domain: string;
};

export type ContactFixture = {
  id: string;
  companyId: string;
  fullName: string;
  role: string;
  email: string;
};

export type GoldenPathInput = {
  idempotencyKey: string;
  company: CompanyFixture;
  contact: ContactFixture;
  qualification: QualificationEvidence;
};

export const GOLDEN_PATH_STAGES = [
  "COMPANY_REGISTERED",
  "SUPPRESSION_PASSED",
  "DRY_RUN_MESSAGE_CREATED",
  "REPLY_INGESTED",
  "STRICT_LEAD_CREATED",
  "ALERT_ENQUEUED",
  "PORTAL_PROJECTED",
  "NEXT_ACTION_CREATED",
] as const;

export type GoldenPathTraceEvent = {
  sequence: number;
  stage: (typeof GOLDEN_PATH_STAGES)[number] | "SUPPRESSION_BLOCKED";
  recordId: string;
  evidenceClass: "synthetic_demo";
};

export type GoldenPathResult = {
  status: "COMPLETED" | "SUPPRESSED" | "DUPLICATE";
  messageId?: string;
  replyId?: string;
  leadId?: string;
  alertId?: string;
  nextActionId?: string;
  auditEventIds: string[];
  trace: GoldenPathTraceEvent[];
};

export type Milestone = {
  id: string;
  name: string;
  owner: string;
  status: DeliveryStatus;
  gate: GateDecision | null;
  dueDate: string;
  acceptance: string;
  evidence: string[];
  blocker: string | null;
  nextAction: string;
  updatedAt: string;
};

export type ControlRoomSnapshot = {
  evidenceClass: "synthetic_demo" | "live";
  generatedAt: string;
  system: {
    environment: "local" | "staging" | "production";
    killSwitch: boolean;
    externalSendAllowed: boolean;
    openP0: number;
    openP1: number;
  };
  commercial: {
    researchedCompanies: number;
    verifiedContacts: number;
    deliveredMessages: number;
    substantiveReplies: number;
    contractualLeads: number;
    qualifiedOpportunities: number;
    wonProjects: number;
    firstPaymentsMxn: number;
  };
  milestones: Milestone[];
};
