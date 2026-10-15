// ---------------------------------------------------------------------------
// Expression compiler — AST types and evaluation context
//
// The expression language supports infix conditions used in flow
// endConditions, player-target matching, and input validation.
//
// Path roots:
//   game.property.X       → gameProperties[X]
//   game.inventory.X      → gameInventories[X]
//   actor.property.X      → players[actorId].properties[X]
//   actor.inventory.X     → players[actorId].inventories[X]
//   player.property.X     → bound player (inside aggregators over `players`)
//   player.inventory.X    → bound player (inside aggregators over `players`)
//   piece.property.X      → bound piece (inside aggregators over an inventory)
//   source.property.X     → gamepieces[sourcePieceId].properties[X]
//   target.property.X     → gamepieces[targetPieceId].properties[X]
//   trigger.X             → trigger[X] (passive effects only)
//
// Functions (a collection is `players` or an inventory path like actor.inventory.hand):
//   count(collection[, filter])       → number of items passing the filter
//   sum(collection, value[, filter])  → total of value over the items passing the filter
//   all(collection, predicate)        → true if predicate holds for every item
//   any(collection, predicate)        → true if predicate holds for at least one item
//   if(condition, then, else)         → then or else, evaluating only the chosen branch
// ---------------------------------------------------------------------------

// --- AST node types ---------------------------------------------------------
/** Comparison operators. */
export type CompareOp = "==" | "!=" | ">=" | "<=" | ">" | "<";
/** Arithmetic operators. */
export type ArithOp = "+" | "-" | "*" | "/";

/** Expression AST node. */
export type Expr =
  | { kind: "literal"; value: number | string | boolean }
  | { kind: "path"; segments: string[] }
  | { kind: "compare"; op: CompareOp; left: Expr; right: Expr }
  | { kind: "arithmetic"; op: ArithOp; left: Expr; right: Expr }
  | { kind: "logical"; op: "and" | "or"; left: Expr; right: Expr }
  | { kind: "not"; operand: Expr }
  | { kind: "call"; fn: string; args: Expr[] };

// --- Shapes for game state objects ----------------------------------------
/** Inventory-like object. */
export interface InventoryLike {
  structure?: string;
  pieceIds?: string[];
  slots?: (string | null)[];
  cells?: Record<string, string | null>;
  nodes?: Record<string, string | null>;
}

/** Player-like object. */
export interface PlayerLike {
  properties: Record<string, unknown>;
  inventories: Record<string, InventoryLike>;
}

/** Evaluation context for expressions. */
export interface EvalContext {
  /** Game-scoped state properties — backing store for `game.property.X` paths. */
  gameProperties: Record<string, unknown>;
  /** Game-scoped inventories — backing store for `game.inventory.X` paths and `count()`. */
  gameInventories: Record<string, InventoryLike>;
  /**
   * Player state map keyed by player ID — backing store for `actor.property.X`,
   * `actor.inventory.X`, `player.property.X`, and `player.inventory.X` paths.
   * `PlayerLike` is a lightweight projection (properties + inventories only); roles
   * and other PlayerState fields are not needed for expression evaluation.
   */
  players: Record<string, PlayerLike>;
  /**
   * All instantiated gamepieces in the session, keyed by piece ID — lookup table
   * for `source.property.X` and `target.property.X` path resolution.
   * Pieces are included regardless of which inventory they currently occupy.
   * Only typeId and properties are projected; inventory membership is not.
   */
  gamepieces: Record<
    string,
    { typeId: string; properties: Record<string, unknown> }
  >;
  /**
   * Ordered player ID list used by `all()` and `any()` quantifiers.
   * Kept separate from `players` because iteration order must be deterministic.
   */
  playerIds: string[];
  /** ID of the acting player; resolves `actor.property/inventory.X` paths. */
  actorId?: string;
  /**
   * Action inputs from the triggering action — resolves `param.X` paths.
   * Present when evaluating effect-time value expressions; absent for flow
   * `endCondition` predicates where no action context exists.
   */
  params?: Record<string, unknown>;
  /** ID of the source piece for this effect; resolves `source.property.X`. */
  sourcePieceId?: string;
  /** ID of the piece currently being iterated in an update loop; resolves `target.property.X`. */
  targetPieceId?: string;
  /** Facts about the state-write that fired a passive; resolves `trigger.X`. Absent outside passives. */
  trigger?: Record<string, unknown>;
  /** Bound player ID for per-player iteration; resolves `player.property.X` outside quantifiers. */
  boundPlayerId?: string;
  /** Bound piece ID for per-piece iteration; resolves `piece.property.X` outside quantifiers. */
  boundPieceId?: string;
}

// --- Error types -----------------------------------------------------------
/** Error thrown during expression evaluation. */
export class ExpressionError extends Error {
  constructor(
    message: string,
    public readonly pos: number,
    public readonly source?: string,
  ) {
    super(
      source
        ? `${message} at position ${pos} in "${source}"`
        : `${message} at position ${pos}`,
    );
    this.name = "ExpressionError";
  }
}
