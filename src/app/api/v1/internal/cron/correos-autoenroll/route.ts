import { NextResponse } from "next/server";

import { autoenrollDirectLane, readDirectLaneHealth } from "@/lib/correos/client";
import { authorizeCronRequest } from "@/lib/dispatch/cron-auth";
import { sendDispatchAlert } from "@/lib/dispatch/telegram";
import { getRuntimeConfig } from "@/lib/runtime/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

/**
 * Inscripción automática (9:00 CDMX, lunes a viernes): por cada buzón
 * conectado llena el cupo de contactos nuevos del día (rampa semanal menos
 * lo ya enviado y lo ya en cola) desde la reserva verificada, en orden de
 * prioridad, saltando banderas, suprimidos y ya inscritos. Apagada por
 * defecto: ENNCO_AUTOENROLL=on la enciende; mientras, la inscripción es un
 * clic del operador.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const config = getRuntimeConfig();
  const auth = authorizeCronRequest(request, config);
  if (auth.status === "HOLD") return NextResponse.json({ state: "HOLD", reason: auth.reason }, { status: 200, headers: privateHeaders });
  if (auth.status === "UNAUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: privateHeaders });
  if (!config.directLaneReleased) return NextResponse.json({ state: "HOLD", reason: "DIRECT_LANE_NOT_RELEASED" }, { status: 200, headers: privateHeaders });
  if (!config.autoEnroll) return NextResponse.json({ state: "HOLD", reason: "AUTOENROLL_OFF" }, { status: 200, headers: privateHeaders });
  try {
    const health = await readDirectLaneHealth(config);
    const results: Array<{ email: string; status: string; enrolled?: number; reason?: string }> = [];
    for (const mailbox of health.mailboxes.filter((m) => m.status === "CONNECTED" && m.credential_active)) {
      const r = await autoenrollDirectLane(config, mailbox.mailbox_id);
      results.push({ email: mailbox.normalized_email, status: r.status, enrolled: r.enrolled, reason: r.reason });
    }
    const total = results.reduce((sum, r) => sum + (r.enrolled ?? 0), 0);
    if (total > 0) await sendDispatchAlert({ config, level: "INFO", title: `inscripción automática: ${total} contactos nuevos`, lines: results.map((r) => `${r.email}: ${r.enrolled ?? 0} (${r.status}${r.reason ? ` ${r.reason}` : ""})`) }).catch(() => false);
    return NextResponse.json({ state: "OK", total, results }, { status: 200, headers: privateHeaders });
  } catch (error) {
    await sendDispatchAlert({ config, level: "WARN", title: "inscripción automática falló", lines: [error instanceof Error ? error.message.slice(0, 160) : "error desconocido"] });
    return NextResponse.json({ state: "ERROR", reason: "DIRECT_LANE_AUTOENROLL_FAILED" }, { status: 200, headers: privateHeaders });
  }
}
