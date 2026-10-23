/**
 * Inventories Module Schema
 *
 * Depends on: gamepiece-types (accepts: string[] are gamepiece type IDs)
 * Referenced by: effects (move targets), flow (inventory state conditions),
 *                mechanics (win conditions referencing inventory contents),
 *                gamepiece-types (inventorySlot.inventoryTypeId forward refs resolve here).
 *
 * An inventory type defines the rules for a collection of gamepieces — its scope,
 * what it accepts, how it is spatially organized, how visible it is, and how large
 * it can be. Gamepiece types reference inventory types via inventory slots; the
 * actual collections are instantiated at runtime per scope (per-player, per-piece, etc.).
 *
 * Reserved system inventory:
 * - 'game:unassigned' — all catalog pieces start here before setup runs. The engine
 *   creates this inventory automatically; do NOT declare it in this module.
 *   Setup effects (root loop onEnter hooks) move pieces out of game:unassigned into
 *   their starting inventories (deal, place, shuffle, distribute). During play,
 *   pieces can be returned to game:unassigned to model an implicit off-board pool.
 *   If players need to see how many pool pieces remain, declare an explicit game-scoped
 *   inventory (e.g., 'gold-supply') and move into it during setup instead.
 *
 * Key design decisions:
 * - structure defines how a collection is ORGANIZED spatially, enabling specific
 *   position-based queries and placements:
 *     none   → unordered collection, no spatial queries (hand, pool, supply pile)
 *     stack  → top/bottom/position N (draw pile, tableau column)
 *     line   → position N, left/right neighbors (card row, movement path)
 *     grid   → (row, col), row/column/diagonal queries (chess board, tic-tac-toe)
 *     graph  → arbitrary adjacency from catalog neighbor lists (hex map, irregular board)
 *   Behavioral patterns built on these structures (score tracks, replenishing rows)
 *   belong in the mechanics module, not here.
 * - displayHint is VISUAL ONLY (renderer guidance). No engine semantics.
 * - scope determines how many instances of this inventory exist at runtime.
 *   It is an object with a 'kind' discriminator and an optional 'role' that
 *   restricts player/team scopes to a specific player role:
 *     { kind: game }                  → one shared instance
 *     { kind: player }                → one per player
 *     { kind: player, role: dealer }  → one per player with that role (e.g., crib)
 *     { kind: team }                  → one per team
 *     { kind: piece }                 → one per gamepiece (via inventorySlots)
 * - visibility controls which players can see piece identities.
 *   countVisibility (optional) independently controls whether the count is visible.
 *
 * @example Full module (card game + grid board)
 * ```yaml
 * types:
 *   - id: playerHand
 *     label: Hand
 *     scope: { kind: player }
 *     accepts: [combatCard]
 *     visibility: owner
 *     displayHint: fan
 *     capacity: { max: 7 }
 *   - id: combatCardDeck
 *     label: Draw Pile
 *     scope: { kind: game }
 *     accepts: [combatCard]
 *     visibility: never
 *     countVisibility: always
 *     structure: stack
 *     displayHint: pile
 *   - id: discardPile
 *     label: Discard
 *     scope: { kind: game }
 *     accepts: [combatCard]
 *     visibility: always
 *     structure: stack
 *     displayHint: pile
 *   - id: scoreMarkerTrack
 *     label: Score Track
 *     scope: { kind: game }
 *     accepts: [scoreMarker]
 *     visibility: always
 *     structure: line
 *   - id: battleGrid
 *     label: Battle Grid
 *     scope: { kind: game }
 *     accepts: [seaZone]
 *     visibility: always
 *     structure: grid
 *     gridDimensions: { rows: 5, columns: 5 }
 * ```
 */

import { z } from "zod";
import { IdentifierSchema } from "#gamedef/modules/common.js";

// ---------------------------------------------------------------------------
// Inventory scope
// ---------------------------------------------------------------------------

/**
 * @example
 * ```yaml
 * scope: { kind: game }                 # one shared instance (draw pile, board)
 * scope: { kind: player }               # one per player (hand, personal supply)
 * scope: { kind: player, role: dealer } # one per player with this role (crib)
 * scope: { kind: team }                 # one per team
 * scope: { kind: piece }                # one per gamepiece (via inventorySlots)
 * ```
 */
export const InventoryScopeSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("game"),
    }),
    z.object({
      kind: z.literal("player"),
      role: z
        .string()
        .optional()
        .describe(
          "Restrict this inventory to players with the given role ID. " +
            "Forward reference to the players module. " +
            "Omit for all players. Example: 'dealer' for the crib in cribbage.",
        ),
    }),
    z.object({
      kind: z.literal("team"),
      role: z
        .string()
        .optional()
        .describe(
          "Restrict this inventory to teams with the given role ID. " +
            "Omit for all teams.",
        ),
    }),
    z.object({
      kind: z.literal("piece"),
    }),
  ])
  .describe(
    "Determines how many runtime instances of this inventory exist and who owns them. " +
      "'game': one shared instance for the whole game (draw pile, shared board). " +
      "'player': one instance per player (hand, personal supply); add 'role' to restrict " +
      "to players with a specific role (e.g., only the dealer gets the crib). " +
      "'team': one instance per team; add 'role' to restrict to a specific team role. " +
      "'piece': one instance per gamepiece that has this inventory slot " +
      "(defined via inventorySlots on a gamepiece type).",
  );

// ---------------------------------------------------------------------------
// Inventory structure (organizational — engine spatial reasoning)
// ---------------------------------------------------------------------------

/**
 * @example
 * ```yaml
 * none     # unordered collection — hand, pool, supply pile (default)
 * stack    # draw pile, tableau column — top/bottom/position N queries
 * line     # card market row, movement path — position N, left/right neighbors
 * grid     # chess board, tic-tac-toe — (row,col), row/column/diagonal queries
 * graph    # hex map, irregular board — arbitrary neighbor lists from catalog
 * ```
 */
export const InventoryStructureSchema = z
  .enum(["none", "stack", "line", "grid", "graph"])
  .describe(
    "Organizational structure of this inventory. Determines what position-based " +
      "queries and placements the engine supports against it. " +
      "'none': unordered collection — no spatial queries, pieces have no meaningful " +
      "position (hand, pool, supply pile). Default. " +
      "'stack': ordered sequence — top, bottom, and position N queries valid " +
      "(draw pile, solitaire tableau column). " +
      "'line': 1D ordered sequence — position N and left/right neighbor queries valid " +
      "(card market row, movement path). " +
      "'grid': 2D coordinate system — (row, col) placement, row/column/diagonal queries valid " +
      "(chess board, tic-tac-toe). Requires gridDimensions. " +
      "'graph': arbitrary peer adjacency — neighbor queries valid, lists defined in catalog " +
      "(hex maps, irregular boards). " +
      "Note: score tracks and replenishing rows are MECHANICS that reference line inventories, " +
      "not special structure types.",
  );

// ---------------------------------------------------------------------------
// Structure-specific configuration
// ---------------------------------------------------------------------------

/**
 * @example Grid 5×5 board
 * ```yaml
 * structure: grid
 * gridDimensions: { rows: 5, columns: 5 }
 * ```
 */

export const GridDimensionsSchema = z
  .object({
    rows: z.number().int().min(1).describe("Number of rows in the grid."),
    columns: z.number().int().min(1).describe("Number of columns in the grid."),
  })
  .describe("Dimensions of a grid-structure inventory.");

// ---------------------------------------------------------------------------
// Inventory placement — canonical position schema for all structure types
// ---------------------------------------------------------------------------

/**
 * A structured position within an inventory. The `kind` must match the
 * `structure` of the target inventory:
 *
 *   - `stack-top`    → top of a stack (draw, discard)
 *   - `stack-bottom` → bottom of a stack
 *   - `line-index`   → single position on a line inventory (0-based)
 *   - `line-range`   → contiguous span on a line inventory — for batch catalog placement
 *   - `grid-cell`    → single cell on a grid inventory
 *   - `grid-row`     → fill one piece per column across a row — for batch catalog placement
 *   - `graph-node`   → named node on a graph inventory
 *
 * Used by both the catalog module (initial placement) and the effects module
 * (move/reposition destinations). Batch kinds (`line-range`, `grid-row`) are only
 * meaningful in catalog entries with `quantity > 1`.
 *
 * @example Stack convenience positions
 * ```yaml
 * at: { kind: stack-top }
 * at: { kind: stack-bottom }
 * ```
 * @example Specific line slot (0-based)
 * ```yaml
 * at: { kind: line-index, index: 3 }
 * ```
 * @example Contiguous line range for quantity-8 entry
 * ```yaml
 * placement: { kind: line-range, start: 0, end: 7 }
 * ```
 * @example Single grid cell
 * ```yaml
 * at: { kind: grid-cell, row: 1, col: "e" }
 * ```
 * @example Grid row for quantity-8 pawns
 * ```yaml
 * placement: { kind: grid-row, row: 2, colStart: "a", colEnd: "h" }
 * ```
 * @example Graph node with adjacency declaration
 * ```yaml
 * placement: { kind: graph-node, nodeId: "C3", neighbors: ["B2", "B3", "C4", "D3"] }
 * ```
 */
export const InventoryPlacementSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("stack-top").describe("Top of a stack-structure inventory."),
    }),
    z.object({
      kind: z.literal("stack-bottom").describe("Bottom of a stack-structure inventory."),
    }),
    z.object({
      kind: z.literal("line-index").describe("Single position on a line-structure inventory."),
      index: z.number().int().min(0).describe("0-based position index."),
    }),
    z.object({
      kind: z.literal("line-range").describe(
        "Contiguous range of positions on a line-structure inventory. " +
          "For catalog use with quantity > 1. Requires quantity === end − start + 1.",
      ),
      start: z.number().int().min(0).describe("0-based start index (inclusive)."),
      end: z.number().int().min(0).describe("0-based end index (inclusive)."),
    }),
    z.object({
      kind: z.literal("grid-cell").describe("Single cell on a grid-structure inventory."),
      row: z
        .union([z.string(), z.number()])
        .describe("Row label or 1-based index. String for lettered rows (e.g. 'a'), number for numeric."),
      col: z
        .union([z.string(), z.number()])
        .describe("Column label or 1-based index. String for lettered columns (e.g. 'e'), number for numeric."),
    }),
    z.object({
      kind: z.literal("grid-row").describe(
        "Fill one piece per column across a row range on a grid-structure inventory. " +
          "For catalog use with quantity > 1.",
      ),
      row: z
        .union([z.string(), z.number()])
        .describe("Row to fill. String for lettered rows, number for numeric."),
      colStart: z
        .union([z.string(), z.number()])
        .describe("First column (inclusive). The engine fills left-to-right / a-to-z."),
      colEnd: z
        .union([z.string(), z.number()])
        .describe("Last column (inclusive)."),
    }),
    z.object({
      kind: z.literal("graph-node").describe("Named node on a graph-structure inventory."),
      nodeId: z.string().describe("Identifier of the graph node to place the piece at."),
      neighbors: z
        .array(z.string())
        .optional()
        .describe(
          "Adjacent node IDs. Declare when this entry establishes graph topology. " +
            "Omit when adjacency is defined elsewhere or not needed.",
        ),
    }),
  ])
  .describe(
    "Structured position within a spatially-organized inventory. " +
      "The 'kind' must match the 'structure' of the target inventory. " +
      "Omit for unstructured inventories (structure: none).",
  );

export type InventoryPlacement = z.infer<typeof InventoryPlacementSchema>;

// ---------------------------------------------------------------------------
// Inventory visibility
// ---------------------------------------------------------------------------

/**
 * @example
 * ```yaml
 * always      # all pieces visible to all players (shared discard pile)
 * revealed    # visible when the piece is face-up (face-down deck, face-up tableau)
 * owner       # visible only to the owning player (hand of cards)
 * never       # pieces invisible to all players (engine-internal buffer, face-down deck)
 * ```
 */
export const InventoryVisibilitySchema = z
  .enum(["always", "top-revealed", "revealed", "owner", "never"])
  .describe(
    "Controls which players can see the identity of pieces in this inventory. " +
      "'always': all pieces visible to all players. " +
      "'top-revealed': only the top piece is visible; others are hidden. Stack-only. " +
      "'revealed': visible when the containing piece is face-up; hidden when face-down. " +
      "'owner': only the owning player can see the pieces. " +
      "'never': pieces invisible to all players (engine-internal use only). " +
      "To control whether the piece count is visible, use countVisibility.",
  );

/**
 * @example
 * ```yaml
 * countVisibility: always  # everyone sees how many pieces (default for most inventories)
 * countVisibility: owner   # only the owner sees the count (e.g. Sheriff satchel)
 * countVisibility: never   # count is hidden from all players
 * ```
 */
export const CountVisibilitySchema = z
  .enum(["always", "owner", "never"])
  .describe(
    "Controls whether players can see how many pieces are in this inventory. " +
      "'always': all players can see the count. " +
      "'owner': only the owning player can see the count. " +
      "'never': count is hidden from all players. " +
      "Defaults based on visibility: owner → always, never → never, others → always.",
  );

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

/**
 * @example
 * ```yaml
 * capacity: { max: 7 }       # hand limit of 7
 * capacity: { min: 1 }       # must always have at least 1
 * capacity: { min: 0, max: 5 } # optional slot, up to 5
 * ```
 */
export const InventoryCapacitySchema = z
  .object({
    min: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Minimum number of pieces this inventory must hold. Default 0."),
    max: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Maximum number of pieces this inventory can hold. Omit for unlimited."),
  })
  .describe(
    "Size constraints on this inventory. Omit entirely for unconstrained collections.",
  );

// ---------------------------------------------------------------------------
// Inventory type
// ---------------------------------------------------------------------------

/**
 * @example Shared draw deck (stack structure, pieces hidden, count visible)
 * ```yaml
 * id: combatCardDeck
 * label: Draw Pile
 * scope: { kind: game }
 * accepts: [combatCard]
 * visibility: never
 * countVisibility: always
 * structure: stack
 * displayHint: pile
 * ```
 * @example Per-player hand (none structure — unordered, fan display)
 * ```yaml
 * id: playerHand
 * label: Hand
 * scope: { kind: player }
 * accepts: [combatCard]
 * visibility: owner
 * structure: none
 * displayHint: fan
 * capacity: { max: 7 }
 * ```
 * @example Role-restricted inventory (cribbage crib — dealer only, hidden until scoring)
 * ```yaml
 * id: crib
 * label: Crib
 * scope: { kind: player, role: dealer }
 * accepts: [playingCard]
 * visibility: owner
 * countVisibility: always
 * structure: none
 * capacity: { min: 4, max: 4 }
 * ```
 * @example Score marker track (line structure — score-track mechanic adds behavior)
 * ```yaml
 * id: scoreMarkerTrack
 * label: Score
 * scope: { kind: game }
 * accepts: [scoreMarker]
 * visibility: always
 * structure: line
 * ```
 * @example Tic-tac-toe board (grid structure)
 * ```yaml
 * id: tttBoard
 * label: Board
 * scope: { kind: game }
 * accepts: [xPiece, oPiece]
 * visibility: always
 * structure: grid
 * gridDimensions: { rows: 3, columns: 3 }
 * capacity: { max: 9 }
 * ```
 */
export const InventoryTypeSchema = z
  .object({
    id: IdentifierSchema.describe(
        "Unique identifier for this inventory type. Referenced by gamepiece-types " +
          "(inventorySlot.inventoryTypeId), effects (move targets), and catalog " +
          "(starting inventory assignments).",
      ),
    label: z
      .string()
      .optional()
      .describe(
        "Human-readable display name (e.g., 'Hand', 'Draw Pile', 'Score Track'). " +
          "Omit if the id is already human-friendly.",
      ),
    scope: InventoryScopeSchema,
    accepts: z
      .array(z.string())
      .min(1)
      .describe(
        "Gamepiece type IDs that may be placed in this inventory. " +
          "Forward references to the gamepiece-types module — validated cross-section. " +
          "Must have at least one entry.",
      ),
    visibility: InventoryVisibilitySchema,
    countVisibility: CountVisibilitySchema.optional().describe(
      "Controls whether players can see how many pieces are in this inventory. " +
        "Defaults based on visibility: owner → always, never → never, others → always.",
    ),
    structure: InventoryStructureSchema.default("none").describe(
      "Organizational structure of this inventory. 'none' (default) for unordered collections " +
        "(hands, pools, resource piles) where no spatial queries are needed.",
    ),
    gridDimensions: GridDimensionsSchema.optional().describe(
      "Required when structure is 'grid'. Defines the number of rows and columns.",
    ),
    gridOrder: z
      .enum(["row-major", "col-major"])
      .optional()
      .describe(
        "Fill order for sequential additions to a grid inventory (no explicit placement). " +
          "Default 'row-major' (left-to-right, top-to-bottom).",
      ),
    lineLength: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "Fixed number of positions for a line-structure inventory. " +
          "Pre-allocates slots; additions beyond this length throw. Omit for dynamic lines.",
      ),
    capacity: InventoryCapacitySchema.optional().describe(
      "Size constraints on this inventory. Omit for unconstrained collections.",
    ),
    displayHint: z
      .enum(["pile", "fan"])
      .optional()
      .describe(
        "Visual rendering hint for the renderer. No engine semantics — does not affect rules. " +
          "'pile': render as a stacked heap (resource pool, discard pile, face-down deck). " +
          "'fan': render spread in a fan (cards in hand). " +
          "Omit for inventories the renderer handles contextually (boards, grids, tracks).",
      ),
    description: z
      .string()
      .optional()
      .describe("Human-readable description of this inventory's role in the game."),
  })
  .describe(
    "A named collection type that holds gamepieces. Defines the rules for that collection: " +
      "scope (how many instances exist at runtime), what it accepts, spatial structure, " +
      "visibility, capacity, and zone transition constraints.",
  );

// ---------------------------------------------------------------------------
// Inventories module
// ---------------------------------------------------------------------------

export const InventoriesModuleSchema = z
  .object({
    types: z
      .array(InventoryTypeSchema)
      .min(1)
      .describe("All inventory types used in this game. Must have at least one entry."),
  })
  .describe(
    "All inventory types in the game — collections that hold gamepieces. " +
      "Depends on gamepiece-types (accepts references). " +
      "Referenced by effects (move targets), flow, mechanics, and catalog.",
  );

export type InventoryScope = z.infer<typeof InventoryScopeSchema>;
export type InventoryStructure = z.infer<typeof InventoryStructureSchema>;
export type InventoryVisibility = z.infer<typeof InventoryVisibilitySchema>;
export type CountVisibility = z.infer<typeof CountVisibilitySchema>;
export type InventoryCapacity = z.infer<typeof InventoryCapacitySchema>;
export type GridDimensions = z.infer<typeof GridDimensionsSchema>;
export type InventoryType = z.infer<typeof InventoryTypeSchema>;
export type InventoriesModule = z.infer<typeof InventoriesModuleSchema>;
