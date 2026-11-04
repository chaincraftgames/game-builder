import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { load } from "js-yaml";
import { validate, ValidationCode } from "../../src/validator/index.js";
import { CURRENT_SPEC_VERSION } from "../../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function highCardWith(specVersion?: unknown): Record<string, any> {
  const raw = load(
    readFileSync(join(__dirname, "../../examples/high-card.yaml"), "utf-8"),
  ) as Record<string, any>;
  if (specVersion !== undefined) raw.metadata.specVersion = specVersion;
  return raw;
}

describe("metadata.specVersion", () => {
  it("CURRENT_SPEC_VERSION is 1", () => {
    expect(CURRENT_SPEC_VERSION).toBe(1);
  });

  it("absent is valid and is not added to the parsed spec", () => {
    const result = validate(highCardWith());
    expect(result.valid).toBe(true);
    expect("specVersion" in result.spec!.metadata!).toBe(false);
  });

  it("1 is valid", () => {
    const result = validate(highCardWith(1));
    expect(result.valid).toBe(true);
    expect(result.spec!.metadata!.specVersion).toBe(1);
  });

  it("2 reports UnsupportedSpecVersion at metadata.specVersion", () => {
    const result = validate(highCardWith(2));
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe("metadata.specVersion");
    expect(result.errors[0].code).toBe(ValidationCode.UnsupportedSpecVersion);
  });

  it.each([0, 1.5])("%p is a schema error", (v) => {
    const result = validate(highCardWith(v));
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe("metadata.specVersion");
    expect(result.errors[0].code).toBe(ValidationCode.Schema);
  });
});
