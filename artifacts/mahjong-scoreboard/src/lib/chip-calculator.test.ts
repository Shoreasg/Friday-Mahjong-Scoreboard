import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { 
  calculateSubtotals, 
  calculateGrandTotal, 
  parseScanResult,
  clampCount
} from "./chip-calculator.ts";
import type { ChipCountMap } from "./chip-calculator.ts";
import type { ChipDenomination, ChipStackEstimate } from "@workspace/api-client-react";

describe("chip-calculator", () => {
  it("clamps counts to integers between 0 and 500", () => {
    assert.equal(clampCount(-5), 0);
    assert.equal(clampCount(0), 0);
    assert.equal(clampCount(10.5), 10);
    assert.equal(clampCount(10.4), 10);
    assert.equal(clampCount(500), 500);
    assert.equal(clampCount(505), 500);
    assert.equal(clampCount(NaN), 0);
  });

  it("calculates subtotals correctly with clamping", () => {
    const counts: ChipCountMap = {
      white: 5,       // 5 * 1 = 5
      orange: -2,     // clamped to 0
      light_blue: 3.2,// clamped to 3 * 10 = 30
      blue: 1,        // 1 * 50 = 50
      black: 600,     // clamped to 500 * 100 = 50000
    };
    
    const subtotals = calculateSubtotals(counts);
    assert.deepEqual(subtotals, {
      white: 5,
      orange: 0,
      light_blue: 30,
      blue: 50,
      black: 50000,
    });
  });

  it("calculates grand total correctly", () => {
    const counts: ChipCountMap = {
      white: 5,
      orange: 2,
      light_blue: 3,
      blue: 1,
      black: 2,
    };
    
    const total = calculateGrandTotal(counts);
    assert.equal(total, 295);
  });

  it("parses scan results with confidence and clamping", () => {
    const stacks: ChipStackEstimate[] = [
      { denomination: "white" as ChipDenomination, count: 10, confidence: 0.95, uncertainty: null },
      { denomination: "white" as ChipDenomination, count: 5, confidence: 0.7, uncertainty: "Slight blur" },
      { denomination: "black" as ChipDenomination, count: 600, confidence: 0.99, uncertainty: null }
    ];
    
    const { counts, warnings, confidences } = parseScanResult(stacks);
    
    assert.deepEqual(counts, {
      white: 15,
      orange: 0,
      light_blue: 0,
      blue: 0,
      black: 500, // clamped
    });
    
    assert.equal(confidences.white, 0.95);
    assert.equal(confidences.black, 0.99);
    assert.equal(confidences.orange, null);

    assert.equal(warnings.white.length, 1);
    assert.equal(warnings.white[0].uncertainty, "Slight blur");
    assert.equal(warnings.black.length, 0);
  });
});
