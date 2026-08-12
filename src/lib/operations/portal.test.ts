import { describe, expect, it } from "vitest";

import { sumFirstPaymentsMxn } from "@/lib/operations/portal";

describe("sumFirstPaymentsMxn", () => {
  it("sums only positive first payments and ignores unsafe values", () => {
    expect(sumFirstPaymentsMxn([
      { amount_mxn: "125000.50", is_first_payment: true },
      { amount_mxn: 25000, is_first_payment: true },
      { amount_mxn: 999999, is_first_payment: false },
      { amount_mxn: "not-a-number", is_first_payment: true },
      { amount_mxn: -1, is_first_payment: true },
    ])).toBe(150000.5);
  });
});
