import { z } from "zod";

import { openDirectLaneSecret } from "@/lib/correos/vault";
import { sendTelegramMessage } from "@/lib/correos/sdr/telegram";
import { GrowattError, syncGrowattPlant, type GrowattDeps } from "@/lib/medidores/growatt";
import { RULE_LABELS, SEVERITY_LABELS, type Rule, type Severity } from "@/lib/medidores/model";
import { cronRange, energyService, evaluateMeter, flagStaleMeters } from "@/lib/medidores/service";
import type { RuntimeConfig } from "@/lib/runtime/config";

/**
 * Vuelta del cron de medidores (cada 15 min): jala Growatt, evalúa alertas de los medidores con datos
 * nuevos, marca "sin datos" a los que dejaron de reportar y, solo si Grant lo encendió
 * (app.energy_settings.telegram_enabled), manda las urgentes por Telegram. Cada parte falla sola.
 */
const workSchema = z.object({
  integrations: z.array(z.object({ id: z.uuid(), api_base: z.string(), token_ciphertext: z.string(), token_key_id: z.string(),
    plant_id: z.string(), timezone: z.string(), meters: z.array(z.object({ id: z.uuid(), external_id: z.string().nullable() })) })),
  evaluate: z.array(z.object({ id: z.uuid(), evaluated_at: z.string().nullable(), first_reading_at: z.string().nullable(), last_reading_at: z.string() })),
  stale: z.array(z.object({ id: z.uuid(), name: z.string(), last_reading_at: z.string() })),
  telegram: z.object({ enabled: z.boolean(), chat_ids: z.array(z.string()), alerts: z.array(z.object({
    id: z.uuid(), rule: z.string(), severity: z.string(), message: z.string(), started_at: z.string(), meter: z.string(),
    client: z.string(), site: z.string(), timezone: z.string() })) }),
});

export function energyTelegramText(alert: z.infer<typeof workSchema>["telegram"]["alerts"][number], appUrl: string): string {
  const when = new Intl.DateTimeFormat("es-MX", { timeZone: alert.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(alert.started_at));
  return [
    `${alert.severity === "URGENTE" ? "🔴" : "🟠"} ${SEVERITY_LABELS[alert.severity as Severity] ?? alert.severity} · ${RULE_LABELS[alert.rule as Rule] ?? alert.rule}`,
    `${alert.client} · ${alert.site} · ${alert.meter}`,
    alert.message,
    `Desde: ${when}`,
    `${appUrl.replace(/\/$/, "")}/operacion/medidores`,
  ].join("\n").slice(0, 4000);
}

export async function runEnergyCron(config: RuntimeConfig, deps: { call?: typeof energyService; growatt?: GrowattDeps; send?: typeof sendTelegramMessage; token?: string; now?: Date } = {}) {
  const call = deps.call ?? energyService;
  const work = workSchema.parse(await call(config, { op: "WORK" }));
  const report = { growatt: { ok: 0, failed: 0, readings: 0 }, evaluated: 0, stale: 0, telegram: { state: "OFF" as string, delivered: 0, failed: 0 } };

  for (const integration of work.integrations) {
    try {
      if (!config.directLaneVaultKey) throw new GrowattError("GROWATT_ERROR", "VAULT");
      const token = openDirectLaneSecret({ ciphertext: integration.token_ciphertext, keyId: integration.token_key_id }, config.directLaneVaultKey);
      const batches = await syncGrowattPlant({ base: integration.api_base.replace(/\/$/, ""), token, plantId: integration.plant_id, timeZone: integration.timezone, now: deps.now }, deps.growatt);
      const result = await call(config, { op: "SYNC_RESULT", integration_id: integration.id, ok: true, batches });
      report.growatt.ok += 1; report.growatt.readings += Number(result.readings ?? 0);
    } catch (error) {
      const code = error instanceof GrowattError ? error.code : "GROWATT_SYNC_FAILED";
      await call(config, { op: "SYNC_RESULT", integration_id: integration.id, ok: false, error: code }).catch(() => undefined);
      report.growatt.failed += 1;
    }
  }

  for (const meter of work.evaluate) {
    try { await evaluateMeter(config, meter.id, cronRange(meter), call); report.evaluated += 1; }
    catch { /* la siguiente vuelta lo vuelve a intentar */ }
  }

  try { report.stale = await flagStaleMeters(config, work.stale, call, deps.now); } catch { /* idem */ }

  // Telegram: la base solo reclama alertas si está encendido; aquí además se exige token.
  if (work.telegram.enabled && work.telegram.alerts.length) {
    const token = deps.token ?? process.env.ENNCO_TELEGRAM_BOT_TOKEN ?? "";
    if (!/^\d+:[\w-]{30,}$/.test(token)) {
      report.telegram.state = "TOKEN_MISSING";
      for (const alert of work.telegram.alerts) await call(config, { op: "TELEGRAM_SETTLE", alert_id: alert.id, delivered: false }).catch(() => undefined);
    } else {
      report.telegram.state = "ON";
      const send = deps.send ?? sendTelegramMessage;
      for (const alert of work.telegram.alerts) {
        let ok = true;
        for (const chat of work.telegram.chat_ids) {
          try { await send(token, chat, energyTelegramText(alert, config.appUrl)); } catch { ok = false; }
        }
        await call(config, { op: "TELEGRAM_SETTLE", alert_id: alert.id, delivered: ok }).catch(() => undefined);
        if (ok) report.telegram.delivered += 1; else report.telegram.failed += 1;
      }
    }
  } else if (work.telegram.enabled) {
    report.telegram.state = "ON";
  }
  return report;
}
