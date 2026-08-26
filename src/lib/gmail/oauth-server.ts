import "server-only";

import { GoogleAuth } from "google-auth-library";

import {
  GoogleKmsEnvelopeClient,
  type GmailOAuthConfig,
} from "@/lib/gmail/oauth";
import type { RuntimeConfig } from "@/lib/runtime/config";

export function requireGmailOAuthConfig(config: RuntimeConfig): GmailOAuthConfig & {
  kmsKeyName: string;
  stateSecret: string;
  completionSecret: string;
} {
  if (
    !config.gmailOauthReleased
    || !config.googleOauthClientId
    || !config.googleOauthClientSecret
    || !config.googleOauthRedirectUri
    || !config.googleKmsKeyName
    || !config.gmailOauthStateSecret
    || !config.gmailOauthCompletionSecret
  ) {
    throw new Error("GMAIL_OAUTH_NOT_RELEASED");
  }
  return {
    clientId: config.googleOauthClientId,
    clientSecret: config.googleOauthClientSecret,
    redirectUri: config.googleOauthRedirectUri,
    kmsKeyName: config.googleKmsKeyName,
    stateSecret: config.gmailOauthStateSecret,
    completionSecret: config.gmailOauthCompletionSecret,
  };
}

export function createGoogleKmsEnvelopeClient(keyName: string): GoogleKmsEnvelopeClient {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  return new GoogleKmsEnvelopeClient({
    keyName,
    accessTokenProvider: async () => {
      const token = await auth.getAccessToken();
      if (!token) throw new Error("KMS_APPLICATION_DEFAULT_CREDENTIALS_REQUIRED");
      return token;
    },
  });
}
