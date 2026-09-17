import { context, apiError, headers } from "@/lib/solar/api";
import { periodLabel, periodsIn, priceAll } from "@/lib/precios/pricing";
import { readPriceCatalog } from "@/lib/precios/server";
import { writeXlsx, type Cell } from "@/lib/precios/xlsx";
export const dynamic = "force-dynamic";
/** Excel con la lista vigente: costo por proveedor, costo elegido y precio final, mas el historial por mes. */
export async function GET() {
  try {
    const c = await context(); const catalog = await readPriceCatalog(c);
    const priced = priceAll(catalog); const periods = periodsIn(catalog).reverse();
    const suppliers = catalog.suppliers.filter((s) => s.active);
    const head: Cell[] = ["Categoría", "Material", "Unidad", "Moneda", ...suppliers.map((s) => s.name), "Costo", "Proveedor del costo", "Precio final", "Costo MXN", "Precio final MXN"];
    const rows: Cell[][] = [head, ...priced.map((p) => [p.item.category, p.item.name, p.item.unit, p.item.currency, ...suppliers.map((s) => p.bySupplier.find((x) => x.supplier.id === s.id)?.unitPrice ?? null), p.cost, p.costSupplier?.name ?? null, p.finalPrice == null ? null : Math.round(p.finalPrice * 100) / 100, p.costMxn == null ? null : Math.round(p.costMxn * 100) / 100, p.finalMxn == null ? null : Math.round(p.finalMxn * 100) / 100])];
    const histHead: Cell[] = ["Categoría", "Material", "Proveedor", ...periods.map(periodLabel)];
    const hist: Cell[][] = [histHead];
    for (const p of priced) for (const s of suppliers) {
      const qs = catalog.quotes.filter((q) => q.itemId === p.item.id && q.supplierId === s.id);
      if (!qs.length) continue;
      hist.push([p.item.category, p.item.name, s.name, ...periods.map((per) => qs.find((q) => q.period.slice(0, 7) === per)?.unitPrice ?? null)]);
    }
    const buf = writeXlsx([{ name: "Precios vigentes", rows, widths: [22, 44, 8, 8, ...suppliers.map(() => 14), 12, 20, 12, 12, 14] }, { name: "Historial", rows: hist, widths: [22, 44, 20, ...periods.map(() => 12)] }]);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(buf), { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="ENNCO precios ${stamp}.xlsx"` } });
  } catch (e) { return apiError(e); }
}
