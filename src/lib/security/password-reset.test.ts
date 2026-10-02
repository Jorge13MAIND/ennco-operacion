import { describe, expect, it } from "vitest";
import { passwordResetIsValid, sealPasswordReset } from "@/lib/security/password-reset";

const config = { gmailOauthStateSecret: "s".repeat(64) };

describe("prueba de recuperación de contraseña", () => {
  it("vale para el mismo usuario dentro de 15 minutos", () => {
    const sealed = sealPasswordReset("user-1", config, 1_000_000)!;
    expect(passwordResetIsValid(sealed, "user-1", config, 1_000_000 + 14 * 60_000)).toBe(true);
  });
  it("no vale para otro usuario, vencida, alterada o sin secreto", () => {
    const sealed = sealPasswordReset("user-1", config, 1_000_000)!;
    expect(passwordResetIsValid(sealed, "user-2", config, 1_000_000)).toBe(false);
    expect(passwordResetIsValid(sealed, "user-1", config, 1_000_000 + 16 * 60_000)).toBe(false);
    expect(passwordResetIsValid(sealed.replace(/.$/, "x"), "user-1", config, 1_000_000)).toBe(false);
    expect(passwordResetIsValid(undefined, "user-1", config)).toBe(false);
    expect(sealPasswordReset("user-1", { gmailOauthStateSecret: undefined })).toBeNull();
  });
});
