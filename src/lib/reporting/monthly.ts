export type CampaignOperationDay = {
  observedOn: string;
  evidenceClass: "synthetic_demo" | "live";
  status: "OPERATING" | "HOLD" | "BLOCKED" | "UNKNOWN";
};

export type MonthlyCommercialCounts = {
  deliveredMessages: number;
  substantiveReplies: number;
  positiveReplies: number;
  emailStrictLeads: number;
  prequoteStrictLeads: number;
  heldMeetings: number;
  qualifiedOpportunities: number;
  deliveredProposals: number;
  closedWon: number;
  firstPaymentsMxn: number;
  clientSlaBreaches: number;
};

export type ContractualMonthlyReport = MonthlyCommercialCounts & {
  periodStart: string;
  periodEndExclusive: string;
  evidenceClass: "live";
  operationalDays: number;
  totalStrictLeads: number;
  targetStrictLeads: 10;
  targetMet: boolean;
  replyRatePerDelivered: number | null;
  positiveReplyRatePerDelivered: number | null;
  emailStrictLeadRatePerDelivered: number | null;
  meetingPerStrictLeadRate: number | null;
  opportunityPerHeldMeetingRate: number | null;
};

function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("MONTHLY_REPORT_DATE_INVALID");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("MONTHLY_REPORT_DATE_INVALID");
  }
  return parsed;
}

function expectedCalendarDays(periodStart: string, periodEndExclusive: string): string[] {
  const start = parseDateOnly(periodStart);
  const end = parseDateOnly(periodEndExclusive);
  if (start.getUTCDate() !== 1) throw new Error("MONTHLY_REPORT_START_NOT_MONTH_BOUNDARY");
  const nextMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  if (nextMonth.getTime() !== end.getTime()) throw new Error("MONTHLY_REPORT_NOT_FULL_CALENDAR_MONTH");
  const days: string[] = [];
  for (const cursor = new Date(start); cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days.push(cursor.toISOString().slice(0, 10));
  }
  return days;
}

function assertNonnegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`MONTHLY_REPORT_COUNT_INVALID:${name}`);
}

export function buildContractualMonthlyReport(input: {
  periodStart: string;
  periodEndExclusive: string;
  generatedAt: string;
  operationDays: CampaignOperationDay[];
  counts: MonthlyCommercialCounts;
}): ContractualMonthlyReport {
  const expectedDays = expectedCalendarDays(input.periodStart, input.periodEndExclusive);
  const periodEnd = parseDateOnly(input.periodEndExclusive);
  const generatedAt = new Date(input.generatedAt);
  if (Number.isNaN(generatedAt.getTime()) || generatedAt < periodEnd) throw new Error("MONTHLY_REPORT_PERIOD_NOT_COMPLETE");

  const uniqueDays = new Map(input.operationDays.map((day) => [day.observedOn, day]));
  if (uniqueDays.size !== input.operationDays.length) throw new Error("MONTHLY_REPORT_DUPLICATE_OPERATION_DAY");
  if (uniqueDays.size !== expectedDays.length || expectedDays.some((day) => !uniqueDays.has(day))) {
    throw new Error("MONTHLY_REPORT_OPERATION_DAYS_INCOMPLETE");
  }
  if (expectedDays.some((day) => {
    const evidence = uniqueDays.get(day);
    return evidence?.evidenceClass !== "live" || evidence.status !== "OPERATING";
  })) throw new Error("MONTHLY_REPORT_OPERATION_DAY_NOT_LIVE_PASS");

  for (const [name, value] of Object.entries(input.counts)) {
    if (name === "firstPaymentsMxn") {
      if (!Number.isFinite(value) || value < 0) throw new Error("MONTHLY_REPORT_PAYMENT_INVALID");
    } else assertNonnegativeInteger(name, value);
  }
  const totalStrictLeads = input.counts.emailStrictLeads + input.counts.prequoteStrictLeads;
  if (input.counts.substantiveReplies > input.counts.deliveredMessages) throw new Error("MONTHLY_REPORT_REPLIES_EXCEED_DELIVERIES");
  if (input.counts.positiveReplies > input.counts.substantiveReplies) throw new Error("MONTHLY_REPORT_POSITIVE_EXCEED_REPLIES");
  if (input.counts.emailStrictLeads > input.counts.positiveReplies) throw new Error("MONTHLY_REPORT_EMAIL_LEADS_EXCEED_POSITIVE");
  if (input.counts.heldMeetings > totalStrictLeads) throw new Error("MONTHLY_REPORT_MEETINGS_EXCEED_LEADS");
  if (input.counts.qualifiedOpportunities > input.counts.heldMeetings) throw new Error("MONTHLY_REPORT_OPPORTUNITIES_EXCEED_MEETINGS");
  if (input.counts.deliveredProposals > input.counts.qualifiedOpportunities) throw new Error("MONTHLY_REPORT_PROPOSALS_EXCEED_OPPORTUNITIES");
  if (input.counts.closedWon > input.counts.deliveredProposals) throw new Error("MONTHLY_REPORT_WINS_EXCEED_PROPOSALS");

  return {
    periodStart: input.periodStart,
    periodEndExclusive: input.periodEndExclusive,
    evidenceClass: "live",
    operationalDays: expectedDays.length,
    ...input.counts,
    totalStrictLeads,
    targetStrictLeads: 10,
    targetMet: totalStrictLeads >= 10,
    replyRatePerDelivered: input.counts.deliveredMessages === 0 ? null : input.counts.substantiveReplies / input.counts.deliveredMessages,
    positiveReplyRatePerDelivered: input.counts.deliveredMessages === 0 ? null : input.counts.positiveReplies / input.counts.deliveredMessages,
    emailStrictLeadRatePerDelivered: input.counts.deliveredMessages === 0 ? null : input.counts.emailStrictLeads / input.counts.deliveredMessages,
    meetingPerStrictLeadRate: totalStrictLeads === 0 ? null : input.counts.heldMeetings / totalStrictLeads,
    opportunityPerHeldMeetingRate: input.counts.heldMeetings === 0 ? null : input.counts.qualifiedOpportunities / input.counts.heldMeetings,
  };
}

export type RecoveryTruth = true | false | "UNKNOWN";
export type RecoveryAction =
  | "MONITOR"
  | "VERIFY_DENOMINATORS"
  | "FIX_DELIVERABILITY"
  | "FIX_CONTACT_QUALITY"
  | "FIX_CLIENT_RESPONSE_SLA"
  | "IDENTIFY_BEST_SEGMENT"
  | "WAIT_ACTIVE_EXPERIMENT"
  | "READY_FOR_ONE_VARIABLE_EXPERIMENT";

export function selectRecoveryAction(input: {
  targetMet: boolean;
  denominatorsVerified: RecoveryTruth;
  deliverabilityVerified: RecoveryTruth;
  contactQualityVerified: RecoveryTruth;
  clientResponseSlaVerified: RecoveryTruth;
  bestSegmentIdentified: RecoveryTruth;
  activeExperiment: boolean;
}): RecoveryAction {
  if (input.targetMet) return "MONITOR";
  if (input.denominatorsVerified !== true) return "VERIFY_DENOMINATORS";
  if (input.deliverabilityVerified !== true) return "FIX_DELIVERABILITY";
  if (input.contactQualityVerified !== true) return "FIX_CONTACT_QUALITY";
  if (input.clientResponseSlaVerified !== true) return "FIX_CLIENT_RESPONSE_SLA";
  if (input.bestSegmentIdentified !== true) return "IDENTIFY_BEST_SEGMENT";
  if (input.activeExperiment) return "WAIT_ACTIVE_EXPERIMENT";
  return "READY_FOR_ONE_VARIABLE_EXPERIMENT";
}

export type RecoveryVariable = "DELIVERABILITY" | "CONTACT_QUALITY" | "CLIENT_RESPONSE_SLA" | "SEGMENT" | "MESSAGE";

export function validateRecoveryExperiment(input: {
  variable: RecoveryVariable;
  sampleSize: number;
  baselineEvidenceSha256: string;
  hypothesisCode: string;
}): void {
  if (!Number.isInteger(input.sampleSize) || input.sampleSize < 5 || input.sampleSize > 100) {
    throw new Error("RECOVERY_EXPERIMENT_SAMPLE_INVALID");
  }
  if (!/^[a-f0-9]{64}$/.test(input.baselineEvidenceSha256)) throw new Error("RECOVERY_EXPERIMENT_BASELINE_INVALID");
  if (!/^[A-Z0-9_]{3,64}$/.test(input.hypothesisCode)) throw new Error("RECOVERY_EXPERIMENT_HYPOTHESIS_INVALID");
}
