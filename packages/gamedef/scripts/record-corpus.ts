// Records the golden corpus. Dry run by default; pass --write to write files.
// Usage: npm run corpus:record [-- --write]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import {
  GOLDEN_DIR,
  computeGolden,
  discoverInputs,
  listGoldenFiles,
  serializeGolden,
} from "../tests/corpus/corpus-lib.js";

const write = process.argv.includes("--write");
const { inputs, excluded } = discoverInputs();

for (const e of excluded) console.log(`excluded: ${e.file} (${e.reason})`);

let differences = 0;
for (const input of inputs) {
  const target = join(GOLDEN_DIR, input.goldenRel);
  const next = serializeGolden(computeGolden(input));
  const prev = existsSync(target) ? readFileSync(target, "utf-8") : null;
  if (prev === next) continue;
  differences++;
  console.log(`${write ? "write" : "would write"}: ${input.goldenRel} (${prev === null ? "new" : "changed"})`);
  if (write) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, next);
  }
}

const expected = new Set(inputs.map((i) => i.goldenRel));
for (const rel of listGoldenFiles()) {
  if (!expected.has(rel)) {
    differences++;
    console.log(`orphan golden (no input, not deleted): ${rel}`);
  }
}

console.log(`${inputs.length} inputs, ${differences} difference(s)`);
if (!write && differences > 0) process.exit(1);
