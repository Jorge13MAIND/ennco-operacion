"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Enrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

export function MfaEnrollment({ next }: { next: string }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function startEnrollment() {
    setStatus("loading");
    const supabase = createSupabaseBrowserClient();
    const { data: existing, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setStatus("error");
      return;
    }
    for (const factor of existing.totp.filter((item) => item.status !== "verified")) {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Control Room ENNCO",
      issuer: "ENNCO",
    });
    if (error) {
      setStatus("error");
      return;
    }
    setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    setStatus("idle");
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment) return;
    setStatus("loading");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrollment.factorId,
      code,
    });
    if (error) {
      setStatus("error");
      return;
    }
    window.location.assign(next);
  }

  if (!enrollment) {
    return (
      <div className="notice">
        <strong>Configura un autenticador.</strong>
        <p>El segundo factor pertenece al Control Room. No cambia ni verifica tu cuenta de Google.</p>
        <button className="button" disabled={status === "loading"} onClick={startEnrollment} type="button">
          {status === "loading" ? "Preparando..." : "Crear segundo factor"}
        </button>
        {status === "error" ? <p className="auth-error" role="alert">No se pudo preparar el factor. Vuelve a intentarlo.</p> : null}
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={verify}>
      <p>Escanea el código con tu aplicación de autenticación y captura el código de seis dígitos.</p>
      <Image alt="Código QR para configurar MFA" className="mfa-qr" height={220} src={enrollment.qrCode} unoptimized width={220} />
      <details>
        <summary>Usar clave manual</summary>
        <code className="mfa-secret">{enrollment.secret}</code>
      </details>
      <label htmlFor="enrollment-code">Código de seis dígitos</label>
      <input autoComplete="one-time-code" id="enrollment-code" inputMode="numeric" maxLength={6} minLength={6} onChange={(event) => setCode(event.target.value)} pattern="[0-9]{6}" required value={code} />
      <button className="button" disabled={status === "loading"} type="submit">Verificar y entrar</button>
      {status === "error" ? <p className="auth-error" role="alert">El código no fue válido. Revisa el autenticador e intenta otra vez.</p> : null}
    </form>
  );
}
