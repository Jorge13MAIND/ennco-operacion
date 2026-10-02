import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

describe("proxy matcher", () => {
  it("guards every /operacion request, including router prefetches", () => {
    const [operations, rest] = config.matcher;
    expect(operations).toBe("/operacion/:path*");
    expect(typeof rest === "object" && rest.source).toContain("operacion|");
  });
});
