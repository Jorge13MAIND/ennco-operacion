import { describe, expect, it } from "vitest";

import { deviceReading, GrowattError, growattPlants, plantLocalToIso, syncGrowattPlant, type GrowattDeps } from "@/lib/medidores/growatt";

function fakeFetch(routes: Record<string, unknown>): GrowattDeps {
  return {
    sleep: async () => undefined,
    fetch: (async (input: string | URL | Request) => {
      const url = String(input);
      const key = Object.keys(routes).find((k) => url.includes(k));
      const body = key ? routes[key] : { error_code: 10002, error_msg: "x", data: "" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "text/html;charset=UTF-8" } });
    }) as typeof fetch,
  };
}

describe("conector de Growatt", () => {
  it("convierte la hora local de la planta a UTC", () => {
    expect(plantLocalToIso("2026-10-16 12:30:00", "America/Mexico_City")).toBe("2026-10-16T18:30:00.000Z");
  });

  it("con región automática prueba el servidor internacional y luego el de Norteamérica", async () => {
    const calls: string[] = [];
    const deps: GrowattDeps = { fetch: (async (input: string | URL | Request) => {
      calls.push(String(input));
      const body = String(input).includes("openapi-us")
        ? { error_code: 0, data: { plants: [{ plant_id: 1915, name: "Planta QRO", peak_power: "850", city: "Querétaro" }] } }
        : { error_code: 10011, error_msg: "error_permission_denied", data: "" };
      return new Response(JSON.stringify(body));
    }) as typeof fetch };
    const result = await growattPlants("6eb6f069523055a339d71e5b1f6c88cc", "auto", deps);
    expect(result.base).toBe("https://openapi-us.growatt.com");
    expect(result.plants[0]).toMatchObject({ id: "1915", name: "Planta QRO", peak_kw: 850 });
    expect(calls).toHaveLength(2);
  });

  it("un límite de frecuencia no se reintenta en otro servidor", async () => {
    await expect(growattPlants("x".repeat(32), "auto", fakeFetch({ "plant/list": { error_code: 10012, error_msg: "error_frequently_access", data: "" } })))
      .rejects.toMatchObject({ code: "GROWATT_RATE_LIMITED" });
  });

  it("lee el inversor MAX (energía en eacToday) y marca falla", () => {
    const reading = deviceReading({ sn: "HPJ0BF20FU", type: 4, model: "MAX", status: 1, lost: false, name: "MAX" },
      { calendar: 1716618863392, status: 3, pac: "2038.9", eacToday: 42.9, powerToday: 0, vacr: 220, fac: 60, temperature: 41 }, "America/Mexico_City");
    expect(reading).toMatchObject({ pv_kw: 2.0389, pv_kwh_today: 42.9, v_l1: 220, freq: 60, inverter_status: "FALLA" });
  });

  it("una vuelta junta la curva de la planta (en W) y la última lectura de cada inversor", async () => {
    const batches = await syncGrowattPlant({ base: "https://openapi.growatt.com", token: "t".repeat(32), plantId: "1", timeZone: "America/Mexico_City", now: new Date("2026-10-16T18:40:00Z") },
      fakeFetch({
        "plant/data": { error_code: 0, data: { current_power: 31.5, today_energy: "120.4", last_update_time: "2026-10-16 12:35:00" } },
        "plant/power": { error_code: 0, data: { powers: [{ time: "2026-10-16 12:30", power: 31000 }, { time: "2026-10-16 12:35", power: null }] } },
        "device/list": { error_code: 0, data: { devices: [{ device_sn: "SN1", type: 1, status: 1, lost: false }, { device_sn: "AMMETER", type: 3 }] } },
        "inverter/last_new_data": { error_code: 0, data: { time: "2026-10-16 12:34:00", status: 1, pac: 15000, powerToday: 60.2 } },
      }));
    expect(batches.map((b) => b.external_id)).toEqual(["PLANT", "SN1"]);
    expect(batches[0]!.rows[0]).toMatchObject({ ts: "2026-10-16T18:30:00.000Z", pv_kw: 31 });
    expect(batches[0]!.rows.at(-1)).toMatchObject({ pv_kw: 31.5, pv_kwh_today: 120.4 });
    expect(batches[1]!.rows[0]).toMatchObject({ pv_kw: 15, pv_kwh_today: 60.2, inverter_status: "NORMAL" });
  });

  it("un token inválido detiene la vuelta", async () => {
    await expect(syncGrowattPlant({ base: "https://openapi.growatt.com", token: "t".repeat(32), plantId: "1", timeZone: "America/Mexico_City" },
      fakeFetch({ "plant/data": { error_code: 10011, error_msg: "error_permission_denied", data: "" } }))).rejects.toBeInstanceOf(GrowattError);
  });
});
