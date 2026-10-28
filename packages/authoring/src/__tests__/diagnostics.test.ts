import { countDiagnostics, formatDiagnostic, sortDiagnostics, type Diagnostic } from "../diagnostics.js";

const base: Diagnostic = { severity: "error", code: "unresolved-ref", message: "boom" };

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

  it("counts by severity", () => {
    expect(countDiagnostics([todo, base, error2])).toEqual({ errors: 2, todos: 1 });
  });
});
