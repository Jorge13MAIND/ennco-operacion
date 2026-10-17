import { describe, expect, it, vi } from "vitest";

import { energyTelegramText, runEnergyCron } from "@/lib/medidores/cron";
import type { RuntimeConfig } from "@/lib/runtime/config";

const config = { appUrl: "https://hub.example", organizationId: "e0000000-0000-4000-8000-000000000001" } as unknown as RuntimeConfig;
const emptyWork = { integrations: [], evaluate: [], stale: [], telegram: { enabled: false, chat_ids: ["-1"], alerts: [] } };
const alert = { id: "00000000-0000-4000-8000-0000000000a1", rule: "CORTE", severity: "URGENTE", message: "Corte de energía desde las 10:00.",
  started_at: "2026-10-16T16:00:00Z", meter: "Tablero general", client: "Cliente", site: "Planta", timezone: "America/Mexico_City" };

describe("cron de medidores", () => {
  it("con Telegram apagado no manda nada", async () => {
    const send = vi.fn();
    const call = vi.fn(async (_c: RuntimeConfig, p: Record<string, unknown>) => (p.op === "WORK" ? { ...emptyWork, telegram: { ...emptyWork.telegram, alerts: [alert] } } : {}));
    const report = await runEnergyCron(config, { call, send, token: "123456:" + "a".repeat(35) });
    expect(send).not.toHaveBeenCalled();
    expect(report.telegram.state).toBe("OFF");
  });

  it("encendido, manda cada alerta a cada chat y la asienta", async () => {
    const send = vi.fn(async () => undefined);
    const ops: string[] = [];
    const call = vi.fn(async (_c: RuntimeConfig, p: Record<string, unknown>) => { ops.push(String(p.op)); return p.op === "WORK" ? { ...emptyWork, telegram: { enabled: true, chat_ids: ["-1", "-2"], alerts: [alert] } } : {}; });
    const report = await runEnergyCron(config, { call, send, token: "123456:" + "a".repeat(35) });
    expect(send).toHaveBeenCalledTimes(2);
    expect(ops).toEqual(["WORK", "TELEGRAM_SETTLE"]);
    expect(report.telegram).toMatchObject({ state: "ON", delivered: 1 });
  });

  it("el texto de Telegram trae nivel, regla, planta y liga", () => {
    const text = energyTelegramText(alert, "https://hub.example/");
    expect(text).toContain("Urgente · Corte de energía");
    expect(text).toContain("Cliente · Planta · Tablero general");
    expect(text).toContain("https://hub.example/operacion/medidores");
  });
});
