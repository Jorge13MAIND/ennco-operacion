import { priceProposal } from "./finance";
import { calculateEngineering, type EngineeringInput } from "./engineering";
import type {
  ProjectBundle,
  ProjectAccess,
  ProjectRecord,
  RecordKind,
  JsonRecord,
  ProjectSegment,
} from "./types";
/** Explicitly synthetic examples for a read-only preview. No ENNCO customer data. */
export function buildProjectDemoFixtures(
  access: ProjectAccess,
): ProjectBundle[] {
  const segments: ProjectSegment[] = [
    "RESIDENTIAL",
    "COMMERCIAL",
    "INDUSTRIAL",
  ];
  return segments.map((segment, index) => {
    const id = `00000000-0000-4000-8000-${String(index + 101).padStart(12, "0")}`,
      records: ProjectRecord[] = [],
      createdAt = "2026-09-10T12:00:00Z";
    const add = (kind: RecordKind, data: JsonRecord) => {
      const record = {
        id: `00000000-0000-4000-8000-${String((index + 1) * 1000 + records.length + 1).padStart(12, "0")}`,
        projectId: id,
        kind,
        data,
        createdAt,
        actorId: "00000000-0000-4000-8000-000000000002",
        revision: records.length + 2,
      };
      records.push(record);
      return record.id;
    };
    const moduleCount = [10, 40, 180][index]!;
    const scope =
      "Caso ilustrativo para revisar el recorrido; no corresponde a una obra contratada.";
    const customerSnapshot = {
      customerName: `Cliente ${["residencial", "comercial", "industrial"][index]} de ejemplo`,
      contactName: "Contacto de ejemplo",
      location: "Sitio ilustrativo",
      scope,
    };
    const input: EngineeringInput = {
      segment,
      solar: {
        moduleCount,
        module: {
          model: "Módulo sintético 550 W",
          sourceRef: "Fixture sintético de validación",
          powerW: 550,
        },
        performanceRatio: 0.8,
        performanceRatioSourceRef: "Supuesto sintético de demostración",
        monthlyResource: Array.from({ length: 12 }, (_, i) => ({
          month: `2026-${String(i + 1).padStart(2, "0")}`,
          dailyPlaneOfArrayKwhM2: 5,
          sourceRef: "Recurso sintético; no usar en diseño",
          datasetPeriod: "Escenario sintético",
          tiltDeg: 20,
          azimuthDeg: 0,
        })),
      },
    };
    const calculationId = add("calculation", {
      input,
      result: calculateEngineering(input),
      inputHash: "synthetic-preview",
      sourceVersions: [],
      reviewStatus: "PENDING",
      customerSnapshot,
    });
    const totalCost = [80000, 320000, 1440000][index]!;
    const proposalData = priceProposal({
      name: "Propuesta ilustrativa",
      pricingMethod: "COST_PLUS_MARGIN",
      capacityWp: moduleCount * 550,
      marginPct: 20,
      discountPct: 0,
      vatPct: 16,
      costLines: [
        {
          category: "Paneles solares",
          description: "Equipos y ejecución del ejemplo",
          quantity: 1,
          unitCostMxn: totalCost,
        },
      ],
      validUntil: "2026-10-31",
      conditions: scope,
      customerSnapshot,
    });
    const proposalId = add("proposal", {
      ...proposalData,
      ...(index === 0 ? { calculationId } : {}),
    });
    if (index > 0) {
      add("proposal_acceptance", {
        proposalId,
        acceptedAt: "2026-09-10",
        customerEvidence: "Evidencia sintética de aceptación",
      });
      add("budget", {
        name: "Presupuesto del ejemplo",
        proposalId,
        lines: [
          {
            category: "Paneles solares",
            description: "Presupuesto sintético",
            amountMxn: totalCost,
          },
        ],
        reason: "Demostración de control financiero",
        approved: true,
        includedChangeOrderIds: [],
      });
      const total = Number(proposalData.totalMxn),
        advance = total / 2;
      const contractId = add("contract", {
        proposalId,
        evidence: "Contrato sintético",
        scope,
        subtotalMxn: proposalData.subtotalMxn,
        vatMxn: proposalData.vatMxn,
        totalMxn: total,
        advanceAmountMxn: advance,
        schedule: [
          {
            id: "advance",
            label: "Anticipo",
            amountMxn: advance,
            dueDate: "2026-09-10",
          },
          {
            id: "delivery",
            label: "Entrega",
            amountMxn: advance,
            dueDate: "2026-10-10",
          },
        ],
        terms: scope,
        warranties: "Condiciones de ejemplo, no son compromisos de ENNCO",
      });
      add("customer_invoice", {
        contractId,
        number: "FACTURA-SINTETICA",
        date: "2026-09-10",
        subtotalMxn: proposalData.subtotalMxn,
        vatMxn: proposalData.vatMxn,
        totalMxn: total,
        evidence: "Factura de ejemplo",
      });
      add("customer_payment", {
        contractId,
        scheduleId: "advance",
        amountMxn: advance,
        paidAt: "2026-09-10",
        method: "Transferencia ilustrativa",
        reference: "SINTETICO",
        evidence: "Comprobante de ejemplo",
        confirmed: true,
      });
      if (index === 2) {
        const order = add("purchase_order", {
          supplier: "Proveedor de ejemplo",
          reference: "OC-SINTETICA",
          major: true,
          deliveryDate: "2026-09-15",
          lines: [
            {
              id: "equipment",
              category: "Paneles solares",
              description: "Equipo del ejemplo",
              quantity: 1,
              unit: "lote",
              unitCostMxn: totalCost * 0.75,
            },
          ],
          subtotalMxn: totalCost * 0.75,
          vatMxn: totalCost * 0.75 * 0.16,
          totalMxn: totalCost * 0.75 * 1.16,
          evidence: "Orden de ejemplo",
        });
        add("expense", {
          purchaseOrderId: order,
          supplier: "Proveedor de ejemplo",
          invoiceNumber: "GASTO-SINTETICO",
          date: "2026-09-10",
          category: "Paneles solares",
          description: "Recepción parcial ilustrativa",
          subtotalMxn: totalCost * 0.3,
          vatMxn: totalCost * 0.3 * 0.16,
          totalMxn: totalCost * 0.3 * 1.16,
          costBasisMxn: totalCost * 0.3,
          evidence: "Comprobante de ejemplo",
        });
        add("progress", {
          date: "2026-09-10",
          responsible: "Responsable de ejemplo",
          percent: 65,
          description: "Avance ilustrativo de instalación",
          evidence: "Evidencia sintética",
        });
      }
    }
    return {
      project: {
        id,
        organizationId: "00000000-0000-4000-8000-000000000001",
        folio: `DEMO-000${index + 1}`,
        name: `Demo · ${["Residencial 5.5 kWp", "Comercial 22 kWp", "Industrial 99 kWp"][index]}`,
        segment,
        ...customerSnapshot,
        email: "",
        phone: "",
        stage: index === 0 ? "SURVEY" : index === 1 ? "PURCHASES" : "EXECUTION",
        lifecycle: "ACTIVE",
        version: records.length + 1,
        createdAt,
        updatedAt: createdAt,
        data: { ownerName: "Responsable de ejemplo", dueDate: "2026-10-10" },
      },
      records,
      permissions: access,
    };
  });
}
