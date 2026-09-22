import { ProductsWorkspace } from "@/components/solar/ProductsWorkspace";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import "@/styles/productos.css";
export const dynamic = "force-dynamic";
export default async function ProductosPage() {
  await requireOperationsAccess();
  return <ProductsWorkspace />;
}
