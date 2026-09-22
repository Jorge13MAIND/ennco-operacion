import { describe, expect, it } from "vitest";

import { supervisorLevel, supervisorLines, supervisorReportSchema, type SupervisorReport } from "@/lib/correos/supervisor";

const box = (email: string, sent_today: number, bounce_rate_7d: number | null = 0.02) => ({
  email, status: "CONNECTED", cap: 20, sent_today, sent_7d: 60, bounced_7d: 1, bounce_rate_7d,
});

const base: SupervisorReport = supervisorReportSchema.parse({
  date: "2026-09-23",
  mailboxes: [box("contacto@ennco.com.mx", 20), box("francisco@enncoenergia.com", 20)],
  paused_now: [],
  bounce_limit: 0.1,
  failed_today: 0,
  enrollments_stuck: 0,
  unanswered_replies: [],
  never_contacted: 900,
  new_contacts_7d: 100,
  runway_days: 45,
  rotation: { scheduled_next_7d: 11, active_by_round: { R1: 130, R2: 11 } },
  hooks: { approved: 8, draft: 0 },
});

describe("supervisor del carril directo", () => {
  it("un día sin novedades es INFO y reporta ritmo, rotación y reserva", () => {
    expect(supervisorLevel(base)).toBe("INFO");
    const lines = supervisorLines(base);
    expect(lines).toContain("Hoy: 40 de 40 correos.");
    expect(lines.some((l) => l.startsWith("Rotación: R1 130 · R2 11"))).toBe(true);
    expect(lines.some((l) => l.includes("900 contactos sin tocar") && l.includes("45 días"))).toBe(true);
  });

  it("un buzón pausado por rebote es CRITICAL y va primero", () => {
    const report = { ...base, paused_now: ["francisco@enncoenergia.com"] };
    expect(supervisorLevel(report)).toBe("CRITICAL");
    expect(supervisorLines(report)[0]).toMatch(/^PAUSADO francisco@enncoenergia\.com/);
  });

  it("una respuesta sin contestar sube a WARN y se nombra con empresa y horas", () => {
    const report = { ...base, unanswered_replies: [{ contact: "amadrigal@hersheys.com", company: "Hershey", hours: 30 }] };
    expect(supervisorLevel(report)).toBe("WARN");
    expect(supervisorLines(report)).toContain("Respuesta sin contestar (30 h): amadrigal@hersheys.com · Hershey");
  });

  it("un buzón que no llegó a la mitad de su tope es WARN: algo frenó el envío", () => {
    const report = { ...base, mailboxes: [box("contacto@ennco.com.mx", 20), box("francisco@enncoenergia.com", 6)] };
    expect(supervisorLevel(report)).toBe("WARN");
  });

  it("sin envíos en la semana no inventa una tasa de rebote", () => {
    const report = { ...base, mailboxes: [box("contacto@ennco.com.mx", 0, null)], runway_days: null };
    const lines = supervisorLines(report);
    expect(lines.some((l) => l.includes("rebote 7 d sin envíos"))).toBe(true);
    expect(lines.some((l) => l.includes("alcanza para"))).toBe(false);
  });
});
