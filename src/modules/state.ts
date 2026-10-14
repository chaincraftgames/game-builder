/**
 * State Module Schema
 *
 * Declares abstract game and player state — values that need to be tracked and
 * communicated across the game lifecycle but have no physical representation as
 * gamepieces. This replaces phantom gamepieces (e.g. bid-markers, score tokens)
 * that exist solely to hold data.
 *
 * Physical state (piece positions, properties, face states) belongs in the
 * gamepieceTypes + inventories modules. Abstract state belongs here.
 *
 * State is mutated by `effect: set-state` effects and read in JSON Logic
 * preconditions and flow endConditions via dot-paths:
 *   game.property.<id>           → game-scoped state
 *   player.property.<id>         → per-player state (resolved per acting player)
 *
 * Key design decisions:
 * - `game` properties are singleton — one value for the whole game.
 * - `player` properties are per-player — the engine maintains one value per player.
 *   In preconditions, `player.property.<id>` resolves to the acting player's value.
 * - All state properties must declare a `default` so the engine can initialise them
 *   before any effects run.
 * - There is no `team` state scope at this time — model team state as game properties
 *   with a naming convention (e.g. `team1Score`, `team2Score`) until that scope is needed.
 * - Every player has a built-in boolean `player.property.eliminated` (default false).
 *   Do not declare it. Set it true via set-state to eliminate a player: the engine skips
 *   their turns. Eliminated players remain visible to expressions, targets, messages, and
 *   win conditions — filter explicitly (e.g. `not player.property.eliminated`) when needed.
 *
 * @example Liar's Dice — bid tracking and elimination
 * ```yaml
 * state:
 *   game:
 *     properties:
 *       - id: currentBidQuantity
 *         type: { kind: number, min: 0, max: 30 }
 *         default: 0
 *       - id: currentBidFace
 *         type: { kind: number, min: 0, max: 6 }
 *         default: 0
 * # Elimination uses the built-in player.property.eliminated; remaining players are
 * # counted with countPlayers(not player.property.eliminated).
 */

import { z } from "zod";
import { IdentifierSchema, PropertyTypeSchema } from "#gamedef/modules/common.js";

// ---------------------------------------------------------------------------
// State property default value
// ---------------------------------------------------------------------------

/**
 * The initial value for a state property. Can be a literal or a special sentinel.
 *
 * @example
 * ```yaml
 * default: 0                          # literal integer
 * default: ""                         # literal empty string
 * default: false                      # literal boolean
 * default: { fromPlayerCount: true }  # set to the number of players at game start
 * ```
 */
export const StateDefaultSchema = z
  .union([
    z.string().describe("Literal string default."),
    z.number().describe("Literal numeric default."),
    z.boolean().describe("Literal boolean default."),
    z
      .object({ fromPlayerCount: z.literal(true) })
      .describe(
        "Initialize this integer property to the number of players at game start. " +
          "Useful for tracking how many players remain active.",
      ),
  ])
  .describe("Initial value for this state property before any effects run.");

// ---------------------------------------------------------------------------
// Computed property query
//
// A computed property's value is lazily derived from inventory/piece state
// rather than stored. This eliminates redundant state that must be kept in
// sync with inventory mutations — the runtime evaluates the query on each
// read, guaranteeing consistency.
//
// Computed properties are read-only: set-state effects targeting a computed
// property are a spec validation error.
// ---------------------------------------------------------------------------

/**
 * @example Count buildings a player has constructed
 * ```yaml
 * - id: buildingCount
 *   type: { kind: number }
 *   computed:
 *     inventory: built
 *     aggregate: count
 * ```
 * @example Check if a player has at least one factory
 * ```yaml
 * - id: hasFactory
 *   type: { kind: boolean }
 *   computed:
 *     inventory: built
 *     ofType: factoryToken
 *     aggregate: exists
 * ```
 * @example Sum total army strength
 * ```yaml
 * - id: totalArmyStrength
 *   type: { kind: number }
 *   computed:
 *     inventory: army
 *     ofType: soldier
 *     property: strength
 *     aggregate: sum
 * ```
 * @example Highest value card in hand
 * ```yaml
 * - id: bestCardValue
 *   type: { kind: number }
 *   computed:
 *     inventory: hand
 *     property: value
 *     aggregate: max
 * ```
 */
export const ComputedPropertySchema = z
  .object({
    inventory: z
      .string()
      .describe(
        "Inventory type ID to query. For game-scoped state, queries a game-scoped " +
          "inventory. For player-scoped state, queries the player's instance of a " +
          "player-scoped inventory. Forward reference to the inventories module.",
      ),
    ofType: z
      .string()
      .optional()
      .describe(
        "Restrict the query to pieces of this gamepiece type ID. Forward reference " +
          "to the gamepiece-types module. Omit to include all pieces in the inventory.",
      ),
    property: z
      .string()
      .optional()
      .describe(
        "Piece property ID to aggregate over. Required for sum/min/max aggregates. " +
          "Ignored for count/exists. Forward reference to a property declared on the " +
          "piece type.",
      ),
    aggregate: z
      .enum(["count", "exists", "sum", "min", "max"])
      .describe(
        "Aggregation function to apply.\n" +
          "  count  — number of pieces (integer)\n" +
          "  exists — at least one piece matches (boolean)\n" +
          "  sum    — sum of a numeric piece property (integer/number)\n" +
          "  min    — minimum value of a numeric piece property\n" +
          "  max    — maximum value of a numeric piece property",
      ),
  })
  .describe(
    "A query that derives a property value from inventory/piece state. " +
      "Evaluated lazily on read — never stored, never stale. " +
      "Eliminates the need for manual sync effects when a value can be " +
      "computed from the canonical piece/inventory state.",
  );

// ---------------------------------------------------------------------------
// State property definition
// ---------------------------------------------------------------------------

/**
 * A state property is either **stored** (has a `default`, mutated by set-state
 * effects) or **computed** (has a `computed` query, read-only, derived from
 * inventory/piece state on every read).
 *
 * @example Stored property
 * ```yaml
 * - id: currentBidQuantity
 *   type: { kind: number, min: 0, max: 30 }
 *   default: 0
 *   description: Quantity declared in the current round's bid.
 * ```
 * @example Computed property (count pieces in inventory)
 * ```yaml
 * - id: buildingCount
 *   type: { kind: number }
 *   computed:
 *     inventory: built
 *     aggregate: count
 *   description: Number of buildings this player has constructed.
 * ```
 */
export const StatePropertySchema = z
  .object({
    id: IdentifierSchema.describe(
        "Programmatic identifier. Used in dot-path references " +
          "(e.g., game.property.currentBidQuantity). Must be camelCase.",
      ),
    type: PropertyTypeSchema.describe("The value type for this property."),
    default: StateDefaultSchema.optional().describe(
      "Initial value for a stored property. Required when `computed` is absent. " +
        "Mutually exclusive with `computed`.",
    ),
    computed: ComputedPropertySchema.optional().describe(
      "Query that derives this property's value from inventory/piece state. " +
        "When present, the property is read-only and `default` must be absent.",
    ),
    description: z
      .string()
      .optional()
      .describe("Human-readable description of what this property tracks."),
  })
  .refine(
    (p) => (p.default !== undefined) !== (p.computed !== undefined),
    {
      message: "A state property must have exactly one of 'default' (stored) or 'computed' (derived), not both and not neither.",
    },
  )
  .describe(
    "A state variable — either stored (mutable, has default) or computed " +
      "(read-only, derived from inventory/piece state on read).",
  );

// ---------------------------------------------------------------------------
// Game-scoped state
// ---------------------------------------------------------------------------

export const GameStateSchema = z
  .object({
    properties: z
      .array(StatePropertySchema)
      .min(1)
      .describe(
        "Singleton properties shared across the whole game. " +
          "Referenced in effects and conditions as game.property.<id>.",
      ),
  })
  .describe("State variables scoped to the game as a whole.");

// ---------------------------------------------------------------------------
// Player-scoped state
// ---------------------------------------------------------------------------

/** Built-in player properties provided by the engine; authors must not declare them. */
export const RESERVED_PLAYER_PROPERTY_IDS = ["eliminated"] as const;

export const PlayerStateSchema = z
  .object({
    properties: z
      .array(StatePropertySchema)
      .min(1)
      .refine(
        (props) =>
          !props.some((p) =>
            (RESERVED_PLAYER_PROPERTY_IDS as readonly string[]).includes(p.id),
          ),
        {
          message:
            "'eliminated' is a built-in player property — do not declare it. " +
            "Reference it as player.property.eliminated.",
        },
      )
      .describe(
        "Per-player properties. The engine maintains one value per player. " +
          "In preconditions and effects, player.property.<id> resolves to the " +
          "acting player's value unless a player selector is specified. " +
          "Built-in (do not declare): 'eliminated' (boolean, default false) — set it true " +
          "to eliminate a player; the engine skips eliminated players' turns.",
      ),
  })
  .describe("State variables scoped per-player. One value per player instance.");

// ---------------------------------------------------------------------------
// State module
// ---------------------------------------------------------------------------

export const StateModuleSchema = z
  .object({
    game: GameStateSchema.optional().describe(
      "Game-scoped state properties. Singleton values for the whole game.",
    ),
    player: PlayerStateSchema.optional().describe(
      "Player-scoped state properties. One value per player.",
    ),
  })
  .describe(
    "Abstract state declarations — values tracked by the engine with no physical " +
      "gamepiece representation. Use for bids, round numbers, flags, and counters. " +
      "Mutated by set-state effects. Read via dot-paths in preconditions and endConditions.",
  );

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StateDefault = z.infer<typeof StateDefaultSchema>;
export type ComputedProperty = z.infer<typeof ComputedPropertySchema>;
export type StateProperty = z.infer<typeof StatePropertySchema>;
export type GameState = z.infer<typeof GameStateSchema>;
export type PlayerState = z.infer<typeof PlayerStateSchema>;
export type StateModule = z.infer<typeof StateModuleSchema>;
