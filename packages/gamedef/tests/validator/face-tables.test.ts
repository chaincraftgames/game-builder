import { describe, expect, it } from "@jest/globals";
import { validate } from "../../src/validator/index.js";

const META = { name: "Test Game", playerCount: { min: 2, max: 2 } };

function specWithType(type: Record<string, unknown>) {
  return { metadata: META, gamepieceTypes: { types: [{ id: "piece", ...type }] } };
}

describe("FaceTablesValidator", () => {
  it("accepts a die with faceCount", () => {
    expect(validate(specWithType({ category: "dice", faceCount: 6 })).valid).toBe(true);
  });

  it("accepts a die with a mixed symbol/number faces table", () => {
    const result = validate(specWithType({ category: "dice", faces: ["skull", "brain", "brain", 1] }));
    expect(result.valid).toBe(true);
  });

  it("rejects a die with neither faceCount nor faces", () => {
    const result = validate(specWithType({ category: "dice" }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        path: "gamepieceTypes.types[0]",
        message: expect.stringContaining("must declare faceCount or faces"),
      }),
    ]);
  });

  it("rejects declaring both faceCount and faces", () => {
    const result = validate(specWithType({ category: "dice", faceCount: 2, faces: ["a", "b"] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({ message: expect.stringContaining("both faceCount and faces") }),
    ]);
  });

  it("does not require a face table on non-dice types", () => {
    expect(validate(specWithType({ category: "token" })).valid).toBe(true);
  });
});
