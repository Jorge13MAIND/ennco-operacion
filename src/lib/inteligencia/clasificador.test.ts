import { describe, expect, it } from "vitest";

import { CLASSIFIER_VERSION, classifyReply } from "./clasificador";

const reply = (body: string, subject = "Re: Lo que le costó un apagón a un cliente") =>
  classifyReply({ subject, body });

describe("clasificador asistido de respuestas", () => {
  it("la baja gana sobre cualquier otra señal, aunque el correo suene positivo", () => {
    const result = reply("Me interesa mucho el tema pero por favor dame de baja de esta lista.");

    expect(result.intent).toBe("UNSUBSCRIBE");
    expect(result.classification).toBe("NEGATIVE");
    expect(result.needs_human_now).toBe(true);
  });

  it("detecta el referido, que es el resultado bueno del CTA de dirección", () => {
    const result = reply("Gracias por escribir. Habla con Luis Ortega, él lleva mantenimiento.");

    expect(result.intent).toBe("REFERRAL");
    expect(result.classification).toBe("POSITIVE");
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it("detecta compromiso comercial cuando piden agendar", () => {
    const result = reply("Sí, agendemos una llamada la próxima semana para verlo.");

    expect(result.intent).toBe("COMMERCIAL_COMMITMENT");
    expect(result.classification).toBe("POSITIVE");
  });

  it("detecta interés expreso pidiendo el entregable del toque 4", () => {
    const result = reply("Sí me interesa, ¿me mandas el formato del reporte?");

    expect(result.classification).toBe("POSITIVE");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("un rechazo explícito cancela la lectura positiva", () => {
    const result = reply("Mándame información pero la verdad no nos interesa el servicio.");

    expect(result.classification).toBe("NEGATIVE");
    expect(result.signals.some((s) => s.includes("contradicha"))).toBe(true);
  });

  it("separa objeción de precio de proveedor más barato", () => {
    expect(reply("¿Cuánto cuesta el servicio?").intent).toBe("PRICE_OBJECTION");
    expect(reply("Ya trabajamos con otro proveedor de mantenimiento.").intent).toBe("CHEAPER_VENDOR");
  });

  it("reconoce alineación interna y aplazamiento como neutrales", () => {
    expect(reply("Lo veo internamente con el equipo y te digo.").classification).toBe("NEUTRAL");
    expect(reply("Por el momento no, retomamos en el próximo trimestre.").classification).toBe("NEUTRAL");
  });

  it("marca las respuestas automáticas para que no disparen SLA", () => {
    const result = reply("Estoy fuera de la oficina hasta el 15 de septiembre.");

    expect(result.needs_human_now).toBe(false);
    expect(result.signals[0]).toContain("automática");
  });

  it("ante texto desconocido baja la confianza en vez de inventar una lectura", () => {
    const result = reply("Recibido.");

    expect(result.confidence).toBeLessThan(0.5);
    expect(result.classification).toBe("NEUTRAL");
  });

  it("tolera respuestas vacías sin romperse", () => {
    const result = classifyReply({ subject: null, body: null });

    expect(result.confidence).toBe(0);
    expect(result.needs_human_now).toBe(false);
  });

  it("es determinista: la misma entrada produce la misma salida", () => {
    const texto = "Sí me interesa, habla con Juan de compras.";
    expect(classifyReply({ subject: null, body: texto })).toEqual(classifyReply({ subject: null, body: texto }));
  });

  it("funciona igual con y sin acentos", () => {
    const con = reply("Sí me interesa, ¿me mandas más información?");
    const sin = reply("Si me interesa, me mandas mas informacion?");

    expect(con.intent).toBe(sin.intent);
    expect(con.classification).toBe(sin.classification);
  });

  it("siempre sella la versión del clasificador para poder auditar la sugerencia", () => {
    expect(reply("lo que sea").classifier_version).toBe(CLASSIFIER_VERSION);
  });
});
