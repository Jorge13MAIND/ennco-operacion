/** Read-only Gmail recovery. Private evidence only. Does not move a cursor or send. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { createDispatchProof } from "../src/lib/dispatch/proof.ts";
import { openDirectLaneSecret } from "../src/lib/correos/vault.ts";
import { getGmailAccessToken } from "../src/lib/dispatch/gmail-token.ts";
import { collectGmailRecovery, gmailRecoveryTransport } from "../src/lib/correos/gmail-recovery.ts";

const [envFile, evidenceDirectory, since = "2026-09-08T00:00:00-06:00"] = process.argv.slice(2);
if (!envFile || !evidenceDirectory) throw new Error("Usage: <private env file> <private evidence directory> [since ISO]");
const env = parseEnv(await readFile(envFile, "utf8"));
const organizationId = env.NEXT_PUBLIC_ENNCO_ORGANIZATION_ID;
if (!env.GOOGLE_OAUTH_CLIENT_ID) throw new Error("OAUTH_CLIENT_ID_NOT_EXPORTED_USE_SERVER_RECOVERY");
if (organizationId !== "e0000000-0000-4000-8000-000000000001") throw new Error("TENANT_MISMATCH");
const out = resolve(evidenceDirectory);
await mkdir(out, { recursive: true, mode: 0o700 });
async function rpc(name: string, payloadParts: string[], args: Record<string, unknown> = {}) {
  const proof = createDispatchProof({ organizationId, commandName: name, payloadParts, secret: env.ENNCO_DISPATCH_SECRET });
  const response = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/rpc/" + name, {
    method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ target_organization_id: organizationId, ...args, ...proof }), signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("RPC_FAILED_" + name + "_" + response.status);
  return await response.json();
}
const health = await rpc("read_direct_lane_health", [organizationId]);
const summaries = await Promise.all(health.mailboxes.map(async (mailbox: { mailbox_id: string; normalized_email: string }) => {
  try {
    const credential = await rpc("read_direct_lane_credential", [organizationId, mailbox.mailbox_id], { target_mailbox_id: mailbox.mailbox_id });
    if (credential.normalized_email !== mailbox.normalized_email) throw new Error("CREDENTIAL_IDENTITY_MISMATCH");
    const refreshToken = openDirectLaneSecret({ ciphertext: credential.ciphertext, keyId: credential.key_id }, env.ENNCO_DIRECT_LANE_VAULT_KEY);
    const accessToken = await getGmailAccessToken({ refreshToken, credentialSha256: credential.credential_sha256, clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET, fetchImpl: async (url, init) => {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        const error = await response.clone().json().catch(() => ({}));
        const code = ["invalid_grant", "invalid_client", "unauthorized_client", "invalid_request"].includes(error.error) ? error.error : "unclassified";
        console.log(JSON.stringify({ mailboxId: mailbox.mailbox_id, oauthStatus: response.status, code }));
      }
      return response;
    } });
    const result = await collectGmailRecovery({ tenantId: organizationId, mailboxId: mailbox.mailbox_id,
      expectedEmail: mailbox.normalized_email, fromEpochMs: Date.parse(since), transport: gmailRecoveryTransport(accessToken) });
    await writeFile(resolve(out, mailbox.mailbox_id + ".json"), JSON.stringify(result), { mode: 0o600 });
    return { mailboxId: mailbox.mailbox_id, state: result.state, listed: result.listedCount, inbound: result.messages.length, from: since, until: new Date(result.untilEpochMs).toISOString(), historyFence: result.historyFence };
  } catch (error) {
    return { mailboxId: mailbox.mailbox_id, state: "FAILED", code: error instanceof Error ? error.message : "UNKNOWN" };
  }
}));
await writeFile(resolve(out, "summary.json"), JSON.stringify(summaries, null, 2), { mode: 0o600 });
console.log(JSON.stringify(summaries, null, 2));
if (summaries.some(item => item.state === "FAILED")) process.exitCode = 1;
