import { describe, expect, it } from "vitest";

import { classifyReply, INTENT_LABELS } from "@/lib/inteligencia/clasificador";

/* "No me interesa" tiene guion propio desde el plan del 21-sep: se valida el desinterés, se deja
   una razón por la que importa y se cierra con la puerta abierta. Lo que estas pruebas cuidan es
   que no se confunda con "ahora no" (que sí se reactiva) ni con una baja (que es obligación legal). */

describe("desinterés", () => {
  it("reconoce las formas en que la gente dice que no le interesa", () => {
    for (const body of ["No me interesa, gracias.", "No estamos interesados por ahora.", "Gracias, pero no."]) {
      const s = classifyReply({ subject: "Re: sobre tu instalación", body });
      expect(s.intent, body).toBe("NOT_INTERESTED");
      expect(s.classification, body).toBe("NEGATIVE");
    }
  });

  it("'ya tenemos proveedor' va a su propia plantilla, que responde mejor que el desinterés", () => {
    const s = classifyReply({ subject: null, body: "Ya tenemos proveedor para eso." });
    expect(s.intent).toBe("CHEAPER_VENDOR");
  });

  it("un rechazo expreso que llega junto a una señal positiva se lee como desinterés, no como 'ahora no'", () => {
    const s = classifyReply({ subject: null, body: "Mándame información, pero la verdad no nos interesa." });
    expect(s.intent).toBe("NOT_INTERESTED");
    expect(s.classification).toBe("NEGATIVE");
  });

  it("no se confunde con 'ahora no', que es neutral y se retoma", () => {
    const s = classifyReply({ subject: null, body: "Ahorita no, retomamos en enero." });
    expect(s.intent).toBe("NOT_NOW");
    expect(s.classification).toBe("NEUTRAL");
  });

  it("la baja gana sobre el desinterés: es obligación legal, no una objeción comercial", () => {
    const s = classifyReply({ subject: null, body: "No me interesa. Baja de la lista, por favor." });
    expect(s.intent).toBe("UNSUBSCRIBE");
  });

  it("tiene etiqueta para el operador", () => {
    expect(INTENT_LABELS.NOT_INTERESTED).toBe("No me interesa");
  });
});
