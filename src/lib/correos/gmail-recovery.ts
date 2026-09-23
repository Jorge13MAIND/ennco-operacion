/**
 * Bounded read-only recovery. Not a cursor reset and not a sending route.
 * Apply/reconcile candidates idempotently, then replay history from historyFence.
 * Only after BOTH succeed may the caller persist a new sync cursor.
 * Bodies remain in memory. Never log this result or provider response bodies.
 */
import { z } from 'zod';

const id = z.string().min(1).max(512);
const profileSchema = z.object({
  emailAddress: z.string().email(), historyId: z.string().regex(/^[0-9]+$/),
});
const listSchema = z.object({
  messages: z.array(z.object({ id, threadId: id })).optional(),
  nextPageToken: z.string().min(1).max(4096).optional(),
});
const messageSchema = z.object({
  id, threadId: id, internalDate: z.string().regex(/^[0-9]+$/),
  labelIds: z.array(z.string()).optional(),
  payload: z.object({}).passthrough(),
}).passthrough();

export type RecoveryMessage = z.infer<typeof messageSchema>;
export type RecoveryTransport = {
  getProfile(): Promise<{ status: number; body: unknown }>;
  listMessages(query: string, pageToken?: string): Promise<{ status: number; body: unknown }>;
  getMessage(id: string): Promise<{ status: number; body: unknown }>;
};

function fail(code: string): never { throw new Error('GMAIL_RECOVERY_' + code); }
function parse<T>(schema: z.ZodType<T>, response: { status: number; body: unknown }): T {
  // Do not include provider response text, URLs, credentials or PII in errors.
  if (response.status !== 200) fail('HTTP_' + response.status);
  const parsed = schema.safeParse(response.body);
  if (!parsed.success) fail('RESPONSE_SHAPE');
  return parsed.data;
}

export async function collectGmailRecovery(input: {
  tenantId: string; mailboxId: string; expectedEmail: string;
  fromEpochMs: number;
  transport: RecoveryTransport;
  maxPages?: number; maxMessages?: number; maxDurationMs?: number;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const maxPages = input.maxPages ?? 20;
  const maxMessages = input.maxMessages ?? 1000;
  const maxDurationMs = input.maxDurationMs ?? 120000;
  const from = input.fromEpochMs;
  if (!input.tenantId.trim() || !input.mailboxId.trim()
    || !z.string().email().safeParse(input.expectedEmail).success
    || !Number.isSafeInteger(from)
    || from < 0 || from >= startedAt
    || startedAt - from > 31 * 86400000
    || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20
    || !Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > 1000
    || !Number.isInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > 120000) {
    fail('INPUT_INVALID');
  }
  const withinDeadline = () => { if (now() - startedAt >= maxDurationMs) fail('TIME_LIMIT'); };
  const request = async <T>(work: () => Promise<T>): Promise<T> => {
    withinDeadline();
    let result: T;
    try { result = await work(); } catch { return fail('TRANSPORT'); }
    withinDeadline();
    return result;
  };
  // Fence BEFORE listing. New arrivals during pagination are recovered by history replay.
  const profile = parse(profileSchema, await request(() => input.transport.getProfile()));
  if (profile.emailAddress.toLowerCase() !== input.expectedEmail.toLowerCase()) fail('MAILBOX_MISMATCH');
  // Upper bound AFTER the profile fence, never before it. Otherwise messages
  // arriving between a caller's cutoff and this fence could be lost by both paths.
  const until = now() + 1;
  if (!Number.isSafeInteger(until) || until <= startedAt) fail('CLOCK_REGRESSION');
  const query = 'after:' + (Math.floor(from / 1000) - 1) + ' before:' + Math.ceil(until / 1000);
  const ids = new Set<string>();
  const pageTokens = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = parse(listSchema, await request(() => input.transport.listMessages(query, pageToken)));
    for (const message of result.messages ?? []) {
      ids.add(message.id);
      if (ids.size > maxMessages) fail('MESSAGE_LIMIT');
    }
    pageToken = result.nextPageToken;
    if (!pageToken) break;
    if (pageTokens.has(pageToken)) fail('PAGINATION_CYCLE');
    pageTokens.add(pageToken);
    if (page === maxPages - 1) fail('PAGE_LIMIT');
  }
  const messages: RecoveryMessage[] = [];
  let excluded = 0;
  for (const messageId of ids) {
    // A disappearance (404) is NOT silently ignored. Reconcile the deletion first.
    const message = parse(messageSchema, await request(() => input.transport.getMessage(messageId)));
    if (message.id !== messageId) fail('MESSAGE_MISMATCH');
    const timestamp = Number(message.internalDate);
    if (!Number.isSafeInteger(timestamp)) fail('RESPONSE_SHAPE');
    if (timestamp < from || timestamp >= until
      || (message.labelIds ?? []).some(label => label === 'SENT' || label === 'DRAFT')) {
      excluded++;
      continue;
    }
    messages.push(message);
  }
  return {
    state: 'COLLECTED_NOT_APPLIED' as const,
    tenantId: input.tenantId, mailboxId: input.mailboxId,
    fromEpochMs: from, untilEpochMs: until,
    historyFence: profile.historyId,
    requiresReconciliation: true as const, requiresHistoryReplay: true as const,
    listedCount: ids.size, excludedCount: excluded, messages,
  };
}

/** GET only, fixed Google host, full MIME for DSNs; no scope creation or token logging. */
export function gmailRecoveryTransport(accessToken: string): RecoveryTransport {
  if (!accessToken.trim()) fail('TOKEN_MISSING');
  const get = async (path: string) => {
    try {
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + path, {
        method: 'GET',
        headers: { authorization: 'Bearer ' + accessToken, accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      return { status: response.status, body: await response.json().catch(() => null) as unknown };
    } catch { return fail('TRANSPORT'); }
  };
  return {
    getProfile: () => get('profile'),
    listMessages: (query, pageToken) => {
      const params = new URLSearchParams({ q: query, includeSpamTrash: 'true', maxResults: '100' });
      if (pageToken) params.set('pageToken', pageToken);
      return get('messages?' + params.toString());
    },
    getMessage: messageId => get('messages/' + encodeURIComponent(messageId) + '?format=full'),
  };
}
