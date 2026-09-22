"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";

import { Icons, ProductTypeIcon } from "@/components/solar/ProductIcons";
import { categoryOf, priceLabel, ratingLabel } from "@/components/solar/productos-format";
import { LoadError, LoadingState, useMutation, useResource } from "@/components/solar/ui";
import { PRICING_MODE_LABEL, PRODUCT_KINDS, UNIT_BASIS_LABEL, type Product, type ProductCatalog, type ProductCategory, type ProductKind } from "@/lib/productos/types";

/* Productos: la lista de SunOne. Tipos a la izquierda, buscador, vista de lista o cuadrícula,
   "Agregar producto"; cada renglón con foto, nombre, marca · código, precio (con "/panel" cuando
   aplica), potencia, tipo, modo de cobro, favorito, descarga de ficha y papelera. */

const KIND_LABEL: Record<ProductKind, string> = {
  module: "Módulo fotovoltaico", inverter: "Inversor", microinverter: "Microinversor", accessory: "Accesorio", structure: "Estructura",
  labor: "Mano de obra", additional: "Adicional", battery: "Batería", controller: "Controlador", offgrid_inverter: "Inversor off-grid", other: "Otro",
};
const ICON_FOR_KIND: Record<ProductKind, string> = {
  module: "panel", inverter: "inverter", microinverter: "inverter", accessory: "box", structure: "structure", labor: "wrench",
  additional: "list-plus", battery: "battery", controller: "controller", offgrid_inverter: "inverter", other: "box",
};

function Thumb({ product, category, large }: { product: Product; category: ProductCategory | null; large?: boolean }) {
  return (
    <div className={`pr-thumb${large ? " pr-thumb-lg" : ""}`}>
      {/* URL firmada del bucket privado, cambia cada hora: no pasa por el optimizador de next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {product.photoUrl ? <img alt="" src={product.photoUrl} /> : <ProductTypeIcon icon={category?.icon ?? "box"} />}
    </div>
  );
}

function PriceCell({ product }: { product: Product }) {
  return (
    <span className="pr-price">
      {priceLabel(product.finalPrice, product.currency)}
      {product.unitBasis === "por_panel" ? <small>/panel</small> : null}
    </span>
  );
}

function RowActions({ product, onChanged }: { product: Product; onChanged: () => Promise<unknown> }) {
  const m = useMutation(onChanged);
  const favorite = async (e: React.MouseEvent) => { e.preventDefault(); await m.run(`/api/v1/productos/producto/${product.id}/favorito`, { favorite: !product.favorite }); };
  const archive = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!window.confirm(`¿Quitar "${product.name}" del catálogo? No se borra: queda en archivados y se puede restaurar.`)) return;
    await m.run(`/api/v1/productos/producto/${product.id}/estado`, { active: false });
  };
  const restore = async (e: React.MouseEvent) => { e.preventDefault(); await m.run(`/api/v1/productos/producto/${product.id}/estado`, { active: true }); };
  return (
    <>
      <button aria-label={product.favorite ? "Quitar de favoritos" : "Marcar favorito"} className="pr-icon-btn" data-on={product.favorite ? "true" : "false"} disabled={m.pending} onClick={favorite} type="button">{Icons.star(product.favorite)}</button>
      {product.datasheetPath
        // Botón y no enlace: el renglón entero ya es un enlace a la ficha, y un <a> dentro de otro es HTML inválido.
        ? <button aria-label="Descargar ficha técnica" className="pr-icon-btn" data-file="" onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(`/api/v1/productos/producto/${product.id}/ficha`, "_blank", "noopener"); }} type="button">{Icons.download}</button>
        : <button aria-label="Sin ficha técnica" className="pr-icon-btn" disabled type="button">{Icons.download}</button>}
      {product.active
        ? <button aria-label="Quitar del catálogo" className="pr-icon-btn" data-danger="" disabled={m.pending} onClick={archive} type="button">{Icons.trash}</button>
        : <button className="projects-button" data-variant="secondary" disabled={m.pending} onClick={restore} type="button">Restaurar</button>}
    </>
  );
}

function NewTypeForm({ onSaved }: { onSaved: () => Promise<unknown> }) {
  const m = useMutation(onSaved);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProductKind>("other");
  if (!open) return <button className="pr-type" onClick={() => setOpen(true)} type="button">+ Nuevo tipo</button>;
  return (
    <form className="pr-type-new" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await m.run("/api/v1/productos/categoria", { name: name.trim(), kind, icon: ICON_FOR_KIND[kind], defaultUnitBasis: kind === "structure" || kind === "labor" ? "por_panel" : kind === "additional" ? null : "por_unidad" }); setName(""); setOpen(false); }}>
      <input aria-label="Nombre del tipo" maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Nombre del tipo" value={name} />
      <select aria-label="Cómo se cotiza" onChange={(e) => setKind(e.target.value as ProductKind)} value={kind}>
        {PRODUCT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
      </select>
      <button className="projects-button" disabled={m.pending} type="submit">Guardar tipo</button>
      <button className="projects-button" data-variant="secondary" onClick={() => setOpen(false)} type="button">Cancelar</button>
      {m.error ? <span className="pr-msg" data-tone="bad">No se pudo guardar el tipo.</span> : null}
    </form>
  );
}

export function ProductsWorkspace() {
  const resource = useResource<{ catalog: ProductCatalog }>("/api/v1/productos/catalogo");
  const catalog = resource.data?.catalog ?? null;
  const [selected, setSelected] = useState<string>("todos");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [showArchived, setShowArchived] = useState(false);
  const seeding = useRef(false);
  const seed = useMutation(resource.reload);
  const needsSeed = Boolean(catalog && catalog.categories.length === 0);
  const runSeed = seed.run;

  // Sin tipos todavía (organización nueva): se cargan los diez de SunOne una sola vez.
  useEffect(() => {
    if (!needsSeed || seeding.current) return;
    seeding.current = true;
    void runSeed("/api/v1/productos/categoria/defaults", {});
  }, [needsSeed, runSeed]);

  if (resource.error) return <main className="shell section operations-main projects-page pr-page" id="main-content" tabIndex={-1}><LoadError message={resource.error} retry={() => void resource.reload()} /></main>;
  if (!catalog) return <main className="shell section operations-main projects-page pr-page" id="main-content" tabIndex={-1}><LoadingState title="Cargando productos…" /></main>;

  const categories = catalog.categories.filter((c) => c.active);
  const current = selected === "todos" ? null : categories.find((c) => c.slug === selected) ?? null;
  const q = search.trim().toLocaleLowerCase("es");
  const visible = catalog.products.filter((p) => p.active !== showArchived && (!current || p.categoryId === current.id) && (!q || `${p.name} ${p.brand ?? ""} ${p.code ?? ""}`.toLocaleLowerCase("es").includes(q)));
  const archivedCount = catalog.products.filter((p) => !p.active && (!current || p.categoryId === current.id)).length;
  const newHref = `/operacion/proyectos/productos/nuevo${current ? `?tipo=${current.slug}` : ""}` as Route;

  return (
    <main className="shell section operations-main projects-page pr-page" id="main-content" tabIndex={-1}>
      {/* Encabezado de SunOne: título chico con su subtítulo, y a la derecha buscador, vista y "Agregar producto". */}
      <header className="pr-head">
        <div>
          <h1>Productos</h1>
          <p>Catálogo de paneles, inversores y accesorios</p>
        </div>
        <div className="pr-tools">
          <label className="pr-search">{Icons.search}<span className="sr-only">Buscar producto</span><input onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto…" type="search" value={search} /></label>
          <div aria-label="Vista" className="pr-view" role="group">
            <button aria-label="Cuadrícula" aria-pressed={view === "grid"} onClick={() => setView("grid")} type="button">{Icons.grid}</button>
            <button aria-label="Lista" aria-pressed={view === "list"} onClick={() => setView("list")} type="button">{Icons.list}</button>
          </div>
          <Link className="pr-add" href={newHref}>{Icons.plus} Agregar producto</Link>
        </div>
      </header>

      <div className="pr-layout">
        <nav aria-label="Tipos de producto" className="pr-types">
          <button aria-current={selected === "todos" ? "true" : undefined} className="pr-type" onClick={() => setSelected("todos")} type="button">Todos los tipos</button>
          {categories.map((c) => <button aria-current={selected === c.slug ? "true" : undefined} className="pr-type" key={c.id} onClick={() => setSelected(c.slug)} type="button">{c.name}</button>)}
          <NewTypeForm onSaved={resource.reload} />
        </nav>

        <section>
          {visible.length === 0 ? (
            <div className="pr-empty">{showArchived ? "No hay productos archivados aquí." : q ? "Ningún producto coincide con la búsqueda." : current ? `Todavía no hay productos de tipo ${current.name}.` : "Todavía no hay productos. Agrega el primero."}</div>
          ) : view === "list" ? (
            <div className="pr-list">
              {visible.map((p) => {
                const cat = categoryOf(catalog.categories, p.categoryId);
                const rating = ratingLabel(p);
                return (
                  <Link className="pr-row" href={`/operacion/proyectos/productos/${p.id}` as Route} key={p.id}>
                    <Thumb category={cat} product={p} />
                    <div>
                      <p className="pr-name">{p.name}</p>
                      <p className="pr-sub">{[p.brand, p.code].filter(Boolean).join(" · ") || (cat?.name ?? "")}</p>
                    </div>
                    <div className="pr-right">
                      <PriceCell product={p} />
                      {p.unitBasis === "por_panel" ? <span className="pr-rating">{UNIT_BASIS_LABEL.por_panel}</span> : null}
                      {rating ? <span className="pr-rating">{rating}</span> : null}
                      {!current && cat ? <span className="pr-chip" data-tone="type">{cat.name}</span> : null}
                      <span className="pr-chip">{PRICING_MODE_LABEL[p.pricingMode]}</span>
                      <RowActions onChanged={resource.reload} product={p} />
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="pr-grid">
              {visible.map((p) => {
                const cat = categoryOf(catalog.categories, p.categoryId);
                return (
                  <Link className="pr-card" href={`/operacion/proyectos/productos/${p.id}` as Route} key={p.id}>
                    <Thumb category={cat} large product={p} />
                    <div>
                      <p className="pr-name">{p.name}</p>
                      <p className="pr-sub">{[p.brand, p.code].filter(Boolean).join(" · ") || (cat?.name ?? "")}</p>
                    </div>
                    <div className="pr-card-foot">
                      <PriceCell product={p} />
                      <RowActions onChanged={resource.reload} product={p} />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {archivedCount > 0 || showArchived ? (
            <p className="pr-archived">
              <button className="px-link" onClick={() => setShowArchived((v) => !v)} type="button">
                {showArchived ? "Ver productos activos" : `Ver archivados (${archivedCount})`}
              </button>
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
