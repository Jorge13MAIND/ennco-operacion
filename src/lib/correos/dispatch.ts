import { readDirectLaneCredential, claimDirectLaneDispatch, readDirectLaneHealth, settleDirectLaneDispatch, type DirectLaneClaim, type DirectLaneMailboxHealth } from "@/lib/correos/client";
import { DirectLaneGmailSender, DirectLaneSendError } from "@/lib/correos/gmail-send";
import { openDirectLaneSecret } from "@/lib/correos/vault";
import { getGmailAccessToken, GmailTokenError, invalidateGmailAccessToken } from "@/lib/dispatch/gmail-token";
import { sendDispatchAlert } from "@/lib/dispatch/telegram";
import type { RuntimeConfig } from "@/lib/runtime/config";
import { buildUnsubscribeUrl, createUnsubscribeToken } from "@/lib/unsubscribe/token";

/**
 * Tick del carril directo. Un correo por buzón conectado por tick: con el cron
 * cada 5 minutos en la ventana 09:30-13:30 CDMX eso da 48/día por buzón, más
 * que el techo de 40 que fija la rampa. El ritmo fino (4-7 min con jitter) lo
 * impone la base en claim_direct_lane_dispatch; aquí sólo se obedece.
 *
 * En modo sombra la base crea DRY_RUN y este código no toca Gmail.
 */

export type DirectLaneTickResult = {
  mode: "shadow" | "live";
  mailboxes: Array<{ mailbox_id: string; email: string; result: string; message_id?: string; detail?: string }>;
};

export function mailboxesEligibleForTick(mailboxes: DirectLaneMailboxHealth[]): DirectLaneMailboxHealth[] {
  return mailboxes.filter((mailbox) => mailbox.status === "CONNECTED" && mailbox.credential_active);
}

type TickDependencies = {
  claim?: typeof claimDirectLaneDispatch;
  settle?: typeof settleDirectLaneDispatch;
  readCredential?: typeof readDirectLaneCredential;
  readHealth?: typeof readDirectLaneHealth;
  accessToken?: typeof getGmailAccessToken;
  createSender?: (accessToken: string) => Pick<DirectLaneGmailSender, "send">;
  alert?: typeof sendDispatchAlert;
};

function unsubscribeUrlFor(config: RuntimeConfig, claim: DirectLaneClaim): string | null {
  if (!config.unsubscribeReleased || !config.unsubscribeSigningSecret || !claim.enrollment_id || !config.organizationId) return null;
  const { token } = createUnsubscribeToken({ organizationId: config.organizationId, enrollmentId: claim.enrollment_id, secret: config.unsubscribeSigningSecret });
  return buildUnsubscribeUrl(config.appUrl, token);
}

export async function runDirectLaneTick(config: RuntimeConfig, deps: TickDependencies = {}): Promise<DirectLaneTickResult> {
  const claim = deps.claim ?? claimDirectLaneDispatch;
  const settle = deps.settle ?? settleDirectLaneDispatch;
  const readCredential = deps.readCredential ?? readDirectLaneCredential;
  const readHealth = deps.readHealth ?? readDirectLaneHealth;
  const issueToken = deps.accessToken ?? getGmailAccessToken;
  const createSender = deps.createSender ?? ((accessToken: string) => new DirectLaneGmailSender({ accessToken }));
  const alert = deps.alert ?? sendDispatchAlert;
  const dryRun = config.directLaneMode !== "live";
  const result: DirectLaneTickResult = { mode: dryRun ? "shadow" : "live", mailboxes: [] };

  const health = await readHealth(config);
  for (const mailbox of mailboxesEligibleForTick(health.mailboxes)) {
    const entry: DirectLaneTickResult["mailboxes"][number] = { mailbox_id: mailbox.mailbox_id, email: mailbox.normalized_email, result: "NOOP" };
    result.mailboxes.push(entry);
    let claimed: DirectLaneClaim;
    try {
      claimed = await claim(config, mailbox.mailbox_id, dryRun);
    } catch (error) {
      entry.result = "CLAIM_FAILED";
      entry.detail = error instanceof Error ? error.message : "unknown";
      continue;
    }
    entry.result = claimed.status === "NOOP" ? `NOOP:${claimed.reason ?? "?"}` : claimed.status;
    entry.message_id = claimed.message_id;
    if (claimed.status !== "CLAIMED" || dryRun || !claimed.message_id) continue;

    const messageId = claimed.message_id;
    const fail = async (code: string) => {
      await settle(config, { messageId, outcome: "FAILED", errorCode: code }).catch(() => undefined);
      entry.result = `FAILED:${code}`;
      await alert({ config, level: "WARN", title: "carril directo: envío fallido", lines: [`buzón ${mailbox.normalized_email}`, `mensaje ${messageId}`, code] });
    };
    if (!config.directLaneVaultKey || !config.googleOauthClientId || !config.googleOauthClientSecret) {
      await fail("DIRECT_LANE_LIVE_CONFIG_INCOMPLETE");
      continue;
    }
    if (!claimed.from_email || !claimed.to_email || !claimed.subject || !claimed.body_text || !claimed.kind) {
      await fail("DIRECT_LANE_CLAIM_INCOMPLETE");
      continue;
    }

    let accessToken: string;
    let credentialSha256 = "";
    let refreshToken = "";
    try {
      const credential = await readCredential(config, mailbox.mailbox_id);
      credentialSha256 = credential.credential_sha256;
      refreshToken = openDirectLaneSecret({ ciphertext: credential.ciphertext, keyId: credential.key_id }, config.directLaneVaultKey);
      accessToken = await issueToken({ refreshToken, credentialSha256, clientId: config.googleOauthClientId, clientSecret: config.googleOauthClientSecret });
    } catch (error) {
      await fail(error instanceof GmailTokenError ? error.code : "DIRECT_LANE_CREDENTIAL_UNAVAILABLE");
      continue;
    }

    const envelope = {
      message_id: messageId,
      from_name: claimed.from_name ?? mailbox.sender_name,
      from_email: claimed.from_email,
      to_email: claimed.to_email,
      cc_emails: claimed.cc_emails ?? [],
      subject: claimed.subject,
      body_text: claimed.body_text,
      kind: claimed.kind,
      touch_number: claimed.touch_number ?? null,
      thread: claimed.thread ?? null,
      list_unsubscribe_url: claimed.kind === "TOUCH" ? unsubscribeUrlFor(config, claimed) : null,
    };
    try {
      let sent;
      try {
        sent = await createSender(accessToken).send(envelope);
      } catch (error) {
        if (error instanceof DirectLaneSendError && error.code === "GMAIL_API_UNAUTHORIZED") {
          invalidateGmailAccessToken(credentialSha256);
          const fresh = await issueToken({ refreshToken, credentialSha256, clientId: config.googleOauthClientId, clientSecret: config.googleOauthClientSecret });
          sent = await createSender(fresh).send(envelope);
        } else {
          throw error;
        }
      }
      await settle(config, {
        messageId,
        outcome: "SENT",
        providerMessageId: sent.provider_message_id,
        providerThreadId: sent.provider_thread_id,
        rfcMessageId: sent.rfc_message_id,
      });
      entry.result = `SENT:${claimed.kind}`;
    } catch (error) {
      const code = error instanceof DirectLaneSendError || error instanceof GmailTokenError ? error.code : "DIRECT_LANE_SEND_UNKNOWN_ERROR";
      await fail(code);
    }
  }
  return result;
}
