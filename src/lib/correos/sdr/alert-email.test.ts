import { describe, expect, it, vi } from "vitest";
import { alertMessage, alertRecipients, sendSdrAlertEmail } from "@/lib/correos/sdr/alert-email";
import { directLaneSendInputSchema } from "@/lib/correos/gmail-send";
import { DirectLaneSendError } from "@/lib/correos/gmail-send";
import type { DirectLaneHealth } from "@/lib/correos/client";
import type { RuntimeConfig } from "@/lib/runtime/config";

const alert = { case_id: "61000000-0000-4000-8000-000000000001", stage: "OVERDUE" as const,
  pending_minutes: 130, owner_email: "owner@example.test", backup_email: "backup@example.test" };
const mailboxHealth = { mailboxes: [{ mailbox_id: "61000000-0000-4000-8000-000000000002",
  normalized_email: "contacto@ennco.com.mx", is_client_primary: true, status: "CONNECTED", credential_active: true }] } as DirectLaneHealth;

describe("internal SDR alert email", () => {
  it("uses the connected client mailbox and sends only to the assigned people", async () => {
    const send = vi.fn(async () => ({ provider: "GMAIL_API" as const, provider_message_id: "synthetic",
      provider_thread_id: "synthetic", rfc_message_id: "<synthetic>", envelope_sha256: "a".repeat(64) }));
    const result = await sendSdrAlertEmail({} as RuntimeConfig, alert, {
      health: async () => mailboxHealth,
      token: async () => "synthetic-access-token-32-characters",
      sender: () => ({ send }),
    });
    expect(result).toBe("ACCEPTED");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from_email: "contacto@ennco.com.mx",
      to_email: "backup@example.test", cc_emails: ["owner@example.test"], kind: "INTERNAL", touch_number: null, thread: null }));
  });

  it("holds ambiguous acceptance and treats an explicit rejection as unavailable", async () => {
    const deps = { health: async () => mailboxHealth, token: async () => "synthetic-access-token-32-characters" };
    expect(await sendSdrAlertEmail({} as RuntimeConfig, alert, {
      ...deps, sender: () => ({ send: async () => { throw new Error("timeout after send"); } }),
    })).toBe("AMBIGUOUS");
    expect(await sendSdrAlertEmail({} as RuntimeConfig, alert, {
      ...deps, sender: () => ({ send: async () => { throw new DirectLaneSendError("GMAIL_API_REQUEST_REJECTED"); } }),
    })).toBe("UNAVAILABLE");
  });
});

describe("aviso con contexto (Jorge, 9-oct)", () => {
  const vw = { contact_name: "Ignacio Lopez", contact_role: "Central Maintenance Manager", contact_email: "ignacio.lopez1@vw.com.mx",
    account_name: "Volkswagen MX", account_city: "Leon", account_state: "Guanajuato", mailbox_email: "fcuellar@enncoindustrial.com",
    received_at: "2026-10-08T18:53:23+00:00", subject: "Re: Ignacio, mil paneles y un recibo que no bajó", touch_number: 2,
    body: "Hola Paco.\n\nYa no estoy viendo esos temas pero te paso el contacto de la persona que los lleva\njanet.serrano@vw.com.mx\n\nSaludos.",
    intent: "WRONG_PERSON", subtype: null, state: "REVIEW", next_action: "Revisión humana requerida", reply_status: null };
  it("dice quién respondió, de qué empresa, qué escribió y qué hizo el sistema", () => {
    const { subject, body } = alertMessage({ ...alert, stage: "PRIMARY", pending_minutes: 15, context: vw }, "https://hub.example.test");
    expect(subject).toBe("ENNCO · Ignacio Lopez (Volkswagen MX) respondió · Persona equivocada o ya no está");
    for (const part of ["Ignacio Lopez, de Volkswagen MX, respondió", "janet.serrano@vw.com.mx", "Puesto: Central Maintenance Manager",
      "Empresa: Volkswagen MX · Leon, Guanajuato", "fcuellar@enncoindustrial.com (toque 2)", "Recibido: 8-oct 12:53",
      "No se le respondió nada automáticamente", "15 minutos sin acuse", "https://hub.example.test/operacion/correos"]) expect(body).toContain(part);
    expect(body).not.toMatch(/[—–]/);
    expect(directLaneSendInputSchema.safeParse({ message_id: alert.case_id, from_name: "ENNCO Control Room", from_email: "contacto@ennco.com.mx",
      to_email: "owner@example.test", subject, body_text: body, kind: "INTERNAL", touch_number: null }).success).toBe(true);
  });
  it("un positivo dice cuándo sale la respuesta automática y con quién en copia", () => {
    const { body } = alertMessage({ ...alert, stage: "PRIMARY", pending_minutes: 15, context: { ...vw, intent: "EXPLICIT_INTEREST",
      subtype: "POSITIVE_VISIT", state: "READY", send_after: "2026-10-08T19:10:00+00:00",
      reply_cc_planned: ["francisco.cuellar@ennco.com.mx", "oscar.ojeda@ennco.com.mx"] } });
    expect(body).toContain("Respuesta automática programada para las 13:10, con copia a francisco.cuellar@ennco.com.mx y oscar.ojeda@ennco.com.mx.");
  });
  it("Oscar va en copia de todos los avisos, sin repetir al destinatario", () => {
    expect(alertRecipients({ ...alert, stage: "PRIMARY", cc_emails: ["oscar.ojeda@ennco.com.mx", "owner@example.test"] }))
      .toEqual({ to: "owner@example.test", cc: ["oscar.ojeda@ennco.com.mx"] });
    expect(alertRecipients({ ...alert, cc_emails: ["oscar.ojeda@ennco.com.mx"] }))
      .toEqual({ to: "backup@example.test", cc: ["owner@example.test", "oscar.ojeda@ennco.com.mx"] });
  });
});
