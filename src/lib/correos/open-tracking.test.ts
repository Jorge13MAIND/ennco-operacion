import { describe, expect, it } from "vitest";

import { buildDirectLaneRawMessage, textToMinimalHtml } from "@/lib/correos/gmail-send";
import { buildOpenPixelUrl, createOpenPixelToken, openPixelAllowed, verifyOpenPixelToken } from "@/lib/correos/open-pixel";
import { buildWeeklyRecommendations, directLaneStatsSchema, weekStartCdmx } from "@/lib/correos/stats";

const secret = "dispatch-secret-synthetic-at-least-32-chars";
const org = "41000000-0000-4000-8000-000000000001";
const msg = "41000000-0000-4000-8000-000000000777";

describe("pixel de apertura", () => {
  it("firma y verifica el token; rechaza firmas ajenas", () => {
    const token = createOpenPixelToken({ organizationId: org, messageId: msg, secret });
    expect(verifyOpenPixelToken({ token, organizationId: org, secret })).toBe(msg);
    expect(verifyOpenPixelToken({ token, organizationId: org, secret: "otro-secreto-sintetico-de-32-caracteres!" })).toBeNull();
    expect(verifyOpenPixelToken({ token: `${msg}.abc`, organizationId: org, secret })).toBeNull();
    expect(buildOpenPixelUrl("https://ennco-operacion.vercel.app", token)).toBe(`https://ennco-operacion.vercel.app/api/v1/public/correos/o/${token}.gif`);
  });
  it("respeta la politica: desde el toque 2 por defecto", () => {
    expect(openPixelAllowed("from_touch_2", 1)).toBe(false);
    expect(openPixelAllowed("from_touch_2", 2)).toBe(true);
    expect(openPixelAllowed("all", 1)).toBe(true);
    expect(openPixelAllowed("off", 5)).toBe(false);
    expect(openPixelAllowed("all", null)).toBe(false);
  });
  it("sin pixel el correo sigue siendo texto plano; con pixel es multipart con la misma prosa", () => {
    const base = { message_id: msg, from_name: "Francisco Cuellar", from_email: "francisco@enncoenergia.com", to_email: "x@planta.test",
      subject: "Hola", body_text: "Hola Juan,\n\nSoy Francisco.\n\nSaludos", kind: "TOUCH" as const, touch_number: 2,
      thread: { provider_thread_id: "t1", in_reply_to: "<a@b.c>", references: [] } };
    const plain = buildDirectLaneRawMessage(base);
    expect(plain.raw).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(plain.raw).not.toContain("multipart");
    const withPixel = buildDirectLaneRawMessage({ ...base, open_pixel_url: "https://ennco-operacion.vercel.app/api/v1/public/correos/o/x.gif" });
    expect(withPixel.raw).toContain("multipart/alternative");
    expect(withPixel.raw).toContain("text/plain");
    expect(withPixel.raw).toContain("text/html");
    expect(textToMinimalHtml("Hola Juan,\n\nSoy Francisco.\nSegunda línea")).toBe("<p>Hola Juan,</p><p>Soy Francisco.<br>Segunda línea</p>");
  });
});

describe("ciclo de mejora", () => {
  const stats = (over: Partial<Record<string, number>> = {}, by: Record<string, unknown> = {}) => directLaneStatsSchema.parse({
    since: "2026-09-07T06:00:00Z", until: "2026-09-11T20:00:00Z",
    funnel: { enrolled: 60, reached: 50, sends: 80, failed: 0, bounced_enrollments: 0, replied: 3, positive: 1, unsubscribed: 0, tracked: 30, opened: 9, leads: 0, ...over },
    by,
  });
  it("calcula la semana (lunes CDMX) y produce recomendaciones con denominadores", () => {
    expect(weekStartCdmx(new Date("2026-09-11T20:00:00Z"))).toBe("2026-09-07");
    expect(weekStartCdmx(new Date("2026-09-14T04:00:00Z"))).toBe("2026-09-07"); // domingo 22:00 CDMX sigue siendo la semana del 7
    const lines = buildWeeklyRecommendations(stats(), stats({ reached: 40, replied: 1 }));
    expect(lines.join(" ")).toContain("6.0%");
    expect(lines.join(" ")).toContain("Apertura direccional: 9 de 30");
    expect(lines.join(" ")).toContain("rampa puede continuar");
  });
  it("frena cuando los fallos pasan de 2% y no declara ganadora sin muestra", () => {
    const lines = buildWeeklyRecommendations(stats({ failed: 5 }, { variant: [{ key: "DIRECCION", sends: 5, reached: 5, failed: 0, tracked: 0, opened: 0, replied: 1 }] }), null);
    expect(lines.join(" ")).toContain("FRENO");
    expect(lines.join(" ")).toContain("no se declara ganadora");
  });
});
