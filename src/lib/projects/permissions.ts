import type { ProjectAccess, ProjectArea, RecordKind } from "./types";
export function projectPermissions(
  areas: ProjectArea[],
  technicalAdmin = false,
  readOnly = false,
): ProjectAccess {
  const has = (...values: ProjectArea[]) =>
    !readOnly && values.some((v) => areas.includes(v));
  const canApprove = has("direction"),
    canConfirmPayments = has("direction", "administration");
  const fullCosts =
    technicalAdmin ||
    areas.some((a) => a === "direction" || a === "administration");
  return {
    areas,
    readOnly,
    canCreate: has(
      "direction",
      "administration",
      "projects",
      "engineering",
      "sales",
    ),
    canEdit: has(
      "direction",
      "administration",
      "projects",
      "engineering",
      "sales",
    ),
    canEngineer: has("direction", "engineering"),
    canSell: has("direction", "sales"),
    canPurchase: has("direction", "purchases"),
    canConfirmPayments,
    canApprove,
    canExecute: has("direction", "projects", "engineering"),
    canReadCosts: fullCosts || areas.includes("purchases"),
    canReadMargins: technicalAdmin || areas.includes("direction"),
    costScope: fullCosts
      ? "ALL"
      : areas.includes("purchases")
        ? "PURCHASES"
        : "NONE",
    canManageCatalogs: has("direction", "engineering", "purchases"),
    canManageMembers: canApprove,
    canCloseFinancial: canConfirmPayments,
  };
}
export function canAppendRecord(
  access: ProjectAccess,
  kind: RecordKind,
  data: Record<string, unknown>,
): boolean {
  if (access.readOnly) return false;
  switch (kind) {
    case "purchase_exception":
    case "change_approval":
    case "technical_review":
    case "source_review":
      return access.canApprove;
    case "budget":
      return data.approved === true
        ? access.canApprove
        : access.canConfirmPayments;
    case "payment_schedule":
    case "customer_payment_allocation":
    case "contract":
    case "customer_invoice":
    case "customer_payment":
    case "expense":
    case "supplier_payment":
      return access.canConfirmPayments;
    case "drive_setup":
      return access.canConfirmPayments;
    case "financial_closure":
      return (
        access.canCloseFinancial && (!data.exceptionReason || access.canApprove)
      );
    case "proposal":
    case "proposal_acceptance":
      return access.canSell || access.canApprove;
    case "supplier_quote":
    case "purchase_order":
    case "material_receipt":
      return access.canPurchase;
    case "calculation":
      return access.canEngineer;
    case "survey":
    case "progress":
    case "technical_closure":
      return access.canExecute;
    case "receipt":
      return access.canEngineer || access.canEdit;
    case "change_order":
      return access.canExecute || access.canSell;
    case "document":
      return data.visibility === "ADMIN"
        ? access.canConfirmPayments
        : data.visibility === "PURCHASES"
          ? access.canPurchase || access.canConfirmPayments
          : access.canEdit || access.canExecute || access.canConfirmPayments;
    case "reversal":
      return access.canApprove || access.canConfirmPayments;
    case "note":
      return (
        access.canEdit ||
        access.canExecute ||
        access.canPurchase ||
        access.canConfirmPayments
      );
  }
}
