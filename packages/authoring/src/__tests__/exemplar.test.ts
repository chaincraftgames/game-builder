import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { ModularGameSpecSchema } from "@chaincraft/gamedef";

const load = (relative: string): unknown =>
  ModularGameSpecSchema.parse(yaml.load(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")));

const withoutDescriptions = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutDescriptions);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "description")
        .map(([key, child]) => [key, withoutDescriptions(child)]),
    );
  }
  return value;
};

describe("shipped High Card exemplar", () => {
  it("parses to the same spec as the gamedef original, ignoring descriptions", () => {
    const shipped = load("../../docs/examples/high-card.yaml");
    const original = load("../../../gamedef/examples/high-card.yaml");
    expect(withoutDescriptions(shipped)).toEqual(withoutDescriptions(original));
  });
});
