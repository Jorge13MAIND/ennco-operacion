import { z } from "zod";
import { sdrCommand } from "@/lib/correos/sdr/client";
import { caseContextSchema, cdmx, company, intentLabel, place, replyExcerpt, systemAction, who, type CaseContext } from "@/lib/correos/sdr/case-context";
import type { RuntimeConfig } from "@/lib/runtime/config";

/**
 * Alerta por Telegram de cada respuesta positiva (Grant, 9-oct), con el bot @Enncoventasbot.
 * La base decide qué casos y a qué chats (app.email_sdr_settings.telegram_chat_ids) y lleva la
 * cola por caso y chat; aquí solo se arma el texto y se envía. El token vive en Vercel
 * (ENNCO_TELEGRAM_BOT_TOKEN). Sin token o sin chats, no hace nada.
 */
const workSchema = z.object({ status: z.literal("TELEGRAM_WORK"), items: z.array(z.object({
  case_id: z.uuid(), chat_id: z.string().regex(/^-?\d{1,20}$/), attempt: z.number().int(), context: caseContextSchema.nullable(),
})).max(20) });

export function telegramText(context: CaseContext): string {
  const lines = [
    `🟢 Respuesta positiva · ENNCO`,
    "",
    `${who(context)}${context.contact_role ? ` · ${context.contact_role}` : ""}`,
    `${company(context)}${place(context) ? ` · ${place(context)}` : ""}`,
    ...(context.contact_email ? [context.contact_email] : []),
    "",
    `${intentLabel(context)}. Escribió:`,
    `"${replyExcerpt(context, 900)}"`,
    "",
    systemAction(context),
    `Recibido ${cdmx(context.received_at)} en ${context.mailbox_email ?? "sin buzón"}${context.touch_number ? ` (toque ${context.touch_number})` : ""}.`,
  ];
  return lines.join("\n").slice(0, 4000);
}

export async function sendTelegramMessage(token: string, chatId: string, text: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
  if (!response.ok || !body?.ok) throw new Error(`TELEGRAM_${response.status}: ${(body?.description ?? "sin detalle").slice(0, 200)}`);
}

export async function runPositiveTelegram(config: RuntimeConfig, deps: {
  command?: typeof sdrCommand; send?: typeof sendTelegramMessage; token?: string;
} = {}) {
  const token = deps.token ?? process.env.ENNCO_TELEGRAM_BOT_TOKEN ?? "";
  if (!/^\d+:[\w-]{30,}$/.test(token)) return { state: "OFF", reason: "TELEGRAM_TOKEN_MISSING" };
  const command = deps.command ?? sdrCommand;
  const send = deps.send ?? sendTelegramMessage;
  const work = workSchema.parse(await command(config, { op: "TELEGRAM_WORK" }));
  let delivered = 0;
  let failed = 0;
  for (const item of work.items) {
    let error: string | null = null;
    try { await send(token, item.chat_id, telegramText(item.context ?? {})); }
    catch (cause) { error = cause instanceof Error ? cause.message.replaceAll(token, "[token]") : "TELEGRAM_SEND_FAILED"; }
    await command(config, { op: "TELEGRAM_SETTLE", case_id: item.case_id, chat_id: item.chat_id, delivered: error === null, error });
    if (error) failed += 1; else delivered += 1;
  }
  return { state: failed ? "DEGRADED" : "OK", claimed: work.items.length, delivered, failed };
}
