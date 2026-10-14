// ---------------------------------------------------------------------------
// Expression evaluator — compiles an Expr AST into a callable function.
//
// The returned function takes an EvalContext and returns a value (number,
// string, boolean, or an inventory-like object for count()).
//
// Path resolution:
//   game.property.X       → ctx.gameProperties[X]
//   game.inventory.X      → ctx.gameInventories[X]
//   actor.property.X      → ctx.players[ctx.actorId].properties[X]
//   actor.inventory.X     → ctx.players[ctx.actorId].inventories[X]
//   player.property.X     → ctx.players[boundPlayerId].properties[X]
//   player.inventory.X    → ctx.players[boundPlayerId].inventories[X]
//   source.property.X     → ctx.gamepieces[ctx.sourcePieceId].properties[X]
//   target.property.X     → ctx.gamepieces[ctx.targetPieceId].properties[X]
//   input.X / param.X     → ctx.params[X]
//
// The `player` root is only valid inside all()/any()/countPlayers() quantifiers
// and per-player filters, which bind boundPlayerId for each iteration.
// ---------------------------------------------------------------------------

import type {
  Expr,
  EvalContext,
  InventoryLike,
  ArithOp,
  CompareOp,
} from "#compiler/expressions/types.js";
import { ExpressionError } from "#compiler/expressions/types.js";

export type ExprFn = (ctx: EvalContext) => unknown;
export type PredicateFn = (ctx: EvalContext) => boolean;

/**
 * Compile an AST into an evaluation function.
 */
export function buildEvaluator(ast: Expr): ExprFn {
  return compile(ast);
}

/**
 * Compile an AST into a boolean predicate function.
 * The expression's result is coerced to boolean.
 */
export function buildPredicate(ast: Expr): PredicateFn {
  const fn = compile(ast);
  return (ctx: EvalContext) => Boolean(fn(ctx));
}

// ---------------------------------------------------------------------------
// Internal recursive compiler
// ---------------------------------------------------------------------------

type InternalFn = (ctx: EvalContext) => unknown;

/** Delegates to the appropriate compile* function for this node kind. */
function compile(node: Expr): InternalFn {
  switch (node.kind) {
    case "literal":
      return compileLiteral(node.value);
    case "path":
      return compilePath(node.segments);
    case "compare":
      return compileCompare(node.op, node.left, node.right);
    case "arithmetic":
      return compileArithmetic(node.op, node.left, node.right);
    case "logical":
      return compileLogical(node.op, node.left, node.right);
    case "not":
      return compileNot(node.operand);
    case "call":
      return compileCall(node.fn, node.args);
  }
}

// --- Leaf nodes -------------------------------------------------------------

function compileLiteral(value: number | string | boolean): InternalFn {
  return () => value;
}

function compilePath(segments: string[]): InternalFn {
  const root = segments[0];
  const rest = segments.slice(1);

  return (ctx: EvalContext) => {
    const { base, skip } = resolveRoot(ctx, root, rest);
    return walkPath(base, rest, skip);
  };
}

interface RootResolution {
  /** The resolved container object. */
  base: unknown;
  /** How many segments of `rest` were consumed by the resolver (e.g. 1 for 'property'/'inventory', 0 for 'param'). */
  skip: number;
}

/** Returns the base object and how many leading rest-segments the resolver consumed (skip). */
function resolvePlayerPaths(
  player: {
    properties: Record<string, unknown>;
    inventories: Record<string, unknown>;
  },
  label: string,
  rest: string[],
): RootResolution {
  const kind = rest[0];
  if (kind === "property") return { base: player.properties, skip: 1 };
  if (kind === "inventory") return { base: player.inventories, skip: 1 };
  throw new ExpressionError(
    `Unknown ${label} sub-path '${kind}'; expected 'property' or 'inventory'`,
    0,
  );
}

/** Maps a path root to its base object and the number of rest-segments already consumed. */
function resolveRoot(
  ctx: EvalContext,
  root: string,
  rest: string[],
): RootResolution {
  switch (root) {
    case "game": {
      const kind = rest[0];
      if (kind === "property") return { base: ctx.gameProperties, skip: 1 };
      if (kind === "inventory") return { base: ctx.gameInventories, skip: 1 };
      throw new ExpressionError(
        `Unknown game sub-path '${kind}'; expected 'property' or 'inventory'`,
        0,
      );
    }
    case "actor": {
      if (!ctx.actorId) {
        throw new ExpressionError(
          'Cannot resolve "actor" — no actorId in context',
          0,
        );
      }
      const player = ctx.players[ctx.actorId];
      if (!player) {
        throw new ExpressionError(
          `Actor '${ctx.actorId}' not found in players`,
          0,
        );
      }
      return resolvePlayerPaths(player, "actor", rest);
    }
    case "player": {
      const pid = ctx.boundPlayerId;
      if (!pid) {
        throw new ExpressionError(
          '"player" requires boundPlayerId in context (quantifier or per-player filter)',
          0,
        );
      }
      const player = ctx.players[pid];
      if (!player) {
        throw new ExpressionError(`Player '${pid}' not found in players`, 0);
      }
      if (rest[0] === "id") return { base: { id: pid }, skip: 0 };
      return resolvePlayerPaths(player, "player", rest);
    }
    case "input":
    case "param": {
      if (!ctx.params) {
        throw new ExpressionError(
          `Cannot resolve "${root}" — no action inputs in context`,
          0,
        );
      }
      return { base: ctx.params, skip: 0 };
    }
    case "source": {
      if (!ctx.sourcePieceId)
        throw new ExpressionError(
          '"source" requires sourcePieceId in context',
          0,
        );
      const sourcePiece = ctx.gamepieces[ctx.sourcePieceId];
      if (!sourcePiece)
        throw new ExpressionError(
          `Source piece '${ctx.sourcePieceId}' not found`,
          0,
        );
      if (rest[0] !== "property")
        throw new ExpressionError(
          `Unknown source sub-path '${rest[0]}'; expected 'property'`,
          0,
        );
      return { base: sourcePiece.properties, skip: 1 };
    }
    case "target": {
      if (!ctx.targetPieceId)
        throw new ExpressionError(
          '"target" requires targetPieceId in context',
          0,
        );
      const targetPiece = ctx.gamepieces[ctx.targetPieceId];
      if (!targetPiece)
        throw new ExpressionError(
          `Target piece '${ctx.targetPieceId}' not found`,
          0,
        );
      if (rest[0] !== "property")
        throw new ExpressionError(
          `Unknown target sub-path '${rest[0]}'; expected 'property'`,
          0,
        );
      return { base: targetPiece.properties, skip: 1 };
    }
    case "piece": {
      if (!ctx.targetPieceId)
        throw new ExpressionError(
          '"piece" requires targetPieceId in context (piece filter)',
          0,
        );
      const piece = ctx.gamepieces[ctx.targetPieceId];
      if (!piece)
        throw new ExpressionError(`Piece '${ctx.targetPieceId}' not found`, 0);
      if (rest[0] === "property") return { base: piece.properties, skip: 1 };
      if (rest[0] === "id") return { base: { id: ctx.targetPieceId }, skip: 0 };
      return { base: piece, skip: 0 };
    }
    case "trigger": {
      if (!ctx.trigger)
        throw new ExpressionError(
          '"trigger" requires trigger in context (passive effects only)',
          0,
        );
      return { base: ctx.trigger, skip: 0 };
    }
    default:
      throw new ExpressionError(
        `Unknown path root '${root}'; expected 'game', 'actor', 'player', 'input', 'source', 'target', 'piece', or 'trigger'`,
        0,
      );
  }
}

/** Walks remaining segments from skip onward; returns undefined for null/missing intermediate nodes. */
function walkPath(base: unknown, segments: string[], skip: number): unknown {
  let current = base;
  for (let i = skip; i < segments.length; i++) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segments[i]];
  }
  return current;
}

// --- Binary operators -------------------------------------------------------

function compileCompare(op: CompareOp, left: Expr, right: Expr): InternalFn {
  const lFn = compile(left);
  const rFn = compile(right);
  return (ctx) => {
    const l = lFn(ctx);
    const r = rFn(ctx);
    return compareValues(op, l, r);
  };
}

/** Only >=, <=, >, < coerce to numbers; == and != use strict equality. */
function compareValues(op: CompareOp, l: unknown, r: unknown): boolean {
  switch (op) {
    case "==":
      return l === r;
    case "!=":
      return l !== r;
    case ">=":
      return Number(l) >= Number(r);
    case "<=":
      return Number(l) <= Number(r);
    case ">":
      return Number(l) > Number(r);
    case "<":
      return Number(l) < Number(r);
  }
}

function compileArithmetic(op: ArithOp, left: Expr, right: Expr): InternalFn {
  const lFn = compile(left);
  const rFn = compile(right);
  return (ctx) => {
    const l = Number(lFn(ctx));
    const r = Number(rFn(ctx));
    switch (op) {
      case "+":
        return l + r;
      case "-":
        return l - r;
      case "*":
        return l * r;
      case "/":
        return r === 0 ? 0 : l / r;
    }
  };
}

function compileLogical(op: "and" | "or", left: Expr, right: Expr): InternalFn {
  const lFn = compile(left);
  const rFn = compile(right);
  if (op === "and") {
    return (ctx) => Boolean(lFn(ctx)) && Boolean(rFn(ctx));
  }
  return (ctx) => Boolean(lFn(ctx)) || Boolean(rFn(ctx));
}

function compileNot(operand: Expr): InternalFn {
  const fn = compile(operand);
  return (ctx) => !fn(ctx);
}

// --- Function calls ---------------------------------------------------------

function compileCall(fn: string, args: Expr[]): InternalFn {
  switch (fn) {
    case "count":
      return compileCount(args);
    case "all":
      return compileQuantifier("all", args);
    case "any":
      return compileQuantifier("any", args);
    case "countPlayers":
      return compileCountPlayers(args);
    default:
      throw new ExpressionError(`Unknown function '${fn}'`, 0);
  }
}

function compileCount(args: Expr[]): InternalFn {
  if (args.length !== 1) {
    throw new ExpressionError(
      `count() expects exactly 1 argument, got ${args.length}`,
      0,
    );
  }
  const argFn = compile(args[0]);
  return (ctx) => {
    const inv = argFn(ctx);
    return countInventory(inv);
  };
}

/** Counts occupied slots across all inventory structure shapes. */
function countInventory(inv: unknown): number {
  if (inv == null || typeof inv !== "object") return 0;
  const obj = inv as InventoryLike;
  if (obj.pieceIds) return obj.pieceIds.length;
  if (obj.slots) return obj.slots.filter((s) => s != null).length;
  if (obj.cells)
    return Object.values(obj.cells).filter((v) => v != null).length;
  if (obj.nodes)
    return Object.values(obj.nodes).filter((v) => v != null).length;
  return 0;
}

/** Sets boundPlayerId for each player so the body predicate can use player.* paths. */
function compileQuantifier(mode: "all" | "any", args: Expr[]): InternalFn {
  if (args.length !== 1) {
    throw new ExpressionError(
      `${mode}() expects exactly 1 argument, got ${args.length}`,
      0,
    );
  }
  const predicateFn = compile(args[0]);

  return (ctx) => {
    const method = mode === "all" ? "every" : "some";
    return ctx.playerIds[method]((pid) => {
      const bound: EvalContext = { ...ctx, boundPlayerId: pid };
      return Boolean(predicateFn(bound));
    });
  };
}

function compileCountPlayers(args: Expr[]): InternalFn {
  if (args.length !== 1) {
    throw new ExpressionError(
      `countPlayers() expects exactly 1 argument, got ${args.length}`,
      0,
    );
  }
  const predicateFn = compile(args[0]);

  return (ctx) =>
    ctx.playerIds.filter((pid) =>
      Boolean(predicateFn({ ...ctx, boundPlayerId: pid })),
    ).length;
}
