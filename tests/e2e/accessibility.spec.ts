import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const surfaces = [
  { path: "/", name: "home" },
  { path: "/diagnostico", name: "diagnostic" },
  { path: "/privacidad", name: "privacy" },
  { path: "/ingreso", name: "identity" },
  { path: "/operacion", name: "control-room" },
  { path: "/operacion/alertas", name: "control-room-alerts" },
  { path: "/operacion/cadencia", name: "control-room-cadence" },
  { path: "/operacion/respuestas", name: "control-room-replies" },
  { path: "/operacion/leads", name: "control-room-leads" },
  { path: "/operacion/empresas", name: "control-room-accounts" },
  { path: "/operacion/precotizaciones", name: "control-room-prequotes" },
  { path: "/operacion/campanas", name: "control-room-campaigns" },
  { path: "/operacion/pipeline", name: "control-room-pipeline" },
  { path: "/operacion/roadmap", name: "control-room-roadmap" },
  { path: "/operacion/aprobaciones", name: "control-room-approvals" },
  { path: "/operacion/reportes", name: "control-room-reports" },
  { path: "/operacion/exportaciones", name: "control-room-exports" },
  { path: "/operacion/entrega", name: "control-room-handoff" },
] as const;

for (const surface of surfaces) {
  test(`${surface.name} has no automated WCAG A or AA violations`, async ({ page }) => {
    await page.goto(surface.path);
    // El contraste se evalúa sobre el estado final: las animaciones de entrada
    // componen opacity/transform y falsean el color efectivo si el scan corre
    // a mitad de un frame. Las animaciones infinitas (dots decorativos) se
    // excluyen porque nunca terminan y no pintan texto.
    await page.evaluate(() => Promise.all(
      document.getAnimations()
        .filter((animation) => {
          const timing = animation.effect?.getTiming();
          return timing?.iterations !== Infinity;
        })
        .map((animation) => animation.finished.catch(() => undefined)),
    ));
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
  });
}
