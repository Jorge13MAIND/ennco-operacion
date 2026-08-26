"use client";

import { useState } from "react";

export function PortalTableFilter({ tableId, total }: { tableId: string; total: number }) {
  const [visible, setVisible] = useState(total);

  function filterRows(value: string) {
    const query = value.trim().toLocaleLowerCase("es-MX");
    const table = document.getElementById(tableId);
    const rows = table?.querySelectorAll<HTMLTableRowElement>("tbody tr[data-search]") ?? [];
    let nextVisible = 0;
    rows.forEach((row) => {
      const matches = !query || (row.dataset.search ?? "").includes(query);
      row.hidden = !matches;
      if (matches) nextVisible += 1;
    });
    setVisible(nextVisible);
  }

  return (
    <div className="table-toolbar">
      <label>
        <span>Filtrar registros</span>
        <input
          onChange={(event) => filterRows(event.target.value)}
          placeholder="Buscar por cuenta, estado o siguiente acción"
          type="search"
        />
      </label>
      <span aria-live="polite" className="table-filter-count" role="status">{visible} de {total}</span>
    </div>
  );
}
