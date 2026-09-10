"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import {
  engineeringInputSchema,
  type EngineeringResult,
} from "@/lib/projects/engineering";
import type { CatalogEntry, JsonRecord } from "@/lib/projects/types";
import {
  History,
  RecordForm,
  Repeater,
  rowsFromForm,
  type SectionProps,
} from "./records";
import { PdfLinks } from "./ProjectCommercial";
import {
  Badge,
  Check,
  DetailList,
  EvidenceField,
  Field,
  Form,
  Metric,
  Notice,
  Panel,
  RecordSelect,
  activeRecords,
  isChecked,
  list,
  money,
  num,
  obj,
  quantity,
  str,
  textValue,
  useProjectMutation,
  useResource,
} from "./ui";

type Control = {
  key: string;
  label: string;
  type?: "number" | "month" | "text" | "textarea" | "boolean";
  optional?: boolean;
  min?: number;
  max?: number;
  help?: string;
  options?: { value: string; label: string }[];
};
const n = (
  key: string,
  label: string,
  optional = false,
  min?: number,
  max?: number,
): Control => ({ key, label, type: "number", optional, min, max });
const t = (key: string, label: string, optional = false): Control => ({
  key,
  label,
  optional,
});
const b = (key: string, label: string): Control => ({
  key,
  label,
  type: "boolean",
});
const m = (key: string, label: string): Control => ({
  key,
  label,
  type: "month",
});
const choose = (
  key: string,
  label: string,
  options: { value: string; label: string }[],
): Control => ({ key, label, options });
function pathValue(data: JsonRecord, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((value, part) => obj(value)[part], data);
}
function Controls({
  prefix,
  fields,
  defaults = {},
}: {
  prefix: string;
  fields: Control[];
  defaults?: JsonRecord;
}) {
  return (
    <div className="projects-form-grid">
      {fields.map((control) => {
        const value = pathValue(defaults, control.key);
        const name = `${prefix}.${control.key}${control.type === "number" ? "~n" : control.type === "boolean" ? "~b" : ""}`;
        return control.type === "boolean" ? (
          <div key={control.key}>
            <input type="hidden" name={name} value="false" />
            <Check name={name} checked={value === true}>
              {control.label}
            </Check>
          </div>
        ) : (
          <Field
            key={`${control.key}-${String(value ?? "")}`}
            name={name}
            label={control.label}
            type={control.type ?? "text"}
            required={!control.optional}
            min={control.min}
            max={control.max}
            options={control.options}
            help={control.help}
            defaultValue={
              typeof value === "string" || typeof value === "number"
                ? value
                : undefined
            }
            wide={control.type === "textarea"}
          />
        );
      })}
    </div>
  );
}
function readControls(form: FormData, prefix: string): JsonRecord {
  const result: JsonRecord = {};
  for (const [name, raw] of form.entries()) {
    if (!name.startsWith(`${prefix}.`) || typeof raw !== "string" || raw === "")
      continue;
    const [path = "", type] = name.slice(prefix.length + 1).split("~");
    const parts = path.split(".");
    let target = result;
    parts.forEach((part, index) => {
      if (index === parts.length - 1)
        target[part] =
          type === "n" ? Number(raw) : type === "b" ? raw === "on" : raw.trim();
      else {
        target[part] ??= {};
        target = obj(target[part]);
      }
    });
  }
  return result;
}
function OptionalSection({
  name,
  title,
  description,
  children,
  defaultOpen = false,
}: {
  name: string;
  title: string;
  description?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [enabled, setEnabled] = useState(defaultOpen);
  return (
    <section className="projects-disclosure">
      <label className="projects-check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <strong>{title}</strong>
      </label>
      {description ? <p className="projects-help">{description}</p> : null}
      {enabled ? (
        <>
          <input type="hidden" name={`${name}Enabled`} value="yes" />
          <div style={{ marginTop: 18 }}>{children}</div>
        </>
      ) : null}
    </section>
  );
}
const CatalogContext = createContext<CatalogEntry[]>([]);
function CatalogPicker({
  category,
  onSelect,
}: {
  category: string;
  onSelect: (entry: CatalogEntry | undefined) => void;
}) {
  const entries = useContext(CatalogContext).filter(
    (entry) =>
      entry.status === "APPROVED" && entry.category.toUpperCase() === category,
  );
  if (!entries.length)
    return (
      <p className="projects-help">
        Sin ficha aprobada en esta categoría. Puedes capturar una fuente para
        revisión o preparar la ficha en Catálogos.
      </p>
    );
  return (
    <label className="projects-field" style={{ marginBottom: 18 }}>
      <span>Usar una referencia aprobada</span>
      <select
        defaultValue=""
        onChange={(event) =>
          onSelect(entries.find((entry) => entry.id === event.target.value))
        }
      >
        <option value="">Captura de este proyecto</option>
        {entries.map((entry) => (
          <option value={entry.id} key={entry.id}>
            {entry.name} · versión {entry.version}
          </option>
        ))}
      </select>
    </label>
  );
}
function RuleControls({
  prefix,
  defaults,
  fields,
  category,
}: {
  prefix: string;
  defaults: JsonRecord;
  fields: Control[];
  category: string;
}) {
  const [selected, setSelected] = useState<CatalogEntry>();
  const values = selected
    ? {
        ...selected.data,
        sourceRef: selected.sourceUrl,
        version: String(selected.version),
        reviewed: true,
      }
    : defaults;
  return (
    <>
      <CatalogPicker category={category} onSelect={setSelected} />
      <Controls prefix={prefix} defaults={values} fields={fields} />
    </>
  );
}
const ruleFields: Control[] = [
  t("sourceRef", "Fuente / documento de la regla"),
  t("version", "Versión de la fuente"),
  b("reviewed", "La regla fue revisada y corresponde a este proyecto."),
];

function ResourceRows({
  name,
  defaults,
}: {
  name: string;
  defaults: JsonRecord[];
}) {
  const [selected, setSelected] = useState<CatalogEntry>();
  const rows = selected ? list(selected.data.monthlyResource) : defaults;
  return (
    <>
      <CatalogPicker category="SOLAR_RESOURCE" onSelect={setSelected} />
      {selected ? (
        <Notice>
          Recurso seleccionado: {selected.name}, versión {selected.version}.
          Comprueba que el sitio, el plano y el año del escenario corresponden a
          este proyecto.
        </Notice>
      ) : null}
      <Repeater
        key={selected?.id ?? "manual"}
        name={name}
        label="Recurso por mes"
        initialCount={Math.max(1, rows.length)}
        max={12}
      >
        {(row, index) => (
          <Controls
            prefix={row}
            defaults={rows[index]}
            fields={[
              m("month", "Mes"),
              n(
                "dailyPlaneOfArrayKwhM2",
                "Irradiación diaria en el plano (kWh/m²)",
                false,
                0,
                24,
              ),
              t("sourceRef", "Fuente"),
              t("datasetPeriod", "Periodo del conjunto de datos"),
              n("tiltDeg", "Inclinación (°)", false, 0, 90),
              n("azimuthDeg", "Azimut (°)", false, -180, 180),
            ]}
          />
        )}
      </Repeater>
    </>
  );
}

function SolarDesign({
  prefix,
  defaults,
}: {
  prefix: string;
  defaults: JsonRecord;
}) {
  const [module, setModule] = useState<CatalogEntry>();
  const [inverter, setInverter] = useState<CatalogEntry>();
  const moduleDefaults = module
    ? { ...defaults, module: { ...module.data, sourceRef: module.sourceUrl } }
    : defaults;
  const inverterDefaults = inverter
    ? {
        ...defaults,
        inverter: { ...inverter.data, sourceRef: inverter.sourceUrl },
      }
    : defaults;
  return (
    <div>
      <CatalogPicker category="MODULE" onSelect={setModule} />
      <Controls
        prefix={prefix}
        defaults={moduleDefaults}
        fields={[
          n("moduleCount", "Número de módulos", false, 1),
          t("module.model", "Modelo del módulo"),
          t("module.sourceRef", "Ficha técnica del módulo"),
          n("module.powerW", "Potencia nominal por módulo (W)", false, 1),
          n("module.vocV", "Voc (V)", true, 0),
          n("module.vmpV", "Vmp (V)", true, 0),
          n("module.iscA", "Isc (A)", true, 0),
          n("module.impA", "Imp (A)", true, 0),
          n(
            "module.vocTemperaturePctPerC",
            "Coeficiente de Voc (%/°C)",
            true,
            -2,
            0,
          ),
          n(
            "module.vmpTemperaturePctPerC",
            "Coeficiente de Vmp (%/°C)",
            true,
            -2,
            0,
          ),
        ]}
      />
      <OptionalSection
        name={`${prefix}Resource`}
        title="Recurso solar y generación"
        description="Datos mensuales del plano del módulo. El índice de desempeño debe tener una fuente revisable."
        defaultOpen={Array.isArray(defaults.monthlyResource)}
      >
        <Controls
          prefix={prefix}
          defaults={defaults}
          fields={[
            n(
              "performanceRatio",
              "Índice de desempeño PR (0 a 1)",
              false,
              0.01,
              1,
            ),
            t("performanceRatioSourceRef", "Fuente del PR"),
          ]}
        />
        <ResourceRows
          name={`${prefix}ResourceRows`}
          defaults={list(defaults.monthlyResource)}
        />
      </OptionalSection>
      <OptionalSection
        name={`${prefix}Inverter`}
        title="Inversor, temperaturas y cadenas MPPT"
        description="Un grupo representa un inversor y sus módulos. Agrega otro grupo para equipos adicionales."
        defaultOpen={Boolean(defaults.inverter)}
      >
        <CatalogPicker category="INVERTER" onSelect={setInverter} />
        <Controls
          prefix={prefix}
          defaults={inverterDefaults}
          fields={[
            t("inverter.model", "Modelo de inversor"),
            t("inverter.sourceRef", "Ficha técnica del inversor"),
            n("inverter.acPowerKw", "Potencia AC (kW)", false, 0.001),
            n(
              "inverter.maxDcPowerKw",
              "Potencia DC máxima admitida (kW)",
              false,
              0.001,
            ),
            n("inverter.maxDcVoltageV", "Tensión DC máxima (V)", false, 1),
            n("inverter.mpptMinV", "MPPT mínimo (V)", false, 1),
            n("inverter.mpptMaxV", "MPPT máximo (V)", false, 1),
            n("inverter.mpptCount", "Número de MPPT", false, 1),
            n(
              "inverter.maxInputCurrentPerMpptA",
              "Corriente máxima por MPPT (A)",
              false,
              0.01,
            ),
            n(
              "inverter.maxShortCircuitCurrentPerMpptA",
              "Isc máxima por MPPT (A)",
              false,
              0.01,
            ),
            n(
              "temperature.minCellC",
              "Temperatura mínima de célula (°C)",
              false,
              -100,
              150,
            ),
            n(
              "temperature.maxCellC",
              "Temperatura máxima de célula (°C)",
              false,
              -100,
              150,
            ),
            t("temperature.sourceRef", "Fuente de temperaturas"),
            n(
              "shortCircuitDesignFactor",
              "Factor de diseño de Isc",
              false,
              1,
              4,
            ),
            t("currentFactorSourceRef", "Fuente del factor de corriente"),
          ]}
        />
        <Repeater
          name={`${prefix}StringRows`}
          label="Distribución de cadenas"
          initialCount={Math.max(1, list(defaults.mpptStrings).length)}
          max={100}
        >
          {(row, index) => (
            <Controls
              prefix={row}
              defaults={list(defaults.mpptStrings)[index]}
              fields={[
                n("mppt", "Número MPPT", false, 1),
                n("modulesInSeries", "Módulos en serie", false, 1),
                n("parallelStrings", "Cadenas en paralelo", false, 1),
              ]}
            />
          )}
        </Repeater>
      </OptionalSection>
    </div>
  );
}
function CircuitDesign({
  prefix,
  defaults,
}: {
  prefix: string;
  defaults: JsonRecord;
}) {
  return (
    <div>
      <Controls
        prefix={prefix}
        defaults={defaults}
        fields={[
          t("id", "Nombre del circuito"),
          choose("type", "Tipo", [
            { value: "DC", label: "Corriente directa" },
            { value: "AC_SINGLE_PHASE", label: "AC monofásico" },
            { value: "AC_THREE_PHASE", label: "AC trifásico" },
          ]),
          choose("material", "Conductor", [
            { value: "COPPER", label: "Cobre" },
            { value: "ALUMINUM", label: "Aluminio" },
          ]),
          n("oneWayLengthM", "Longitud de ida (m)", false, 0),
          n("voltageV", "Tensión (V)", false, 0.001),
          n("currentA", "Corriente (A)", false, 0.001),
          n("crossSectionMm2", "Sección del conductor (mm²)", false, 0.001),
          n(
            "resistivityOhmMm2PerM",
            "Resistividad (Ω·mm²/m)",
            false,
            0.000001,
            1,
          ),
          n(
            "conductorTemperatureC",
            "Temperatura del conductor (°C)",
            false,
            -100,
            250,
          ),
          t("conductorSourceRef", "Ficha / tabla del conductor"),
          n("powerFactor", "Factor de potencia AC (0 a 1)", true, 0.01, 1),
          n("reactanceOhmPerKm", "Reactancia AC (Ω/km)", true, 0, 10),
          n(
            "voltageDropLimitPct",
            "Límite de caída de tensión (%)",
            true,
            0.001,
            100,
          ),
          t("voltageDropLimitSourceRef", "Fuente del límite de caída", true),
          n("breakerA", "Protección propuesta (A)", true, 0.001),
          n("groundCrossSectionMm2", "Conductor de tierra (mm²)", true, 0.001),
        ]}
      />
      <OptionalSection
        name={`${prefix}Ampacity`}
        title="Verificar ampacidad"
        defaultOpen={Boolean(defaults.ampacity)}
      >
        <RuleControls
          category="AMPACITY"
          prefix={`${prefix}.ampacity`}
          defaults={obj(defaults.ampacity)}
          fields={[
            n("baseA", "Ampacidad base (A)", false, 0.001),
            n("temperatureFactor", "Factor por temperatura", false, 0.001, 2),
            n("groupingFactor", "Factor por agrupamiento", false, 0.001, 1),
            n("terminalLimitA", "Límite por terminal (A)", false, 0.001),
            n(
              "requiredCurrentMultiplier",
              "Multiplicador de corriente requerido",
              false,
              1,
              4,
            ),
            ...ruleFields,
          ]}
        />
      </OptionalSection>
      <OptionalSection
        name={`${prefix}Protection`}
        title="Verificar protección y tierra"
        defaultOpen={Boolean(defaults.protectionRule)}
      >
        <RuleControls
          category="PROTECTION"
          prefix={`${prefix}.protectionRule`}
          defaults={obj(defaults.protectionRule)}
          fields={[
            n(
              "minimumBreakerMultiplier",
              "Multiplicador mínimo de protección",
              false,
              1,
              4,
            ),
            n(
              "maximumBreakerA",
              "Protección máxima permitida (A)",
              false,
              0.001,
            ),
            n(
              "minimumGroundMm2",
              "Tierra mínima requerida (mm²)",
              false,
              0.001,
            ),
            ...ruleFields,
          ]}
        />
      </OptionalSection>
      <OptionalSection
        name={`${prefix}Conduit`}
        title="Verificar ocupación de tubería"
        defaultOpen={Boolean(defaults.conduit)}
      >
        <RuleControls
          category="CONDUIT"
          prefix={`${prefix}.conduit`}
          defaults={obj(defaults.conduit)}
          fields={[
            n("internalAreaMm2", "Área interna de tubería (mm²)", false, 0.001),
            n("occupiedAreaMm2", "Área ocupada por cables (mm²)", false, 0.001),
            n(
              "allowedFillFraction",
              "Fracción de llenado permitida (0 a 1)",
              false,
              0.001,
              1,
            ),
            ...ruleFields,
          ]}
        />
      </OptionalSection>
    </div>
  );
}

export function EngineeringSection({ detail, reload }: SectionProps) {
  const catalogs = useResource<{ entries: CatalogEntry[] }>(
    "/api/v1/projects/catalogs",
  );
  const records = activeRecords(detail.records);
  const calculations = records.filter(
    (record) => record.kind === "calculation",
  );
  const latest = calculations.at(-1);
  const savedInput = obj(latest?.data.input);
  const [validation, setValidation] = useState<string[]>([]);
  const mutation = useProjectMutation(reload);
  const receiptMonths = records
    .filter(
      (record) =>
        record.kind === "receipt" &&
        record.data.confirmed === true &&
        str(record.data, "periodStart").slice(0, 7) ===
          str(record.data, "periodEnd").slice(0, 7),
    )
    .map((record) => ({
      month: str(record.data, "periodStart").slice(0, 7),
      kWh: num(record.data, "kWh"),
      confirmed: true,
      sourceRef: `Recibo ${record.id}`,
      ...(record.data.amountMxn !== undefined
        ? { billMxn: num(record.data, "amountMxn") }
        : {}),
      ...(record.data.demandKw !== undefined
        ? { demandKw: num(record.data, "demandKw") }
        : {}),
    }));
  const consumptionDefaults = obj(savedInput.consumption);
  const defaultMonths = list(consumptionDefaults.months).length
    ? list(consumptionDefaults.months)
    : receiptMonths;
  const solarGroups = list(savedInput.solarSystems).length
    ? list(savedInput.solarSystems)
    : savedInput.solar
      ? [{ id: "Grupo 1", design: savedInput.solar }]
      : [];
  async function calculate(form: FormData) {
    const input: JsonRecord = { segment: detail.project.segment };
    if (form.has("consumptionEnabled")) {
      const consumption: JsonRecord = {
        months: rowsFromForm(form, "months", (row) => readControls(form, row)),
      };
      if (form.has("tariffEnabled"))
        consumption.tariff = readControls(form, "tariff");
      if (form.has("selfConsumptionEnabled"))
        consumption.selfConsumption = rowsFromForm(
          form,
          "selfConsumption",
          (row) => readControls(form, row),
        );
      input.consumption = consumption;
    }
    if (form.has("solarEnabled"))
      input.solarSystems = rowsFromForm(form, "solarGroups", (row) => {
        const design = readControls(form, `${row}.design`);
        if (form.has(`${row}.designResourceEnabled`))
          design.monthlyResource = rowsFromForm(
            form,
            `${row}.designResourceRows`,
            (resourceRow) => readControls(form, resourceRow),
          );
        if (form.has(`${row}.designInverterEnabled`))
          design.mpptStrings = rowsFromForm(
            form,
            `${row}.designStringRows`,
            (stringRow) => readControls(form, stringRow),
          );
        return { id: textValue(form, `${row}.id`), design };
      });
    if (form.has("preliminarySizingEnabled"))
      input.preliminarySizing = {
        ...readControls(form, "preliminarySizing"),
        monthlyResource: rowsFromForm(form, "sizingResourceRows", (row) =>
          readControls(form, row),
        ),
      };
    if (form.has("shadowsEnabled"))
      input.shadows = readControls(form, "shadows");
    if (form.has("circuitsEnabled"))
      input.circuits = rowsFromForm(form, "circuits", (row) =>
        readControls(form, row),
      );
    if (form.has("capacitorEnabled"))
      input.capacitor = readControls(form, "capacitor");
    if (form.has("materialsEnabled")) {
      input.materials = readControls(form, "materials");
      if (form.has("materialRunsEnabled"))
        obj(input.materials).runs = rowsFromForm(form, "materialRuns", (row) =>
          readControls(form, row),
        );
    }
    if (form.has("qualityEnabled"))
      input.qualityStudy = {
        ...readControls(form, "quality"),
        evidenceRefs: textValue(form, "qualityEvidence")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      };
    const parsed = engineeringInputSchema.safeParse(input);
    if (!parsed.success) {
      setValidation(parsed.error.issues.map((issue) => issue.message));
      return null;
    }
    if (Object.keys(input).length < 2) {
      setValidation(["Selecciona al menos un análisis y completa sus datos."]);
      return null;
    }
    setValidation([]);
    return mutation.run(`/api/v1/projects/${detail.project.id}/calculate`, {
      expectedVersion: detail.project.version,
      input: parsed.data,
    });
  }
  return (
    <CatalogContext.Provider value={catalogs.data?.entries ?? []}>
      <Notice>
        <strong>Cálculos por revisión del proyecto</strong>
        <p>
          Selecciona los análisis necesarios y documenta sus fuentes. El
          resultado señala datos faltantes y verificaciones pendientes; la
          aprobación técnica se registra por separado.
        </p>
      </Notice>
      {latest ? (
        <EngineeringOutput
          result={obj(latest.data.result) as unknown as EngineeringResult}
        />
      ) : null}
      {detail.access.canEngineer ? (
        <Panel
          title={
            latest
              ? "Preparar otra revisión de ingeniería"
              : "Desarrollar la ingeniería"
          }
          description="Los campos recuperados de tu última revisión se pueden ajustar. Guardar un cálculo genera una nueva revisión sin reemplazar la anterior."
        >
          <Form
            mutation={mutation}
            onSubmit={calculate}
            submit="Calcular y guardar revisión"
            disabled={detail.readiness.storage === "UNAVAILABLE"}
          >
            {validation.length ? (
              <Notice tone="danger" role="alert">
                <strong>Revisa los datos del cálculo</strong>
                <ul>
                  {validation.map((message, index) => (
                    <li key={index}>{message}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            <OptionalSection
              name="consumption"
              title="Consumo y escenario tarifario"
              description="Captura meses individuales. Un recibo bimestral requiere asignación mensual con evidencia; no se divide automáticamente."
              defaultOpen={
                Boolean(savedInput.consumption) || defaultMonths.length > 0
              }
            >
              <Repeater
                name="months"
                label="Consumo mensual confirmado"
                initialCount={Math.max(1, defaultMonths.length)}
                max={12}
              >
                {(row, index) => (
                  <Controls
                    prefix={row}
                    defaults={defaultMonths[index]}
                    fields={[
                      m("month", "Mes"),
                      n("kWh", "Consumo (kWh)", false, 0),
                      t("sourceRef", "Recibo / evidencia de asignación"),
                      n("billMxn", "Recibo MXN", true, 0),
                      n("demandKw", "Demanda (kW)", true, 0),
                      n("reactiveKvarh", "Energía reactiva (kvarh)", true, 0),
                      b("confirmed", "Confirmé este mes contra la evidencia."),
                    ]}
                  />
                )}
              </Repeater>
              <OptionalSection
                name="tariff"
                title="Escenario del componente de energía"
                description="Conserva los cargos fijos y por demanda. No sustituye la liquidación completa de CFE ni las bandas horarias."
                defaultOpen={Boolean(consumptionDefaults.tariff)}
              >
                <RuleControls
                  category="TARIFF"
                  prefix="tariff"
                  defaults={obj(consumptionDefaults.tariff)}
                  fields={[
                    t("name", "Tarifa"),
                    n("energyRateMxnKwh", "Cargo energético MXN/kWh", false, 0),
                    n("fixedMonthlyMxn", "Cargo fijo mensual MXN", false, 0),
                    n(
                      "demandMonthlyMxn",
                      "Cargo por demanda mensual MXN",
                      false,
                      0,
                    ),
                    m("validFrom", "Vigente desde"),
                    m("validTo", "Vigente hasta"),
                    ...ruleFields,
                  ]}
                />
              </OptionalSection>
              <OptionalSection
                name="selfConsumption"
                title="Autoconsumo respaldado por evidencia"
                description="La generación mensual no equivale por sí sola a energía autoconsumida."
                defaultOpen={Array.isArray(consumptionDefaults.selfConsumption)}
              >
                <Repeater
                  name="selfConsumption"
                  label="Autoconsumo por mes"
                  initialCount={Math.max(
                    1,
                    list(consumptionDefaults.selfConsumption).length,
                  )}
                  max={12}
                >
                  {(row, index) => (
                    <Controls
                      prefix={row}
                      defaults={
                        list(consumptionDefaults.selfConsumption)[index]
                      }
                      fields={[
                        m("month", "Mes"),
                        n("kWh", "Autoconsumo (kWh)", false, 0),
                        t("sourceRef", "Fuente"),
                        b("confirmed", "Autoconsumo confirmado"),
                      ]}
                    />
                  )}
                </Repeater>
              </OptionalSection>
            </OptionalSection>
            <OptionalSection
              name="preliminarySizing"
              title="Dimensionamiento preliminar"
              description="Estima potencia y módulos para una cobertura anual objetivo. Requiere doce meses de recurso solar y no sustituye el diseño de inversores ni el análisis de autoconsumo."
              defaultOpen={Boolean(savedInput.preliminarySizing)}
            >
              <Controls
                prefix="preliminarySizing"
                defaults={obj(savedInput.preliminarySizing)}
                fields={[
                  n(
                    "annualDemandKwh",
                    "Consumo anual documentado (kWh)",
                    false,
                    0.001,
                  ),
                  n(
                    "coveragePct",
                    "Cobertura energética objetivo (%)",
                    false,
                    0.001,
                    100,
                  ),
                  n(
                    "modulePowerW",
                    "Potencia del módulo para estimar (W)",
                    false,
                    1,
                  ),
                  n(
                    "performanceRatio",
                    "Índice de desempeño previsto PR",
                    false,
                    0.001,
                    1,
                  ),
                  t("sourceRef", "Evidencia del consumo y criterio de diseño"),
                ]}
              />
              <ResourceRows
                name="sizingResourceRows"
                defaults={list(
                  obj(savedInput.preliminarySizing).monthlyResource,
                )}
              />
            </OptionalSection>
            <OptionalSection
              name="solar"
              title="Sistema fotovoltaico e inversores"
              description="Modela un grupo por inversor. Cada grupo conserva módulo, cadenas y condiciones de diseño."
              defaultOpen={solarGroups.length > 0}
            >
              <Repeater
                name="solarGroups"
                label="Grupos fotovoltaicos"
                initialCount={Math.max(1, solarGroups.length)}
                max={100}
              >
                {(row, index) => (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <Field
                      name={`${row}.id`}
                      label={`Nombre del grupo ${index + 1}`}
                      required
                      defaultValue={str(
                        solarGroups[index] ?? {},
                        "id",
                        `Inversor ${index + 1}`,
                      )}
                    />
                    <div style={{ marginTop: 20 }}>
                      <SolarDesign
                        prefix={`${row}.design`}
                        defaults={obj(solarGroups[index]?.design)}
                      />
                    </div>
                  </div>
                )}
              </Repeater>
            </OptionalSection>
            <OptionalSection
              name="shadows"
              title="Separación de filas y sombras"
              description="Geometría declarada del sitio; registra la condición solar de diseño."
              defaultOpen={Boolean(savedInput.shadows)}
            >
              <Controls
                prefix="shadows"
                defaults={obj(savedInput.shadows)}
                fields={[
                  n(
                    "panelSlopeLengthM",
                    "Longitud inclinada del panel (m)",
                    false,
                    0.001,
                  ),
                  n("tiltDeg", "Inclinación (°)", false, 0, 90),
                  n(
                    "designSolarElevationDeg",
                    "Elevación solar de diseño (°)",
                    false,
                    0.001,
                    90,
                  ),
                  n(
                    "additionalObstacleHeightM",
                    "Altura adicional de obstáculo (m)",
                    false,
                    0,
                  ),
                  t("sourceRef", "Fuente de la condición de diseño"),
                ]}
              />
            </OptionalSection>
            <OptionalSection
              name="circuits"
              title="Circuitos DC, AC, protecciones y tierra"
              description="Registra longitudes de ida y datos del conductor. Para AC, el factor de potencia y la reactancia son obligatorios."
              defaultOpen={list(savedInput.circuits).length > 0}
            >
              <Repeater
                name="circuits"
                label="Circuitos del proyecto"
                initialCount={Math.max(1, list(savedInput.circuits).length)}
                max={200}
              >
                {(row, index) => (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <CircuitDesign
                      prefix={row}
                      defaults={list(savedInput.circuits)[index] ?? {}}
                    />
                  </div>
                )}
              </Repeater>
            </OptionalSection>
            <OptionalSection
              name="capacitor"
              title="Compensación de factor de potencia"
              description="Estimación para revisión de ingeniería. Con distorsión o condiciones desconocidas se requiere estudio."
              defaultOpen={Boolean(savedInput.capacitor)}
            >
              <Controls
                prefix="capacitor"
                defaults={obj(savedInput.capacitor)}
                fields={[
                  n("activeKw", "Potencia activa medida (kW)", false, 0.001),
                  n(
                    "measuredPowerFactor",
                    "Factor de desplazamiento medido",
                    false,
                    0.001,
                    1,
                  ),
                  n("targetPowerFactor", "Factor objetivo", false, 0.001, 1),
                  t("measurementRef", "Evidencia de medición"),
                  choose("loadType", "Condición de carga", [
                    {
                      value: "INDUCTIVE_SINUSOIDAL",
                      label: "Inductiva sinusoidal confirmada",
                    },
                    {
                      value: "UNKNOWN_OR_DISTORTED",
                      label: "Desconocida o con distorsión",
                    },
                  ]),
                ]}
              />
            </OptionalSection>
            <OptionalSection
              name="materials"
              title="Cuantificación de materiales"
              description="Cantidades derivadas de medidas y reglas explícitas del proyecto."
              defaultOpen={Boolean(savedInput.materials)}
            >
              <Controls
                prefix="materials"
                defaults={obj(savedInput.materials)}
                fields={[
                  t("sourceRef", "Fuente de medidas y reglas"),
                  n("reservePct", "Reserva de materiales (%)", false, 0, 100),
                ]}
              />
              <OptionalSection
                name="layout"
                title="Estructura y distribución de módulos"
                defaultOpen={Boolean(obj(savedInput.materials).layout)}
              >
                <Controls
                  prefix="materials.layout"
                  defaults={obj(obj(savedInput.materials).layout)}
                  fields={[
                    n("rows", "Filas", false, 1),
                    n("modulesPerRow", "Módulos por fila", false, 1),
                    n("moduleWidthM", "Ancho de módulo (m)", false, 0.001),
                    n("moduleGapM", "Separación entre módulos (m)", false, 0),
                    n("railLinesPerRow", "Líneas de riel por fila", false, 1),
                    n(
                      "railEndAllowanceM",
                      "Excedente de riel por extremo (m)",
                      false,
                      0,
                    ),
                    n(
                      "railCommercialLengthM",
                      "Longitud comercial de riel (m)",
                      false,
                      0.001,
                    ),
                    n("fixturesPerModule", "Fijaciones por módulo", false, 0),
                    n("connectorsPerString", "Conectores por cadena", false, 0),
                    n("stringCount", "Número de cadenas", false, 1),
                  ]}
                />
              </OptionalSection>
              <OptionalSection
                name="materialRuns"
                title="Cable y tubería por trayectoria"
                defaultOpen={list(obj(savedInput.materials).runs).length > 0}
              >
                <Repeater
                  name="materialRuns"
                  label="Trayectorias de materiales"
                  initialCount={Math.max(
                    1,
                    list(obj(savedInput.materials).runs).length,
                  )}
                  max={500}
                >
                  {(row, index) => (
                    <Controls
                      prefix={row}
                      defaults={list(obj(savedInput.materials).runs)[index]}
                      fields={[
                        t("id", "Trayectoria"),
                        choose("kind", "Material", [
                          { value: "CABLE", label: "Cable" },
                          { value: "CONDUIT", label: "Tubería" },
                        ]),
                        n("oneWayLengthM", "Longitud de ida (m)", false, 0),
                        n("parallelPieces", "Piezas paralelas", false, 1),
                        n(
                          "commercialLengthM",
                          "Longitud comercial (m)",
                          false,
                          0.001,
                        ),
                      ]}
                    />
                  )}
                </Repeater>
              </OptionalSection>
            </OptionalSection>
            <OptionalSection
              name="quality"
              title="Estudio de calidad de energía"
              description="Conserva objetivo y mediciones para la revisión del especialista."
              defaultOpen={Boolean(savedInput.qualityStudy)}
            >
              <Controls
                prefix="quality"
                defaults={obj(savedInput.qualityStudy)}
                fields={[
                  t("objective", "Objetivo del estudio"),
                  t("instrument", "Instrumento", true),
                  t("measuredAt", "Fecha y periodo de medición", true),
                  t("reviewer", "Responsable de revisión", true),
                  {
                    key: "findings",
                    label: "Hallazgos",
                    type: "textarea",
                    optional: true,
                  },
                ]}
              />
              <Field
                name="qualityEvidence"
                label="Documentos de medición (uno por línea)"
                type="textarea"
                defaultValue={
                  Array.isArray(obj(savedInput.qualityStudy).evidenceRefs)
                    ? (
                        obj(savedInput.qualityStudy).evidenceRefs as string[]
                      ).join("\n")
                    : undefined
                }
              />
            </OptionalSection>
          </Form>
        </Panel>
      ) : null}
      <RecordForm
        detail={detail}
        reload={reload}
        kind="technical_review"
        title="Revisión técnica de Paco"
        description="La decisión se liga al cálculo exacto y a las secciones revisadas."
        allowed={detail.access.canApprove}
        submit="Guardar revisión técnica"
        build={(form) => ({
          calculationId: textValue(form, "calculationId"),
          decision: textValue(form, "decision"),
          notes: textValue(form, "notes"),
          evidence: textValue(form, "evidence"),
          reviewedSections: [
            "Consumo",
            "Fotovoltaico",
            "Circuitos",
            "Materiales",
            "Sombras",
            "Factor de potencia",
            "Calidad de energía",
          ].filter((label) => isChecked(form, `review-${label}`)),
        })}
      >
        <div className="projects-form-grid">
          <RecordSelect
            records={calculations}
            label="Cálculo revisado"
            name="calculationId"
          />
          <Field
            label="Decisión"
            name="decision"
            required
            options={[
              { value: "APPROVED", label: "Aprobar" },
              { value: "REJECTED", label: "Requiere correcciones" },
            ]}
          />
          {[
            "Consumo",
            "Fotovoltaico",
            "Circuitos",
            "Materiales",
            "Sombras",
            "Factor de potencia",
            "Calidad de energía",
          ].map((label) => (
            <Check key={label} name={`review-${label}`}>
              {label}
            </Check>
          ))}
          <Field
            name="notes"
            label="Criterios revisados y observaciones"
            type="textarea"
            required
            wide
          />
          <EvidenceField label="Evidencia de la revisión" />
        </div>
      </RecordForm>
      <History
        title="Revisiones de ingeniería"
        records={detail.records.filter((record) =>
          ["calculation", "technical_review"].includes(record.kind),
        )}
        detail={detail}
        renderExtra={(record) =>
          record.kind === "calculation" ? (
            <>
              <EngineeringOutput
                result={obj(record.data.result) as unknown as EngineeringResult}
                compact
              />
              <PdfLinks
                projectId={detail.project.id}
                record={record}
                kinds={["technical"]}
              />
            </>
          ) : null
        }
      />
    </CatalogContext.Provider>
  );
}

function EngineeringOutput({
  result,
  compact = false,
}: {
  result: EngineeringResult;
  compact?: boolean;
}) {
  const solar = result.solarTotals ?? result.solar;
  const sizing = obj(obj(result).preliminarySizing);
  const groups =
    result.solarSystems ??
    (result.solar ? [{ id: "Sistema fotovoltaico", solar: result.solar }] : []);
  if (!result.version)
    return (
      <Notice tone="warning">
        Este cálculo no contiene un resultado disponible.
      </Notice>
    );
  return (
    <div>
      <div className="projects-toolbar" style={{ marginBlock: 16 }}>
        <Badge
          tone={result.status === "READY_FOR_REVIEW" ? "success" : "warning"}
        >
          {result.status === "READY_FOR_REVIEW"
            ? "Listo para revisión técnica"
            : "Revisión pendiente"}
        </Badge>
        <span className="projects-help">Motor {result.version}</span>
      </div>
      {!compact ? (
        <section
          className="projects-metrics"
          aria-label="Resultado de ingeniería"
        >
          <Metric
            label="Consumo confirmado"
            value={
              result.consumption
                ? `${quantity(result.consumption.totalKwh)} kWh`
                : "Sin consumo"
            }
            help={
              result.consumption
                ? `${result.consumption.confirmedMonths} meses confirmados`
                : undefined
            }
          />
          <Metric
            label="Potencia fotovoltaica"
            value={solar ? `${quantity(solar.capacityKw)} kWp` : "Sin sistema"}
          />
          <Metric
            label="Generación del periodo"
            value={
              solar?.totalGenerationKwh !== undefined
                ? `${quantity(solar.totalGenerationKwh)} kWh`
                : "Datos pendientes"
            }
          />
          <Metric
            label="Circuitos revisados"
            value={result.circuits?.length ?? 0}
          />
        </section>
      ) : null}
      {result.warnings?.length ? (
        <Notice
          tone={
            result.warnings.some((warning) => warning.severity === "BLOCKER")
              ? "danger"
              : "warning"
          }
        >
          <strong>Resultados que requieren atención</strong>
          <ul>
            {result.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {!compact && Object.keys(sizing).length ? (
        <Panel title="Dimensionamiento preliminar">
          <Notice tone="warning">
            Estimación para iniciar la selección de equipos. La distribución
            MPPT, las temperaturas y el autoconsumo se revisan por separado.
          </Notice>
          <DetailList
            values={[
              [
                "Potencia mínima calculada",
                `${quantity(num(sizing, "minimumCapacityKw"))} kWp`,
              ],
              ["Módulos estimados", quantity(num(sizing, "moduleCount"), 0)],
              [
                "Potencia redondeada",
                `${quantity(num(sizing, "capacityKw"))} kWp`,
              ],
              [
                "Energía anual estimada",
                `${quantity(num(sizing, "estimatedAnnualEnergyKwh"))} kWh`,
              ],
              [
                "Cobertura energética estimada",
                `${quantity(num(sizing, "estimatedCoveragePct"))}%`,
              ],
            ]}
          />
        </Panel>
      ) : null}
      {!compact && groups.some((group) => group.solar.strings.length) ? (
        <Panel title="Compatibilidad por inversor y MPPT">
          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Grupo / MPPT</th>
                  <th>Voc en frío</th>
                  <th>Vmp caliente / frío</th>
                  <th>Corriente / Isc de diseño</th>
                  <th>Módulos en serie</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {groups.flatMap((group) =>
                  group.solar.strings.map((row) => (
                    <tr key={`${group.id}-${row.mppt}`}>
                      <td>
                        {group.id}
                        <small>MPPT {row.mppt}</small>
                      </td>
                      <td>{quantity(row.coldVocV)} V</td>
                      <td>
                        {quantity(row.hotVmpV)} / {quantity(row.coldVmpV)} V
                      </td>
                      <td>
                        {quantity(row.operatingCurrentA)} /{" "}
                        {quantity(row.designShortCircuitCurrentA)} A
                      </td>
                      <td>
                        {row.minModulesInSeries}–{row.maxModulesInSeries}
                      </td>
                      <td>
                        <Badge tone={row.compatible ? "success" : "danger"}>
                          {row.compatible
                            ? "Dentro de límites"
                            : "Requiere corrección"}
                        </Badge>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
      {!compact && solar?.monthlyGeneration?.length ? (
        <Panel title="Producción estimada por mes">
          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th>Días</th>
                  <th>Generación</th>
                </tr>
              </thead>
              <tbody>
                {solar.monthlyGeneration.map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td>{"days" in row ? String(row.days) : "—"}</td>
                    <td>{quantity(row.generationKwh)} kWh</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
      {!compact && result.circuits?.length ? (
        <Panel title="Resultados eléctricos">
          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Circuito</th>
                  <th>Caída</th>
                  <th>Ampacidad corregida</th>
                  <th>Protección</th>
                  <th>Tierra</th>
                </tr>
              </thead>
              <tbody>
                {result.circuits.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>
                      {quantity(row.voltageDropV)} V ·{" "}
                      {quantity(row.voltageDropPct)}%
                    </td>
                    <td>
                      {row.correctedAmpacityA === undefined
                        ? "Por revisar"
                        : `${quantity(row.correctedAmpacityA)} A`}
                    </td>
                    <td>
                      {row.breakerWithinReviewedRule === undefined
                        ? "Por revisar"
                        : row.breakerWithinReviewedRule
                          ? "Dentro de regla"
                          : "Fuera de regla"}
                    </td>
                    <td>
                      {row.groundWithinReviewedRule === undefined
                        ? "Por revisar"
                        : row.groundWithinReviewedRule
                          ? "Dentro de regla"
                          : "Fuera de regla"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
      {!compact && result.materials?.items?.length ? (
        <Panel title="Materiales calculados">
          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Necesario</th>
                  <th>Para compra</th>
                </tr>
              </thead>
              <tbody>
                {result.materials.items.map((row) => (
                  <tr key={row.id}>
                    <td>{row.description}</td>
                    <td>
                      {quantity(row.requiredQuantity)}{" "}
                      {row.unit === "piece" ? "pzas." : "m"}
                    </td>
                    <td>
                      {quantity(row.purchaseQuantity)}{" "}
                      {row.unit === "piece" ? "pzas." : "m"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
      {!compact && (result.shadows || result.capacitor) ? (
        <Panel title="Otros resultados">
          <DetailList
            values={[
              ...(result.shadows
                ? ([
                    [
                      "Separación libre entre filas",
                      `${quantity(result.shadows.clearGapM)} m`,
                    ],
                    [
                      "Paso entre filas",
                      `${quantity(result.shadows.rowPitchM)} m`,
                    ],
                  ] as [string, ReactNode][])
                : []),
              ...(result.capacitor?.compensationKvar !== undefined
                ? ([
                    [
                      "Compensación estimada",
                      `${quantity(result.capacitor.compensationKvar)} kvar`,
                    ],
                  ] as [string, ReactNode][])
                : []),
              ...(result.consumption?.energySavingsMxn !== undefined
                ? ([
                    [
                      "Ahorro del componente energético",
                      money(result.consumption.energySavingsMxn),
                    ],
                  ] as [string, ReactNode][])
                : []),
            ]}
          />
        </Panel>
      ) : null}
    </div>
  );
}
