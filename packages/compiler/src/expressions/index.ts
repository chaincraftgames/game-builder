// ---------------------------------------------------------------------------
// Expression compiler — public API
//
// compileExpression(input) → (ctx: EvalContext) => unknown
// compilePredicate(input)  → (ctx: EvalContext) => boolean
// parseExpression(input)   → Expr AST (for inspection/testing)
// ---------------------------------------------------------------------------

export { parseExpression } from '#compiler/expressions/parser.js';
export { buildEvaluator, buildPredicate } from '#compiler/expressions/evaluator.js';
export type { ExprFn, PredicateFn } from '#compiler/expressions/evaluator.js';
export type { Expr, CompareOp, ArithOp, EvalContext, InventoryLike, PlayerLike } from '#compiler/expressions/types.js';
export { ExpressionError } from '#compiler/expressions/types.js';
export { EXPRESSION_FUNCTIONS } from '#compiler/expressions/evaluator-functions.js';
export type { ExpressionFunction } from '#compiler/expressions/evaluator-functions.js';

import { parseExpression } from '#compiler/expressions/parser.js';
import { buildEvaluator, buildPredicate } from '#compiler/expressions/evaluator.js';
import type { EvalContext, Expr } from '#compiler/expressions/types.js';
import { ExpressionError } from "#compiler/expressions/types.js";

/** A path root an expression may read. `param` is checked as its alias `input`. */
export type ExprRoot =
  | "game"
  | "actor"
  | "player"
  | "piece"
  | "target"
  | "source"
  | "input"
  | "trigger";

const AGGREGATORS = new Set(["count", "sum", "all", "any"]);

/**
 * Throw if the expression reads a path root its evaluation context does not bind.
 * Aggregators over `players` bind `player`; aggregators over an inventory bind `piece`.
 */
export function checkRoots(input: string, ast: Expr, roots: readonly ExprRoot[]): void {
  const visit = (node: Expr, scope: ReadonlySet<string>): void => {
    switch (node.kind) {
      case "path": {
        const root = node.segments[0] === "param" ? "input" : node.segments[0];
        if (!scope.has(root)) {
          const problem =
            root === "players"
              ? "'players' is only valid as the first argument of an aggregator"
              : `'${root}' is not available in this context`;
          throw new ExpressionError(
            `${problem}; available roots: ${[...scope].join(", ")}`,
            0,
            input,
          );
        }
        return;
      }
      case "compare":
      case "arithmetic":
      case "logical":
        visit(node.left, scope);
        visit(node.right, scope);
        return;
      case "not":
        visit(node.operand, scope);
        return;
      case "call": {
        if (!AGGREGATORS.has(node.fn) || node.args.length === 0) {
          node.args.forEach((a) => visit(a, scope));
          return;
        }
        const [collection, ...rest] = node.args;
        const overPlayers =
          collection.kind === "path" &&
          collection.segments.length === 1 &&
          collection.segments[0] === "players";
        if (!overPlayers) visit(collection, scope);
        const itemScope = new Set(scope).add(overPlayers ? "player" : "piece");
        rest.forEach((a) => visit(a, itemScope));
        return;
      }
      case "literal":
        return;
    }
  };
  visit(ast, new Set(roots));
}

/** Action input ids an expression reads via `input.<id>` (or the `param.<id>` alias). */
export function referencedInputs(input: string): string[] {
  const refs = new Set<string>();
  const visit = (node: Expr): void => {
    switch (node.kind) {
      case 'path':
        if ((node.segments[0] === 'input' || node.segments[0] === 'param') && node.segments[1]) {
          refs.add(node.segments[1]);
        }
        return;
      case 'compare':
      case 'arithmetic':
      case 'logical':
        visit(node.left);
        visit(node.right);
        return;
      case 'not':
        visit(node.operand);
        return;
      case 'call':
        node.args.forEach(visit);
        return;
      case 'literal':
        return;
    }
  };
  visit(parseExpression(input));
  return [...refs];
}

/**
 * Compile an infix expression string into a function that evaluates it
 * against an EvalContext, returning the expression's value.
 * With `roots`, paths outside those roots are rejected at compile time.
 */
export function compileExpression(
  input: string,
  roots?: readonly ExprRoot[],
): (ctx: EvalContext) => unknown {
  const ast = parseExpression(input);
  const fn = buildEvaluator(ast);
  if (roots) checkRoots(input, ast, roots);
  return fn;
}

/**
 * Compile an infix expression string into a boolean predicate function.
 * The expression's result is coerced to boolean.
 * With `roots`, paths outside those roots are rejected at compile time.
 */
export function compilePredicate(
  input: string,
  roots?: readonly ExprRoot[],
): (ctx: EvalContext) => boolean {
  const ast = parseExpression(input);
  const fn = buildPredicate(ast);
  if (roots) checkRoots(input, ast, roots);
  return fn;
}
