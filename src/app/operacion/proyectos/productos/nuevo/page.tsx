import { ProductEditor } from "@/components/solar/ProductEditor";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import "@/styles/productos.css";
export const dynamic = "force-dynamic";
export default async function ProductoNuevoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOperationsAccess();
  const params = await searchParams;
  const tipo = typeof params.tipo === "string" ? params.tipo : null;
  return <ProductEditor id="nuevo" initialCategorySlug={tipo} />;
}
