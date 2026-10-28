import { readFileSync } from "node:fs";
import { COMMANDS } from "../commands.js";

describe("templates/AGENTS.md", () => {
  const text = readFileSync(new URL("../../templates/AGENTS.md", import.meta.url), "utf8");
  const referenced = [...text.matchAll(/`chaincraft ([a-z][a-z-]*)/g)].map((m) => m[1]);

  it("references at least one command", () => {
    expect(referenced.length).toBeGreaterThan(0);
  });

  it.each([...new Set(referenced)])("`chaincraft %s` is a registered command", (word) => {
    expect(COMMANDS as readonly string[]).toContain(word);
  });
});
