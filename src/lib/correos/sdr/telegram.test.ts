import { describe, expect, it, vi } from "vitest";
import { runPositiveTelegram, telegramText } from "@/lib/correos/sdr/telegram";
import type { RuntimeConfig } from "@/lib/runtime/config";

const holcim = { contact_name: "Ramon Magana Lozano", contact_role: "Maintenance Manager", contact_email: "ramon.magana@holcim.com",
  account_name: "Holcim México", account_city: "Guadalajara", account_state: "Jalisco", mailbox_email: "fcuellar@enncoenergia.com",
  received_at: "2026-10-07T22:47:16+00:00", touch_number: 1, intent: "EXPLICIT_INTEREST", subtype: "POSITIVE_VISIT", state: "READY",
  send_after: "2026-10-07T23:07:16+00:00", reply_cc_planned: ["francisco.cuellar@ennco.com.mx", "oscar.ojeda@ennco.com.mx"],
  body: "Si, nos podemos acomodar\n\nmarcame\n\nSaludos\n\nRamon Magaña Lozano\nJefe de Mantenimiento UN Guadalajara" };
const token = "8000000000:SYNTHETIC-token-for-tests-only-0000";

describe("alerta de positivo por Telegram", () => {
  it("trae quién, empresa, qué escribió y la respuesta automática", () => {
    const text = telegramText(holcim);
    for (const part of ["Respuesta positiva", "Ramon Magana Lozano · Maintenance Manager", "Holcim México · Guadalajara, Jalisco",
      "ramon.magana@holcim.com", "nos podemos acomodar", "programada para las 17:07", "oscar.ojeda@ennco.com.mx",
      "Recibido 7-oct 16:47 en fcuellar@enncoenergia.com (toque 1)"]) expect(text).toContain(part);
    expect(text).not.toContain("Jefe de Mantenimiento UN Guadalajara");
  });
  it("envía cada caso a cada chat y asienta el resultado sin filtrar el token", async () => {
    const command = vi.fn(async (_c: unknown, payload: Record<string, unknown>) => payload.op === "TELEGRAM_WORK"
      ? { status: "TELEGRAM_WORK", items: [{ case_id: "61000000-0000-4000-8000-000000000001", chat_id: "-100123", attempt: 1, context: holcim },
          { case_id: "61000000-0000-4000-8000-000000000001", chat_id: "456", attempt: 1, context: holcim }] }
      : { status: "SETTLED" });
    const send = vi.fn(async (_t: string, chat: string) => { if (chat === "456") throw new Error(`TELEGRAM_403: blocked ${token}`); });
    const result = await runPositiveTelegram({} as RuntimeConfig, { command: command as never, send, token });
    expect(result).toEqual({ state: "DEGRADED", claimed: 2, delivered: 1, failed: 1 });
    expect(command).toHaveBeenCalledWith(expect.anything(), { op: "TELEGRAM_SETTLE", case_id: "61000000-0000-4000-8000-000000000001", chat_id: "-100123", delivered: true, error: null });
    expect(command).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ chat_id: "456", delivered: false, error: "TELEGRAM_403: blocked [token]" }));
  });
  it("sin token no hace nada", async () => {
    const command = vi.fn();
    expect(await runPositiveTelegram({} as RuntimeConfig, { command: command as never, token: "" })).toEqual({ state: "OFF", reason: "TELEGRAM_TOKEN_MISSING" });
    expect(command).not.toHaveBeenCalled();
  });
});
