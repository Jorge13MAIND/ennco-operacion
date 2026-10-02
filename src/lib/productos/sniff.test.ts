import { describe, expect, it } from "vitest";
import { sniffMime } from "@/lib/productos/sniff";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(12).fill(0)].slice(0, 12));

describe("tipo real del archivo de producto", () => {
  it("reconoce PNG, JPEG, WebP y PDF por su firma", () => {
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47))).toBe("image/png");
    expect(sniffMime(bytes(0xff, 0xd8, 0xff))).toBe("image/jpeg");
    expect(sniffMime(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe("image/webp");
    expect(sniffMime(bytes(0x25, 0x50, 0x44, 0x46))).toBe("application/pdf");
  });
  it("rechaza un HTML disfrazado de imagen", () => {
    expect(sniffMime(new TextEncoder().encode("<html><script>"))).toBeNull();
  });
});
