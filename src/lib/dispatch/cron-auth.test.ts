import { describe, expect, it, vi } from "vitest";

import { authorizeCronRequest } from "@/lib/dispatch/cron-auth";
import { sendDispatchAlert } from "@/lib/dispatch/telegram";
import type { RuntimeConfig } from "@/lib/runtime/config";

const secret = "synthetic-cron-secret-at-least-32-characters";

function configWith(overrides: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    dispatchReleased: true,
    dispatchMode: "shadow",
    cronSecret: secret,
    ...overrides,
  } as RuntimeConfig;
}

function requestWith(authorization?: string): Request {
  return new Request("https://example.test/api/v1/internal/cron/dispatch", {
    headers: authorization ? { authorization } : {},
  });
}

describe("cron authorization", () => {
  it("holds without touching auth when the dispatcher is not released", () => {
    expect(authorizeCronRequest(requestWith(`Bearer ${secret}`), configWith({ dispatchReleased: false })))
      .toEqual({ status: "HOLD", reason: "DISPATCH_NOT_RELEASED" });
    expect(authorizeCronRequest(requestWith(`Bearer ${secret}`), configWith({ cronSecret: undefined })))
      .toEqual({ status: "HOLD", reason: "CRON_SECRET_NOT_CONFIGURED" });
  });

  it("authorizes only the exact bearer secret", () => {
    expect(authorizeCronRequest(requestWith(`Bearer ${secret}`), configWith({})))
      .toEqual({ status: "AUTHORIZED" });
    expect(authorizeCronRequest(requestWith(), configWith({}))).toEqual({ status: "UNAUTHORIZED" });
    expect(authorizeCronRequest(requestWith("Bearer wrong"), configWith({}))).toEqual({ status: "UNAUTHORIZED" });
    expect(authorizeCronRequest(requestWith(secret), configWith({}))).toEqual({ status: "UNAUTHORIZED" });
  });
});

describe("dispatch telegram alerts", () => {
  it("returns false without configuration and never throws on provider failure", async () => {
    expect(await sendDispatchAlert({ config: {}, level: "INFO", title: "x" })).toBe(false);
    const failing = vi.fn(async () => { throw new Error("network down"); });
    expect(await sendDispatchAlert({
      config: { telegramBotToken: "bot-token-synthetic-long", telegramChatId: "123" },
      level: "CRITICAL",
      title: "x",
      fetchImpl: failing,
    })).toBe(false);
  });

  it("posts the formatted message to the Telegram API", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain("api.telegram.org/botbot-token-synthetic-long/sendMessage");
      const body = JSON.parse(String(init?.body)) as { chat_id: string; text: string };
      expect(body.chat_id).toBe("123");
      expect(body.text).toContain("ENNCO despacho · budget agotado");
      expect(body.text).toContain("enviados hoy: 5/5");
      return new Response("{}", { status: 200 });
    });
    expect(await sendDispatchAlert({
      config: { telegramBotToken: "bot-token-synthetic-long", telegramChatId: "123" },
      level: "INFO",
      title: "budget agotado",
      lines: ["enviados hoy: 5/5"],
      fetchImpl,
    })).toBe(true);
  });
});
