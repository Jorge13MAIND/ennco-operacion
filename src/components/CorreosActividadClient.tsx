"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId } from "react";

/**
 * Selectores de la pantalla Actividad. Viven dentro de un formulario GET, así
 * que sin JavaScript siguen funcionando con el botón "Aplicar"; con JavaScript
 * cada cambio recarga la tabla al instante conservando el resto de filtros.
 */
export function ActivitySelect({ name, label, value, options }: { name: string; label: string; value: string; options: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const id = useId();
  return (
    <label className="cr-stats-select" htmlFor={id}>
      <span>{label}</span>
      <select
        defaultValue={value}
        id={id}
        name={name}
        onChange={(event) => {
          const next = new URLSearchParams(params.toString());
          next.set(name, event.currentTarget.value);
          router.push(`${pathname}?${next.toString()}` as Route);
        }}
      >
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
}
