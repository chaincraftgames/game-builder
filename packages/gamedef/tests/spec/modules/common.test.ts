/**
 * Parse tests for common schemas: IntRangeSchema.
 */

import { IntRangeSchema } from "#gamedef/modules/common.js";

// ---------------------------------------------------------------------------
// IntRangeSchema
// ---------------------------------------------------------------------------

describe("IntRangeSchema", () => {
  it("parses { min: 3, max: 3 } (exactly 3)", () => {
    expect(IntRangeSchema.parse({ min: 3, max: 3 })).toEqual({ min: 3, max: 3 });
  });

  it("parses { max: 3 } (up to 3)", () => {
    expect(IntRangeSchema.parse({ max: 3 })).toEqual({ max: 3 });
  });

  it("parses { min: 2 } (at least 2)", () => {
    expect(IntRangeSchema.parse({ min: 2 })).toEqual({ min: 2 });
  });

  it("parses {} (unbounded)", () => {
    expect(IntRangeSchema.parse({})).toEqual({});
  });

  it("rejects min < 0", () => {
    expect(IntRangeSchema.safeParse({ min: -1 }).success).toBe(false);
  });

  it("rejects max < 1", () => {
    expect(IntRangeSchema.safeParse({ max: 0 }).success).toBe(false);
  });
});
