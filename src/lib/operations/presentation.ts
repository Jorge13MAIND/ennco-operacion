const operationalLabels: Record<string, string> = {
  ACTIVE: "Activo",
  ALLOWED: "Permitido",
  BLOCKED: "Bloqueado",
  BLOCKED_EXTERNAL: "Bloqueado por dependencia externa",
  BREACHED: "Incumplido",
  DEGRADED: "Degradado",
  EVIDENCE_READY: "Evidencia local lista",
  FULL: "Sin capacidad",
  HEALTHY: "Saludable",
  HOLD: "En espera",
  INACTIVE: "Inactivo",
  INCOMPLETE: "Incompleto",
  IN_PROGRESS: "En progreso",
  LIVE: "Datos reales",
  NOT_STARTED: "No iniciado",
  OPEN: "Abierto",
  PASS: "Cumple",
  READY: "Listo",
  REJECTED: "Rechazado",
  RESEARCH_ONLY_HOLD: "Sólo investigación",
  SIMULACION: "Simulación",
  SIMULATION: "Simulación",
  SYNTHETIC_DEMO: "Demo sintético",
  UNKNOWN: "Sin evidencia",
  WARNING: "Atención",
  ZERO: "Sin registros",
};

export function operationalLabel(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return "Sin evidencia";
  if (operationalLabels[normalized]) return operationalLabels[normalized];

  const words = normalized.toLocaleLowerCase("es-MX").replaceAll("_", " ");
  return `${words.charAt(0).toLocaleUpperCase("es-MX")}${words.slice(1)}`;
}
