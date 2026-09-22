import { notFound } from "next/navigation";
import { z } from "zod";

import { ProductEditor } from "@/components/solar/ProductEditor";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import "@/styles/productos.css";
export const dynamic = "force-dynamic";
export default async function ProductoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOperationsAccess();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return <ProductEditor id={id} />;
}
