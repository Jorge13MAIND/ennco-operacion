import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { demoMeterView, demoOverview } from "@/lib/medidores/demo";
import { meterViewSchema, overviewSchema, type MeterView, type Overview } from "@/lib/medidores/model";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Lecturas de la pestaña Medidores (/operacion/medidores). En vivo, por read_energy y read_energy_meter
 * con la sesión del usuario (migración 113); fuera de producción, el ejemplo SIMULACION de demo.ts.
 */
export type MedidoresScreen = { overview: Overview; evidenceClass: OperationsAccessContext["evidenceClass"]; canEdit: boolean };

export async function loadMedidores(access: OperationsAccessContext): Promise<MedidoresScreen> {
  const canEdit = access.evidenceClass === "live" && access.role !== "auditor_readonly";
  if (access.evidenceClass !== "live" || !access.organizationId) {
    return { overview: demoOverview(), evidenceClass: access.evidenceClass, canEdit: false };
  }
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("read_energy", { target_organization_id: access.organizationId });
  if (error) throw new Error("ENERGY_READ_FAILED");
  return { overview: overviewSchema.parse(data), evidenceClass: "live", canEdit };
}

export async function loadMeterView(access: OperationsAccessContext, meterId: string, since: string | null, until: string | null): Promise<MeterView> {
  if (access.evidenceClass !== "live" || !access.organizationId) {
    const view = demoMeterView(meterId, new Date(), since, until);
    if (!view) throw new Error("ENERGY_METER_NOT_FOUND");
    return view;
  }
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("read_energy_meter", {
    target_organization_id: access.organizationId, target_meter_id: meterId, since_at: since, until_at: until,
  });
  if (error) throw new Error("ENERGY_METER_READ_FAILED");
  return meterViewSchema.parse(data);
}
