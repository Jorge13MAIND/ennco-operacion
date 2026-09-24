import { describe, expect, it, vi } from "vitest";
import { runSdrAlerts } from "@/lib/correos/sdr/alerts";
import type { RuntimeConfig } from "@/lib/runtime/config";

describe("SDR alert escalation", () => {
  it("records provider acceptance separately from human acknowledgment", async () => {
    const cases = [
      { case_id: "61000000-0000-4000-8000-000000000001", stage: "PRIMARY", pending_minutes: 16, backup_configured: true },
      { case_id: "61000000-0000-4000-8000-000000000002", stage: "OVERDUE", pending_minutes: 121, backup_configured: true },
    ];
    const command = vi.fn(async (_config: RuntimeConfig, payload: Record<string, unknown>) => payload.op === "ALERT_WORK"
      ? { status: "ALERT_WORK", alerts: cases, oldest_pending_minutes: 121 }
      : { status: "PROVIDER_ACCEPTED" });
    const send = vi.fn(async ({ level }: { level: string }) => level !== "CRITICAL");
    const result = await runSdrAlerts({} as RuntimeConfig, {
      command: command as unknown as typeof import("@/lib/correos/sdr/client").sdrCommand,
      send: send as unknown as typeof import("@/lib/dispatch/telegram").sendDispatchAlert,
    });
    expect(result).toMatchObject({ state: "DEGRADED", claimed: 2, provider_accepted: 1, provider_unavailable: 1 });
    expect(command).toHaveBeenCalledWith(expect.anything(), { op: "ALERT_SETTLE", case_id: cases[0]!.case_id, stage: "PRIMARY", accepted: true });
    expect(command).toHaveBeenCalledWith(expect.anything(), { op: "ALERT_SETTLE", case_id: cases[1]!.case_id, stage: "OVERDUE", accepted: false });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
