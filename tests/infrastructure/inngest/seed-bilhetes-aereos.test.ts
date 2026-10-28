import { describe, expect, it } from "vitest";
import { selectBilheteSeedYears } from "@/infrastructure/inngest/functions/seed-bilhetes-aereos.function";

describe("bilhetes-aereos seed year selection", () => {
  it("defaults to all years from 2008 through the current year", () => {
    expect(selectBilheteSeedYears(undefined, 2026)).toEqual(
      Array.from({ length: 19 }, (_unused, index) => 2008 + index),
    );
  });

  it("accepts a single year from the event payload", () => {
    expect(selectBilheteSeedYears(2025, 2026)).toEqual([2025]);
  });

  it("rejects years outside the source range", () => {
    expect(() => selectBilheteSeedYears(2007, 2026)).toThrow(
      "entre 2008 e 2026",
    );
    expect(() => selectBilheteSeedYears("2025", 2026)).toThrow(
      "entre 2008 e 2026",
    );
    expect(() => selectBilheteSeedYears(2027, 2026)).toThrow(
      "entre 2008 e 2026",
    );
  });
});
