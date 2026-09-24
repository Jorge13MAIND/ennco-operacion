import { expect, it } from "vitest";
import { deliveryDiagnostic } from "@/lib/correos/delivery-diagnostic";
it.each([["5.1.1", "INVALID_ADDRESS", true], ["5.7.1", "SENDER_OR_POLICY", true], ["5.4.1", "SERVER_REJECTION", true], ["4.4.7", "TEMPORARY", false], ["", "UNKNOWN", false]])("distinguishes DSN %s", (code, category, permanent) => {
  const message = { payload: { parts: [{ mimeType: "message/delivery-status", body: { data: Buffer.from("Status: " + code).toString("base64url") } }] } };
  expect(deliveryDiagnostic(message)).toMatchObject({ category, permanent });
});

it.each([
  ["5.7.1", "554 5.7.1 <recipient@example.com>: Relay access denied"],
  ["5.7.0", "550 permanent failure for one or more recipients (recipient@example.com:550 5.4.1 Recipient address rejected: Access denied)"],
])("attributes recipient rejection despite wrapper status %s", (status, diagnostic) => {
  const dsn = `Status: ${status}\nDiagnostic-Code: smtp; ${diagnostic}`;
  const message = { payload: { parts: [{ mimeType: "message/delivery-status", body: { data: Buffer.from(dsn).toString("base64url") } }] } };
  expect(deliveryDiagnostic(message)).toMatchObject({ status, category: "SERVER_REJECTION", permanent: true });
});
