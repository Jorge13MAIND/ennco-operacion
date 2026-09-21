"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect } from "react";

/**
 * Pantalla de fallo del Control Room. Se mantiene mínima a propósito: un aviso corto y la
 * salida, en vez del cartel a pantalla completa que había antes. El código de referencia es
 * el digest de Next: con él se localiza la excepción exacta en los registros del servidor.
 */
export default function OperationsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Control Room", error);
  }, [error]);
  return (
    <main className="shell section operations-main" id="main-content" tabIndex={-1}>
      <section className="cr-error-simple">
        <p className="cr-error-code">Error</p>
        <h1>No pudimos mostrar esta pantalla.</h1>
        <p>{/57014/u.test(error.message) ? "La base de datos tardó demasiado en responder. Suele resolverse al reintentar." : "Vuelve a intentarlo. Si sigue igual, avisa a Teckel con el código de referencia."}</p>
        <div className="cr-error-actions">
          <button className="button" onClick={reset} type="button">Reintentar</button>
          <Link className="button secondary" href={"/operacion" as Route}>Ir a Hoy</Link>
        </div>
        {error.message && !/^An error occurred in the Server Components render/u.test(error.message) ? <p className="cr-error-ref">Detalle: {error.message.slice(0, 220)}</p> : null}
        {error.digest ? <p className="cr-error-ref">Referencia: {error.digest}</p> : null}
      </section>
    </main>
  );
}
