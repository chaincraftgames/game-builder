// ---------------------------------------------------------------------------
// Expression evaluator functions — compile function calls for expressions.
//
// Provided functions:
//   count(collection[, filter])
//   sum(collection, value[, filter])
//   all(collection, predicate)
//   any(collection, predicate)
//   if(condition, then, else)
// A collection is `players` or an inventory path like actor.inventory.hand.
// ---------------------------------------------------------------------------

import type {
  Expr,
  EvalContext,
  InventoryLike,
  ArithOp,
  CompareOp,
} from "#compiler/expressions/types.js";
import { ExpressionError } from "#compiler/expressions/types.js";
import { InternalFn } from "#compiler/expressions/evaluator.js";

type CompileFn = (node: Expr) => InternalFn;

/**
 * Compile a function call expression into an evaluation function.
 * Returns an evaluation function for the given function call.
 */
export function compileCall(
  fn: string,
  args: Expr[],
  compile: CompileFn,
): InternalFn {
  switch (fn) {
    case "if":
      return compileIf(args, compile);
    case "count":
    case "sum":
    case "all":
    case "any":
      return compileAggregator(fn, args, compile);
    default:
      throw new ExpressionError(`Unknown function '${fn}'`, 0);
  }
}

// #region Aggregator Functions

type CollectionType =
  | { kind: "players" }
  | { kind: "inventory"; invFn: InternalFn };

function classifyCollection(
  fn: string,
  node: Expr,
  compile: CompileFn,
): CollectionType {
  if (node.kind === "path") {
    const s = node.segments;
    if (s.length === 1 && s[0] === "players") return { kind: "players" };
    if (
      s.length === 3 &&
      s[1] === "inventory" &&
      (s[0] === "game" || s[0] === "actor" || s[0] === "player")
    ) {
      return { kind: "inventory", invFn: compile(node) };
    }
  }
  throw new ExpressionError(
    `first argument of ${fn}() must be 'players' or an inventory path like actor.inventory.hand`,
    0,
  );
}

function itemContexts(c: CollectionType, ctx: EvalContext): EvalContext[] {
  return c.kind === "players"
    ? ctx.playerIds.map((pid) => ({ ...ctx, boundPlayerId: pid }))
    : inventoryPieceIds(c.invFn(ctx)).map((id) => ({
        ...ctx,
        boundPieceId: id,
      }));
}

function inventoryPieceIds(inv: unknown): string[] {
  if (inv == null || typeof inv !== "object") return [];
  const obj = inv as InventoryLike;
  if (obj.pieceIds) return obj.pieceIds;
  if (obj.slots) return obj.slots.filter((s): s is string => s != null);
  if (obj.cells)
    return Object.values(obj.cells).filter((v): v is string => v != null);
  if (obj.nodes)
    return Object.values(obj.nodes).filter((v): v is string => v != null);
  return [];
}

function selectItems(
  c: CollectionType,
  filterFn: InternalFn | undefined,
  ctx: EvalContext,
): EvalContext[] {
  const items = itemContexts(c, ctx);
  return filterFn ? items.filter((i) => Boolean(filterFn(i))) : items;
}

const AGGREGATOR_ARITY: Record<string, [min: number, max: number]> = {
  count: [1, 2],
  sum: [2, 3],
  all: [2, 2],
  any: [2, 2],
};

function checkAggregatorArity(fn: string, argCount: number): void {
  const [min, max] = AGGREGATOR_ARITY[fn];
  if (argCount >= min && argCount <= max) return;
  if ((fn === "all" || fn === "any") && argCount === 1) {
    throw new ExpressionError(
      `${fn}() needs a collection: ${fn}(players, <expr>)`,
      0,
    );
  }
  const expected = min === max ? `exactly ${min}` : `${min} or ${max}`;
  throw new ExpressionError(
    `${fn}() expects ${expected} arguments, got ${argCount}`,
    0,
  );
}

function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new ExpressionError("sum() item value is not a number", 0);
  }
  return n;
}

function compileAggregator(
  fn: string,
  args: Expr[],
  compile: CompileFn,
): InternalFn {
  checkAggregatorArity(fn, args.length);
  const collection = classifyCollection(fn, args[0], compile);
  switch (fn) {
    case "count": {
      const filterFn = args.length > 1 ? compile(args[1]) : undefined;
      return (ctx) => selectItems(collection, filterFn, ctx).length;
    }
    case "sum": {
      const valueFn = compile(args[1]);
      const filterFn = args.length > 2 ? compile(args[2]) : undefined;
      return (ctx) =>
        selectItems(collection, filterFn, ctx).reduce(
          (acc, item) => acc + toFiniteNumber(valueFn(item)),
          0,
        );
    }
    case "all": {
      const predicateFn = compile(args[1]);
      return (ctx) =>
        itemContexts(collection, ctx).every((item) => Boolean(predicateFn(item)));
    }
    case "any": {
      const predicateFn = compile(args[1]);
      return (ctx) =>
        itemContexts(collection, ctx).some((item) => Boolean(predicateFn(item)));
    }
    default:
      throw new ExpressionError(`Unknown aggregator function '${fn}'`, 0);
  }
} 

// #endregion Aggregator Functions

function compileIf(args: Expr[], compile: CompileFn): InternalFn {
  if (args.length !== 3) {
    throw new ExpressionError(
      `if() expects exactly 3 arguments, got ${args.length}`,
      0,
    );
  }
  const conditionFn = compile(args[0]);
  const thenFn = compile(args[1]);
  const elseFn = compile(args[2]);

  return (ctx) => {
    return Boolean(conditionFn(ctx)) ? thenFn(ctx) : elseFn(ctx);
  };
}
