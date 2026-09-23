import { expect, it } from "vitest";
import { deliveryDiagnostic } from "@/lib/correos/delivery-diagnostic";
it.each([["5.1.1", "INVALID_ADDRESS", true], ["5.7.1", "SENDER_OR_POLICY", true], ["5.4.1", "SERVER_REJECTION", true], ["4.4.7", "TEMPORARY", false], ["", "UNKNOWN", false]])("distinguishes DSN %s", (code, category, permanent) => {
  const message = { payload: { parts: [{ mimeType: "message/delivery-status", body: { data: Buffer.from("Status: " + code).toString("base64url") } }] } };
  expect(deliveryDiagnostic(message)).toMatchObject({ category, permanent });
});
