import { describe, expect, it } from "vitest";

import { buildBrief, formatBriefLines, type BriefInput } from "./brief";

const base: BriefInput = {
  moment: "PREFLIGHT",
  generatedAt: "2026-09-02T15:45:00.000Z",
  unreviewedReplies: 0,
  oldestUnreviewedMinutes: null,
  openP0: 0,
  openP1: 0,
  openReplyCases: 0,
  assignmentActive: true,
  externalSendAllowed: true,
  botonDeApagado: false,
  mailboxes: [
    { email: "francisco@enncoindustrial.com", status: "CONNECTED", sentToday: 3, capToday: 5 },
  ],
  suggestionsNeedingHuman: 0,
  priorityAccountsReady: 0,
};

describe("brief de operación", () => {
  it("un día limpio no inventa problemas", () => {
    const brief = buildBrief(base);

    expect(brief.severity).toBe("INFO");
    expect(brief.headline).toBe("Todo en orden para operar");
    expect(brief.items.every((item) => item.severity === "INFO")).toBe(true);
  });

  it("lo que congela el canal se reporta primero", () => {
    const brief = buildBrief({ ...base, openP1: 2, unreviewedReplies: 5, oldestUnreviewedMinutes: 30 });

    expect(brief.severity).toBe("CRITICAL");
    expect(brief.items[0]?.title).toContain("P1");
    expect(brief.items[0]?.action).toContain("RESOLVED");
  });

  it("sin responsable activo es crítico aunque no haya nada más", () => {
    const brief = buildBrief({ ...base, assignmentActive: false });

    expect(brief.severity).toBe("CRITICAL");
    expect(brief.items.some((item) => item.title === "Sin responsable activo")).toBe(true);
  });

  it("una respuesta vieja sube de aviso a crítico al cruzar las dos horas", () => {
    const reciente = buildBrief({ ...base, unreviewedReplies: 1, oldestUnreviewedMinutes: 45 });
    const vieja = buildBrief({ ...base, unreviewedReplies: 1, oldestUnreviewedMinutes: 150 });

    expect(reciente.severity).toBe("WARNING");
    expect(vieja.severity).toBe("CRITICAL");
    expect(vieja.items[0]?.detail).toContain("2 h 30 min");
  });

  it("distingue apertura de cierre en el titular", () => {
    expect(buildBrief({ ...base, moment: "CLOSE" }).headline).toBe("El día cierra limpio");
  });

  it("el botón de apagado se reporta como control, no como falla", () => {
    const brief = buildBrief({ ...base, botonDeApagado: true });
    const item = brief.items.find((i) => i.title === "Botón de apagado activo");

    expect(item?.severity).toBe("INFO");
    expect(item?.detail).toContain("control deliberado");
  });

  it("sin buzones conectados avisa en la apertura y sólo informa en el cierre", () => {
    const mailboxes = [{ email: "francisco@enncoindustrial.com", status: "DISCONNECTED", sentToday: 0, capToday: 0 }];

    expect(buildBrief({ ...base, mailboxes }).severity).toBe("WARNING");
    expect(buildBrief({ ...base, moment: "CLOSE", mailboxes }).severity).toBe("INFO");
  });

  it("suma los envíos y los topes de todos los buzones", () => {
    const brief = buildBrief({
      ...base,
      mailboxes: [
        { email: "a@enncoindustrial.com", status: "CONNECTED", sentToday: 3, capToday: 5 },
        { email: "b@enncoenergia.com", status: "CONNECTED", sentToday: 4, capToday: 10 },
      ],
    });

    expect(brief.items.some((item) => item.title === "7 de 15 envíos hoy")).toBe(true);
  });

  it("las sugerencias que piden trato humano aparecen sin decidir por el operador", () => {
    const brief = buildBrief({ ...base, suggestionsNeedingHuman: 2 });
    const item = brief.items.find((i) => i.title.includes("trato humano"));

    expect(item?.detail).toContain("decisión sigue siendo del operador");
  });

  it("el formato para Telegram incluye titular y todos los renglones", () => {
    const brief = buildBrief({ ...base, openP1: 1 });
    const lines = formatBriefLines(brief);

    expect(lines[0]).toContain("Brief de apertura");
    expect(lines).toHaveLength(brief.items.length + 1);
  });
});
