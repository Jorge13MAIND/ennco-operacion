import citiesJson from "../../../data/solar/cities.json";
import factorKJson from "../../../data/solar/factor-k.json";
import generationJson from "../../../data/solar/generation-defaults.json";
import invertersJson from "../../../data/solar/inverters.json";
import fusesJson from "../../../data/solar/module-fuses.json";
import modulesJson from "../../../data/solar/modules.json";
import mountingJson from "../../../data/solar/mounting.json";
import pricesJson from "../../../data/solar/prices.json";
import tariffsJson from "../../../data/solar/tariffs.json";

import type { FactorKTable, GenerationDefaults, Prices, SolarCatalog, SolarCity, SolarInverter, SolarModule, Tariffs } from "@/lib/solar/types";

/**
 * Catálogos del libro (data/solar/*.json, generados con scripts/build-solar-catalogs.py). Es la
 * versión de respaldo; en un ambiente live se sobreponen las versiones aprobadas en Catálogos
 * (ennco_project_catalogs, categorías solar_*). Solo se importa en servidor y en pruebas: el
 * navegador recibe el catálogo ya resuelto como prop.
 */
type FuseEntry = { maxSeriesFuseA: number | null; source: string };
const FUSES = fusesJson as unknown as Record<string, FuseEntry | string>;

/** Añade el fusible máximo de serie de la ficha técnica a cada módulo (capa module-fuses.json).
    Se aplica también a los módulos que vengan de Catálogos, para no perder el dato al sobreescribir. */
export function withModuleFuses(modules: SolarModule[]): SolarModule[] {
  return modules.map((m) => {
    const f = FUSES[m.model];
    const entry = f && typeof f === "object" ? f : null;
    return { ...m, maxSeriesFuseA: m.maxSeriesFuseA ?? entry?.maxSeriesFuseA ?? null, fuseSource: m.fuseSource ?? entry?.source ?? null };
  });
}

export function workbookCatalog(): SolarCatalog {
  return {
    modules: withModuleFuses(modulesJson as SolarModule[]),
    inverters: invertersJson as SolarInverter[],
    cities: citiesJson as SolarCity[],
    factorK: factorKJson as FactorKTable,
    tariffs: tariffsJson as unknown as Tariffs,
    prices: pricesJson as unknown as Prices,
    generation: generationJson as unknown as GenerationDefaults,
    mounting: mountingJson as SolarCatalog["mounting"],
  };
}
