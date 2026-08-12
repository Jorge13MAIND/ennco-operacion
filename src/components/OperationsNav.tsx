import type { Route } from "next";
import Link from "next/link";

import { OPERATION_MODULE_KEYS, OPERATION_MODULE_LABELS } from "@/lib/operations/portal";

export function OperationsNav() {
  return (
    <nav aria-label="Módulos de operación" className="operations-nav">
      <Link href="/operacion">Hoy</Link>
      {OPERATION_MODULE_KEYS.map((key) => (
        <Link href={`/operacion/${key}` as Route} key={key}>{OPERATION_MODULE_LABELS[key]}</Link>
      ))}
    </nav>
  );
}
