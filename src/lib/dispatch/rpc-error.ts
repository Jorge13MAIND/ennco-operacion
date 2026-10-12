/** El código que levantó la base (RAISE 'ALGO_INVALID') o el SQLSTATE; nunca el texto libre. */
export function rpcErrorCode(error: { message?: string; code?: string } | null | undefined): string {
  const raised = /^([A-Z][A-Z0-9_]{3,63})$/.exec((error?.message ?? "").trim())?.[1];
  if (raised) return raised;
  return error?.code ? `PG_${error.code.replace(/[^A-Z0-9]/gi, "").toUpperCase()}` : "DB_UNREACHABLE";
}
