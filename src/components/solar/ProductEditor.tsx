"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Icons, ProductTypeIcon } from "@/components/solar/ProductIcons";
import { LoadError, LoadingState, useMutation, useResource } from "@/components/solar/ui";
import { finalPrice, isEquipmentKind, type PriceTier, type Product, type ProductCatalog, type ProductCategory } from "@/lib/productos/types";

/* Ficha de producto, calcada de SunOne. Izquierda: foto y ficha técnica. Derecha: información del
   producto y precio. Los equipos (módulos, inversores, baterías…) llevan "Precio y utilidad";
   estructura, mano de obra y adicionales llevan "Costo unitario" por panel o por unidad, con
   costo fijo o por rango. Precio final = precio base + utilidad, siempre a la vista. */

type Draft = {
  categoryId: string; name: string; brand: string; code: string; description: string;
  currency: "USD" | "MXN"; pricingMode: "unit" | "range"; unitBasis: "" | "por_unidad" | "por_panel";
  basePrice: string; utilityPct: string; rating: string; tiers: PriceTier[];
};
const num = (s: string) => { const v = Number(String(s).replace(/,/g, "").trim()); return Number.isFinite(v) ? v : 0; };
const nf = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function draftFrom(product: Product | null, categoryId: string): Draft {
  return {
    categoryId: product?.categoryId ?? categoryId, name: product?.name ?? "", brand: product?.brand ?? "", code: product?.code ?? "", description: product?.description ?? "",
    currency: product?.currency ?? "USD", pricingMode: product?.pricingMode ?? "unit", unitBasis: product?.unitBasis ?? "",
    basePrice: product ? String(product.basePrice) : "", utilityPct: product?.utilityPct == null ? "" : String(product.utilityPct),
    rating: product?.rating == null ? "" : String(product.rating), tiers: product?.tiers ?? [],
  };
}

function FileCard({ product, kind, canWrite, onDone }: { product: Product | null; kind: "photo" | "datasheet"; canWrite: boolean; onDone: () => Promise<unknown> }) {
  const [state, setState] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null });
  const isPhoto = kind === "photo";
  const has = isPhoto ? Boolean(product?.photoPath) : Boolean(product?.datasheetPath);
  const upload = async (file: File | undefined) => {
    if (!file || !product) return;
    setState({ pending: true, error: null });
    const form = new FormData(); form.append("kind", kind); form.append("file", file);
    try {
      const res = await fetch(`/api/v1/productos/producto/${product.id}/archivo`, { method: "POST", body: form, credentials: "same-origin" });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "PRODUCT_FILE_UPLOAD_FAILED");
      await onDone(); setState({ pending: false, error: null });
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setState({ pending: false, error: code === "PRODUCT_FILE_TOO_LARGE" ? (isPhoto ? "La foto pasa de 5 MB." : "La ficha pasa de 10 MB.") : code === "PRODUCT_FILE_TYPE_INVALID" ? (isPhoto ? "Solo PNG, JPG o WebP." : "Solo PDF.") : "No se pudo subir el archivo." });
    }
  };
  const accept = isPhoto ? "image/png,image/jpeg,image/webp" : "application/pdf";
  return (
    <div className={isPhoto ? "pr-photo-actions" : "pr-box"}>
      {isPhoto ? null : <h3 className="pr-box-title"><span className="pr-box-icon">{Icons.doc}</span>Ficha técnica</h3>}
      {isPhoto ? null : <p>{has ? "Especificaciones y documentación del producto." : "Agrega la documentación técnica de este producto."}</p>}
      {!isPhoto && has && product?.source === "sunone" ? <span className="pr-chip pr-chip-src">Del catálogo</span> : null}
      {!isPhoto && has && product ? <a className="pr-file-btn" data-primary="" href={`/api/v1/productos/producto/${product.id}/ficha`} rel="noopener" target="_blank">{Icons.download} Descargar ficha técnica</a> : null}
      {canWrite && product ? (
        <label className="pr-file-btn" data-kind={kind}>
          <input accept={accept} disabled={state.pending} onChange={(e) => void upload(e.target.files?.[0])} type="file" />
          {isPhoto ? Icons.camera : Icons.upload} {state.pending ? "Subiendo…" : isPhoto ? (has ? "Cambiar foto" : "Subir foto") : (has ? "Cambiar ficha" : "Subir ficha técnica")}
        </label>
      ) : null}
      {!product ? <p className="fine">Guarda el producto para poder subir {isPhoto ? "la foto" : "la ficha"}.</p> : null}
      {state.error ? <p className="pr-msg" data-tone="bad">{state.error}</p> : null}
      <p className="fine">{isPhoto ? "PNG, JPG o WebP · Máximo 5 MB" : "PDF · Máximo 10 MB"}</p>
    </div>
  );
}

function Form({ product, categories, initialCategoryId, canWrite, reload }: { product: Product | null; categories: ProductCategory[]; initialCategoryId: string; canWrite: boolean; reload: () => Promise<unknown> }) {
  const router = useRouter();
  const m = useMutation();
  const [d, setD] = useState<Draft>(() => draftFrom(product, initialCategoryId));
  const patch = (p: Partial<Draft>) => setD((prev) => ({ ...prev, ...p }));
  const category = categories.find((c) => c.id === d.categoryId) ?? null;
  const equipment = category ? isEquipmentKind(category.kind) : false;
  const base = num(d.basePrice);
  const utility = d.utilityPct.trim() === "" ? null : num(d.utilityPct);
  const total = finalPrice(base, utility);

  const save = async () => {
    const payload = {
      id: product?.id ?? null, categoryId: d.categoryId, name: d.name.trim(), brand: d.brand.trim() || null, code: d.code.trim() || null, description: d.description.trim() || null,
      currency: d.currency, pricingMode: d.pricingMode, unitBasis: d.unitBasis || null, basePrice: base, utilityPct: utility,
      tiers: d.pricingMode === "range" ? d.tiers.filter((t) => t.price >= 0) : [],
      rating: d.rating.trim() === "" ? null : num(d.rating), ratingUnit: category?.kind === "module" ? "W" : equipment ? "kW" : null,
    };
    const result = await m.run<{ product: Product }>("/api/v1/productos/producto", payload);
    if (!result) return;
    if (!product) router.replace(`/operacion/proyectos/productos/${result.product.id}` as Route);
    else await reload();
  };

  const tierRow = (t: PriceTier, i: number) => (
    <tr key={i}>
      <td><input inputMode="numeric" onChange={(e) => setD((p) => ({ ...p, tiers: p.tiers.map((x, j) => (j === i ? { ...x, minQty: num(e.target.value) } : x)) }))} value={t.minQty} /></td>
      <td><input inputMode="numeric" onChange={(e) => setD((p) => ({ ...p, tiers: p.tiers.map((x, j) => (j === i ? { ...x, maxQty: e.target.value.trim() === "" ? null : num(e.target.value) } : x)) }))} placeholder="sin tope" value={t.maxQty ?? ""} /></td>
      <td><input inputMode="decimal" onChange={(e) => setD((p) => ({ ...p, tiers: p.tiers.map((x, j) => (j === i ? { ...x, price: num(e.target.value) } : x)) }))} value={t.price} /></td>
      <td><button className="pr-icon-btn" data-danger="" onClick={() => setD((p) => ({ ...p, tiers: p.tiers.filter((_, j) => j !== i) }))} type="button">{Icons.trash}</button></td>
    </tr>
  );

  const priceBlock = equipment ? (
    <section className="pr-section">
      <h2>Precio y utilidad</h2>
      <p>Define el precio base y la utilidad sobre el costo.</p>
      <div className="pr-fields" data-cols="3">
        <label className="pr-field" data-select=""><span>Moneda<b>*</b></span><select disabled={!canWrite} onChange={(e) => patch({ currency: e.target.value as Draft["currency"] })} value={d.currency}><option value="USD">USD</option><option value="MXN">MXN</option></select></label>
        <label className="pr-field"><span>Precio base<b>*</b></span><input disabled={!canWrite} inputMode="decimal" onChange={(e) => patch({ basePrice: e.target.value })} value={d.basePrice} /></label>
        <label className="pr-field"><span>Utilidad sobre costo %</span><input disabled={!canWrite} inputMode="decimal" onChange={(e) => patch({ utilityPct: e.target.value })} placeholder="Utilidad %" value={d.utilityPct} /></label>
      </div>
      <div className="pr-final"><div><b>Precio final</b><small>Precio base + utilidad</small></div><strong>{d.currency === "USD" ? "USD " : "$"}{nf.format(total)}<span>{d.currency}</span></strong></div>
    </section>
  ) : (
    <section className="pr-section">
      <div className="pr-rowfields"><span>Moneda <b style={{ color: "#dc2626" }}>*</b></span><label className="pr-field"><select disabled={!canWrite} onChange={(e) => patch({ currency: e.target.value as Draft["currency"] })} value={d.currency}><option value="USD">USD</option><option value="MXN">MXN</option></select></label></div>
      <div className="pr-rowfields">
        <span>Costo unitario <b style={{ color: "#dc2626" }}>*</b></span>
        <div>
          <label className="pr-field"><select disabled={!canWrite} onChange={(e) => patch({ unitBasis: e.target.value as Draft["unitBasis"] })} value={d.unitBasis}><option value="">Selecciona</option><option value="por_panel">Por panel</option><option value="por_unidad">Por unidad</option></select></label>
          <div className="pr-modes">
            <button aria-pressed={d.pricingMode === "unit"} className="pr-mode" disabled={!canWrite} onClick={() => patch({ pricingMode: "unit" })} type="button">{Icons.unit}<span><b>Costo por unidad</b><small>Precio fijo por pieza</small></span></button>
            <button aria-pressed={d.pricingMode === "range"} className="pr-mode" disabled={!canWrite} onClick={() => patch({ pricingMode: "range", tiers: d.tiers.length ? d.tiers : [{ minQty: 1, maxQty: null, price: base }] })} type="button">{Icons.range}<span><b>Costo por rango</b><small>Precio variable por cantidad</small></span></button>
          </div>
          {d.pricingMode === "range" ? (
            <>
              <table className="pr-tiers"><thead><tr><th>Desde (cantidad)</th><th>Hasta</th><th>Precio ({d.currency})</th><th /></tr></thead><tbody>{d.tiers.map(tierRow)}</tbody></table>
              {canWrite ? <button className="px-link" onClick={() => setD((p) => ({ ...p, tiers: [...p.tiers, { minQty: (p.tiers.at(-1)?.maxQty ?? 0) + 1, maxQty: null, price: base }] }))} type="button">+ Agregar rango</button> : null}
            </>
          ) : null}
        </div>
      </div>
      <div className="pr-rowfields">
        <span>Precio ({d.currency}) <b style={{ color: "#dc2626" }}>*</b></span>
        <div className="pr-fields" data-cols="3">
          <label className="pr-field"><input disabled={!canWrite} inputMode="decimal" onChange={(e) => patch({ basePrice: e.target.value })} value={d.basePrice} /><small>Precio</small></label>
          <label className="pr-field"><input disabled={!canWrite} inputMode="decimal" onChange={(e) => patch({ utilityPct: e.target.value })} placeholder="Utilidad %" value={d.utilityPct} /><small>Utilidad sobre costo %</small></label>
          <label className="pr-field"><input readOnly value={nf.format(total)} /><small>Precio final</small></label>
        </div>
      </div>
    </section>
  );

  return (
    <div className="pr-main">
      <section className="pr-section">
        <h2>Información del producto</h2>
        <p>Administra los datos y precios de tu catálogo.</p>
        <div className="pr-fields" data-cols="2" data-even="">
          <label className="pr-field"><span>Nombre<b>*</b></span><input disabled={!canWrite} maxLength={160} onChange={(e) => patch({ name: e.target.value })} value={d.name} /></label>
          <label className="pr-field"><span>Código</span><input disabled={!canWrite} maxLength={80} onChange={(e) => patch({ code: e.target.value })} value={d.code} /></label>
        </div>
        <label className="pr-field" style={{ marginTop: 18 }}><span>Descripción</span><textarea disabled={!canWrite} maxLength={2000} onChange={(e) => patch({ description: e.target.value })} placeholder="Describe las características del producto" value={d.description} /></label>
        <div className="pr-fields" data-cols={equipment ? "3" : "2"} style={{ marginTop: 18 }}>
          <label className="pr-field"><span>Tipo<b>*</b></span><select disabled={!canWrite} onChange={(e) => patch({ categoryId: e.target.value })} value={d.categoryId}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="pr-field"><span>Marca</span><input disabled={!canWrite} maxLength={80} onChange={(e) => patch({ brand: e.target.value })} value={d.brand} /></label>
          {equipment ? <label className="pr-field"><span>Potencia ({category?.kind === "module" ? "W" : "kW"})</span><input disabled={!canWrite} inputMode="decimal" onChange={(e) => patch({ rating: e.target.value })} value={d.rating} /><small>Es el número que se ve en la lista y el que usa el cotizador.</small></label> : null}
        </div>
      </section>
      {priceBlock}
      <div className="pr-actions">
        {m.error ? <span className="pr-msg" data-tone="bad">{m.error === "PROJECT_INPUT_INVALID" ? "Revisa los campos marcados." : "No se pudo guardar."}</span> : m.success ? <span className="pr-msg" data-tone="good">Guardado.</span> : null}
        {canWrite ? <button className="projects-button" disabled={m.pending || !d.name.trim() || !d.categoryId} onClick={() => void save()} type="button">{m.pending ? "Guardando…" : "Guardar cambios"}</button> : null}
      </div>
    </div>
  );
}

export function ProductEditor({ id, initialCategorySlug }: { id: string; initialCategorySlug?: string | null }) {
  const resource = useResource<{ catalog: ProductCatalog }>("/api/v1/productos/catalogo");
  const catalog = resource.data?.catalog ?? null;
  const shell = (children: React.ReactNode) => <main className="shell section operations-main projects-page pr-page" id="main-content" tabIndex={-1}>{children}</main>;
  if (resource.error) return shell(<LoadError message={resource.error} retry={() => void resource.reload()} />);
  if (!catalog) return shell(<LoadingState title="Cargando producto…" />);
  const categories = catalog.categories.filter((c) => c.active);
  const product = id === "nuevo" ? null : catalog.products.find((p) => p.id === id) ?? null;
  if (id !== "nuevo" && !product) return shell(<LoadError message="PRODUCT_NOT_FOUND" retry={() => void resource.reload()} />);
  const category = product ? categories.find((c) => c.id === product.categoryId) ?? null : categories.find((c) => c.slug === initialCategorySlug) ?? categories[0] ?? null;
  const canWrite = true; // el rol de solo lectura recibe SOLAR_FORBIDDEN al guardar; la pantalla no oculta nada.
  const initialCategoryId = category?.id ?? categories[0]?.id ?? "";

  return shell(
    <>
      <div className="pr-editor-head">
        <div>
          <Link className="pr-back" href={"/operacion/proyectos/productos" as Route}>{Icons.back} Productos</Link>
          <h1>{product?.name ?? "Nuevo producto"}</h1>
        </div>
        {category ? <span className="pr-chip" data-tone="type">{category.name}</span> : null}
      </div>
      {categories.length === 0 ? <p className="pr-readonly">Primero crea un tipo de producto en la lista.</p> : null}
      <div className="pr-editor">
        <aside className="pr-aside">
          <div className="pr-box">
            <div className="pr-photo">
              {/* URL firmada del bucket privado, cambia cada hora: no pasa por el optimizador de next/image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {product?.photoUrl ? <img alt="" src={product.photoUrl} /> : <ProductTypeIcon icon={category?.icon ?? "box"} />}
            </div>
            <div className="pr-brand"><span>{product?.brand || category?.name || "Producto"}</span>{product?.source === "sunone" ? <span className="pr-chip">Catálogo</span> : null}</div>
            {product?.code ? <p className="pr-code">{product.code}</p> : null}
            <FileCard canWrite={canWrite} kind="photo" onDone={resource.reload} product={product} />
          </div>
          <FileCard canWrite={canWrite} kind="datasheet" onDone={resource.reload} product={product} />
        </aside>
        <Form canWrite={canWrite} categories={categories} initialCategoryId={initialCategoryId} key={product ? `${product.id}:${product.updatedAt}` : `nuevo:${initialCategoryId}`} product={product} reload={resource.reload} />
      </div>
    </>,
  );
}
