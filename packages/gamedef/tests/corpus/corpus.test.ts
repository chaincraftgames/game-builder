import { readFileSync } from "fs";
import { join } from "path";
import {
  GOLDEN_DIR,
  computeGolden,
  discoverInputs,
  listGoldenFiles,
} from "./corpus-lib.js";

const { inputs } = discoverInputs();

describe("spec corpus", () => {
  test("corpus is not empty", () => {
    expect(inputs.filter((i) => i.kind === "valid").length).toBeGreaterThan(0);
    expect(inputs.filter((i) => i.kind === "invalid").length).toBeGreaterThan(0);
  });

  test("every input has a golden file and every golden file has an input", () => {
    const expected = inputs.map((i) => i.goldenRel).sort();
    expect(listGoldenFiles()).toStrictEqual(expected);
  });

  test.each(inputs.map((i) => [i.goldenRel, i] as const))("%s matches golden", (_name, input) => {
    const golden = JSON.parse(readFileSync(join(GOLDEN_DIR, input.goldenRel), "utf-8"));
    // No JSON round-trip of `actual`: an explicit `undefined` key must fail.
    expect(computeGolden(input)).toStrictEqual(golden);
  });
});
