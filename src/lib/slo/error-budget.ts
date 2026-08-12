export type SloStatus = "HEALTHY" | "AT_RISK" | "EXHAUSTED" | "UNKNOWN";

export type AvailabilityBudget = {
  target: number;
  observedAvailability: number | null;
  allowedBadEvents: number | null;
  consumedBadEvents: number;
  consumedFraction: number | null;
  remainingBadEvents: number | null;
  status: SloStatus;
  featureFreeze: boolean;
};

export function calculateAvailabilityBudget(input: {
  totalEvents: number;
  badEvents: number;
  target?: number;
}): AvailabilityBudget {
  const target = input.target ?? 0.999;
  if (!Number.isInteger(input.totalEvents) || input.totalEvents < 0
    || !Number.isInteger(input.badEvents) || input.badEvents < 0
    || input.badEvents > input.totalEvents
    || !Number.isFinite(target) || target <= 0 || target >= 1) {
    throw new Error("ERROR_BUDGET_INPUT_INVALID");
  }
  if (input.totalEvents === 0) {
    return {
      target,
      observedAvailability: null,
      allowedBadEvents: null,
      consumedBadEvents: 0,
      consumedFraction: null,
      remainingBadEvents: null,
      status: "UNKNOWN",
      featureFreeze: true,
    };
  }
  const allowedBadEvents = input.totalEvents * (1 - target);
  const consumedFraction = allowedBadEvents === 0 ? Infinity : input.badEvents / allowedBadEvents;
  const status: SloStatus = consumedFraction >= 1 ? "EXHAUSTED" : consumedFraction >= 0.5 ? "AT_RISK" : "HEALTHY";
  return {
    target,
    observedAvailability: 1 - input.badEvents / input.totalEvents,
    allowedBadEvents,
    consumedBadEvents: input.badEvents,
    consumedFraction,
    remainingBadEvents: Math.max(0, allowedBadEvents - input.badEvents),
    status,
    featureFreeze: status !== "HEALTHY",
  };
}
