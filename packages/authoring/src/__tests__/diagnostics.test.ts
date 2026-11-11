import { countDiagnostics, formatDiagnostic, schemaPointer, sortDiagnostics, type Diagnostic } from "../diagnostics.js";

const base: Diagnostic = { severity: "error", code: "unresolved-ref", message: "boom" };

describe("schemaPointer", () => {
  const keys = ["flow", "effects"];
  const schema = (path?: string): Diagnostic => ({ ...base, code: "schema", ...(path === undefined ? {} : { path }) });

  it("names the module of the first schema diagnostic", () => {
    expect(schemaPointer([schema("effects.effects.0"), schema("flow")], keys)).toBe("see `chaincraft docs schema effects`");
  });

  it.each([[""], [undefined], ["nope.x"]])("drops the argument for a schema path %j", (path) => {
    expect(schemaPointer([schema(path)], keys)).toBe("see `chaincraft docs schema`");
  });

  it("never names the key of an unknown-module diagnostic", () => {
    const unknown: Diagnostic = { ...base, code: "unknown-module", path: "flow" };
    expect(schemaPointer([unknown], keys)).toBe("see `chaincraft docs schema`");
  });

  it("is undefined without a schema or unknown-module diagnostic", () => {
    expect(schemaPointer([base], keys)).toBeUndefined();
  });
});

describe("formatDiagnostic", () => {
  it("prints file, path, message and known ids", () => {
    const text = formatDiagnostic({ ...base, file: "spec/actions.yaml", path: "actions.actions[0]", knownIds: ["a", "b"] });
    expect(text).toBe("spec/actions.yaml  actions.actions[0]\n  error unresolved-ref: boom\n  known ids: a, b");
  });

  it("omits the location line when there is no file or path", () => {
    expect(formatDiagnostic(base)).toBe("  error unresolved-ref: boom");
  });

  it("shows file:line for yaml syntax errors", () => {
    const text = formatDiagnostic({ ...base, code: "yaml-syntax", file: "spec/x.yaml", line: 12 });
    expect(text.split("\n")[0]).toBe("spec/x.yaml:12");
  });

  it("truncates known ids beyond 30", () => {
    const knownIds = Array.from({ length: 33 }, (_, i) => `id${i}`);
    const line = formatDiagnostic({ ...base, knownIds }).split("\n")[1];
    expect(line.endsWith("id29, … (3 more)")).toBe(true);
    expect(line).not.toContain("id30");
  });
});

describe("sortDiagnostics / countDiagnostics", () => {
  const todo: Diagnostic = { ...base, severity: "todo", message: "t" };
  const error2: Diagnostic = { ...base, message: "e2" };

  it("puts errors first and keeps order within a severity", () => {
    const sorted = sortDiagnostics([todo, base, error2]);
    expect(sorted.map((d) => d.message)).toEqual(["boom", "e2", "t"]);
  });

  it("orders errors, then warnings, then todos", () => {
    const warning: Diagnostic = { ...base, severity: "warning", message: "w" };
    expect(sortDiagnostics([todo, warning, base]).map((d) => d.message)).toEqual(["boom", "w", "t"]);
  });

  it("counts by severity", () => {
    const warning: Diagnostic = { ...base, severity: "warning", message: "w" };
    expect(countDiagnostics([todo, base, error2, warning])).toEqual({ errors: 2, warnings: 1, todos: 1 });
  });
});
