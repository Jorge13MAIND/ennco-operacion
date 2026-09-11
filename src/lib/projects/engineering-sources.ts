/** References identify methods, never an approval of an ENNCO design. */
export type EngineeringSource = {
  id: string;
  title: string;
  publisher: string;
  url?: string;
  consultedOn: string;
  scope: string;
};

export const ENGINEERING_VERSION = "ennco-engineering-1.0.0";
export const engineeringSources: readonly EngineeringSource[] = [
  {
    id: "nrel-performance-ratio",
    title: "Performance Parameters for Grid-Connected PV Systems",
    publisher: "NREL",
    url: "https://research-hub.nlr.gov/en/publications/performance-parameters-for-grid-connected-pv-systems-2/",
    consultedOn: "2026-09-10",
    scope:
      "Definición de rendimiento de referencia y performance ratio. La proyección mensual local no implementa PVWatts.",
  },
  {
    id: "pvgis-resource",
    title: "PVGIS: API non-interactive service",
    publisher: "European Commission, Joint Research Centre",
    url: "https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/api-non-interactive-service_en",
    consultedOn: "2026-09-10",
    scope:
      "Procedencia, plano, periodo y unidades del recurso solar; no se incluye una climatología predeterminada.",
  },
  {
    id: "sandia-temperature",
    title: "Sandia PV Array Performance Model",
    publisher: "Sandia National Laboratories",
    url: "https://pvpmc.sandia.gov/modeling-guide/2-dc-module-iv/point-value-models/sandia-pv-array-performance-model/",
    consultedOn: "2026-09-10",
    scope:
      "Coeficientes de tensión y temperatura de celda. Corrección lineal a irradiancia de referencia; no implementa SAPM completo.",
  },
  {
    id: "sandia-strings",
    title: "DC Array IV",
    publisher: "Sandia National Laboratories",
    url: "https://pvpmc.sandia.gov/modeling-guide/3-dc-array-iv/",
    consultedOn: "2026-09-10",
    scope:
      "Relaciones de tensión/corriente en arreglos serie/paralelo; límites adicionales provienen de fichas del fabricante.",
  },
  {
    id: "schneider-voltage-drop",
    title: "Calculation of voltage drop in steady load conditions",
    publisher: "Schneider Electric",
    url: "https://www.electrical-installation.org/enwiki/Calculation_of_voltage_drop_in_steady_load_conditions",
    consultedOn: "2026-09-10",
    scope:
      "Caída de tensión resistiva/reactiva monofásica y trifásica equilibrada; los límites normativos no se infieren de esta guía.",
  },
  {
    id: "schneider-capacitor",
    title: "Theoretical principles to improve power factor",
    publisher: "Schneider Electric",
    url: "https://www.electrical-installation.org/enwiki/Theoretical_principles_to_improve_power_factor",
    consultedOn: "2026-09-10",
    scope:
      "Estimación de kvar para carga inductiva sinusoidal; no selecciona banco, pasos, filtros ni protecciones.",
  },
  {
    id: "cfe-tariff-components",
    title: "Tarifa GDMTO: cuotas y demanda máxima medida",
    publisher: "Comisión Federal de Electricidad",
    url: "https://app.cfe.mx/Aplicaciones/CCFE/Tarifas/TarifasCREIndustria/Tarifas/GranDemandaMTO.aspx",
    consultedOn: "2026-09-10",
    scope:
      "Energía y demanda son componentes separados. No se han incorporado precios vigentes ni reglas de facturación a este motor.",
  },
  {
    id: "nom-catalog-review",
    title: "NOM-001-SEDE-2012",
    publisher: "Secretaría de Energía / Diario Oficial de la Federación",
    url: "https://e.economia.gob.mx/wp-content/uploads/sites/29/PDF_Normas_Publicas/001sede2012.pdf",
    consultedOn: "2026-09-10",
    scope:
      "Referencia de revisión de catálogo. Publicación identificada; descarga no disponible durante esta verificación. No contiene tablas aprobadas incorporadas ni certificación automática.",
  },
  {
    id: "ennco-geometry",
    title: "Especificación ENNCO: geometría plana y cantidades",
    publisher: "ENNCO: reconstrucción documentada",
    consultedOn: "2026-09-10",
    scope:
      "Trigonometría plana y medidas suministradas; no son fórmulas recuperadas de MEST ni cálculo estructural.",
  },
  {
    id: "mest-recovery-audit",
    title: "Auditoría estática MEST PROGRAM 2.0 recuperado",
    publisher: "NEXUS / ENNCO",
    consultedOn: "2026-09-10",
    scope:
      "37 hojas comunes, cero fórmulas de celda. El VBA de selección y navegación no reconstruye el motor perdido.",
  },
];
