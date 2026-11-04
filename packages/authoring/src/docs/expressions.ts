/**
 * Expression reference for `chaincraft docs expressions`.
 *
 * Three parts: the `ConditionExpression` description (paths per context), the operator
 * precedence and literals (from the compiler's tokenizer and parser), and the function list
 * (names from the compiler's `EXPRESSION_FUNCTIONS`, so a new function cannot go undocumented).
 */

import { EXPRESSION_FUNCTIONS, type ExpressionFunction } from "@chaincraft/compiler";
import { ConditionExpressionSchema } from "@chaincraft/gamedef";

/** Argument shape and meaning of each function; keyed by name so a missing entry fails to compile. */
const FUNCTION_DOCS: Record<ExpressionFunction, { signature: string; description: string }> = {
  count: {
    signature: "count(collection[, filter])",
    description: "Number of items in the collection; with `filter`, only items for which it is true.",
  },
  sum: {
    signature: "sum(collection, value[, filter])",
    description: "Total of `value` over the items (optionally only those passing `filter`). `value` must be numeric for every item.",
  },
  all: {
    signature: "all(collection, predicate)",
    description: "True if `predicate` holds for every item (true for an empty collection).",
  },
  any: {
    signature: "any(collection, predicate)",
    description: "True if `predicate` holds for at least one item (false for an empty collection).",
  },
  if: {
    signature: "if(condition, then, else)",
    description: "Evaluates to `then` when `condition` is true, otherwise `else`. Exactly three arguments.",
  },
};

/** Expressions shown on the page; the tests parse each one. */
export const EXPRESSION_EXAMPLES: readonly string[] = [
  "actor.property.coins >= 3 and actor.property.turnsTaken > 0",
  "count(game.inventory.deck) == 0",
  "any(players, player.property.score >= 50)",
  "count(actor.inventory.hand, piece.property.suit == \"hearts\") >= 2",
  "sum(actor.inventory.hand, piece.property.rank) > 21",
  "if(actor.property.coins > 0, actor.property.coins * 2, 0)",
  "not (game.property.round == 1 or game.property.round == 2)",
];

/** Lowest to highest binding. */
const PRECEDENCE: readonly { operators: string; note: string }[] = [
  { operators: "`or`", note: "left to right" },
  { operators: "`and`", note: "left to right" },
  { operators: "`not`", note: "prefix; applies to a whole comparison, so `not a == b` is `not (a == b)`" },
  { operators: "`==` `!=` `<` `<=` `>` `>=`", note: "at most one per comparison; `a < b < c` is a syntax error, write `a < b and b < c`" },
  { operators: "`+` `-`", note: "left to right" },
  { operators: "`*` `/`", note: "left to right" },
];

/** The expression reference as markdown. */
export function expressionDoc(): string {
  const lines = [
    "# Condition expressions",
    "",
    ConditionExpressionSchema.description ?? "",
    "",
    "## Operator precedence",
    "",
    "Lowest binds loosest. Use parentheses to override.",
    "",
    "| Operators | Notes |",
    "|---|---|",
    ...PRECEDENCE.map(({ operators, note }) => `| ${operators} | ${note} |`),
    "",
    "## Literals and names",
    "",
    "- Numbers: `3`, `-2`, `1.5`. A leading `-` is part of the number only directly before a digit and not after a value, so write `0 - x` rather than `-x`.",
    "- Strings: `\"hearts\"` or `'hearts'`; a backslash escapes the next character.",
    "- Booleans: `true`, `false`. Keywords `and`, `or`, `not`, `true`, `false` are lowercase only.",
    "- Names: letters, digits and `_`, starting with a letter or `_`. A path joins names with dots: `actor.property.coins`.",
    "",
    "## Functions",
    "",
    "A collection argument is `players` or an inventory path `<game|actor|player>.inventory.<id>`. Inside the",
    "per-item argument the current item is `player` (over `players`) or `piece` (over an inventory).",
    "",
    ...EXPRESSION_FUNCTIONS.map((name) => `- \`${FUNCTION_DOCS[name].signature}\` — ${FUNCTION_DOCS[name].description}`),
    "",
    "## Examples",
    "",
    ...EXPRESSION_EXAMPLES.map((example) => `- \`${example}\``),
  ];
  return lines.join("\n");
}
