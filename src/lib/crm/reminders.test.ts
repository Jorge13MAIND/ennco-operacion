import { describe, expect, it, vi } from "vitest";

import { runCrmReminders } from "@/lib/crm/reminders";
import type { RuntimeConfig } from "@/lib/runtime/config";

const record = {
  id: "51000000-0000-4000-8000-000000000001", source: "CORREO", full_name: "Ramon Magana", company_name: "Holcim México", stage: "CALIFICADO",
  owner_email: "oscar.ojeda@ennco.com.mx", qualification: {}, revision: 2, created_at: "2026-10-07T22:47:00Z", updated_at: "2026-10-07T22:47:00Z",
};
const token = "8000000000:SYNTHETIC-token-for-tests-only-0000";

describe("recordatorios del CRM por Telegram", () => {
  it("avisa al grupo y libera el recordatorio si Telegram falla", async () => {
    const command = vi.fn(async (_c: unknown, payload: Record<string, unknown>) => payload.op === "CRM_REMINDERS_WORK"
      ? { status: "CRM_REMINDERS", chat_ids: ["-5519603691"], items: [
          { kind: "SIGUIENTE", id: record.id, what: "Llamar para agendar visita", due_at: "2026-10-13T16:00:00Z", record },
          { kind: "TAREA", id: "53000000-0000-4000-8000-000000000001", what: "Enviar cotización", due_at: "2026-10-13T15:00:00Z", record }] }
      : { status: "SETTLED" });
    const send = vi.fn(async (_t: string, _chat: string, text: string) => { if (text.includes("cotización")) throw new Error("TELEGRAM_500"); });
    const result = await runCrmReminders({ appUrl: "https://hub.example.test" } as RuntimeConfig, { command: command as never, send, token });
    expect(result).toEqual({ state: "DEGRADED", claimed: 2, delivered: 1, failed: 1 });
    expect(send.mock.calls[0]![2]).toContain("Siguiente acción vencida");
    expect(send.mock.calls[0]![2]).toContain("Responsable: Oscar Ojeda");
    expect(send.mock.calls[0]![2]).toContain("https://hub.example.test/operacion/crm");
    expect(command).toHaveBeenCalledWith(expect.anything(), { op: "CRM_REMINDERS_SETTLE", kind: "TAREA", id: "53000000-0000-4000-8000-000000000001", delivered: false });
  });
});
