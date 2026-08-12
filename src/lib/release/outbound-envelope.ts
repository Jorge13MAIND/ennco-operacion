import { addVisibleUnsubscribe, buildListUnsubscribeHeaders, renderSequenceTouch, type RenderValues, type SequenceDefinition } from "@/lib/release/render";
import { buildUnsubscribeUrl, createUnsubscribeToken } from "@/lib/unsubscribe/token";

export type PreparedOutboundEnvelope = {
  subject: string;
  bodyText: string;
  headers: Record<string, string>;
  unsubscribeTokenNonce: string;
  unsubscribeTokenExpiresAtEpoch: number;
};

export function prepareOutboundEnvelope(input: {
  sequence: SequenceDefinition;
  touchNumber: number;
  variantName: string;
  values: RenderValues;
  appUrl: string;
  organizationId: string;
  enrollmentId: string;
  unsubscribeSigningSecret: string;
  now?: Date;
  tokenNonce?: string;
}): PreparedOutboundEnvelope {
  const rendered = renderSequenceTouch(input.sequence, input.touchNumber, input.variantName, input.values);
  const { token, payload } = createUnsubscribeToken({
    organizationId: input.organizationId,
    enrollmentId: input.enrollmentId,
    secret: input.unsubscribeSigningSecret,
    now: input.now,
    nonce: input.tokenNonce,
  });
  const unsubscribeUrl = buildUnsubscribeUrl(input.appUrl, token);
  return {
    subject: rendered.subject,
    bodyText: addVisibleUnsubscribe(rendered.body, unsubscribeUrl),
    headers: buildListUnsubscribeHeaders(unsubscribeUrl),
    unsubscribeTokenNonce: payload.nonce,
    unsubscribeTokenExpiresAtEpoch: payload.expiresAtEpoch,
  };
}
