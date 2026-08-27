import { describe, expect, it } from "vitest";

import { evaluateDispatchWatchdog, formatDailySnapshot, isInsideSendWindow } from "@/lib/dispatch/watchdog";

const insideWindow = new Date("2026-08-26T16:30:00Z");
const outsideWindow = new Date("2026-08-26T02:00:00Z");
const weekend = new Date("2026-08-29T16:30:00Z");

describe("dispatch watchdog", () => {
  it("knows the CDMX send window", () => {
    expect(isInsideSendWindow(insideWindow)).toBe(true);
    expect(isInsideSendWindow(outsideWindow)).toBe(false);
    expect(isInsideSendWindow(weekend)).toBe(false);
  });

  it("flags a dead cron only inside the window", () => {
    const health = { last_tick: null };
    expect(evaluateDispatchWatchdog({ health, now: insideWindow, dispatchMode: "shadow" }))
      .toContainEqual(expect.objectContaining({ level: "CRITICAL", title: "el cron no está corriendo" }));
    expect(evaluateDispatchWatchdog({ health, now: outsideWindow, dispatchMode: "shadow" })).toEqual([]);
  });

  it("flags zero sends with free budget past half window in live mode", () => {
    const health = {
      last_tick: { created_at: insideWindow.toISOString() },
      active_release: { daily_cap: 5, sent_today: 0, budget_remaining: 5 },
    };
    const late = new Date("2026-08-26T18:00:00Z");
    expect(evaluateDispatchWatchdog({ health, now: late, dispatchMode: "live" }))
      .toContainEqual(expect.objectContaining({ title: "0 enviados con budget libre" }));
    expect(evaluateDispatchWatchdog({ health, now: late, dispatchMode: "shadow" })
      .filter((finding) => finding.title === "0 enviados con budget libre")).toEqual([]);
  });

  it("warns on stale live observation and overdue outbox", () => {
    const health = {
      last_tick: { created_at: outsideWindow.toISOString() },
      latest_live_observation: { age_seconds: 21 * 3600 },
      outbox: { pending: 3, due: 2, processing: 0 },
    };
    const findings = evaluateDispatchWatchdog({ health, now: outsideWindow, dispatchMode: "live" });
    expect(findings).toContainEqual(expect.objectContaining({ title: "observación live por caducar" }));
    expect(findings).toContainEqual(expect.objectContaining({ title: "outbox con eventos vencidos" }));
  });

  it("grita cuando el calendario hábil se está agotando, y solo entonces", () => {
    const conCalendario = (dias: number | undefined) => evaluateDispatchWatchdog({
      health: { last_tick: { created_at: insideWindow.toISOString() }, business_calendar: { future_business_days: dias } },
      now: insideWindow,
      dispatchMode: "shadow",
    });

    expect(conCalendario(344)).toEqual([]);
    expect(conCalendario(89)).toContainEqual(
      expect.objectContaining({ level: "WARN", title: "calendario hábil por agotarse" }),
    );
    expect(conCalendario(19)).toContainEqual(
      expect.objectContaining({ level: "CRITICAL", title: "calendario hábil agotado" }),
    );
    // Cero es el estado exacto que se encontró en produccion el 27-ago-2026.
    expect(conCalendario(0)).toContainEqual(
      expect.objectContaining({ level: "CRITICAL", title: "calendario hábil agotado" }),
    );
    // Si la salud no trae el dato no se inventa una alarma.
    expect(conCalendario(undefined)).toEqual([]);
  });

  it("formats the daily snapshot with release and outbox facts", () => {
    const lines = formatDailySnapshot({
      health: {
        active_release: { daily_cap: 5, sent_today: 2, budget_remaining: 3 },
        outbox: { pending: 1, due: 0, processing: 0 },
      },
      dispatchMode: "live",
      moment: "CLOSE",
    });
    expect(lines.join("\n")).toContain("2/5 enviados");
    expect(lines.join("\n")).toContain("outbox: 1 pendientes");
  });
});
