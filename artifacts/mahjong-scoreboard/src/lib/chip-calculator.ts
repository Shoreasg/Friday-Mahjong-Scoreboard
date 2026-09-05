import type { ChipDenomination, ChipStackEstimate } from "@workspace/api-client-react";

export const CHIP_VALUES: Record<ChipDenomination, number> = {
  white: 1,
  orange: 5,
  light_blue: 10,
  blue: 50,
  black: 100,
};

export const CHIP_LABELS: Record<ChipDenomination, string> = {
  white: "White ($1)",
  orange: "Orange ($5)",
  light_blue: "Light Blue ($10)",
  blue: "Blue ($50)",
  black: "Black ($100)",
};

export const CHIP_NAMES: Record<ChipDenomination, string> = {
  white: "White",
  orange: "Orange",
  light_blue: "Light Blue",
  blue: "Blue",
  black: "Black",
};

export type ChipCountMap = Record<ChipDenomination, number>;
export type ChipUncertaintyMap = Record<ChipDenomination, { confidence: number; uncertainty: string | null }[]>;
export type ChipConfidenceMap = Record<ChipDenomination, number | null>;

export function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(500, Math.trunc(value)));
}

export function calculateSubtotals(counts: ChipCountMap): Record<ChipDenomination, number> {
  return {
    white: clampCount(counts.white || 0) * CHIP_VALUES.white,
    orange: clampCount(counts.orange || 0) * CHIP_VALUES.orange,
    light_blue: clampCount(counts.light_blue || 0) * CHIP_VALUES.light_blue,
    blue: clampCount(counts.blue || 0) * CHIP_VALUES.blue,
    black: clampCount(counts.black || 0) * CHIP_VALUES.black,
  };
}

export function calculateGrandTotal(counts: ChipCountMap): number {
  const subtotals = calculateSubtotals(counts);
  return Object.values(subtotals).reduce((sum, val) => sum + val, 0);
}

export function parseScanResult(stacks: ChipStackEstimate[]): { counts: ChipCountMap, warnings: ChipUncertaintyMap, confidences: ChipConfidenceMap } {
  const counts: ChipCountMap = {
    white: 0,
    orange: 0,
    light_blue: 0,
    blue: 0,
    black: 0,
  };
  
  const warnings: ChipUncertaintyMap = {
    white: [],
    orange: [],
    light_blue: [],
    blue: [],
    black: [],
  };

  const confidences: ChipConfidenceMap = {
    white: null,
    orange: null,
    light_blue: null,
    blue: null,
    black: null,
  };

  for (const stack of stacks) {
    if (stack.denomination in counts) {
      counts[stack.denomination] = clampCount(counts[stack.denomination] + stack.count);
      
      const currentConfidence = confidences[stack.denomination];
      if (currentConfidence === null || stack.confidence > currentConfidence) {
        confidences[stack.denomination] = stack.confidence;
      }

      if (stack.confidence < 0.8 || stack.uncertainty) {
        warnings[stack.denomination].push({
          confidence: stack.confidence,
          uncertainty: stack.uncertainty
        });
      }
    }
  }

  return { counts, warnings, confidences };
}
