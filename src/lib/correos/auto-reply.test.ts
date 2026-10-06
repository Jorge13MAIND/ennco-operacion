import { describe, expect, it } from "vitest";
import { detectAutoReply, parseReturnDate } from "@/lib/correos/auto-reply";

const at = (iso: string) => new Date(iso);
const auto = [{ name: "Auto-Submitted", value: "auto-replied" }];
const d = (subject: string, body: string, received: string, headers = auto, sender = "x@cliente.mx") =>
  detectAutoReply({ subject, headers, body, senderEmail: sender, receivedAt: at(received) });

describe("respuestas automáticas reales (sep-oct 2026)", () => {
  it("Hahn: back on October 12th → regreso 12-oct", () => {
    expect(d("Respuesta automática: Monserrath, sé que ves muchos proveedores",
      "Dear Sender:\n\nThank you for your email. I’m currently out of the office with limited access to my email. I apologize for any inconvenience if replies are delayed. I will be back in the office on October 12th and will follow up to you as soon as possible.",
      "2026-10-05T14:02:00Z")).toEqual({ kind: "OOO", returnDate: "2026-10-12", referrals: [] });
  });
  it("Molycop: hasta el 10 de octubre 2026", () => {
    expect(d("Respuesta automática: Daniel, pregunta rápida",
      "Estaré fuera de la oficina con acceso limitado a correos hasta el 10 de octubre 2026.\nResponderé a su mensaje lo antes posible.\nI will be out of the office until october 10th with limited access",
      "2026-10-06T17:42:00Z")?.returnDate).toBe("2026-10-10");
  });
  it("Relats: a mi regreso, el día 7 de octubre del 2026", () => {
    expect(d("Respuesta automática: Julio, pregunta rápida",
      "Gracias por vuestro email. Estoy con acceso limitado a mi buzón de correo.\nResponderé a vuestro mensaje a mi regreso, el día 7 de octubre del 2026.\n\nI will do my best to respond promptly to your email when I return on October 7, 2026.",
      "2026-10-06T19:57:00Z")?.returnDate).toBe("2026-10-07");
  });
  it("Sensata: del 24 al 27 de septiembre, regresa el 28", () => {
    expect(d("Automatic reply: Mara, qué incluye y qué no",
      "Thank you for your message. I will be out of the office on vacation from September 24 through September 27 with limited access to email. I will return and respond to your message on September 28.",
      "2026-09-28T17:06:00Z")?.returnDate).toBe("2026-09-28");
  });
  it("Pennsylvania: regreso a la oficina el lunes 5 (sin mes)", () => {
    expect(d("Respuesta automática: Hayde, sé que estás ocupado", "Estaré fuera de la oficina, con acceso a mi correo limitado, regreso a la oficina el lunes 5",
      "2026-09-23T22:17:00Z")?.returnDate).toBe("2026-10-05");
  });
  it("Innovia: fuera de la oficina sin fecha", () => {
    expect(d("Automatic reply: Juan, sobre tu instalación eléctrica.",
      "Gracias por tu correo, por el momento estoy fuera de la oficina con acceso limitado al correo, en caso de asuntos urgentes por favor comunícate a mi celular.",
      "2026-09-23T22:14:00Z")).toEqual({ kind: "OOO", returnDate: null, referrals: [] });
  });
  it("Novares: ya no trabajo con la empresa, con dos referidos", () => {
    expect(d("Automatic reply: Francisco, sobre tu instalación eléctrica.",
      "Ya no trabajo con la empresa. Por favor, envíe todos los correos electrónicos a OCAMACHO@novaresteam.com o SMARTINEZ@novaresteam.com. Muchas gracias.",
      "2026-09-23T22:14:00Z", auto, "fvaltierra@novaresteam.com")).toEqual({ kind: "GONE", returnDate: null, referrals: ["ocamacho@novaresteam.com", "smartinez@novaresteam.com"] });
  });
  it("Ampacet y Mubea: cuenta deshabilitada", () => {
    expect(d("Automatic reply: EXTERNAL: Sergio, sobre tu instalación eléctrica.",
      "Esta cuenta se encuentra actualmente deshabilitada, para cualquier duda o consulta, favor comuníquese con Fernando Domingues al siguiente correo electrónico: fernando.domingues@ampacet.com",
      "2026-09-23T22:16:00Z", auto, "sergio.bojalil@ampacet.com")?.kind).toBe("GONE");
    expect(d("Automatic reply: Ruben, pregunta rápida",
      "This email account has been disabled and is no longer available. For any inquiries or follow-up, please contact: Pedro Antonio López PedroAntonio.Lopez@mubea.com",
      "2026-10-06T19:27:00Z", auto, "ruben.acevedo@mubea.com")).toMatchObject({ kind: "GONE", referrals: ["pedroantonio.lopez@mubea.com"] });
  });
  it("reconoce el asunto aunque falte el encabezado", () => {
    expect(d("Automatic reply: Ana, pregunta rápida", "Thank you for your email.", "2026-10-06T15:00:00Z", [])?.kind).toBe("OOO");
  });
});

describe("respuestas de personas que NO son automáticas", () => {
  it.each([
    "Hola Francisco, buenas tardes, ¿podemos hablar sobre esto mañana miércoles a las 18:00?\n\nSaludos",
    "Sí, por favor, gracias.",
    "Gracias por tu información, pero ahorita no lo necesitamos",
    "Después de vacaciones lo vemos, mándame la propuesta",
    "Estaré fuera la próxima semana pero me interesa, agendemos para el 20",
    "Estoy fuera de la oficina hasta el lunes, ¿me mandas la información?",
  ])("%s", (body) => {
    expect(d("RE: Juan, pregunta rápida", body, "2026-10-06T15:00:00Z", [])).toBeNull();
  });
});

describe("fecha de regreso", () => {
  it("formato numérico y año siguiente", () => {
    expect(parseReturnDate("Regreso el 12/10/2026", at("2026-10-06T00:00:00Z"))).toBe("2026-10-12");
    expect(parseReturnDate("regreso el 7 de enero", at("2026-12-20T00:00:00Z"))).toBe("2027-01-07");
  });
  it("ignora horas y teléfonos", () => {
    expect(parseReturnDate("llámame al 442 467 9790 a las 18:00", at("2026-10-06T00:00:00Z"))).toBeNull();
  });
});
