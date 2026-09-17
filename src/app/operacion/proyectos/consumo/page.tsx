import { ConsumptionCalculator } from "@/components/solar/ConsumptionCalculator";
import { requireOperationsAccess } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

/** Calculadora de consumo para casas en construcción (hoja Cal_Consumo del libro). */
export default async function ConsumoPage() {
  await requireOperationsAccess();
  return <ConsumptionCalculator />;
}
