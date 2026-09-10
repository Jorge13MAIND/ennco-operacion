import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
} from "pdf-lib";
import { activeRecords, projectSummary } from "./finance";
import {
  SEGMENT_LABELS,
  type JsonRecord,
  type ProjectBundle,
  type ProjectRecord,
} from "./types";

export type ProjectDocumentKind =
  | "proposal"
  | "technical"
  | "financial"
  | "contract";
export const CONTRACT_TEMPLATE_VERSION = "ENNCO-CONTRACT-DRAFT-1";
const pending = "[POR COMPLETAR]";
const object = (v: unknown): JsonRecord =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as JsonRecord)
    : {};
const objects = (v: unknown): JsonRecord[] =>
  Array.isArray(v) ? v.map(object) : [];
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
const text = (v: unknown, fallback = pending): string =>
  typeof v === "string" && v.trim() ? v.trim() : fallback;
const numeric = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const formatNumber = (v: unknown, unit = ""): string =>
  numeric(v) === undefined
    ? pending
    : `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 }).format(v as number)}${unit ? ` ${unit}` : ""}`;
const money = (v: unknown): string =>
  numeric(v) === undefined
    ? pending
    : `${new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(v as number)} MXN`;
const yesNo = (v: unknown): string =>
  typeof v !== "boolean" ? "Pendiente" : v ? "Sí" : "No";
const titles: Record<ProjectDocumentKind, string> = {
  proposal: "Propuesta comercial",
  technical: "Expediente técnico",
  financial: "Control financiero interno",
  contract: "Contrato de suministro e instalación",
};

function selectedRecord(
  records: ProjectRecord[],
  kind: ProjectRecord["kind"],
  id?: string,
): ProjectRecord | undefined {
  if (id) {
    const record = records.find((r) => r.id === id && r.kind === kind);
    if (!record) throw new Error("DOCUMENT_REVISION_NOT_FOUND");
    return record;
  }
  return activeRecords(records)
    .filter((r) => r.kind === kind)
    .at(-1);
}
function isTechnicalApproved(
  records: ProjectRecord[],
  calculation?: ProjectRecord,
): boolean {
  if (
    !calculation ||
    !activeRecords(records).some((r) => r.id === calculation.id)
  )
    return false;
  const review = activeRecords(records)
    .filter(
      (r) =>
        r.kind === "technical_review" &&
        r.data.calculationId === calculation.id,
    )
    .at(-1);
  const result = object(calculation.data.result);
  return (
    review?.data.decision === "APPROVED" &&
    typeof result.version === "string" &&
    result.status !== "DRAFT" &&
    Array.isArray(result.missingData) &&
    Array.isArray(result.warnings) &&
    strings(result.missingData).length === 0 &&
    !objects(result.warnings).some((w) => w.severity === "BLOCKER")
  );
}
function clientLines(bundle: ProjectBundle, snapshot?: JsonRecord): string[] {
  const c = snapshot ?? bundle.project;
  return [
    `Cliente: ${text(c.customerName)}`,
    `Contacto: ${text(c.contactName)}`,
    `Sitio: ${text(c.location)}`,
    `Segmento: ${SEGMENT_LABELS[bundle.project.segment]}`,
    `Alcance: ${text(c.scope)}`,
  ];
}
function signatureLines(record?: ProjectRecord): string[] {
  return record
    ? [
        `Revisión del expediente: ${record.revision}`,
        `Identificador de revisión: ${record.id}`,
        `Registrada: ${record.createdAt}`,
      ]
    : ["Revisión del expediente: pendiente de registro"];
}
function evidenceLines(value: JsonRecord): string[] {
  return [
    ...strings(value.assumptions).map((v) => `Supuesto: ${v}`),
    ...strings(value.sourceRefs).map((v) => `Fuente: ${v}`),
  ];
}

function solarLines(
  label: string,
  input: JsonRecord,
  output: JsonRecord,
): string[] {
  const pvModule = object(input.module),
    inverter = object(input.inverter),
    temperature = object(input.temperature);
  return [
    `## ${label}`,
    `Módulo: ${text(pvModule.model)} | Cantidad: ${formatNumber(input.moduleCount)} | Potencia unitaria: ${formatNumber(pvModule.powerW, "Wp")}`,
    `Voc: ${formatNumber(pvModule.vocV, "V")} | Vmp: ${formatNumber(pvModule.vmpV, "V")} | Isc: ${formatNumber(pvModule.iscA, "A")} | Imp: ${formatNumber(pvModule.impA, "A")}`,
    `Coeficiente Voc: ${formatNumber(pvModule.vocTemperaturePctPerC, "%/°C")} | Coeficiente Vmp: ${formatNumber(pvModule.vmpTemperaturePctPerC, "%/°C")}`,
    `Inversor: ${text(inverter.model)} | AC: ${formatNumber(inverter.acPowerKw, "kW")} | Máximo DC: ${formatNumber(inverter.maxDcPowerKw, "kW")}`,
    `Rango MPPT: ${formatNumber(inverter.mpptMinV, "V")} a ${formatNumber(inverter.mpptMaxV, "V")} | Máxima tensión DC: ${formatNumber(inverter.maxDcVoltageV, "V")}`,
    `Corriente MPPT máxima: ${formatNumber(inverter.maxInputCurrentPerMpptA, "A")} | Cortocircuito MPPT máximo: ${formatNumber(inverter.maxShortCircuitCurrentPerMpptA, "A")}`,
    `Temperaturas de celda: ${formatNumber(temperature.minCellC, "°C")} a ${formatNumber(temperature.maxCellC, "°C")} | Fuente: ${text(temperature.sourceRef)}`,
    `PR: ${formatNumber(input.performanceRatio)} | Criterio: ${text(input.performanceRatioSourceRef)}`,
    `Factor de corriente: ${formatNumber(input.shortCircuitDesignFactor)} | Criterio: ${text(input.currentFactorSourceRef)}`,
    ...objects(input.mpptStrings).map(
      (v) =>
        `Distribución MPPT ${formatNumber(v.mppt)}: ${formatNumber(v.modulesInSeries)} módulos por cadena, ${formatNumber(v.parallelStrings)} cadenas en paralelo.`,
    ),
    `Potencia total: ${formatNumber(output.capacityKw, "kWp")} | Relación DC/AC: ${formatNumber(output.dcAcRatio)}`,
    `Generación anual: ${formatNumber(output.annualGenerationKwh, "kWh")} | Generación del periodo calculado: ${formatNumber(output.totalGenerationKwh, "kWh")}`,
    `Compatibilidad de los límites calculados: ${yesNo(output.compatible)}; no equivale a aprobación integral.`,
    ...objects(input.monthlyResource).map(
      (v) =>
        `Recurso ${text(v.month)}: ${formatNumber(v.dailyPlaneOfArrayKwhM2, "kWh/m²/día")} | Inclinación ${formatNumber(v.tiltDeg, "°")} | Azimut ${formatNumber(v.azimuthDeg, "°")} | Periodo ${text(v.datasetPeriod)} | ${text(v.sourceRef)}`,
    ),
    ...objects(output.monthlyGeneration).map(
      (v) =>
        `Generación ${text(v.month)}: ${formatNumber(v.generationKwh, "kWh")}`,
    ),
    ...objects(output.strings).map(
      (v) =>
        `MPPT ${formatNumber(v.mppt)}: Voc frío ${formatNumber(v.coldVocV, "V")}, Vmp caliente ${formatNumber(v.hotVmpV, "V")}, Vmp frío ${formatNumber(v.coldVmpV, "V")}; operación ${formatNumber(v.operatingCurrentA, "A")}, Isc diseño ${formatNumber(v.designShortCircuitCurrentA, "A")}; compatible ${yesNo(v.compatible)}.`,
    ),
    ...evidenceLines(output),
  ];
}

function technicalLines(
  bundle: ProjectBundle,
  records: ProjectRecord[],
  id?: string,
): string[] {
  const calculation = selectedRecord(records, "calculation", id);
  const approved = isTechnicalApproved(records, calculation);
  const input = object(calculation?.data.input),
    output = object(calculation?.data.result);
  const snapshot = calculation?.data.customerSnapshot
    ? object(calculation.data.customerSnapshot)
    : undefined;
  const lines = [
    `Estado: ${approved ? "REVISIÓN TÉCNICA APROBADA REGISTRADA" : "BORRADOR - PENDIENTE DE REVISIÓN TÉCNICA"}`,
    ...clientLines(bundle, snapshot),
    ...signatureLines(calculation),
    ...(snapshot
      ? []
      : [
          "Datos de identificación del proyecto a la fecha de consulta; esta revisión no tiene una copia congelada del cliente. Las entradas y resultados técnicos corresponden al cálculo seleccionado.",
        ]),
    `Versión del motor: ${text(output.version)}`,
    `Huella de entradas: ${text(calculation?.data.inputHash)}`,
    "Este expediente conserva los resultados y entradas de la revisión seleccionada. Un resultado calculado no acredita por sí mismo cumplimiento normativo integral.",
  ];
  if (!calculation)
    return [
      ...lines,
      "No hay una revisión de cálculo guardada. Registrar los datos y el cálculo antes de emitir una memoria técnica.",
    ];
  for (const version of objects(calculation.data.sourceVersions))
    lines.push(
      `Catálogo: ${text(version.id ?? version.sourceId)} | Versión ${formatNumber(version.version)} | Fuente ${text(version.sourceRef ?? version.sourceUrl)}`,
    );
  if (input.preliminarySizing) {
    const p = object(input.preliminarySizing),
      sized = object(output.preliminarySizing);
    lines.push(
      "## Dimensionamiento preliminar",
      `Demanda anual declarada ${formatNumber(p.annualDemandKwh, "kWh")} | Cobertura objetivo ${formatNumber(p.coveragePct, "%")} | Módulo ${formatNumber(p.modulePowerW, "Wp")} | PR ${formatNumber(p.performanceRatio)}`,
      `Rendimiento específico anual ${formatNumber(sized.annualSpecificYieldKwhPerKwp, "kWh/kWp")} | Potencia mínima energética ${formatNumber(sized.minimumCapacityKw, "kWp")}`,
      `Sugerencia: ${formatNumber(sized.moduleCount)} módulos, ${formatNumber(sized.capacityKw, "kWp")} | Generación anual estimada ${formatNumber(sized.estimatedAnnualEnergyKwh, "kWh")} | Cobertura energética ${formatNumber(sized.estimatedCoveragePct, "%")}`,
      ...evidenceLines(sized),
      ...strings(sized.warnings),
    );
  }
  if (input.solar)
    lines.push(
      ...solarLines("Diseño solar", object(input.solar), object(output.solar)),
    );
  for (const system of objects(input.solarSystems)) {
    const computed = objects(output.solarSystems).find(
      (v) => v.id === system.id,
    );
    lines.push(
      ...solarLines(
        `Sistema ${text(system.id)}`,
        object(system.design),
        object(computed?.solar),
      ),
    );
  }
  if (output.solarTotals) {
    const aggregate = object(output.solarTotals);
    lines.push(
      "## Total de sistemas solares",
      `Potencia ${formatNumber(aggregate.capacityKw, "kWp")} | Generación anual ${formatNumber(aggregate.annualGenerationKwh, "kWh")}`,
      ...evidenceLines(aggregate),
    );
  }
  if (input.consumption) {
    const consumption = object(input.consumption),
      calculated = object(output.consumption);
    lines.push(
      "## Consumo y escenario de energía",
      `Consumo confirmado: ${formatNumber(calculated.totalKwh, "kWh")} | Total anual: ${formatNumber(calculated.annualKwh, "kWh")}`,
    );
    for (const period of objects(consumption.months))
      lines.push(
        `${text(period.month)}: ${formatNumber(period.kWh, "kWh")} | Confirmado: ${yesNo(period.confirmed)} | Fuente: ${text(period.sourceRef)}`,
      );
    for (const period of objects(consumption.selfConsumption))
      lines.push(
        `Autoconsumo ${text(period.month)}: ${formatNumber(period.kWh, "kWh")} | Confirmado: ${yesNo(period.confirmed)} | Fuente: ${text(period.sourceRef)}`,
      );
    const tariff = object(consumption.tariff);
    if (consumption.tariff)
      lines.push(
        `Escenario: ${text(tariff.name)} | Energía ${money(tariff.energyRateMxnKwh)}/kWh | Fijo ${money(tariff.fixedMonthlyMxn)} | Demanda mensual ${money(tariff.demandMonthlyMxn)} | Vigencia ${text(tariff.validFrom)} a ${text(tariff.validTo)} | Fuente ${text(tariff.sourceRef)}`,
      );
    for (const period of objects(calculated.monthlyBilling))
      lines.push(
        `Escenario ${text(period.month)}: antes ${money(period.beforeMxn)}, después ${money(period.afterMxn)}, ahorro energético ${money(period.savingsMxn)}, demanda conservada ${money(period.unchangedDemandMxn)}.`,
      );
    lines.push(...evidenceLines(calculated));
  }
  if (input.shadows) {
    const s = object(input.shadows),
      r = object(output.shadows);
    lines.push(
      "## Sombras",
      `Longitud inclinada ${formatNumber(s.panelSlopeLengthM, "m")} | Inclinación ${formatNumber(s.tiltDeg, "°")} | Elevación solar de diseño ${formatNumber(s.designSolarElevationDeg, "°")} | Obstáculo adicional ${formatNumber(s.additionalObstacleHeightM, "m")}`,
      `Altura ${formatNumber(r.panelHeightM, "m")} | Separación libre ${formatNumber(r.clearGapM, "m")} | Paso entre filas ${formatNumber(r.rowPitchM, "m")}`,
      ...evidenceLines(r),
    );
  }
  for (const c of objects(input.circuits)) {
    const r = objects(output.circuits).find((v) => v.id === c.id) ?? {};
    lines.push(
      `## Circuito ${text(c.id)}`,
      `Tipo ${text(c.type)} | Material ${text(c.material)} | Longitud de ida ${formatNumber(c.oneWayLengthM, "m")} | Tensión ${formatNumber(c.voltageV, "V")} | Corriente ${formatNumber(c.currentA, "A")}`,
      `Sección ${formatNumber(c.crossSectionMm2, "mm²")} | Resistividad ${formatNumber(c.resistivityOhmMm2PerM, "ohm mm²/m")} a ${formatNumber(c.conductorTemperatureC, "°C")} | FP ${formatNumber(c.powerFactor)} | Reactancia ${formatNumber(c.reactanceOhmPerKm, "ohm/km")}`,
      `Caída ${formatNumber(r.voltageDropV, "V")} (${formatNumber(r.voltageDropPct, "%")}) | Dentro del límite: ${yesNo(r.meetsVoltageDropLimit)}`,
      `Ampacidad corregida ${formatNumber(r.correctedAmpacityA, "A")} | Requerida ${formatNumber(r.requiredAmpacityA, "A")} | Dentro de regla ${yesNo(r.meetsAmpacity)}`,
      `Protección ${formatNumber(c.breakerA, "A")} | Dentro de regla ${yesNo(r.breakerWithinReviewedRule)} | Tierra ${formatNumber(c.groundCrossSectionMm2, "mm²")} | Dentro de regla ${yesNo(r.groundWithinReviewedRule)}`,
      `Ocupación canalización ${formatNumber(r.conduitFillFraction)} | Dentro de regla ${yesNo(r.meetsConduitFill)}`,
      ...evidenceLines(r),
    );
    for (const key of ["ampacity", "protectionRule", "conduit"] as const) {
      const rule = object(c[key]);
      if (c[key])
        lines.push(
          `Regla ${key}: ${text(rule.sourceRef)} | Versión ${text(rule.version)} | Revisada ${yesNo(rule.reviewed)}`,
        );
    }
  }
  if (input.capacitor) {
    const c = object(input.capacitor),
      r = object(output.capacitor);
    lines.push(
      "## Compensación reactiva: estimación",
      `Potencia activa ${formatNumber(c.activeKw, "kW")} | FP medido ${formatNumber(c.measuredPowerFactor)} | FP objetivo ${formatNumber(c.targetPowerFactor)}`,
      `Compensación estimada ${formatNumber(r.compensationKvar, "kvar")} | Potencia aparente antes ${formatNumber(r.apparentBeforeKva, "kVA")} | Después ${formatNumber(r.apparentAfterKva, "kVA")}`,
      ...evidenceLines(r),
    );
  }
  if (output.materials) {
    const materials = object(output.materials);
    lines.push("## Cantidades de materiales (sin precios)");
    for (const item of objects(materials.items))
      lines.push(
        `${text(item.description)}: requerido ${formatNumber(item.requiredQuantity, text(item.unit, ""))} | Compra ${formatNumber(item.purchaseQuantity, text(item.unit, ""))} | Unidades comerciales ${formatNumber(item.commercialUnits)}`,
      );
    lines.push(...evidenceLines(materials));
  }
  if (input.qualityStudy) {
    const q = object(input.qualityStudy);
    lines.push(
      "## Estudio manual de calidad",
      `Objetivo ${text(q.objective)} | Instrumento ${text(q.instrument)} | Fecha ${text(q.measuredAt)}`,
      `Hallazgos: ${text(q.findings)}`,
      ...strings(q.evidenceRefs).map((v) => `Medición: ${v}`),
      "Requiere interpretación del responsable; no se ha aplicado un algoritmo automático de armónicos.",
    );
  }
  lines.push(
    "## Faltantes y advertencias",
    ...strings(output.missingData).map((v) => `Falta: ${v}`),
  );
  for (const warning of objects(output.warnings))
    lines.push(
      `${text(warning.severity)} / ${text(warning.code)}: ${text(warning.message)}`,
    );
  lines.push("## Fuentes de la revisión", ...strings(output.sourceRefs));
  return lines;
}

function proposalLines(
  bundle: ProjectBundle,
  records: ProjectRecord[],
  id?: string,
): string[] {
  const proposal = selectedRecord(records, "proposal", id);
  const active = activeRecords(records);
  const acceptance = active.findLast(
    (r) =>
      r.kind === "proposal_acceptance" && r.data.proposalId === proposal?.id,
  );
  const calculation = active.find(
    (r) => r.kind === "calculation" && r.id === proposal?.data.calculationId,
  );
  const snapshot = proposal?.data.customerSnapshot
    ? object(proposal.data.customerSnapshot)
    : undefined;
  const snapshotComplete =
    snapshot &&
    ["customerName", "location", "scope"].every(
      (k) => typeof snapshot[k] === "string" && (snapshot[k] as string).trim(),
    );
  const approved = Boolean(
    proposal &&
      active.some((r) => r.id === proposal.id) &&
      acceptance &&
      snapshotComplete &&
      (!proposal.data.calculationId ||
        isTechnicalApproved(records, calculation)),
  );
  const data = proposal?.data ?? {};
  const lines = [
    `Estado: ${approved ? "PROPUESTA ACEPTADA - REVISIÓN CONSERVADA" : "BORRADOR - REVISIÓN Y ACEPTACIÓN PENDIENTES"}`,
    ...clientLines(bundle, snapshot),
    ...signatureLines(proposal),
    ...(snapshot
      ? []
      : [
          "Datos de cliente y alcance de la captura actual; falta congelar la información comercial de esta revisión.",
        ]),
    "## Propuesta",
    `Nombre: ${text(data.name)}`,
    `Potencia ofertada: ${formatNumber(data.capacityWp, "Wp")}`,
    `Subtotal: ${money(data.subtotalMxn)}`,
    `IVA: ${money(data.vatMxn)}`,
    `TOTAL A PAGAR: ${money(data.totalMxn)}`,
    `Vigencia: ${text(data.validUntil)}`,
    `Condiciones comerciales: ${text(data.conditions)}`,
  ];
  // Deliberate allowlist: never costLines, costMxn, marginPct, profitMxn, notes, raw tokens or JSON.
  if (calculation) {
    const result = object(calculation.data.result),
      solar = object(result.solarTotals ?? result.solar);
    lines.push(
      "## Referencia técnica",
      `Revisión técnica: ${calculation.id}`,
      `Motor: ${text(result.version)}`,
      `Potencia DC: ${formatNumber(solar.capacityKw, "kWp")}`,
      `Generación anual estimada: ${formatNumber(solar.annualGenerationKwh, "kWh")}`,
      "La generación es una estimación sujeta a los supuestos del estudio. No representa garantía de facturación ni de ahorro.",
    );
  }
  if (data.economics) {
    const economics = object(data.economics);
    lines.push(
      "## Retorno simple estimado",
      `Método: antes de IVA | Revisión de cálculo: ${text(economics.calculationId)} | Modelo: ${text(economics.version)}`,
    );
    if (
      economics.status === "ESTIMATE" &&
      numeric(economics.simplePaybackYears) !== undefined
    ) {
      lines.push(
        `Inversión antes de IVA: ${money(economics.investmentMxn)}`,
        `Ahorro energético anual estimado: ${money(economics.annualEnergySavingsMxn)}`,
        `Operación anual del sistema antes de IVA: ${money(economics.annualOperatingCostMxn)}`,
        `Ahorro anual después de operación: ${money(economics.netAnnualSavingsMxn)}`,
        `Retorno simple: ${formatNumber(economics.simplePaybackYears, "años")}`,
        `Periodo del escenario: ${text(economics.periodFrom)} a ${text(economics.periodTo)}`,
      );
    } else lines.push(`Retorno pendiente: ${text(economics.missingReason)}`);
    lines.push(...strings(economics.limitations));
  }
  if (acceptance)
    lines.push(`Aceptación registrada: ${text(acceptance.data.acceptedAt)}`);
  return lines;
}

function contractLines(
  bundle: ProjectBundle,
  records: ProjectRecord[],
  id?: string,
): string[] {
  const active = activeRecords(records);
  const selected = id
    ? records.find(
        (r) => r.id === id && ["contract", "proposal"].includes(r.kind),
      )
    : undefined;
  if (id && !selected) throw new Error("DOCUMENT_REVISION_NOT_FOUND");
  const contract =
    selected?.kind === "contract"
      ? selected
      : selected?.kind === "proposal"
        ? active.findLast(
            (r) => r.kind === "contract" && r.data.proposalId === selected.id,
          )
        : active.filter((r) => r.kind === "contract").at(-1);
  const proposal =
    selected?.kind === "proposal"
      ? selected
      : contract
        ? records.find(
            (r) => r.kind === "proposal" && r.id === contract.data.proposalId,
          )
        : active
            .filter(
              (r) =>
                r.kind === "proposal" &&
                active.some(
                  (a) =>
                    a.kind === "proposal_acceptance" &&
                    a.data.proposalId === r.id,
                ),
            )
            .at(-1);
  const acceptance = active.findLast(
    (r) =>
      r.kind === "proposal_acceptance" && r.data.proposalId === proposal?.id,
  );
  const data = contract?.data ?? {},
    legal = object(data.legalDetails);
  const snapshot = proposal?.data.customerSnapshot
    ? object(proposal.data.customerSnapshot)
    : undefined;
  const monetary = contract?.data ?? proposal?.data ?? {};
  const total = numeric(monetary.totalMxn),
    advance = numeric(data.advanceAmountMxn);
  const lines = [
    "Estado: BORRADOR - PLANTILLA PENDIENTE DE VALIDACIÓN LEGAL ENNCO",
    `Plantilla: ${CONTRACT_TEMPLATE_VERSION}`,
    "Este documento de trabajo no sustituye el contrato firmado. Completar campos y validar la plantilla, representación y legislación aplicable antes de firma.",
    ...signatureLines(contract ?? proposal),
    ...clientLines(bundle, snapshot),
    `Propuesta de referencia: ${text(proposal?.id)}`,
    `Aceptación registrada: ${acceptance ? text(acceptance.data.acceptedAt) : "PENDIENTE; este borrador no acredita aceptación"}`,
    "## 1. Partes y representación",
    `Prestador (razón social legal): ${text(legal.legalNameEnnco)} | Nombre comercial: ENNCO`,
    `RFC del prestador: ${text(legal.enncoRfc)} | Domicilio: ${text(legal.enncoAddress)}`,
    `Representante del prestador: ${text(legal.enncoRepresentative)} | Facultades/documento: ${text(legal.providerAuthority)}`,
    `Cliente (nombre o razón social legal): ${text(legal.customerLegalName)}`,
    `RFC del cliente: ${text(legal.customerRfc)} | Domicilio: ${text(legal.customerAddress)}`,
    `Representante del cliente: ${text(legal.customerRepresentative)} | Facultades/documento: ${text(legal.customerAuthority)}`,
    "Las partes deberán confirmar su identidad, capacidad, representación y facultades respecto del inmueble antes de suscribir este instrumento.",
    "## 2. Objeto, alcance y anexos",
    `ENNCO suministrará e instalará los equipos y servicios expresamente descritos en la propuesta de referencia y su anexo técnico. Alcance contractual: ${text(data.scope, text(snapshot?.scope))}`,
    `Exclusiones específicas: ${text(legal.scopeExclusions)} | Relación de anexos y revisiones: ${text(legal.annexes)}`,
    "La versión aceptada identifica cantidades, modelos, ubicación, trabajos y entregables. Cualquier sustitución o adicional deberá acordarse mediante una modificación documentada antes de su ejecución.",
    "## 3. Precio, impuestos y condiciones de pago",
    `Subtotal: ${money(monetary.subtotalMxn)} | IVA: ${money(monetary.vatMxn)} | TOTAL A PAGAR: ${money(monetary.totalMxn)}`,
    `Anticipo: ${money(advance)} | Porcentaje del total: ${advance !== undefined && total !== undefined && total > 0 ? formatNumber((advance / total) * 100, "%") : pending}`,
    `Medio y datos de pago verificados: ${text(legal.paymentInstructions)}`,
    "El calendario deberá cubrir el importe contractual completo e identificar fecha, condición y monto de cada pago. Los comprobantes de facturación y de pago se registran por separado; emitir una factura no acredita recepción de fondos.",
    ...objects(data.schedule).map(
      (p) =>
        `Parcialidad ${text(p.label)}: ${money(p.amountMxn)} | Vencimiento ${text(p.dueDate)} | Condición ${text(p.condition)}`,
    ),
    ...(objects(data.schedule).length
      ? []
      : [`Calendario de pagos: ${pending}`]),
    "## 4. Inicio, compras y programa de ejecución",
    `Inicio previsto: ${text(data.startDate)} | Duración pactada: ${formatNumber(data.durationDays, "días")} | Naturaleza de los días: ${text(legal.durationDayType)}`,
    "La liberación administrativa de compras requiere confirmación del anticipo previsto. Una excepción interna de Dirección debe documentarse y no modifica por sí sola el precio, calendario u obligaciones pactadas con el cliente.",
    "El objetivo interno de ENNCO para compras principales es de cinco días hábiles desde la confirmación del anticipo. Este objetivo de compras no constituye una fecha automática de entrega de la instalación.",
    `Hitos de suministro, instalación y entrega: ${text(legal.deliveryMilestones)}`,
    "Cualquier incidencia de suministro, acceso, clima o tercero que afecte el programa se comunicará, documentará y gestionará conforme a los mecanismos que las partes acuerden; no autoriza cambios unilaterales ilimitados.",
    "## 5. Obligaciones de ENNCO y condiciones del sitio",
    "ENNCO coordinará personal, materiales y actividades incluidos en el alcance, mantendrá evidencia del avance y aplicará las medidas de seguridad correspondientes a los trabajos. Informará hallazgos que requieran modificación del alcance antes de ejecutar el adicional.",
    `Responsable operativo ENNCO y canal de coordinación: ${text(legal.providerCoordinator)}`,
    "El cliente facilitará el acceso autorizado al inmueble, información disponible sobre instalaciones y permisos de intervención a su cargo. Se coordinarán horarios, accesos, maniobras y cortes de energía para evitar riesgos y afectaciones no previstas.",
    `Responsabilidades y apoyos específicos del cliente: ${text(legal.customerResponsibilities)}`,
    `Condiciones de seguridad, permisos de trabajo y responsables: ${text(legal.safetyConditions)}`,
    "## 6. Cambios y trabajos adicionales",
    "Cada cambio identificará motivo, alcance, efecto en precio e impuestos, calendario y entregables. Se ejecutará después de la autorización expresa documentada de las partes. Una nota de obra no acredita por sí misma aceptación comercial del cliente.",
    `Medio y representantes autorizados para cambios: ${text(legal.changeAuthorization)}`,
    "## 7. Pruebas, entrega y trámites",
    `Pruebas y criterios de aceptación técnica: ${text(legal.acceptanceCriteria)}`,
    `Responsable, alcance y pagos de trámites/interconexión: ${text(legal.interconnectionResponsibilities)}`,
    "La entrega técnica se documentará con pruebas, evidencias, fichas, manuales, garantías y pendientes expresos del alcance. Los plazos o resoluciones de CFE u otras autoridades deberán distinguirse de las actividades bajo responsabilidad de ENNCO.",
    "El cierre técnico y la conciliación financiera se registrarán por separado. La entrega no elimina saldos ni obligaciones vigentes; el pago no elimina obligaciones técnicas o garantías aplicables.",
    "## 8. Garantías y atención posterior",
    `Garantías generales pactadas: ${text(data.warranties)}`,
    `Equipos: proveedor responsable, duración, inicio y alcance: ${text(legal.equipmentWarranty)}`,
    `Instalación y mano de obra: responsable, duración, inicio y alcance: ${text(legal.workmanshipWarranty)}`,
    `Procedimiento, documentos, domicilio y contacto para reclamaciones: ${text(legal.warrantyProcedure)}`,
    `Condiciones de mantenimiento y exclusiones específicas: ${text(legal.warrantyConditions)}`,
    "Las garantías se entregarán por escrito y se distinguirán por equipo, fabricación e instalación. No se fijan automáticamente años de cobertura ni se sustituyen derechos legalmente aplicables por referencias genéricas del fabricante.",
    "## 9. Suspensión, cancelación y obligaciones pendientes",
    `Causas, aviso, procedimiento, plazos y efectos pactados: ${text(legal.cancellationTerms)}`,
    "Ante una suspensión o terminación, las partes documentarán avance, bienes adquiridos, trabajos realizados, anticipos, facturas, pagos y compromisos comprobables. La conciliación determinará saldos, devoluciones y entrega de bienes/documentos conforme a lo pactado y la legislación aplicable.",
    "Este borrador no establece pérdida automática del anticipo ni cargos o penalizaciones sin definición y revisión expresa. Las garantías y demás obligaciones que correspondan se conservarán conforme a su naturaleza.",
    "## 10. Comunicación, controversias y firma",
    `Domicilios/correos de notificación: ${text(legal.noticeContacts)}`,
    `Legislación, competencia y mecanismos de solución aplicables: ${text(legal.jurisdiction)}`,
    "Se deberán revisar las disposiciones civiles, mercantiles, locales y de protección al consumidor que correspondan al caso. No se pacta aquí renuncia a derechos irrenunciables ni a competencias legalmente establecidas.",
    `Condiciones particulares adicionales: ${text(data.terms)}`,
    `Lugar y fecha de firma: ${text(legal.signaturePlaceDate)}`,
    "Por ENNCO: nombre, carácter y firma ____________________",
    "Por el cliente: nombre, carácter y firma ____________________",
    "Anexos aceptados: propuesta, memoria/alcance, programa de pagos, entregables y garantías identificados por revisión. Entregar copia íntegra a ambas partes.",
    "Fuentes de revisión de la plantilla: Cámara de Diputados, Código Civil Federal (arts. 1794-1803) y Ley Federal de Protección al Consumidor (arts. 7, 7 Bis, 77-78, 85-86 Bis), cuando resulten aplicables. La plantilla no cuenta con dictamen ni registro PROFECO acreditados.",
  ];
  return lines;
}

function financialLines(
  bundle: ProjectBundle,
  records: ProjectRecord[],
  id?: string,
): string[] {
  if (
    !bundle.permissions.canReadCosts ||
    bundle.permissions.costScope !== "ALL"
  )
    throw new Error("PROJECT_FINANCIAL_DOCUMENT_FORBIDDEN");
  let snapshotRecords = records;
  if (id) {
    const cutoff = records.find((r) => r.id === id);
    if (!cutoff) throw new Error("DOCUMENT_REVISION_NOT_FOUND");
    snapshotRecords = records.filter((r) => r.revision <= cutoff.revision);
  }
  const cutoff = snapshotRecords.at(-1),
    active = activeRecords(snapshotRecords);
  const date = new Date(cutoff?.createdAt ?? bundle.project.updatedAt);
  if (!Number.isFinite(date.getTime()))
    throw new Error("DOCUMENT_DATE_INVALID");
  const summary = projectSummary(snapshotRecords, bundle.permissions, date);
  const lines = [
    "Estado: CONTROL INTERNO - ACCESO RESTRINGIDO",
    ...clientLines(bundle),
    ...signatureLines(cutoff),
    `Corte del expediente: ${date.toISOString()}`,
    "Importes en MXN. Facturas, costos incurridos y pagos son movimientos diferentes y no se suman dos veces.",
    "## Contratación y cobranza",
    `Contratado: ${money(summary.contractedMxn)}`,
    `Facturado: ${money(summary.invoicedMxn)}`,
    `Cobrado: ${money(summary.collectedMxn)}`,
    `Saldo: ${money(summary.balanceMxn)}`,
    `Anticipo requerido: ${money(summary.advanceRequiredMxn)} | Confirmado: ${money(summary.advanceConfirmedMxn)}`,
    `Compras liberadas: ${yesNo(summary.purchasesReleased)} | Objetivo de compras: ${text(summary.purchaseDueDate)}`,
    `Avance físico: ${formatNumber(summary.physicalProgressPct, "%")} | Porcentaje cobrado: ${formatNumber(summary.collectedPct, "%")}`,
    "## Presupuesto y costos",
    `Presupuesto autorizado: ${money(summary.budgetMxn)}`,
    `Compras comprometidas: ${money(summary.committedMxn)}`,
    `Costos incurridos: ${money(summary.incurredMxn)}`,
    `Pagos a proveedores: ${money(summary.supplierPaidMxn)}`,
    `Costo proyectado: ${money(summary.projectedCostMxn)}`,
  ];
  for (const category of summary.categories ?? [])
    lines.push(
      `${category.category}: presupuesto ${money(category.budgetMxn)}, incurrido ${money(category.incurredMxn)}, comprometido ${money(category.committedMxn)}, pagado ${money(category.paidMxn)}, diferencia ${money(category.differenceMxn)}.`,
    );
  if (bundle.permissions.canReadMargins)
    lines.push(
      "## Utilidad del proyecto",
      `Estimada: ${money(summary.estimatedProfitMxn)}`,
      `Proyectada: ${money(summary.projectedProfitMxn)}`,
      `Real al cierre: ${money(summary.actualProfitMxn)}`,
      "Estas cifras corresponden a la utilidad del proyecto según los costos registrados; no son la utilidad neta de toda la empresa.",
    );
  lines.push("## Movimientos incluidos en el corte");
  for (const r of active) {
    const d = r.data;
    if (r.kind === "customer_invoice")
      lines.push(
        `Factura cliente ${text(d.number)} | ${text(d.date)} | Subtotal ${money(d.subtotalMxn)} | IVA ${money(d.vatMxn)} | Total ${money(d.totalMxn)}`,
      );
    if (r.kind === "customer_payment")
      lines.push(
        `Cobro ${text(d.reference)} | ${text(d.paidAt)} | ${money(d.amountMxn)} | Confirmado ${yesNo(d.confirmed)}`,
      );
    if (r.kind === "purchase_order")
      lines.push(
        `Compra ${text(d.reference)} | ${text(d.supplier)} | Subtotal ${money(d.subtotalMxn)} | IVA ${money(d.vatMxn)} | Total ${money(d.totalMxn)}`,
      );
    if (r.kind === "expense")
      lines.push(
        `Gasto ${text(d.category)} | ${text(d.supplier)} | ${text(d.invoiceNumber)} | ${text(d.description)} | Subtotal ${money(d.subtotalMxn)} | IVA ${money(d.vatMxn)} | Total ${money(d.totalMxn)} | Base de costo ${money(d.costBasisMxn)}`,
      );
    if (r.kind === "supplier_payment")
      lines.push(
        `Pago proveedor ${text(d.reference)} | ${text(d.paidAt)} | ${money(d.amountMxn)} | Gasto ${text(d.expenseId)}`,
      );
  }
  lines.push(
    "## Cierre y avisos",
    `Cierre técnico: ${yesNo(summary.technicalClosed)} | Cierre financiero: ${yesNo(summary.financialClosed)}`,
    ...summary.alerts.map((a) => `${a.code}: ${a.message}`),
  );
  return lines;
}

/** Explicit allowlists are the data boundary for all PDFs. Never serialize a ProjectBundle into a document or token. */
export function buildProjectDocumentLines(
  bundle: ProjectBundle,
  kind: ProjectDocumentKind,
  revisionId?: string,
): string[] {
  if (!Object.hasOwn(titles, kind))
    throw new Error("INVALID_PROJECT_DOCUMENT_KIND");
  const records = [...bundle.records].sort((a, b) => a.revision - b.revision);
  const renderers = {
    proposal: proposalLines,
    technical: technicalLines,
    financial: financialLines,
    contract: contractLines,
  };
  return [
    `# ${titles[kind]}`,
    `Folio: ${bundle.project.folio}`,
    ...renderers[kind](bundle, records, revisionId),
  ];
}

/** Standard PDF fonts encode WinAnsi. Preserve Spanish accents and replace unsupported glyphs without failing export. */
export function projectPdfSafeText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u2192/g, " -> ")
    .replace(/\u221a/g, "sqrt")
    .replace(/\u03a9/g, "ohm")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/[^\x20-\x7e\xa1-\xff\n]/gu, "?");
}
function wrapLine(
  value: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of projectPdfSafeText(value).split(/\r?\n/)) {
    let line = "";
    for (const token of paragraph.split(/\s+/)) {
      if (!token) continue;
      if (
        font.widthOfTextAtSize(`${line}${line ? " " : ""}${token}`, size) <=
        width
      ) {
        line += `${line ? " " : ""}${token}`;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      let part = "";
      for (const char of token) {
        if (part && font.widthOfTextAtSize(part + char, size) > width) {
          lines.push(part);
          part = "";
        }
        part += char;
      }
      line = part;
    }
    lines.push(line);
  }
  return lines;
}

export async function generateProjectPdf(
  bundle: ProjectBundle,
  kind: ProjectDocumentKind,
  revisionId?: string,
): Promise<Uint8Array> {
  // Build before allocating PDF: permissions/revision checks fail before serialization.
  const lines = buildProjectDocumentLines(bundle, kind, revisionId);
  const draft = lines.some((line) => line.startsWith("Estado: BORRADOR"));
  const pdf = await PDFDocument.create();
  pdf.setTitle(projectPdfSafeText(`${titles[kind]} - ${bundle.project.folio}`));
  pdf.setAuthor("ENNCO");
  pdf.setCreator("Proyectos ENNCO");
  pdf.setSubject(
    draft
      ? "Borrador para revisión"
      : kind === "financial"
        ? "Control interno restringido"
        : "Revisión del expediente",
  );
  // No personal data, raw JSON, private cost fields or signed payload is embedded as metadata/attachments.
  const regular = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.04, 0.13, 0.23),
    muted = rgb(0.35, 0.4, 0.47),
    pale = rgb(0.91, 0.94, 0.96);
  let page = pdf.addPage([612, 792]),
    y = 694;
  const addHeader = () => {
    page.drawRectangle({ x: 0, y: 724, width: 612, height: 68, color: navy });
    page.drawText("ENNCO", {
      x: 42,
      y: 755,
      size: 19,
      font: bold,
      color: rgb(1, 1, 1),
    });
    page.drawText(projectPdfSafeText(titles[kind]), {
      x: 42,
      y: 736,
      size: 10,
      font: regular,
      color: rgb(1, 0.76, 0.17),
    });
    if (draft)
      page.drawText("BORRADOR", {
        x: 130,
        y: 330,
        size: 52,
        font: bold,
        rotate: degrees(35),
        color: pale,
        opacity: 0.48,
      });
    if (kind === "financial")
      page.drawText("INTERNO", {
        x: 175,
        y: 325,
        size: 58,
        font: bold,
        rotate: degrees(35),
        color: pale,
        opacity: 0.4,
      });
  };
  addHeader();
  for (const original of lines) {
    const heading = original.startsWith("#"),
      content = original.replace(/^#{1,2}\s*/, "");
    const font = heading ? bold : regular,
      size = heading ? 12 : 9;
    const wrapped = wrapLine(content, font, size, 528);
    if (heading && y < 120) {
      page = pdf.addPage([612, 792]);
      y = 694;
      addHeader();
    }
    if (heading) y -= 8;
    for (const line of wrapped) {
      if (y < 64) {
        page = pdf.addPage([612, 792]);
        y = 694;
        addHeader();
      }
      page.drawText(line, {
        x: 42,
        y,
        size,
        font,
        color: heading ? navy : rgb(0.1, 0.14, 0.2),
      });
      y -= heading ? 17 : 13;
    }
    y -= 4;
  }
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    p.drawLine({
      start: { x: 42, y: 47 },
      end: { x: 570, y: 47 },
      thickness: 0.6,
      color: pale,
    });
    const footer = `${bundle.project.folio} | ${draft ? "BORRADOR" : kind === "financial" ? "USO INTERNO" : "EXPEDIENTE"} | ${index + 1}/${pages.length}`;
    p.drawText(projectPdfSafeText(footer), {
      x: 42,
      y: 30,
      size: 7,
      font: regular,
      color: muted,
    });
  });
  return pdf.save();
}
