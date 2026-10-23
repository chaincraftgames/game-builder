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

import { parseExpression } from '#compiler/expressions/parser.js';
import { buildEvaluator, buildPredicate } from '#compiler/expressions/evaluator.js';
import type { EvalContext, Expr } from '#compiler/expressions/types.js';

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
 */
export function compileExpression(input: string): (ctx: EvalContext) => unknown {
  const ast = parseExpression(input);
  return buildEvaluator(ast);
}

/**
 * Compile an infix expression string into a boolean predicate function.
 * The expression's result is coerced to boolean.
 */
export function compilePredicate(input: string): (ctx: EvalContext) => boolean {
  const ast = parseExpression(input);
  return buildPredicate(ast);
}
