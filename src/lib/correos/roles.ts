import type { DirectLaneVariantKey } from "@/lib/correos/sequence";

/**
 * Variante del copy por cargo. Espejo exacto de app.direct_lane_variant_for_role
 * en la migración M041: si cambia uno, cambia el otro (el gate lo comprueba).
 *
 * Seguridad e higiene se evalúa ANTES que mantenimiento porque muchos cargos
 * dicen "seguridad, higiene y mantenimiento" y el miedo que responde es el del
 * acta, no el del turno.
 */
export function directLaneVariantForRole(roleTitle: string | null | undefined): DirectLaneVariantKey {
  const role = (roleTitle ?? "").toLocaleLowerCase("es-MX");
  if (/compras|comprador|purchas|procurement|buyer|sourcing|abastecimiento|adquisicion|supply chain|suministro/u.test(role)) return "COMPRAS";
  if (/seguridad|higiene|\behs\b|\bhse\b|\bsafety\b|medio ambiente|environment/u.test(role)) return "SEGURIDAD";
  if (/manten|maintenance|planta|plant|ingenier|engineer|facilit|operaci|production|producci|electric|el[eé]ctric/u.test(role)) return "MANTENIMIENTO";
  return "DIRECCION";
}

export const DIRECT_LANE_VARIANT_LABELS: Record<DirectLaneVariantKey, string> = {
  DIRECCION: "Dirección general",
  MANTENIMIENTO: "Mantenimiento / planta",
  SEGURIDAD: "Seguridad e higiene",
  COMPRAS: "Compras",
};
