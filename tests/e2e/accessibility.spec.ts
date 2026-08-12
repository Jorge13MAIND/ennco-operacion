import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const surfaces = [
  { path: "/", name: "home" },
  { path: "/diagnostico", name: "diagnostic" },
  { path: "/privacidad", name: "privacy" },
  { path: "/ingreso", name: "identity" },
  { path: "/operacion", name: "control-room" },
] as const;

for (const surface of surfaces) {
  test(`${surface.name} has no automated WCAG A or AA violations`, async ({ page }) => {
    await page.goto(surface.path);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
  });
}
