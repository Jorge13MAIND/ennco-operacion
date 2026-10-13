import { describe, expect, it } from "vitest";

import { crmWorkbookRows } from "@/lib/crm/export";
import { byUrgency, crmBoardSchema, crmCommandSchema, inView, isQualified, relativeDay, stageRequirements, whatsappLink, type CrmRecord } from "@/lib/crm/model";

const now = new Date("2026-10-13T17:00:00Z");
const base = crmBoardSchema.parse({
  records: [{
    id: "51000000-0000-4000-8000-000000000001", contact_id: null, account_id: null, source: "CORREO", full_name: "Salvador Uribe",
    email: "suribe@cliente.test", phone: null, role_title: "Maintenance Manager", company_name: "Condumex", city: null, state: null,
    stage: "RESPONDIO", owner_user_id: "52000000-0000-4000-8000-000000000001", owner_email: "oscar.ojeda@ennco.com.mx",
    service_interest: null, value_mxn: null, next_action: null, next_action_at: null, close_reason: null, qualification: {},
    reply_intent: "POSITIVE_VISIT", first_reply_at: "2026-10-06T15:11:00Z", last_reply_at: "2026-10-06T15:11:00Z", last_touch_at: null,
    last_reply_body: "¿podemos hablar mañana?", mailbox_email: "fcuellar@enncoindustrial.com", open_tasks: 0, next_task_at: null,
    revision: 1, created_at: "2026-10-06T15:11:00Z", updated_at: "2026-10-06T15:11:00Z",
  }],
  users: [], default_owner_user_id: null, generated_at: now.toISOString(),
}).records[0]!;
const rec = (patch: Partial<CrmRecord>): CrmRecord => ({ ...base, ...patch });

describe("reglas del proceso de Paco", () => {
  it("Calificado exige las 4 condiciones y siguiente acción con fecha y responsable", () => {
    expect(stageRequirements(base, "CALIFICADO")).toEqual(["calificacion", "siguiente"]);
    const ready = rec({ qualification: { mercado: true, contacto: true, necesidad: true, avance: true }, next_action: "Llamar", next_action_at: "2026-10-14T16:00:00Z" });
    expect(isQualified(ready)).toBe(true);
    expect(stageRequirements(ready, "PROPUESTA")).toEqual([]);
  });
  it("Ganado pide valor; Perdido y Descartado piden motivo; Respondió no pide nada", () => {
    const qualified = rec({ qualification: { mercado: true, contacto: true, necesidad: true, avance: true } });
    expect(stageRequirements(qualified, "GANADO")).toEqual(["valor"]);
    expect(stageRequirements(base, "PERDIDO")).toEqual(["motivo"]);
    expect(stageRequirements(rec({ close_reason: "Ya tiene proveedor" }), "DESCARTADO")).toEqual([]);
    expect(stageRequirements(base, "RESPONDIO")).toEqual([]);
  });
});

describe("vistas y orden", () => {
  it("separa por calificar, vencidos, míos y descartados", () => {
    expect(inView(base, "por_calificar", null, now)).toBe(true);
    expect(inView(rec({ next_action_at: "2026-10-12T16:00:00Z" }), "vencidos", null, now)).toBe(true);
    expect(inView(base, "mis", "52000000-0000-4000-8000-000000000001", now)).toBe(true);
    expect(inView(rec({ stage: "DESCARTADO" }), "abiertos", null, now)).toBe(false);
    expect(inView(rec({ stage: "DESCARTADO" }), "descartados", null, now)).toBe(true);
  });
  it("pone primero lo vencido y luego lo más próximo", () => {
    const later = rec({ id: "51000000-0000-4000-8000-000000000002", next_action_at: "2026-10-20T16:00:00Z" });
    const overdue = rec({ id: "51000000-0000-4000-8000-000000000003", next_action_at: "2026-10-10T16:00:00Z" });
    expect([later, base, overdue].sort(byUrgency(now)).map((r) => r.id.slice(-1))).toEqual(["3", "2", "1"]);
  });
  it("días relativos en hora de México y WhatsApp con lada", () => {
    expect(relativeDay("2026-10-13T20:00:00Z", now)).toBe("hoy");
    expect(relativeDay("2026-10-12T20:00:00Z", now)).toBe("ayer");
    expect(whatsappLink("442 467 9790")).toBe("https://wa.me/524424679790");
    expect(whatsappLink("123")).toBeNull();
  });
});

describe("comandos y exportación", () => {
  it("acepta comandos válidos y rechaza campos de más", () => {
    expect(crmCommandSchema.safeParse({ op: "MOVER", payload: { record_id: base.id, stage: "CALIFICADO" } }).success).toBe(true);
    expect(crmCommandSchema.safeParse({ op: "MOVER", payload: { record_id: base.id, stage: "INVENTADA" } }).success).toBe(false);
    expect(crmCommandSchema.safeParse({ op: "ACTUALIZAR", payload: { record_id: base.id, organization_id: "x" } }).success).toBe(false);
    expect(crmCommandSchema.safeParse({ op: "CREAR", payload: { full_name: "Janet Serrano", email: "janet@vw.test", source: "REFERIDO" } }).success).toBe(true);
    expect(crmCommandSchema.safeParse({ op: "BORRAR", payload: {} }).success).toBe(false);
  });
  it("el Excel lleva encabezados en español y una fila por contacto", () => {
    const rows = crmWorkbookRows([base]);
    expect(rows[0]![0]).toBe("Nombre");
    expect(rows[1]).toContain("Respondió");
    expect(rows[1]).toContain("Oscar Ojeda");
  });
});
