import { test } from 'vitest';
import assert from 'node:assert/strict';
import { collectGmailRecovery, gmailRecoveryTransport, type RecoveryTransport } from './gmail-recovery.js';

const NOW = Date.parse('2026-09-19T22:00:00Z');
const FROM = NOW - 86400000;
const ok = (body: unknown) => ({ status: 200, body });
const message = (id = 'm1', labels = ['INBOX'], at = FROM + 1000) => ({
  id, threadId: 'thread-' + id, internalDate: String(at), labelIds: labels,
  payload: { headers: [{ name: 'Auto-Submitted', value: 'auto-replied' }] },
});
const transport = (overrides: Partial<RecoveryTransport> = {}): RecoveryTransport => ({
  getProfile: async () => ok({ emailAddress: 'sender@example.test', historyId: '900' }),
  listMessages: async () => ok({ messages: [{ id: 'm1', threadId: 'thread-m1' }] }),
  getMessage: async id => ok(message(id)),
  ...overrides,
});
const input = (t = transport()) => ({
  tenantId: 'tenant-a', mailboxId: 'mailbox-a', expectedEmail: 'sender@example.test',
  fromEpochMs: FROM, now: () => NOW, transport: t,
});

test('recovers duplicates once; preserves fence before list, never claims cursor reset', async () => {
  const calls: string[] = [];
  const r = await collectGmailRecovery(input(transport({
    getProfile: async () => { calls.push('profile'); return ok({ emailAddress: 'sender@example.test', historyId: '900' }); },
    listMessages: async (q, token) => {
      calls.push('list');
      assert.equal(q.includes('in:inbox'), false);
      return ok({ messages: [{ id: 'm1', threadId: 'thread-m1' }], ...(token ? {} : { nextPageToken: 'page2' }) });
    },
    getMessage: async id => { calls.push(id); return ok(message(id)); },
  })));
  assert.deepEqual(calls, ['profile', 'list', 'list', 'm1']);
  assert.equal(r.messages.length, 1);
  assert.equal(r.historyFence, '900');
  assert.equal(r.state, 'COLLECTED_NOT_APPLIED');
  assert.equal(r.requiresHistoryReplay, true);
  assert.equal(r.requiresReconciliation, true);
  assert.equal('newCursor' in r, false);
});

test('includes archive/spam/trash; excludes sent, drafts and out-of-window', async () => {
  const all = [message('archive', []), message('spam', ['SPAM']), message('trash', ['TRASH']),
    message('sent', ['SENT']), message('draft', ['DRAFT']), message('old', [], FROM - 1),
    message('future', [], NOW + 1)];
  const r = await collectGmailRecovery(input(transport({
    listMessages: async () => ok({ messages: all.map(m => ({ id: m.id, threadId: m.threadId })) }),
    getMessage: async id => ok(all.find(m => m.id === id)),
  })));
  assert.deepEqual(r.messages.map(m => m.id), ['archive', 'spam', 'trash']);
  assert.equal(r.excludedCount, 4);
});

test('wrong authenticated mailbox fails before list', async () => {
  let listed = false;
  await assert.rejects(collectGmailRecovery(input(transport({
    getProfile: async () => ok({ emailAddress: 'different@example.test', historyId: '999' }),
    listMessages: async () => { listed = true; return ok({}); },
  }))), /MAILBOX_MISMATCH/);
  assert.equal(listed, false);
});

test('empty interval is collected, not proof of reconciled history', async () => {
  const r = await collectGmailRecovery(input(transport({ listMessages: async () => ok({}) })));
  assert.equal(r.messages.length, 0);
  assert.equal(r.requiresReconciliation, true);
});

for (const status of [401, 403, 404, 429, 500]) {
  test('HTTP ' + status + ' fails closed without retry or response disclosure', async () => {
    let attempts = 0;
    await assert.rejects(collectGmailRecovery(input(transport({
      getMessage: async () => { attempts++; return { status, body: { secret: 'do-not-disclose' } }; },
    }))), error => error instanceof Error && error.message === 'GMAIL_RECOVERY_HTTP_' + status);
    assert.equal(attempts, 1);
  });
}

test('wrong message id and malformed date fail closed', async () => {
  await assert.rejects(collectGmailRecovery(input(transport({
    getMessage: async () => ok(message('other')),
  }))), /MESSAGE_MISMATCH/);
  await assert.rejects(collectGmailRecovery(input(transport({
    getMessage: async () => ok({ ...message(), internalDate: 'not-a-date' }),
  }))), /RESPONSE_SHAPE/);
});

test('partial pagination and repeated page tokens never return a recovery result', async () => {
  const t = transport({ listMessages: async () => ok({ nextPageToken: 'same' }) });
  await assert.rejects(collectGmailRecovery({ ...input(t), maxPages: 1 }), /PAGE_LIMIT/);
  await assert.rejects(collectGmailRecovery(input(t)), /PAGINATION_CYCLE/);
});

test('message limit prevents fetching a partial recovery batch', async () => {
  await assert.rejects(collectGmailRecovery({
    ...input(transport({ listMessages: async () => ok({ messages: [
      { id: 'm1', threadId: 't1' }, { id: 'm2', threadId: 't2' },
    ] }) })), maxMessages: 1,
  }), /MESSAGE_LIMIT/);
});

test('rejects unlimited, future, invalid and overly long windows', async () => {
  for (const change of [{ fromEpochMs: NOW + 1 }, { fromEpochMs: FROM + 0.5 },
    { fromEpochMs: NOW - 32 * 86400000 }, { maxPages: 0 }, { maxMessages: 1001 },
    { tenantId: '' }, { expectedEmail: 'invalid' }, { maxDurationMs: 0 }]) {
    await assert.rejects(collectGmailRecovery({ ...input(), ...change }), /INPUT_INVALID/);
  }
});

test('arrivals between start and profile fence remain in the bounded scan', async () => {
  let time = NOW;
  const r = await collectGmailRecovery({
    ...input(transport({
      getProfile: async () => {
        time += 5000;
        return ok({ emailAddress: 'sender@example.test', historyId: '905' });
      },
      getMessage: async () => ok(message('m1', ['INBOX'], NOW + 2000)),
    })), now: () => time,
  });
  assert.equal(r.messages.length, 1);
  assert.equal(r.untilEpochMs, NOW + 5001);
  assert.equal(r.historyFence, '905');
});

test('deadline exhaustion and transport error redact details', async () => {
  let time = NOW;
  await assert.rejects(collectGmailRecovery({
    ...input(transport({ getProfile: async () => {
      time += 120000; return ok({ emailAddress: 'sender@example.test', historyId: '900' });
    } })), now: () => time,
  }), /TIME_LIMIT/);
  await assert.rejects(collectGmailRecovery(input(transport({
    getProfile: async () => { throw new Error('secret-token-and-email'); },
  }))), error => error instanceof Error && error.message === 'GMAIL_RECOVERY_TRANSPORT');
});

test('real transport uses only GET, fixed host, all folders and full message MIME', async () => {
  const original = globalThis.fetch;
  const requests: Array<{ url: URL; method: string | undefined }> = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: new URL(String(url)), method: init?.method });
    return new Response('{}', { status: 200 });
  };
  try {
    const t = gmailRecoveryTransport('synthetic-token');
    await t.getProfile();
    await t.listMessages('after:100 before:200', 'page-token');
    await t.getMessage('message/id');
    assert.equal(requests.length, 3);
    assert.equal(requests.every(r => r.method === 'GET' && r.url.host === 'gmail.googleapis.com'), true);
    assert.equal(requests[1]!.url.searchParams.get('includeSpamTrash'), 'true');
    assert.equal(requests[1]!.url.searchParams.has('labelIds'), false);
    assert.equal(requests[1]!.url.searchParams.get('pageToken'), 'page-token');
    assert.equal(requests[2]!.url.searchParams.get('format'), 'full');
    assert.equal(requests[2]!.url.pathname.endsWith('/message%2Fid'), true);
  } finally { globalThis.fetch = original; }
});
