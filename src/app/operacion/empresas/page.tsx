import { redirect } from "next/navigation";

/** Empresas se consolidó en Leads (vista por empresa) el 15-sep-2026. */
export default function EmpresasPage() {
  redirect("/operacion/leads?vista=empresas");
}
