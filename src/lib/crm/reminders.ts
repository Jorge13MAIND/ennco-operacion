import { z } from "zod";

import { sdrCommand } from "@/lib/correos/sdr/client";
import { sendTelegramMessage } from "@/lib/correos/sdr/telegram";
import { crmRecordSchema, formatDateTime, personName, STAGE_LABELS } from "@/lib/crm/model";
import type { RuntimeConfig } from "@/lib/runtime/config";

/**
 * Recordatorios del CRM por Telegram (Grant, 13-oct): una tarea o una siguiente acción vencida avisa
 * una vez al grupo de ENNCO, de lunes a viernes de 8:00 a 19:00. La base elige y marca qué avisar
 * (CRM_REMINDERS_WORK); si Telegram falla, se libera para la siguiente vuelta.
 */
const workSchema = z.object({
  status: z.literal("CRM_REMINDERS"),
  items: z.array(z.object({ kind: z.enum(["TAREA", "SIGUIENTE"]), id: z.uuid(), what: z.string().nullable(), due_at: z.string().nullable(), record: crmRecordSchema })).max(20),
  chat_ids: z.array(z.string().regex(/^-?\d{1,20}$/)).nullable().transform((v) => v ?? []),
});

export function reminderText(item: z.infer<typeof workSchema>["items"][number], appUrl: string): string {
  const r = item.record;
  return [
    `⏰ ${item.kind === "TAREA" ? "Tarea vencida" : "Siguiente acción vencida"} · CRM ENNCO`,
    "",
    item.what ?? "Sin descripción",
    `${r.full_name}${r.company_name ? ` · ${r.company_name}` : ""} (${STAGE_LABELS[r.stage]})`,
    `Responsable: ${personName(r.owner_email)}`,
    `Venció: ${formatDateTime(item.due_at)}`,
    `${appUrl.replace(/\/$/, "")}/operacion/crm`,
  ].join("\n");
}

export async function runCrmReminders(config: RuntimeConfig, deps: { command?: typeof sdrCommand; send?: typeof sendTelegramMessage; token?: string } = {}) {
  const token = deps.token ?? process.env.ENNCO_TELEGRAM_BOT_TOKEN ?? "";
  if (!/^\d+:[\w-]{30,}$/.test(token)) return { state: "OFF", reason: "TELEGRAM_TOKEN_MISSING" };
  const command = deps.command ?? sdrCommand;
  const send = deps.send ?? sendTelegramMessage;
  const work = workSchema.parse(await command(config, { op: "CRM_REMINDERS_WORK" }));
  let delivered = 0;
  let failed = 0;
  for (const item of work.items) {
    let ok = work.chat_ids.length > 0;
    for (const chat of work.chat_ids) {
      try { await send(token, chat, reminderText(item, config.appUrl)); } catch { ok = false; }
    }
    await command(config, { op: "CRM_REMINDERS_SETTLE", kind: item.kind, id: item.id, delivered: ok });
    if (ok) delivered += 1; else failed += 1;
  }
  return { state: failed ? "DEGRADED" : "OK", claimed: work.items.length, delivered, failed };
}
