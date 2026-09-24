import { describe, expect, it, vi } from "vitest";
import { runSdrAlerts } from "@/lib/correos/sdr/alerts";
import { alertRecipients } from "@/lib/correos/sdr/alert-email";
import type { RuntimeConfig } from "@/lib/runtime/config";

describe("SDR alert escalation", () => {
  it("records provider acceptance separately from human acknowledgment", async () => {
    const cases = [
      { case_id: "61000000-0000-4000-8000-000000000001", stage: "PRIMARY", pending_minutes: 16, backup_configured: true,
        owner_email: "owner@example.test", backup_email: "backup@example.test" },
      { case_id: "61000000-0000-4000-8000-000000000002", stage: "OVERDUE", pending_minutes: 121, backup_configured: true,
        owner_email: "owner@example.test", backup_email: "backup@example.test" },
    ];
    const command = vi.fn(async (_config: RuntimeConfig, payload: Record<string, unknown>) => payload.op === "ALERT_WORK"
      ? { status: "ALERT_WORK", alerts: cases, oldest_pending_minutes: 121 }
      : { status: "PROVIDER_ACCEPTED" });
    const send = vi.fn(async (_config: RuntimeConfig, item: { stage: string }) => item.stage === "PRIMARY" ? "ACCEPTED" : "UNAVAILABLE");
    const result = await runSdrAlerts({} as RuntimeConfig, {
      command: command as unknown as typeof import("@/lib/correos/sdr/client").sdrCommand,
      send: send as unknown as typeof import("@/lib/correos/sdr/alert-email").sendSdrAlertEmail,
    });
    expect(result).toMatchObject({ state: "DEGRADED", claimed: 2, provider_accepted: 1, provider_unavailable: 1 });
    expect(command).toHaveBeenCalledWith(expect.anything(), { op: "ALERT_SETTLE", case_id: cases[0]!.case_id, stage: "PRIMARY", accepted: true });
    expect(command).toHaveBeenCalledWith(expect.anything(), { op: "ALERT_SETTLE", case_id: cases[1]!.case_id, stage: "OVERDUE", accepted: false });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("sends internal notices only to the owner or the configured backup", () => {
    const item = { case_id: "61000000-0000-4000-8000-000000000001", pending_minutes: 35,
      owner_email: "owner@example.test", backup_email: "backup@example.test" };
    expect(alertRecipients({ ...item, stage: "PRIMARY" })).toEqual({ to: "owner@example.test", cc: [] });
    expect(alertRecipients({ ...item, stage: "BACKUP" })).toEqual({ to: "backup@example.test", cc: [] });
    expect(alertRecipients({ ...item, stage: "OVERDUE" })).toEqual({ to: "backup@example.test", cc: ["owner@example.test"] });
    expect(alertRecipients({ ...item, stage: "BACKUP", backup_email: "prospect@example.test\nBcc: rogue@example.test" })).toBeNull();
  });
  it("quarantines an ambiguous email result without counting provider acceptance", async () => {
    const item = { case_id: "61000000-0000-4000-8000-000000000003", stage: "OVERDUE", pending_minutes: 130,
      backup_configured: true, owner_email: "owner@example.test", backup_email: "backup@example.test" };
    const command = vi.fn(async (_config: RuntimeConfig, payload: Record<string, unknown>) => payload.op === "ALERT_WORK"
      ? { status: "ALERT_WORK", alerts: [item], oldest_pending_minutes: 130 }
      : { status: "PROVIDER_AMBIGUOUS" });
    const result = await runSdrAlerts({} as RuntimeConfig, {
      command: command as unknown as typeof import("@/lib/correos/sdr/client").sdrCommand,
      send: (async () => "AMBIGUOUS") as typeof import("@/lib/correos/sdr/alert-email").sendSdrAlertEmail,
    });
    expect(result).toMatchObject({ state: "DEGRADED", provider_accepted: 0, provider_ambiguous: 1 });
    expect(command).toHaveBeenCalledWith(expect.anything(), { op: "ALERT_SETTLE", case_id: item.case_id, stage: "OVERDUE", accepted: null });
  });
});
