import type { Route } from "next";
import Link from "next/link";

import type { DirectLaneStatsScreen } from "@/lib/correos/stats-loader";

/**
 * La sección Estadísticas de Correos se mudó a su propia página
 * (/operacion/correos/estadisticas), con selector de campaña para que la
 * prueba interna no se mezcle con la campaña real. Esta tarjeta queda como
 * puente mientras la página Correos termina de reorganizarse.
 */
export function CorreosStats({ screen }: { screen: DirectLaneStatsScreen }) {
  const f = screen.thisWeek?.funnel;
  return (
    <div className="cr-stats-bridge">
      {f ? <p>Esta semana, todas las campañas juntas: {f.reached} contactos alcanzados, {f.sends} correos, {f.replied} respuestas.</p> : <p>Las estadísticas se activan con datos reales del carril.</p>}
      <Link className="button secondary" href={"/operacion/correos/estadisticas" as Route}>Ver estadísticas por campaña</Link>
    </div>
  );
}
