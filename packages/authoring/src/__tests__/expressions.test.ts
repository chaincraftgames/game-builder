import { parseExpression, EXPRESSION_FUNCTIONS } from "@chaincraft/compiler";
import { ConditionExpressionSchema } from "@chaincraft/gamedef";
import { EXPRESSION_EXAMPLES, expressionDoc } from "#authoring/docs/expressions.js";

/** Example rule: every single-backtick span in the text is an expression. Fenced blocks are not used here. */
const backtickSpans = (text: string): string[] => [...text.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g)].map((match) => match[1]);

describe("expressionDoc", () => {
  const page = expressionDoc();

  it("starts with the ConditionExpression description verbatim", () => {
    expect(page).toContain(ConditionExpressionSchema.description);
  });

  it("names every expression function with its signature", () => {
    for (const name of EXPRESSION_FUNCTIONS) expect(page).toContain(`\`${name}(`);
  });

  it("lists the operators, lowest binding first", () => {
    const order = ["`or`", "`and`", "`not`", "`==`", "`+` `-`", "`*` `/`"].map((cell) => page.indexOf(`| ${cell}`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("parses every example on the page", () => {
    expect(EXPRESSION_EXAMPLES.length).toBeGreaterThan(0);
    for (const example of EXPRESSION_EXAMPLES) expect(() => parseExpression(example)).not.toThrow();
  });

  it("parses every backtick example in the ConditionExpression description", () => {
    for (const example of backtickSpans(ConditionExpressionSchema.description ?? "")) {
      expect(() => parseExpression(example)).not.toThrow();
    }
  });

  it("extracts backtick spans", () => {
    expect(backtickSpans("use `a == 1` or `count(game.inventory.deck)`, not ```fenced```")).toEqual([
      "a == 1",
      "count(game.inventory.deck)",
    ]);
  });

  it("documents precedence the parser really has", () => {
    expect(parseExpression("not a == b")).toMatchObject({ kind: "not", operand: { kind: "compare" } });
    expect(() => parseExpression("a < b < c")).toThrow();
    expect(() => parseExpression("-x")).toThrow();
    expect(() => parseExpression("0 - x")).not.toThrow();
    expect(parseExpression("a or b and c")).toMatchObject({ kind: "logical", op: "or", right: { kind: "logical", op: "and" } });
  });
});
