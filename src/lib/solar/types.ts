/**
 * Motor de la Calculadora Solar ENNCO (port del libro v1.0.1, reconstrucción del MEST PROGRAM 2.0).
 * Cada tipo conserva el nombre de la hoja o celda de origen en el comentario para poder auditar
 * contra el libro. Los meses van 1 = enero .. 12 = diciembre; los historiales van del periodo más
 * reciente (índice 0) al más antiguo (índice 11), igual que Inf_Vac_*!F27:F38.
 */

export type Segment = "RESIDENTIAL" | "COMMERCIAL" | "INDUSTRIAL";
export type Period = "Mensual" | "Bimestral";
export type Language = "Español" | "Inglés";

export type SolarModule = {
  brand: string; model: string; lengthMm: number | null; widthMm: number | null; thicknessMm: number | null;
  pmaxW: number; vmpV: number; impA: number; vocV: number; iscA: number; tempRefC: number | null;
  coefP: number; coefV: number; coefI: number; toncC: number;
  brand2?: string | null; weightKg?: number | null; efficiency?: number | null; cellType?: string | null;
  warrantyProductYears?: number | null; warrantyPerformanceYears?: number | null; priceUsd: number | null;
};

export type SolarInverter = {
  model: string; nominalW: number; pmaxFvW: number; mpptMaxDcInputW: Array<number | null>; maxDcInputV: number | null;
  startUpV: number | null; mpptMinV: number | null; mppt: Array<{ maxV: number | null; maxA: number | null }>;
  mpptCount: number | null; stringsPerMppt: Array<number | null>; totalStrings: number | null; sizingFactor: number | null;
  outputW: number | null; gridV: number | null; phases: number | null; maxOutputA: number | null; brand: string | null;
  efficiency?: number | null; weightKg?: number | null; lengthMm?: number | null; widthMm?: number | null; thicknessMm?: number | null;
  warrantyYears?: number | null; priceUsd: number | null;
};

export type SolarCity = {
  city: string; division: string | null; irradiance: Array<number | null>; tMaxC: number | null; tMinC: number | null;
  region: string | null; latitude: number | null; state?: string | null; tMax2C?: number | null;
};

/** Inf_Factor_K: latitud (16..32) → inclinación (0..90 de 5 en 5) → 12 factores. */
export type FactorKTable = Record<string, Record<string, Array<number | null>>>;

export type ResidentialTariffRow = {
  tariff: string; basicPrice: number; intermediatePrice: number; excessPrice: number; basicStep: number; intermediateStep: number;
  summerBasicPrice: number; summerIntermediatePrice: number; summerIntermediate2Price: number; summerExcessPrice: number;
  summerBasicStep: number; summerIntermediateStep: number; summerIntermediate2Step: number; dacLimitBimonthlyKwh: number;
};
export type DacRow = { region: string; fixedMonthly: number; pricePerKwh: number };
export type LowVoltageTariffRow = { tariff: string; zone: string; transmission: number; distribution: number; cenace: number; fixed: number; mem: number; energy: number; capacity: number };
export type MediumVoltageTariffRow = { tariff: string; zone: string; transmission: number; distribution: number; cenace: number; fixed: number; mem: number; energyBase: number; energyIntermediate: number; energyPeak: number; energySemiPeak: number; capacity: number };
export type Rates = {
  iva: number; dapResidential: number; dapCommercial: number; dapIndustrial: number; lowVoltageMetering: number;
  powerFactorBonus: number; powerFactorPenalty: number; residentialMinimumKwh: number; incomeTaxDeduction: number; dapResidentialWithPv: number;
};
export type Tariffs = {
  residential: ResidentialTariffRow[]; dac: DacRow[]; lowVoltage: LowVoltageTariffRow[]; mediumVoltage: MediumVoltageTariffRow[];
  rates: Rates; loadFactor: Record<string, number>;
};

export type PriceBand = { fromW: number; toW: number; usdPerW: Record<string, number | null> };
export type SegmentPrices = { bands: PriceBand[]; structureUsdPerModule: number; laborUsdPerModule: number };
export type Prices = Record<Segment, SegmentPrices>;

export type GenerationDefaults = Record<Segment, { safetyMargin: number | null; performanceRatio: number; loss1: number; loss2: number; daysPerMonth: number[] }>;

export type MountingSystem = { code: number; name: string; description: string | null };

export type SolarCatalog = {
  modules: SolarModule[];
  inverters: SolarInverter[];
  cities: SolarCity[];
  factorK: FactorKTable;
  tariffs: Tariffs;
  prices: Prices;
  generation: GenerationDefaults;
  mounting: { es: MountingSystem[]; en: MountingSystem[] };
};

export type Orientation = { modules: number; azimuth: number; inclination: number };
export type InverterSelection = { model: string; quantity: number };
export type AdditionalService = { enabled: boolean; concept: string; costMxn: number };
export type Financing = { share: number; months: number };

/** Entradas de una cotización = celdas de captura de Inf_Vac_Res / Com / Ind. */
export type QuoteInput = {
  segment: Segment;
  customer: { name: string; subtitle?: string | null; supplier?: string | null };
  city: string;
  period: Period;
  summerTariff: boolean;
  /** G19: tarifa actual (residencial puede ser DAC; comercial PDBT/GDBT/APBT/RABT; industrial GDMTO/GDMTH/DIST). */
  currentTariff: string;
  /** G20 residencial: tarifa base (1, 1A .. 1F). */
  baseTariff?: string | null;
  /** G20 comercial e industrial: demanda contratada (kW). */
  contractedDemandKw?: number | null;
  /** D20/D21 comercial e industrial: inicio y fin del último periodo, en serial de Excel (días desde 1899-12-30). */
  periodStartSerial?: number | null;
  periodEndSerial?: number | null;
  /** E22: mes del periodo más reciente, 1..12. */
  billedMonth: number;
  meterType?: string | null; phases?: number | null; voltage?: number | null; electricalConfig?: string | null;
  /** K27 */
  annualIncrease: number;
  /** F27:F38, periodo más reciente primero. */
  consumptionKwh: number[];
  /** D27:D38 industrial: demanda máxima por periodo. */
  demandKw?: number[] | null;
  kwhBase?: number; kwhIntermediate?: number; kwhPeak?: number; kwhSemiPeak?: number;
  kwBase?: number; kwIntermediate?: number; kwPeak?: number; kwSemiPeak?: number;
  kvarh?: number;
  /** R58 industrial: factor de potencia objetivo para el banco de capacitores. */
  targetPowerFactor?: number | null;
  moduleModel: string;
  orientationCount?: number;
  orientations: Orientation[];
  mountingSystem?: string | null;
  /** M55 */
  degradation: number;
  inverters: InverterSelection[];
  services: AdditionalService[];
  currency?: string | null;
  /** M87 */
  exchangeRate: number;
  /** G98: costo sin IVA por watt (MXN). */
  pricePerWatt: number;
  /** G99 */
  utilityFactor: number;
  /** M98 */
  discount: number;
  addIva: boolean;
  taxDeduction: boolean;
  /** D107:D110 */
  advances: number[];
  /** G113 */
  financingBase: number;
  financing: Financing[];
  language?: Language | string | null;
  structureWarrantyYears?: number | null;
  startTime?: string | null; deliveryTime?: string | null; validityDays?: number | null;
  /** Parámetros de diseño de Gen_Energía (PR, margen, pérdidas); por defecto los del libro para el segmento. */
  generation?: { performanceRatio?: number; safetyMargin?: number; loss1?: number; loss2?: number } | null;
};

export type OrientationGeneration = {
  modules: number; inclination: number; azimuth: number; powerW: number;
  irradiance: number[]; factorK: number[]; days: number[]; energyPerModule: number[]; energy: number[]; annual: number;
};

export type GenerationResult = {
  latitude: number; latestMonth: number;
  orientations: OrientationGeneration[];
  /** V49:V60 (mes calendario 1..12). */
  monthly: number[];
  /** S49:S60: consumo por mes calendario. */
  consumptionByMonth: number[];
  /** P49:P60: generación del periodo facturado por mes calendario (bimestral suma dos meses). */
  periodGeneration: number[];
  annual: number; annualConsumption: number; coverage: number;
  parameters: { performanceRatio: number; safetyMargin: number; loss1: number; loss2: number };
};

export type BillColumn = Record<string, number | string | boolean | null>;

export type TariffResult = {
  tariff: string; zone: string | null; monthsPerPeriod: number;
  /** 12 periodos sin FV, el más reciente primero (bloque C:O del libro). */
  without: BillColumn[];
  /** 12 periodos proyectados con FV (bloque Q:AC). */
  with: BillColumn[];
  annualWithout: number; annualWith: number;
  /** E45/E46: fracción del pago que se ahorra y fracción que sigue pagándose. */
  savingsShare: number; remainingShare: number;
  warnings: string[];
  extra?: Record<string, number | null>;
};

export type ProjectionYear = { year: number; consumption: number; payment: number; production: number; consumptionWithPv: number; paymentWithPv: number; savings: number; cumulative: number; cashFlow: number };
export type ProjectionResult = {
  cost: number; deduction: number; irr: number; years: ProjectionYear[];
  paybackYears: number; paybackFraction: number; paybackTotal: number; paybackMonths: number;
};

export type BomLine = { concept: string; brand: string | null; powerW: number | null; quantity: number; unitUsd: number; totalUsd: number };
export type PricingResult = {
  bom: BomLine[]; bomTotalUsd: number; bomTotalMxn: number; suggestedPricePerWatt: number; discountVsSuggested: number;
  servicesUsd: number; servicesMxn: number; cashPrice: number; advances: number[]; financing: Array<{ amount: number; months: number; monthly: number }>;
};

export type QuoteResult = {
  input: QuoteInput;
  module: SolarModule; city: SolarCity;
  averageConsumption: number; annualConsumption: number; annualGeneration: number; coverage: number;
  modulePowerW: number; modulesNeeded: number; systemNeededKw: number;
  inverters: Array<{ model: string; quantity: number; minModules: number; maxModules: number; modules: number; systemKw: number; inverter: SolarInverter | null }>;
  modulesTotal: number; systemKw: number;
  demandWarning: string | null;
  generation: GenerationResult;
  bill: TariffResult;
  pricing: PricingResult;
  projection: ProjectionResult;
  powerFactor?: number | null;
};
