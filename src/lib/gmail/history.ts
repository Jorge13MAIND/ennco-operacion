import { z } from "zod";

const historyPageSchema = z.object({
  history: z.array(z.object({
    id: z.string().regex(/^[0-9]+$/),
    messagesAdded: z.array(z.object({
      message: z.object({ id: z.string().min(1).max(512), threadId: z.string().min(1).max(512) }).passthrough(),
    })).optional(),
  }).passthrough()).optional(),
  nextPageToken: z.string().min(1).optional(),
  historyId: z.string().regex(/^[0-9]+$/),
}).strict();

const messageSchema = z.object({
  id: z.string().min(1).max(512),
  threadId: z.string().min(1).max(512),
  labelIds: z.array(z.string()).optional(),
  payload: z.object({
    headers: z.array(z.object({ name: z.string(), value: z.string() })),
    mimeType: z.string().optional(),
  }).passthrough(),
  internalDate: z.string().regex(/^[0-9]+$/),
}).passthrough();

export type GmailMessageMetadata = z.infer<typeof messageSchema>;
export type GmailProviderEventKind = "REPLY" | "AUTO_REPLY" | "HARD_BOUNCE" | "UNKNOWN";

export class GmailHistoryResetRequiredError extends Error {
  constructor() {
    super("GMAIL_HISTORY_FULL_SYNC_REQUIRED");
    this.name = "GmailHistoryResetRequiredError";
  }
}

export type GmailHistoryTransport = {
  listHistory(startHistoryId: string, pageToken?: string): Promise<{ status: number; body: unknown }>;
  getMessage(messageId: string): Promise<{ status: number; body: unknown }>;
};

export async function collectGmailHistory(input: {
  transport: GmailHistoryTransport;
  startHistoryId: string;
  maxPages?: number;
}): Promise<{ historyId: string; messages: GmailMessageMetadata[] }> {
  const maxPages = input.maxPages ?? 20;
  const messageIds = new Set<string>();
  let pageToken: string | undefined;
  let currentHistoryId = input.startHistoryId;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const response = await input.transport.listHistory(input.startHistoryId, pageToken);
    if (response.status === 404) throw new GmailHistoryResetRequiredError();
    if (response.status !== 200) throw new Error("GMAIL_HISTORY_UNAVAILABLE");
    const page = historyPageSchema.parse(response.body);
    currentHistoryId = page.historyId;
    for (const history of page.history ?? []) {
      for (const added of history.messagesAdded ?? []) messageIds.add(added.message.id);
    }
    pageToken = page.nextPageToken;
    if (!pageToken) break;
    if (pageNumber === maxPages - 1) throw new Error("GMAIL_HISTORY_PAGE_LIMIT_EXCEEDED");
  }
  const messages: GmailMessageMetadata[] = [];
  for (const messageId of messageIds) {
    const response = await input.transport.getMessage(messageId);
    if (response.status === 404) continue;
    if (response.status !== 200) throw new Error("GMAIL_MESSAGE_UNAVAILABLE");
    messages.push(messageSchema.parse(response.body));
  }
  return { historyId: currentHistoryId, messages };
}

function headerMap(message: GmailMessageMetadata): Map<string, string> {
  return new Map(message.payload.headers.map((header) => [header.name.toLowerCase(), header.value]));
}

export function classifyGmailMessage(message: GmailMessageMetadata): GmailProviderEventKind {
  const headers = headerMap(message);
  const autoSubmitted = headers.get("auto-submitted")?.toLowerCase();
  const precedence = headers.get("precedence")?.toLowerCase();
  if ((autoSubmitted && autoSubmitted !== "no") || precedence === "auto_reply") return "AUTO_REPLY";
  if (headers.has("in-reply-to") || headers.has("references")) return "REPLY";
  return "UNKNOWN";
}
