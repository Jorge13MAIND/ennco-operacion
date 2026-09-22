import { z } from "zod";

/* Supervisor del carril directo (junta #6): el "director comercial" por reglas. Corre al cerrar la
   ventana de envío, revisa cada buzón y la campaña, y manda el reporte por Telegram. La base ya
   pausó el buzón que rebotó de más; aquí solo se lee el resultado y se decide qué tan fuerte avisar.
   La parte con IA (investigar ganchos, juzgar el texto) se agrega cuando haya llave de API. */

const mailboxSchema = z.object({
  email: z.string(),
  status: z.string(),
  cap: z.number(),
  sent_today: z.number(),
  sent_7d: z.number(),
  bounced_7d: z.number(),
  bounce_rate_7d: z.number().nullable(),
});

export const supervisorReportSchema = z.object({
  date: z.string(),
  mailboxes: z.array(mailboxSchema),
  paused_now: z.array(z.string()),
  bounce_limit: z.number(),
  failed_today: z.number(),
  enrollments_stuck: z.number(),
  unanswered_replies: z.array(z.object({ contact: z.string(), company: z.string(), hours: z.number() })),
  never_contacted: z.number(),
  new_contacts_7d: z.number(),
  runway_days: z.number().nullable(),
  rotation: z.object({ scheduled_next_7d: z.number(), active_by_round: z.record(z.string(), z.number()) }),
  hooks: z.object({ approved: z.number(), draft: z.number() }),
});
export type SupervisorReport = z.infer<typeof supervisorReportSchema>;

const pct = (value: number | null) => (value === null ? "sin envíos" : `${(value * 100).toFixed(1)} %`);

/** Nivel de la alerta: CRITICAL si pausó un buzón, WARN si hay algo que atender, INFO si todo va. */
export function supervisorLevel(report: SupervisorReport): "INFO" | "WARN" | "CRITICAL" {
  if (report.paused_now.length > 0) return "CRITICAL";
  const underCap = report.mailboxes.some((m) => m.status === "CONNECTED" && m.sent_today < m.cap / 2);
  if (report.unanswered_replies.length > 0 || report.failed_today > 0 || report.enrollments_stuck > 0 || underCap) return "WARN";
  return "INFO";
}

/** Renglones del reporte, en el orden en que se leen en Telegram: lo urgente primero. */
export function supervisorLines(report: SupervisorReport): string[] {
  const lines: string[] = [];
  for (const email of report.paused_now) lines.push(`PAUSADO ${email}: rebote de 7 días arriba de ${pct(report.bounce_limit)}. Revisar antes de reanudar.`);
  for (const reply of report.unanswered_replies) lines.push(`Respuesta sin contestar (${reply.hours} h): ${reply.contact} · ${reply.company}`);
  if (report.failed_today > 0) lines.push(`Envíos fallidos hoy: ${report.failed_today}`);
  if (report.enrollments_stuck > 0) lines.push(`Inscripciones detenidas por error de envío: ${report.enrollments_stuck}`);

  const sentToday = report.mailboxes.reduce((sum, m) => sum + m.sent_today, 0);
  const capToday = report.mailboxes.filter((m) => m.status === "CONNECTED").reduce((sum, m) => sum + m.cap, 0);
  lines.push(`Hoy: ${sentToday} de ${capToday} correos.`);
  for (const m of report.mailboxes) {
    lines.push(`· ${m.email}: ${m.sent_today}/${m.cap} hoy · rebote 7 d ${pct(m.bounce_rate_7d)}${m.status !== "CONNECTED" ? ` · ${m.status}` : ""}`);
  }

  const rounds = Object.entries(report.rotation.active_by_round).sort(([a], [b]) => a.localeCompare(b)).map(([round, n]) => `${round} ${n}`).join(" · ");
  lines.push(`Rotación: ${rounds || "sin rondas abiertas"}; ${report.rotation.scheduled_next_7d} rondas nuevas arrancan en 7 días.`);
  lines.push(`Reserva: ${report.never_contacted} contactos sin tocar${report.runway_days !== null ? `, alcanza para unos ${report.runway_days} días hábiles al ritmo actual` : ""}.`);
  lines.push(`Ganchos propios: ${report.hooks.approved} aprobados, ${report.hooks.draft} en borrador.`);
  return lines;
}
