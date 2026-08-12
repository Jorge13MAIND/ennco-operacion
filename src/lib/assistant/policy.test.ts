import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { evaluateAssistantMessage } from "@/lib/assistant/policy";

type EvalCase = {
  id: string;
  message: string;
  expected_action: string;
  expected_topic: string;
};

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "data/assistant/eval-cases-v1.json"), "utf8"),
) as { runs_required: number; cases: EvalCase[] };

describe("bounded ENNCO proposal assistant", () => {
  it("runs the complete eval set twice with deterministic outcomes", () => {
    expect(fixture.runs_required).toBe(2);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(20);

    const runs = [1, 2].map(() => fixture.cases.map((testCase) => ({
      id: testCase.id,
      result: evaluateAssistantMessage(testCase.message),
    })));

    for (const run of runs) {
      for (const evaluated of run) {
        const expected = fixture.cases.find((testCase) => testCase.id === evaluated.id)!;
        expect(evaluated.result.action, expected.id).toBe(expected.expected_action);
        expect(evaluated.result.topic, expected.id).toBe(expected.expected_topic);
        expect(evaluated.result.answer.length, expected.id).toBeGreaterThan(20);
        expect(evaluated.result.groundedIn.length, expected.id).toBeGreaterThan(0);
      }
    }

    expect(runs[0]).toEqual(runs[1]);
  });

  it("never produces a commercial commitment from blocked topics", () => {
    const blocked = fixture.cases.filter((testCase) =>
      ["COMMERCIAL_APPROVAL", "DELIVERY_COMMITMENT", "LEGAL_OR_TAX", "TECHNICAL_APPROVAL"].includes(testCase.expected_topic),
    );
    for (const testCase of blocked) {
      const result = evaluateAssistantMessage(testCase.message);
      expect(result.action).toBe("HANDOFF");
      expect(result.answer).not.toMatch(/te garantizo|precio final es|queda instalado el|ahorro de \d|descuento de \d/i);
    }
  });
});
