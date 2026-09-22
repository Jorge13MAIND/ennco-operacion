import type { Product, ProductCategory } from "@/lib/productos/types";

/* Formato compartido de la lista y la ficha: los precios se muestran como en SunOne
   (US$362.674 · $2,800 /panel), sin redondear a dos decimales. */

const nf = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
export const priceLabel = (value: number, currency: string) => `${currency === "USD" ? "US$" : "$"}${nf.format(value)}`;
export const ratingLabel = (p: Pick<Product, "rating">) => (p.rating == null ? null : nf.format(p.rating));
export const categoryOf = (categories: ProductCategory[], id: string) => categories.find((c) => c.id === id) ?? null;
