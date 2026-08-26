import type { RuntimeConfig } from "@/lib/runtime/config";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type DispatchAlertLevel = "INFO" | "WARN" | "CRITICAL";

const levelBadge: Record<DispatchAlertLevel, string> = {
  INFO: "🟢",
  WARN: "🟡",
  CRITICAL: "🔴",
};

/**
 * Notificador operativo del motor de despacho. Nunca lanza: una alerta caída
 * no debe tumbar un tick (el watchdog detecta el silencio por otra vía).
 * Devuelve false cuando no está configurado o el envío falla.
 */
export async function sendDispatchAlert(input: {
  config: Pick<RuntimeConfig, "telegramBotToken" | "telegramChatId">;
  level: DispatchAlertLevel;
  title: string;
  lines?: readonly string[];
  fetchImpl?: FetchLike;
}): Promise<boolean> {
  const { telegramBotToken, telegramChatId } = input.config;
  if (!telegramBotToken || !telegramChatId) return false;
  const fetchImpl = input.fetchImpl ?? fetch;
  const text = [
    `${levelBadge[input.level]} ENNCO despacho · ${input.title}`,
    ...(input.lines ?? []),
  ].join("\n").slice(0, 4000);
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramChatId, text, disable_web_page_preview: true }),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
