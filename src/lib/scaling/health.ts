export type ScalingHealthInput = {
  evidenceClass: "synthetic_demo" | "live";
  deliveredCount: number;
  hardBounceCount: number;
  spamComplaintCount: number;
  unsubscribeCount: number;
  duplicateDeliveryCount: number;
  suppressionViolationCount: number;
  unknownCount: number;
  openP0: number;
  openP1: number;
  replySyncP95Seconds: number | null;
  observationHours: number;
  plannedNextVolume: number;
};

export type ScalingHealthResult = {
  decision: "PASS" | "EXTEND" | "KILL";
  nextMaximumVolume: number;
  reasons: string[];
};

export function evaluateScalingHealth(input: ScalingHealthInput): ScalingHealthResult {
  const nextMaximumVolume = Math.min(25, Math.max(5, input.deliveredCount * 2));
  const killReasons: string[] = [];
  const extendReasons: string[] = [];

  if (input.spamComplaintCount > 0) killReasons.push("SPAM_COMPLAINT_OBSERVED");
  if (input.duplicateDeliveryCount > 0) killReasons.push("DUPLICATE_DELIVERY_OBSERVED");
  if (input.suppressionViolationCount > 0) killReasons.push("SUPPRESSION_VIOLATION_OBSERVED");
  if (input.openP0 > 0) killReasons.push("OPEN_P0");
  if (killReasons.length > 0) return { decision: "KILL", nextMaximumVolume, reasons: killReasons };

  if (input.evidenceClass !== "live") extendReasons.push("EVIDENCE_NOT_LIVE");
  if (input.deliveredCount < 1) extendReasons.push("NO_VALID_DELIVERIES");
  if (input.observationHours < 24) extendReasons.push("OBSERVATION_WINDOW_UNDER_24_HOURS");
  if (input.hardBounceCount > 0) extendReasons.push("HARD_BOUNCE_REQUIRES_REVIEW");
  if (input.unsubscribeCount > 0) extendReasons.push("UNSUBSCRIBE_REQUIRES_REVIEW");
  if (input.unknownCount > 0) extendReasons.push("UNKNOWN_HEALTH_SIGNAL");
  if (input.openP1 > 0) extendReasons.push("OPEN_P1");
  if (input.replySyncP95Seconds === null) extendReasons.push("REPLY_SYNC_P95_UNKNOWN");
  if (input.replySyncP95Seconds !== null && input.replySyncP95Seconds > 300) extendReasons.push("REPLY_SYNC_P95_OVER_300_SECONDS");
  if (input.plannedNextVolume < 1) extendReasons.push("NEXT_VOLUME_INVALID");
  if (input.plannedNextVolume > nextMaximumVolume) extendReasons.push("NEXT_VOLUME_EXCEEDS_RAMP_LIMIT");

  return {
    decision: extendReasons.length === 0 ? "PASS" : "EXTEND",
    nextMaximumVolume,
    reasons: extendReasons,
  };
}

export type T0Counts = {
  validFirstDeliveries: number;
  substantiveReplies: number;
  positiveReplies: number;
  strictLeads: number;
  heldMeetings: number;
  qualifiedOpportunities: number;
};

export type T0Metrics = T0Counts & {
  replyRate: number;
  positiveReplyRate: number;
  strictLeadRate: number;
  heldMeetingPerLeadRate: number | null;
  opportunityPerMeetingRate: number | null;
};

function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`INVALID_T0_COUNT:${name}`);
}

export function calculateT0(counts: T0Counts): T0Metrics {
  for (const [name, value] of Object.entries(counts)) assertCount(name, value);
  if (counts.validFirstDeliveries < 100) throw new Error("T0_REQUIRES_100_VALID_FIRST_DELIVERIES");
  if (counts.substantiveReplies > counts.validFirstDeliveries) throw new Error("T0_REPLIES_EXCEED_DELIVERIES");
  if (counts.positiveReplies > counts.substantiveReplies) throw new Error("T0_POSITIVE_EXCEEDS_REPLIES");
  if (counts.strictLeads > counts.positiveReplies) throw new Error("T0_LEADS_EXCEED_POSITIVE_REPLIES");
  if (counts.heldMeetings > counts.strictLeads) throw new Error("T0_MEETINGS_EXCEED_LEADS");
  if (counts.qualifiedOpportunities > counts.heldMeetings) throw new Error("T0_OPPORTUNITIES_EXCEED_MEETINGS");

  return {
    ...counts,
    replyRate: counts.substantiveReplies / counts.validFirstDeliveries,
    positiveReplyRate: counts.positiveReplies / counts.validFirstDeliveries,
    strictLeadRate: counts.strictLeads / counts.validFirstDeliveries,
    heldMeetingPerLeadRate: counts.strictLeads === 0 ? null : counts.heldMeetings / counts.strictLeads,
    opportunityPerMeetingRate: counts.heldMeetings === 0 ? null : counts.qualifiedOpportunities / counts.heldMeetings,
  };
}

export function requiredDeliveredContacts(targetStrictLeads: number, observedStrictLeadRate: number): number | null {
  if (!Number.isFinite(targetStrictLeads) || targetStrictLeads <= 0) throw new Error("TARGET_STRICT_LEADS_INVALID");
  if (!Number.isFinite(observedStrictLeadRate) || observedStrictLeadRate < 0 || observedStrictLeadRate > 1) {
    throw new Error("OBSERVED_STRICT_LEAD_RATE_INVALID");
  }
  if (observedStrictLeadRate === 0) return null;
  return Math.ceil(targetStrictLeads / observedStrictLeadRate);
}
