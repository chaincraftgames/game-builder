import { validate } from "#gamedef/validator/index.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { load } from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test("liars-dice.yaml validates", () => {
  const raw = load(
    readFileSync(join(__dirname, "../../examples/liars-dice.yaml"), "utf-8")
  );
  const result = validate(raw);
  if (!result.valid) {
    console.error("Validation errors:", JSON.stringify(result.errors, null, 2));
  }
  expect(result.valid).toBe(true);
});
