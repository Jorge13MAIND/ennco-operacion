import { describe, expect, it } from "vitest";

import { extractReplyText, stripQuotedReply } from "@/lib/gmail/body";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

describe("texto de una respuesta", () => {
  it("toma la parte de texto plano de un multipart y corta la cita de Gmail en español", () => {
    const message = { payload: { mimeType: "multipart/alternative", parts: [
      { mimeType: "text/plain", body: { data: b64("Gracias, pero no nos interesa por ahora.\n\nEl lun, 21 sept 2026 a las 11:10, Francisco Cuellar <contacto@ennco.com.mx> escribió:\n> Hola Armando,\n> Tal vez mi correo anterior…") } },
      { mimeType: "text/html", body: { data: b64("<p>Gracias, pero no nos interesa por ahora.</p>") } },
    ] } };
    expect(extractReplyText(message)).toBe("Gracias, pero no nos interesa por ahora.");
  });

  it("corta el bloque de Outlook que empieza con De:", () => {
    expect(stripQuotedReply("No gracias.\n\nDe: Francisco Cuellar <contacto@ennco.com.mx>\nEnviado: lunes\nAsunto: …")).toBe("No gracias.");
  });

  it("corta la cita en inglés y quita líneas con >", () => {
    expect(stripQuotedReply("Not interested.\n> quoted\nOn Mon, Sep 21, 2026 at 11:10 AM Francisco wrote:\n> more")).toBe("Not interested.");
  });

  it("si solo hay HTML, lo pasa a texto", () => {
    const message = { payload: { mimeType: "text/html", body: { data: b64("<div>Sí, llámame el jueves.<br>Saludos</div>") } } };
    expect(extractReplyText(message)).toBe("Sí, llámame el jueves.\nSaludos");
  });

  it("sin cuerpo legible devuelve null en vez de cadena vacía", () => {
    expect(extractReplyText({ payload: { mimeType: "multipart/mixed", parts: [] } })).toBeNull();
    expect(extractReplyText(null)).toBeNull();
  });
});
