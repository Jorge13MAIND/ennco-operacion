/** Operational projects are independent from contractual outreach attribution. */
export const PROJECT_SEGMENTS = [
  "RESIDENTIAL",
  "COMMERCIAL",
  "INDUSTRIAL",
] as const;
export type ProjectSegment = (typeof PROJECT_SEGMENTS)[number];
export const SEGMENT_LABELS: Record<ProjectSegment, string> = {
  RESIDENTIAL: "Residencial",
  COMMERCIAL: "Comercial",
  INDUSTRIAL: "Industrial",
};
export const PROJECT_STAGES = [
  "PROSPECT",
  "INFORMATION",
  "QUOTATION",
  "SURVEY",
  "PROPOSAL",
  "NEGOTIATION",
  "CONTRACTED",
  "ADVANCE",
  "PURCHASES",
  "ENGINEERING",
  "EXECUTION",
  "INTERCONNECTION",
  "COLLECTION",
  "DELIVERY",
  "CLOSED",
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];
export const STAGE_LABELS: Record<ProjectStage, string> = {
  PROSPECT: "Prospecto",
  INFORMATION: "Información recibida",
  QUOTATION: "Cotización",
  SURVEY: "Levantamiento",
  PROPOSAL: "Propuesta",
  NEGOTIATION: "Negociación",
  CONTRACTED: "Contratado",
  ADVANCE: "Anticipo recibido",
  PURCHASES: "Compras",
  ENGINEERING: "Ingeniería",
  EXECUTION: "Ejecución",
  INTERCONNECTION: "Trámites / Interconexión",
  COLLECTION: "Cobranza",
  DELIVERY: "Entrega",
  CLOSED: "Cerrado",
};
export type ProjectLifecycle = "ACTIVE" | "PAUSED" | "CANCELLED" | "LOST";
export const PROJECT_AREAS = [
  "direction",
  "administration",
  "purchases",
  "engineering",
  "projects",
  "sales",
] as const;
export type ProjectArea = (typeof PROJECT_AREAS)[number];
export const AREA_LABELS: Record<ProjectArea, string> = {
  direction: "Dirección",
  administration: "Administración",
  purchases: "Compras",
  engineering: "Ingeniería",
  projects: "Proyectos",
  sales: "Ventas",
};
export const DOCUMENT_SECTIONS = [
  "Información del cliente",
  "Levantamiento técnico",
  "Ingeniería",
  "Propuesta económica",
  "Contrato y pagos",
  "Compras",
  "Ejecución",
  "Cierre del proyecto",
] as const;
export type DocumentSection = (typeof DOCUMENT_SECTIONS)[number];
export const COST_CATEGORIES = [
  "Paneles solares",
  "Inversores",
  "Estructura",
  "Material eléctrico",
  "Media tensión",
  "Obra civil",
  "Mano de obra",
  "Ingeniería",
  "Trámites",
  "Verificación",
  "Fletes",
  "Grúas",
  "Renta de maquinaria o herramienta",
  "Viáticos",
  "Comisiones",
  "Otros gastos directos",
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];
export const RECORD_KINDS = [
  "receipt",
  "survey",
  "calculation",
  "technical_review",
  "proposal",
  "proposal_acceptance",
  "budget",
  "contract",
  "customer_invoice",
  "customer_payment",
  "supplier_quote",
  "purchase_order",
  "material_receipt",
  "expense",
  "supplier_payment",
  "purchase_exception",
  "progress",
  "change_order",
  "change_approval",
  "document",
  "technical_closure",
  "financial_closure",
  "reversal",
  "note",
  "source_review",
  "drive_setup",
  "customer_payment_allocation",
  "payment_schedule",
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
export type JsonRecord = Record<string, unknown>;
export interface Project {
  id: string;
  organizationId: string;
  folio: string;
  name: string;
  segment: ProjectSegment;
  customerName: string;
  contactName: string;
  email: string;
  phone: string;
  location: string;
  scope: string;
  stage: ProjectStage;
  lifecycle: ProjectLifecycle;
  version: number;
  createdAt: string;
  updatedAt: string;
  data: JsonRecord;
}
export interface ProjectCreateInput {
  name: string;
  segment: ProjectSegment;
  customerName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  location?: string;
  scope?: string;
  data?: {
    accountId?: string | null;
    opportunityId?: string | null;
    ownerName?: string;
    latitude?: number | null;
    longitude?: number | null;
    dueDate?: string | null;
  };
}
export type ProjectUpdateInput = Partial<
  Omit<ProjectCreateInput, "segment">
> & { stage?: ProjectStage; lifecycle?: ProjectLifecycle };
export interface ProjectRecord {
  id: string;
  projectId: string;
  kind: RecordKind;
  data: JsonRecord;
  createdAt: string;
  actorId: string;
  revision: number;
}
export interface ProjectAccess {
  areas: ProjectArea[];
  readOnly: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canEngineer: boolean;
  canSell: boolean;
  canPurchase: boolean;
  canConfirmPayments: boolean;
  canApprove: boolean;
  canExecute: boolean;
  canReadCosts: boolean;
  canReadMargins: boolean;
  costScope: "ALL" | "PURCHASES" | "NONE";
  canManageCatalogs: boolean;
  canManageMembers: boolean;
  canCloseFinancial: boolean;
}
export interface ProjectBundle {
  project: Project;
  records: ProjectRecord[];
  permissions: ProjectAccess;
}
export interface ProjectReadiness {
  storage: "READY" | "UNAVAILABLE" | "DEMO";
  drive: "CONNECTED" | "CONFIGURED" | "NOT_CONFIGURED";
  ocr: "LOCAL_PDF" | "ASSISTED" | "MANUAL";
  engineering: "REVIEW_REQUIRED";
  contractTemplate: "REVIEW_REQUIRED";
  message?: string;
  demo: boolean;
}
export interface ProjectAlert {
  code: string;
  message: string;
  level: "info" | "warning" | "error";
  recordId?: string;
}
export interface CategorySummary {
  category: string;
  budgetMxn: number;
  incurredMxn: number;
  committedMxn: number;
  paidMxn: number;
  differenceMxn: number;
  deviationPct: number | null;
}
export interface ProjectSummary {
  contractedMxn: number;
  invoicedMxn: number;
  collectedMxn: number;
  balanceMxn: number;
  advanceRequiredMxn: number;
  advanceConfirmedMxn: number;
  purchasesReleased: boolean;
  purchaseDueDate: string | null;
  physicalProgressPct: number;
  collectedPct: number;
  nextPayment: { label: string; amountMxn: number; dueDate: string } | null;
  technicalClosed: boolean;
  financialClosed: boolean;
  alerts: ProjectAlert[];
  budgetMxn?: number;
  incurredMxn?: number;
  committedMxn?: number;
  supplierPaidMxn?: number;
  projectedCostMxn?: number;
  estimatedProfitMxn?: number;
  projectedProfitMxn?: number;
  actualProfitMxn?: number;
  categories?: CategorySummary[];
}
export interface CatalogEntry {
  id: string;
  category: string;
  name: string;
  version: number;
  data: JsonRecord;
  sourceUrl: string;
  sourceDate: string;
  status: "DRAFT" | "APPROVED" | "RETIRED";
  createdAt?: string;
  reviewedBy?: string;
}
export interface ProjectListResponse {
  projects: Project[];
  access: ProjectAccess;
  readiness: ProjectReadiness;
  summaries?: Record<string, ProjectSummary>;
}
export interface ProjectDetailResponse {
  project: Project;
  records: ProjectRecord[];
  access: ProjectAccess;
  summary: ProjectSummary;
  readiness: ProjectReadiness;
}

/** Record payload contract. All money uses MXN, decimal amounts with at most two decimals.
 receipt: {documentId?,periodStart,periodEnd,kWh,amountMxn?,demandKw?,reactiveKvarh?,tariff,confirmed,source:'MANUAL'|'PDF'|'OCR',notes?}
 survey: {scheduledDate?,completedDate?,responsible,voltage,phases,transformerKva?,roofType,availableAreaM2?,acLengthM?,dcLengthM?,checks:Record<string,boolean>,notes,evidenceIds:string[]}
 calculation: {input:EngineeringInput,result:EngineeringResult,inputHash,sourceVersions:[],reviewStatus:'PENDING'} (server computes)
 technical_review: {calculationId,decision:'APPROVED'|'REJECTED',notes,evidence,reviewedSections:string[]}
 proposal: {name,calculationId?,pricingMethod:'USD_PER_WATT'|'COST_PLUS_MARGIN',capacityWp,usdPerWatt?,exchangeRate?,marginPct?,discountPct,vatPct,costLines:[{category,description,quantity,unitCostMxn}],validUntil,conditions,notes?,subtotalMxn,vatMxn,totalMxn,costMxn,profitMxn} (server computes money)
 proposal_acceptance: {proposalId,acceptedAt,customerEvidence}
 budget: {name,proposalId?,lines:[{category,description,amountMxn}],reason,approved:boolean,includedChangeOrderIds:string[]}
 contract: {proposalId,acceptanceId?,documentId?,evidence,scope,subtotalMxn,vatMxn,totalMxn,advanceAmountMxn,startDate?,durationDays?,schedule:[{id,label,amountMxn,dueDate,condition?}],terms,warranties}
 customer_invoice: {contractId,number,date,subtotalMxn,vatMxn,totalMxn,evidence}
 customer_payment: {contractId,invoiceId?,scheduleId?,amountMxn,paidAt,method,reference,evidence,confirmed:boolean}
 supplier_quote: {supplier,description,category,quantity,unit,unitCostMxn,vatPct,totalMxn,validUntil,deliveryDate?,warranty?,evidence}
 purchase_order: {supplier,reference,quoteId?,major:boolean,deliveryDate,lines:[{id,category,description,quantity,unit,unitCostMxn}],subtotalMxn,vatMxn,totalMxn,evidence,notes?}
 material_receipt: {purchaseOrderId,receivedAt,lines:[{lineId,quantity}],evidence,notes?}
 expense: {purchaseOrderId?,supplier,invoiceNumber,date,category,description,subtotalMxn,vatMxn,totalMxn,costBasisMxn,dueDate?,evidence}
 supplier_payment: {expenseId,amountMxn,paidAt,method,reference,evidence}
 purchase_exception: {reason,evidence}
 progress: {date,responsible,percent,description,evidence,incidents?}
 change_order: {description,reason,saleDeltaMxn,saleVatDeltaMxn,costDeltaMxn,timeDeltaDays,evidence}
 change_approval: {changeOrderId,decision:'APPROVED'|'REJECTED',evidence,notes}
 document: {name,section,mimeType,size,sha256,driveFileId?,driveUrl?,status:'PENDING'|'SYNCED'|'ERROR',revisionId?,visibility:'TEAM'|'ADMIN'|'PURCHASES',error?}
 technical_closure: {checks:Record<string,boolean>,evidence,notes}
 financial_closure: {evidence,notes,exceptionReason?}
 reversal: {recordId,reason,evidence}
 note: {text}
 source_review: {sourceId,version,decision:'APPROVED'|'REJECTED',notes,evidence}
 */
