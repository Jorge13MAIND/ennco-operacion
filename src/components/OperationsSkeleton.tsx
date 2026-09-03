/**
 * Esqueleto de carga del Control Room.
 *
 * Es lo que el navegador pinta EN EL INSTANTE del click, mientras el servidor
 * arma la pantalla real. Sin esto, el App Router deja al operador clavado en
 * la página anterior sin ninguna señal, que era exactamente la queja: "le doy
 * click y tarda mucho en responder".
 *
 * Además de dar la señal, su existencia cambia el prefetch: con un loading
 * boundary, los links precargan hasta aquí y el click siempre tiene algo que
 * mostrar de inmediato.
 */
export function OperationsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <main aria-busy="true" aria-label="Cargando" className="shell section operations-main">
      <div className="op-skeleton">
        <div className="op-skeleton-line op-skeleton-eyebrow" />
        <div className="op-skeleton-line op-skeleton-title" />
        <div className="op-skeleton-panel">
          {Array.from({ length: rows }, (_, index) => (
            <div className="op-skeleton-line op-skeleton-row" key={index} />
          ))}
        </div>
      </div>
    </main>
  );
}
