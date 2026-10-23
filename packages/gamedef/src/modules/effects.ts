/**
 * Effects Module Schema
 *
 * No dependencies on other spec modules — inventory type IDs, gamepiece type IDs,
 * and property IDs are all string forward references validated cross-section.
 * Referenced by: actions (action steps), flow (phase-transition effects),
 *                mechanics (pattern execution effects).
 *
 * Effects are named, concrete state-transition operations. Named effects live in the
 * effects module and are always fully self-contained — no parameters, no binding maps.
 * Call sites (actions, flow transitions, mechanics) reference them by ID.
 *
 * Inline effects may be used at any call site for one-off transitions not worth naming.
 * Inline effects inside actions may use { param: id } in PropertyValue to reference a
 * value from an input step of the enclosing action — the engine resolves these by convention
 * without any explicit binding declaration.
 *
 * Key design decisions:
 * - Every effect is discriminated by 'effect' (its kind) — a discriminated union, not a
 *   catch-all map. Named effects are invoked with 'effectRef: <id>'.
 * - Named effects are concrete and reusable. Use them for anything triggered from more
 *   than one place (an action AND a flow transition, or an action AND a mechanic).
 * - Inline effects are anonymous and local. Use them for one-off transitions specific
 *   to a single action or flow step.
 * - { param: id } in PropertyValue is only valid in inline effects inside an action that
 *   declares a matching input id. The engine resolves by name — no bind map needed.
 * - 'custom' kind is the escape hatch for logic that doesn't fit the primitive kinds.
 *   Avoid overusing it — the primitive kinds cover the common cases deterministically.
 * - PieceSelector is shared across move/flip/update/roll/orient. Deterministic only:
 *   player choice is declared as an action input (gamepiece-select), not an effect selector.
 * - draw-discard behavior is a MECHANIC that references effects — not a special kind.
 *
 * @example Effects module (card game)
 * ```yaml
 * effects:
 *   - id: shuffleDeck
 *     effect: shuffle
 *     inventory: drawDeck
 *
 *   - id: drawCard
 *     effect: move
 *     from: { inventory: drawDeck, select: top }
 *     to: { inventory: playerHand }
 *
 *   - id: advanceScore2
 *     effect: update
 *     pieces: { inventory: scoreTrack, select: all, ofType: scorePeg }
 *     property: position
 *     value: { delta: 2 }
 *
 *   - id: resolveCombat
 *     effect: custom
 *     description: >
 *       Compare power totals of face-up cards. Higher total scores 1 point.
 *       On a tie no points scored; both players draw a card.
 * ```
 * @example Action with inline effects using { param } (Liar's Dice make-bid)
 * ```yaml
 * id: makeBid
 * steps:
 *   - input: quantity
 *     type: { kind: number, min: 1, max: 30 }
 *   - input: faceValue
 *     type: { kind: number, min: 1, max: 6 }
 *   # { param: quantity } resolves from this action's input steps by id — no bind map
 *   - effect: update
 *     pieces: { inventory: currentBid, select: top }
 *     property: quantity
 *     value: { param: quantity }
 *   - effect: update
 *     pieces: { inventory: currentBid, select: top }
 *     property: faceValue
 *     value: { param: faceValue }
 * ```
 * @example Mixed named refs and inline in a single action
 * ```yaml
 * steps:
 *   - effectRef: shuffleDeck
 *   - effect: move
 *     from: { inventory: drawDeck, select: top }
 *     to: { inventory: playerHand }
 * ```
 */

import { z } from "zod";
import { InventoryPlacementSchema } from "#gamedef/modules/inventories.js";
import { ConditionExpressionSchema, IdentifierSchema, keyedUnion } from "#gamedef/modules/common.js";

// ---------------------------------------------------------------------------
// Player target (who a player-scoped effect or selector applies to)
//
// By default, player-scoped effects target the acting player. Use a target
// to apply effects to other players: a chosen opponent, all players, all
// players except the actor, or players matching a condition.
//
// Contexts with no actor (flow hooks) must name their players explicitly.
// ---------------------------------------------------------------------------

const ActorTargetSchema = z
  .object({ kind: z.literal("actor") })
  .describe("The acting player (default when target is omitted). Requires an actor — not available in flow hooks.");

const AllTargetSchema = z
  .object({ kind: z.literal("all") })
  .describe("Every player in the game.");

const AllOtherTargetSchema = z
  .object({ kind: z.literal("all-other") })
  .describe("All players except the actor. Requires an actor — not available in flow hooks.");

const ParamTargetSchema = z
  .object({
    kind: z.literal("param"),
    inputId: z
      .string()
      .describe(
        "Action input ID whose value is the target player ID. " +
          "Forward reference to an input declared on the enclosing action.",
      ),
  })
  .describe(
    "A specific player resolved from an action input (e.g., 'choose a target'). " +
      "The input value must be a valid player ID.",
  );

const StateRefTargetSchema = z
  .object({
    kind: z.literal("stateRef"),
    path: z
      .string()
      .describe(
        "Dot-path to a string state property whose value is the target player ID. " +
          "Format: 'game.property.<id>'. Resolved at runtime.",
      ),
  })
  .describe(
    "A player identified by a state property value (e.g., game.property.roundLoser).",
  );

const MatchingTargetSchema = z
  .object({
    kind: z.literal("matching"),
    condition: ConditionExpressionSchema.describe(
      "An infix expression evaluated per candidate player. " +
        "Available paths: 'player.property.<id>' (stored and computed state properties), " +
        "'count(player.inventory.<id>)' (total piece count in a player-scoped inventory). " +
        "Example: 'player.property.roundsWon >= 3' or " +
        "'count(player.inventory.hand) > 0 and not player.property.eliminated'.",
    ),
  })
  .describe(
    "All players satisfying an infix condition expression evaluated against each player's state.",
  );

/**
 * @example Target a player chosen by the actor
 * ```yaml
 * target: { kind: param, inputId: targetPlayer }
 * ```
 * @example Target all other players
 * ```yaml
 * target: { kind: all-other }
 * ```
 * @example Target players with >= 1 building (via computed property)
 * ```yaml
 * target:
 *   kind: matching
 *   condition: "player.property.buildingCount > 0"
 * ```
 * @example Target players whose score exceeds 10
 * ```yaml
 * target:
 *   kind: matching
 *   condition: "player.property.score >= 10"
 * ```
 * @example Compound condition — score > 5 AND at least one resource
 * ```yaml
 * target:
 *   kind: matching
 *   condition: "player.property.score > 5 and count(player.inventory.resources) > 0"
 * ```
 */
export const PlayerTargetSchema = z
  .discriminatedUnion("kind", [
    ActorTargetSchema,
    AllTargetSchema,
    AllOtherTargetSchema,
    ParamTargetSchema,
    StateRefTargetSchema,
    MatchingTargetSchema,
  ])
  .describe(
    "Who a player-scoped effect applies to. Defaults to 'actor' when omitted. " +
      "Use to target other players, all players, or players matching a condition.",
  );

/**
 * Subset of PlayerTargetSchema that always resolves to exactly one player.
 * Used where a single player is required (e.g., a move destination).
 */
export const SinglePlayerTargetSchema = z
  .discriminatedUnion("kind", [
    ActorTargetSchema,
    ParamTargetSchema,
    StateRefTargetSchema,
  ])
  .describe(
    "Exactly one player: the actor, a player chosen via an action input, or a player named by a state property.",
  );

// ---------------------------------------------------------------------------
// Gamepiece selector (shared across move, flip, update, roll, orient)
// ---------------------------------------------------------------------------

/**
 * @example
 * ```yaml
 * { inventory: drawDeck, select: top }
 * { inventory: drawDeck, select: top, count: 3 }
 * { inventory: combatZone, select: all, ofType: captain }
 * { inventory: diceTray, select: random, count: 2 }
 * { inventory: game:unassigned, select: { id: whiteKing } }
 * { inventory: playerHand, select: { id: { param: chosenCard } } }
 * { player: { kind: stateRef, path: game.property.roundLoser }, inventory: playerCup, select: top }
 * { player: { kind: param, inputId: targetPlayer }, inventory: playerHand, select: top }
 * { player: { kind: all }, inventory: playerCup, select: all }   # every player's cup — required in flow hooks
 * ```
 */
export const GamepieceSelectorSchema = z
  .object({
    player: PlayerTargetSchema
      .optional()
      .describe(
        "Whose instance of a player-scoped inventory to select from. Ignored for game-scoped inventories. " +
          "Omit to use the acting player — an error in flow hooks (onEnter/onComplete), which have no actor, " +
          "so hook effects must name their players, e.g. { kind: all }. " +
          "With several players, 'select' and 'count' apply to each player's inventory separately.",
      ),
    inventory: z
      .string()
      .describe(
        "Inventory type ID to select pieces from. Forward reference to the inventories module. " +
          "Use 'game:unassigned' to select from the system pool of unplaced catalog pieces.",
      ),
    select: z
      .union([
        z.enum(["top", "bottom", "random", "all"]).describe(
          "Deterministic selection mode. " +
            "'top': take from the top of a stack or front of a line. " +
            "'bottom': take from the bottom of a stack or back of a line. " +
            "'random': engine picks randomly — use 'count' to specify how many. " +
            "'all': every piece currently in the inventory (ignores 'count').",
        ),
        z
          .object({
            id: z.union([
              z.string().describe("Literal catalog piece ID (e.g., 'white-king')."),
              z.object({ param: z.string() }).describe(
                "Piece ID from an action input. References a gamepiece-select input by id.",
              ),
            ]),
          })
          .describe(
            "Select a specific piece by ID. Use a literal string for catalog-defined pieces " +
              "(e.g., { id: white-king }). Use { id: { param: inputId } } to select the piece " +
              "chosen by a gamepiece-select action input.",
          ),
      ])
      .describe("How to select pieces from the inventory."),
    count: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "How many pieces to select. " +
          "Omit when select is 'all'. For top/bottom/random defaults to 1.",
      ),
    ofType: z
      .string()
      .optional()
      .describe(
        "Restrict selection to pieces of this gamepiece type ID. Forward reference to " +
          "the gamepiece-types module. Omit to select any piece regardless of type.",
      ),
    filter: ConditionExpressionSchema.optional().describe(
      "Infix expression to filter eligible pieces. " +
        "Evaluated per-piece after 'ofType'. Available paths: 'piece.property.<id>', 'piece.typeId'. " +
        "Example: 'piece.property.frozen == false' or 'piece.typeId == \"creature\"'.",
    ),
  })
  .describe(
    "Identifies which pieces an effect operates on — which inventory and how to pick from it. " +
      "For player-scoped inventories, 'player' names whose inventory (see PlayerTarget).",
  );

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Inventory target (destination for move effects)
// ---------------------------------------------------------------------------

/**
 * @example
 * ```yaml
 * { inventory: playerHand }                                        # unordered — no position needed
 * { inventory: discardPile, at: { kind: stack-top } }             # top of the discard stack
 * { inventory: marketRow, at: { kind: line-index, index: 2 } }   # slot 2 in a line inventory
 * { inventory: battleGrid, at: { kind: grid-cell, row: 1, col: "e" } } # grid cell
 * { inventory: board, at: { kind: graph-node, nodeId: "C3" } }    # graph node
 * { inventory: battleGrid, at: { param: targetCell } }          # position from action input
 * { player: { kind: param, inputId: targetPlayer }, inventory: playerHand }    # opponent's inventory
 * ```
 */
export const InventoryTargetSchema = z
  .object({
    player: SinglePlayerTargetSchema.optional().describe(
      "Whose instance of a player-scoped destination inventory receives the pieces. " +
        "Exactly one player. Omit to use the acting player — an error in flow hooks, which have no actor.",
    ),
    inventory: z
      .string()
      .describe(
        "Destination inventory type ID. Forward reference to the inventories module. " +
          "For player-scoped inventories, the engine resolves to the acting player's " +
          "instance within the context of a player action.",
      ),
    at: z
      .union([
        InventoryPlacementSchema,
        z.object({ param: z.string() }).describe(
          "Placement position from an action input. References an inventory-position " +
            "input by id. The input resolves to an InventoryPlacement descriptor.",
        ),
      ])
      .optional()
      .describe(
        "Placement position within the inventory. " +
          "Use a literal InventoryPlacement for fixed positions (stack-top, grid-cell, etc.). " +
          "Use { param: inputId } for positions chosen by the player via inventory-position input. " +
          "Omit for unordered (none) inventories or when position doesn't matter. " +
          "When from and to reference the same inventory, the engine performs a " +
          "within-inventory reposition rather than a cross-inventory move.",
      ),
  })
  .describe("Destination inventory and optional placement position for a move effect.");

// ---------------------------------------------------------------------------
// Distribute target (explicit multi-instance targeting for distribute effects)
// ---------------------------------------------------------------------------

/**
 * @example
 * ```yaml
 * { inventory: playerHand }                          # every player's hand
 * { inventory: playerHand, roles: [mafia] }          # only players holding the mafia role
 * ```
 */
export const DistributeTargetSchema = z
  .object({
    inventory: z
      .string()
      .describe(
        "Target inventory type ID (player-scoped). " +
          "Forward reference to the inventories module.",
      ),
    roles: z
      .array(z.string())
      .min(1)
      .optional()
      .describe(
        "If provided, restrict distribution to players holding at least one of these role IDs. " +
          "Forward references to role IDs defined in the players module. " +
          "Use in setup to deal role-specific items: e.g., deal a kill card only to the mafia player.",
      ),
  })
  .describe("Target for distribute effects. Always deals to all players, optionally filtered by role.");

// ---------------------------------------------------------------------------
// Piece reference (source piece for value resolution)
// ---------------------------------------------------------------------------

/**
 * A reference to a single gamepiece, used to establish source context for
 * value resolution. Allows effects to read the source piece's properties
 * via `source.property.<id>` var paths.
 *
 * @example Reference a piece selected by the player as action input
 * ```yaml
 * source: { param: attacker }
 * ```
 * @example Reference a specific piece by literal ID
 * ```yaml
 * source: { id: hero-piece }
 * ```
 */
export const PieceRefSchema = z
  .union([
    z.object({
      param: z.string().describe(
        "Resolve the piece ID from an action input by matching this id. " +
          "The input should be a gamepiece-select type that yields a single piece ID.",
      ),
    }),
    z.object({
      id: z.string().describe("A literal gamepiece ID."),
    }),
  ])
  .describe(
    "Reference to a single gamepiece. Used by the `source` field on update and set-state " +
      "effects to establish which piece's properties are available via source.property.<id> var paths.",
  );

// ---------------------------------------------------------------------------
// Shared numeric operator schemas (used by PropertyValue and adjust)
// ---------------------------------------------------------------------------

/**
 * Numeric value or state variable reference with optional negate flag.
 * Shared shape for both delta and mult operators.
 */
const NumericOrVarSchema = z.union([
  z.number(),
  z.object({
    var: z.string(),
    negate: z.boolean().optional().describe(
      "If true, negate the resolved value before applying. " +
        "Allows decrementing by positive-valued properties without custom effects.",
    ),
  }),
  z.object({ expr: z.string() }).describe(
    "Compute the delta/factor from an infix expression evaluated at execution time. " +
      "Example: 'actor.property.attack - target.property.defense'.",
  ),
]);

/** Additive delta operator: increment/decrement a numeric value. */
export const DeltaSchema = z
  .object({ delta: NumericOrVarSchema })
  .describe(
    "Increment or decrement a numeric property. Delta can be a literal number or " +
      "a { var: \"path\" } reference to a numeric state property. " +
      "Positive delta increments, negative decrements (or use negate: true with var). " +
      "The engine clamps to the property's min/max if defined.",
  );

/** Multiplicative operator: scale a numeric value by a factor. */
export const MultSchema = z
  .object({ mult: NumericOrVarSchema })
  .describe(
    "Multiply a numeric property by a factor. Mult can be a literal number or " +
      "a { var: \"path\" } reference. Use 0.5 to halve, 2 to double, etc. " +
      "The engine rounds the result to the nearest integer if the property is integer-typed. " +
      "The engine clamps to the property's min/max if defined.",
  );

// ---------------------------------------------------------------------------
// Property value expression (for update effects)
// ---------------------------------------------------------------------------

/**
 * @example
 * ```yaml
 * value: 5                   # set to literal integer
 * value: "exhausted"         # set to literal string
 * value: true                # set to literal boolean
 * value: { delta: -1 }       # decrement by 1
 * value: { delta: 3 }        # increment by 3
 * value: { mult: 2 }         # double the current value
 * value: { mult: 0.5 }       # cut in half
 * value: { toggle: true }    # flip a boolean property
 * value: { param: delta }    # resolve from named param at call site
 * value: { var: "player.property.relicCount" }  # read from game state
 * value: { delta: { var: "game.property.spellPower" } }  # delta from state variable
 * value: { delta: { var: "player.property.damageDealt", negate: true } }  # subtract a value
 * value: { mult: { var: "player.property.workerCount" } }  # scale by state variable
 * value: { delta: { var: "source.property.attack", negate: true } }  # subtract source piece's attack
 * value: { var: "target.property.defense" }  # read from current target piece
 * value: { delta: { var: "trigger.delta", negate: true } }  # (passives only) undo/mirror the triggering change
 * ```
 */
export const PropertyValueSchema = z
  .union([
    z.string().describe("Set property to a literal string value."),
    z.number().describe("Set property to a literal numeric value."),
    z.boolean().describe("Set property to a literal boolean value."),
    DeltaSchema,
    MultSchema,
    z
      .object({ toggle: z.literal(true) })
      .describe("Flip a boolean property to its opposite value."),
    z
      .object({ param: z.string() })
      .describe(
        "Resolve this value from the enclosing action's input steps by matching id. " +
          "Engine convention — no explicit binding needed. " +
          "Only valid in inline effects inside an action that declares a matching input id.",
      ),
    z
      .object({ actor: z.literal(true) })
      .describe(
        "Set this property to the ID of the player who triggered the current action. " +
          "Useful for recording who made a bid, who attacked, or who initiated any action. " +
          "Engine resolves at execution time from the current action context.",
      ),
    z
      .object({ var: z.string() })
      .describe(
        "Set this property to the value of another state property. Use a dot-path: " +
          "'game.property.<id>', 'player.property.<id>', " +
          "'source.property.<id>' (requires a source field), " +
          "'target.property.<id>' (available in update effects — refers to the current target piece), " +
          "'trigger.<field>' (available only inside a passive's effects when the trigger is state-write; " +
          "fields: delta (signed, newValue - previousValue), previousValue, newValue, path, direction, targetId). " +
          "Resolved at effect execution time.",
      ),
    z
      .object({ expr: z.string() })
      .describe(
        "Compute this value from an infix expression evaluated at effect execution time. " +
          "Supports arithmetic (+, -, *, /), comparisons, boolean operators, " +
          "dot-path state references (game.property.x, actor.id, actor.property.y, trigger.delta in passives, etc.), " +
          "aggregators count/sum/all/any over 'players' or an inventory path, and if(cond, a, b) " +
          "to choose between two values. " +
          "Example: 'actor.property.attack - target.property.defense' or " +
          "'if(count(actor.inventory.hand) == 0, actor.id, game.property.leader)'. " +
          "Supersedes var/delta/mult for complex computations.",
      ),
  ])
  .describe(
    "The new value to assign, or a relative change to apply to a property. " +
    "Values can be literals, deltas, multipliers, state references, or action inputs. " +
    "Each value performs ONE operation. For computed values (arithmetic, counting or summing " +
    "pieces or players, choosing between two values), use { expr: \"...\" } with the " +
    "aggregators and if() — do not use a custom effect for these.",
  );

// ---------------------------------------------------------------------------
// Individual effect kinds
// ---------------------------------------------------------------------------

/**
 * Move one or more pieces between inventories, or reposition within the same inventory.
 * When from.inventory and to.inventory are the same ID, the engine performs an
 * in-place reposition — no piece is added or removed, only its position changes.
 *
 * @example Draw a card (cross-inventory)
 * ```yaml
 * effect: move
 * from: { inventory: drawDeck, select: top }
 * to: { inventory: playerHand }
 * ```
 * @example Player discards a chosen card to the top of the discard pile
 * ```yaml
 * effect: move
 * from: { inventory: playerHand, select: { id: { param: card } } }
 * to: { inventory: discardPile, at: { kind: stack-top } }
 * # within the action that calls this effect:
 * # steps:
 * #   - input: card
 * #     type: { kind: gamepiece-select, inventory: playerHand }
 * ```
 * @example Move a piece to a specific grid cell (within-inventory reposition)
 * ```yaml
 * effect: move
 * from: { inventory: battleGrid, select: { id: { param: piece } } }
 * to: { inventory: battleGrid, at: { kind: grid-cell, row: 2, col: 3 } }
 * # within the action that calls this effect:
 * # steps:
 * #   - input: piece
 * #     type: { kind: gamepiece-select, inventory: battleGrid }
 * ```
 * @example Advance a token to slot 5 on a line inventory
 * ```yaml
 * effect: move
 * from: { inventory: scoreTrack, select: all, ofType: scorePeg }
 * to: { inventory: scoreTrack, at: { kind: line-index, index: 5 } }
 * ```
 */
export const MoveEffectSchema = z
  .object({
    effect: z.literal("move"),
    from: GamepieceSelectorSchema.describe("Which pieces to move and where to take them from."),
    to: InventoryTargetSchema.describe(
      "Destination inventory and position. When from.inventory === to.inventory, " +
        "the engine repositions the piece within the same inventory.",
    ),
  })
  .describe(
    "Moves pieces between inventories or repositions them within the same inventory. " +
      "The engine preserves piece identity and all property state.",
  );

/**
 * Change the face state of one or more pieces.
 * Only meaningful for gamepiece types where hasFaceState is true (e.g. cards).
 * For temporary visibility overrides without changing face state, use 'reveal'/'hide'.
 *
 * @example Reveal all cards in the combat zone
 * ```yaml
 * effect: flip
 * pieces: { inventory: combatZone, select: all }
 * to: face-up
 * ```
 * @example Toggle the top card of the reserve
 * ```yaml
 * effect: flip
 * pieces: { inventory: reserve, select: top }
 * to: toggle
 * ```
 */
export const FlipEffectSchema = z
  .object({
    effect: z.literal("flip"),
    pieces: GamepieceSelectorSchema.describe("Which pieces to flip."),
    to: z
      .enum(["face-up", "face-down", "toggle"])
      .describe(
        "Target face state. 'face-up': reveal. 'face-down': conceal. " +
          "'toggle': reverse the current state.",
      ),
  })
  .describe(
    "Changes the physical face state of pieces (requires hasFaceState: true on the type). " +
      "Affects visibility of 'revealed' properties. " +
      "For temporary per-audience visibility without a physical flip, use 'reveal'/'hide'.",
  );

/**
 * Change a property value on one or more pieces.
 *
 * @example Set a piece as exhausted
 * ```yaml
 * effect: update
 * pieces: { inventory: playArea, select: { id: { param: piece } } }
 * property: isExhausted
 * value: true
 * # within the action that calls this effect:
 * # steps:
 * #   - input: piece
 * #     type: { kind: gamepiece-select, inventory: playArea }
 * ```
 * @example Advance score peg by 2
 * ```yaml
 * effect: update
 * pieces: { inventory: scoreTrack, select: all, ofType: scorePeg }
 * property: position
 * value: { delta: 2 }
 * ```
 * @example Deal damage equal to attacker's attack stat
 * ```yaml
 * effect: update
 * source: { param: attacker }
 * pieces: { inventory: battlefield, select: { id: { param: target } } }
 * property: hp
 * value: { delta: { var: "source.property.attack", negate: true } }
 * ```
 */
export const UpdateEffectSchema = z
  .object({
    effect: z.literal("update"),
    source: PieceRefSchema.optional().describe(
      "Optional reference to a source gamepiece whose properties can be read " +
        "via 'source.property.<id>' var paths in the value expression. " +
        "Typically the piece performing the action (e.g. an attacker).",
    ),
    pieces: GamepieceSelectorSchema.describe("Which pieces to update."),
    property: z
      .string()
      .describe(
        "ID of the property to change. Forward reference to a mutable property on the " +
          "selected gamepiece type.",
      ),
    value: PropertyValueSchema,
  })
  .describe(
    "Changes a mutable property on one or more pieces. Only valid for mutable properties. " +
      "Use 'source' to reference a triggering piece's properties in the value expression. " +
      "The current target piece's properties are available via 'target.property.<id>'.",
  );

/**
 * Randomize the order of pieces within an inventory.
 * Typically used to shuffle a draw deck after resetting from discard.
 *
 * @example Shuffle the draw deck
 * ```yaml
 * effect: shuffle
 * inventory: drawDeck
 * ```
 */
export const ShuffleEffectSchema = z
  .object({
    effect: z.literal("shuffle"),
    inventory: z
      .string()
      .describe(
        "Inventory type ID to shuffle. Forward reference to the inventories module. " +
          "Randomizes the internal order of all pieces in the inventory.",
      ),
  })
  .describe("Randomizes the order of all pieces in an inventory.");

/**
 * Deal a fixed number of pieces from a source to multiple inventory instances.
 * Typical use: deal opening hands, distribute starting resources.
 *
 * @example Deal 6 cards to each player round-robin
 * ```yaml
 * effect: distribute
 * from: { inventory: drawDeck, select: top }
 * to: { inventory: playerHand }
 * count: 6
 * style: round-robin
 * ```
 * @example Deal 1 kill card to each mafia player
 * ```yaml
 * effect: distribute
 * from: { inventory: roleCards, select: top }
 * to: { inventory: playerHand, roles: [mafia] }
 * count: 1
 * ```
 */
export const DistributeEffectSchema = z
  .object({
    effect: z.literal("distribute"),
    from: GamepieceSelectorSchema.describe(
      "Source inventory and selection method. 'count' on the selector is ignored — " +
        "use the top-level 'count' field.",
    ),
    to: DistributeTargetSchema,
    count: z
      .number()
      .int()
      .min(1)
      .describe("Number of pieces to deal to each target instance."),
    style: z
      .enum(["round-robin", "batch"])
      .default("round-robin")
      .describe(
        "Dealing order. 'round-robin': one piece at a time to each target in turn, repeat. " +
          "'batch': deal all 'count' pieces to the first target, then all to the next, etc.",
      ),
  })
  .describe(
    "Deals pieces from a source inventory to multiple target inventory instances. " +
      "Use for setup (deal opening hands) or mid-game distributions.",
  );

/**
 * Randomize the face value of one or more die pieces.
 * The engine uses faceCount from the gamepiece type to determine the range.
 *
 * @example Roll all dice in the dice tray
 * ```yaml
 * effect: roll
 * pieces: { inventory: diceTray, select: all }
 * ```
 * @example Roll a single chosen die
 * ```yaml
 * effect: roll
 * pieces: { inventory: diceTray, select: { id: { param: die } } }
 * ```
 */
export const RollEffectSchema = z
  .object({
    effect: z.literal("roll"),
    pieces: GamepieceSelectorSchema.describe(
      "Which die pieces to roll. Should select pieces with faceCount defined on their type.",
    ),
  })
  .describe(
    "Randomizes the face value of die pieces. Engine picks a random face in [1, faceCount].",
  );

/**
 * Pick a random value and write it to a game state property — no physical die
 * required (use 'roll' for that). Two shapes, chosen by which field is present:
 *   - options : a weighted list of explicit values (booleans, numbers, or strings).
 *               Omit weights for an equal-probability pick. This subsumes coin flips
 *               (true/false) and enum choices (suits, etc.).
 *   - range   : a uniform random integer in [min, max].
 *
 * @example 25% chance of a dramatic reversal (weighted boolean)
 * ```yaml
 * id: rollReversal
 * effect: set-random
 * path: game.property.includeReversal
 * options:
 *   - value: true
 *     weight: 0.25
 *   - value: false
 *     weight: 0.75
 * ```
 * @example Pick a random suit (equal probability)
 * ```yaml
 * id: chooseDominantSuit
 * effect: set-random
 * path: game.property.dominantSuit
 * options:
 *   - value: hearts
 *   - value: diamonds
 *   - value: clubs
 *   - value: spades
 * ```
 * @example Roll a d6 result into state (numeric range)
 * ```yaml
 * id: rollInitiative
 * effect: set-random
 * path: game.property.initiative
 * range:
 *   min: 1
 *   max: 6
 * ```
 */
export const SetRandomEffectSchema = z
  .object({
    effect: z.literal("set-random"),
    source: z
      .discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("options"),
            options: z
              .array(
                z
                  .object({
                    value: z
                      .union([z.string(), z.number(), z.boolean()])
                      .describe("A possible result value (string, number, or boolean)."),
                    weight: z
                      .number()
                      .positive()
                      .optional()
                      .describe(
                        "Relative likelihood of this option. Weights are normalized, so they " +
                          "need not sum to 1 — using probabilities that sum to 1 (e.g. 0.25/0.75) " +
                          "reads naturally and works directly. Omit weights on all options for an " +
                          "equal-probability pick.",
                      ),
                  })
                  .describe("One weighted candidate value."),
              )
              .min(2)
              .describe("The candidate values to choose from (at least two)."),
          })
          .describe(
            "Weighted choice over an explicit list of values. Covers coin flips, enum picks, " +
              "and any discrete weighted outcome.",
          ),
        z
          .object({
            kind: z.literal("range"),
            min: z.number().int().describe("Inclusive lower bound."),
            max: z.number().int().describe("Inclusive upper bound."),
          })
          .describe("Uniform random integer in [min, max]."),
      ])
      .describe("Where the random value comes from: a weighted 'options' list or a numeric 'range'."),
    path: z
      .string()
      .describe(
        "Dot-path to the game state property that receives the result " +
          "(e.g. 'game.property.includeReversal'). Forward reference to a property " +
          "declared in the state module whose type must be compatible with the result.",
      ),
  })
  .describe(
    "Picks a random value (from a weighted list of options or a numeric range) and writes it " +
      "to a state property. Use for RNG that drives game logic (flags, initiative, suit " +
      "selection). For rolling actual die pieces use 'roll' instead.",
  );

/**
 * Set or rotate the orientation of one or more pieces.
 * The engine uses orientationCount from the gamepiece type to determine valid orientations.
 *
 * @example Rotate a tile clockwise
 * ```yaml
 * effect: orient
 * pieces: { inventory: board, select: { id: { param: tile } } }
 * to: rotate-cw
 * ```
 * @example Set a piece to a specific orientation
 * ```yaml
 * effect: orient
 * pieces: { inventory: playArea, select: all, ofType: compassToken }
 * to: 0
 * ```
 */
export const OrientEffectSchema = z
  .object({
    effect: z.literal("orient"),
    pieces: GamepieceSelectorSchema.describe("Which pieces to reorient."),
    to: z
      .union([
        z
          .number()
          .int()
          .min(0)
          .describe(
            "Set to a specific orientation index (0-based, must be < orientationCount).",
          ),
        z
          .literal("rotate-cw")
          .describe("Rotate clockwise: increment orientation index, wrap at orientationCount."),
        z
          .literal("rotate-ccw")
          .describe(
            "Rotate counter-clockwise: decrement orientation index, wrap at 0.",
          ),
      ])
      .describe("Target orientation or rotation direction."),
  })
  .describe(
    "Changes the orientation of pieces. Meaningful for gamepiece types with orientationCount > 1.",
  );

// ---------------------------------------------------------------------------
// Custom effect (escape hatch for logic that doesn't fit the primitive kinds)
// ---------------------------------------------------------------------------

/**
 * Use custom when the required logic doesn't fit neatly into the primitive kinds:
 * conditional branching, multi-step resolution, comparisons across multiple pieces.
 *
 * @example Complex combat resolution
 * ```yaml
 * id: resolveCombat
 * effect: custom
 * description: >
 *   Compare the sum of power values of all face-up combat cards in each player's
 *   combat zone. The player with the higher total wins and scores 1 point. On a
 *   tie, no points are scored and both players draw one card from the draw deck.
 * ```
 */
export const CustomEffectSchema = z
  .object({
    effect: z.literal("custom"),
    description: z
      .string()
      .describe(
        "Plain-English description of what this effect should do. The AI generates " +
          "engine code from this description. Be precise: name the inventories, " +
          "properties, and conditions involved. Avoid vague language.",
      ),
  })
  .describe(
    "An effect whose logic is too complex for the primitive kinds. " +
      "Described in plain English; the AI generates the corresponding engine code. " +
      "Use sparingly — prefer primitive kinds for deterministic, testable effects.",
  );

// ---------------------------------------------------------------------------
// Message effect
// ---------------------------------------------------------------------------

/**
 * Who receives a message. The literal `actor` means the player whose turn/action
 * triggered this effect; `all` broadcasts to all players; `opponents` sends to
 * every player except the actor; `role:<id>` targets all players with the named
 * role; any other string is treated as a specific player ID.
 *
 * @example
 * ```yaml
 * to: actor           # confirmation to the player who just acted
 * to: all             # broadcast to everyone
 * to: opponents       # notify opponents without telling the acting player
 * to: "role:mafia"    # send only to players with the mafia role
 * to: "player1"       # direct to a specific player by ID
 * ```
 */
export const MessageRecipientSchema = z
  .string()
  .describe(
    "Who receives the message. " +
      "'actor': the player whose action triggered this effect. " +
      "'all': every player, including eliminated players. " +
      "'opponents': all players except the actor. " +
      "'role:<id>': all players assigned the named role (e.g., 'role:dealer'). " +
      "Any other string: a specific player ID. " +
      "For private messages use visibility: private. For broadcast use visibility: public (default).",
  );

/**
 * Temporarily override the visibility of pieces for specific players.
 * Does NOT move pieces or change face state — the override persists until an explicit
 * 'hide' effect or the end of the enclosing action.
 *
 * Use for: peek actions (view top card), challenge reveals (show all dice to everyone),
 * opponent hand inspections, and any case where pieces need to be visible temporarily.
 *
 * @example Reveal all dice to all players for challenge resolution (Liar's Dice)
 * ```yaml
 * effect: reveal
 * pieces: { inventory: playerCup, select: all }
 * to: all
 * ```
 * @example Active player peeks at the top card of the draw deck
 * ```yaml
 * effect: reveal
 * pieces: { inventory: drawDeck, select: top }
 * to: actor
 * ```
 * @example Reveal one opponent's card to the acting player
 * ```yaml
 * effect: reveal
 * pieces: { inventory: opponentHand, select: { id: { param: card } } }
 * to: actor
 * # within the action that calls this effect:
 * # steps:
 * #   - input: card
 * #     type: { kind: gamepiece-select, inventory: opponentHand }
 * ```
 */
export const RevealEffectSchema = z
  .object({
    effect: z.literal("reveal"),
    pieces: GamepieceSelectorSchema.describe("Which pieces to temporarily reveal."),
    to: MessageRecipientSchema.describe(
      "Who can see the revealed pieces. " +
        "'actor': only the player whose turn it is. " +
        "'all': every player, including eliminated players. " +
        "'opponents': all players except the actor. " +
        "'role:<id>': only players with the named role. " +
        "Any other string: a specific player ID.",
    ),
  })
  .describe(
    "Temporarily overrides piece visibility for specific players without moving pieces. " +
      "The reveal persists until an explicit 'hide' effect or the enclosing action completes. " +
      "Use for peek actions, challenge reveals, and hand inspections.",
  );

/**
 * Revert piece visibility to the inventory's default, cancelling any active 'reveal' override.
 *
 * @example Re-hide all dice after challenge resolution (Liar's Dice)
 * ```yaml
 * effect: hide
 * pieces: { inventory: playerCup, select: all }
 * ```
 * @example Re-hide the peeked top card after a peek action
 * ```yaml
 * effect: hide
 * pieces: { inventory: drawDeck, select: top }
 * ```
 */
export const HideEffectSchema = z
  .object({
    effect: z.literal("hide"),
    pieces: GamepieceSelectorSchema.describe(
      "Which pieces to revert to their inventory's default visibility.",
    ),
  })
  .describe(
    "Reverts pieces to their inventory's default visibility, cancelling any active 'reveal' overrides. " +
      "Typically paired with a preceding 'reveal' effect after the inspection or resolution window closes.",
  );

/**
 * @example Confirmation after player creates a weapon
 * ```yaml
 * id: confirmWeapon
 * effect: message
 * to: actor
 * template: "Your weapon '{{input.weaponDescription}}' has been registered."
 * ```
 * @example Phase announcement to all
 * ```yaml
 * id: announceBattle
 * effect: message
 * to: all
 * template: "Round {{state.game.property.currentRound}} begins — select your weapon!"
 * ```
 */
export const MessageEffectSchema = z
  .object({
    effect: z.literal("message"),
    to: MessageRecipientSchema.describe(
      "Who receives this message. " +
        "'all' or 'opponents' = broadcast (visible to those players). " +
        "'actor' or a specific player ID = private (visible only to that player). " +
        "'role:<id>' = delivered to players with that role only.",
    ),
    template: z
      .string()
      .describe(
        "Handlebars template string for the message body. " +
          "Available references: {{input.<id>}} for action inputs, " +
          "{{state.game.property.<id>}} and {{state.players.<playerId>.property.<id>}} " +
          "for game state. The engine resolves templates at execution time.",
      ),
  })
  .describe(
    "Delivers a deterministic text message to one or more players. " +
      "No state mutation — output only. " +
      "Visibility is determined by 'to': 'all'/'opponents'/'role:<id>' = broadcast; " +
      "'actor' or player ID = private. " +
      "For AI-generated text use effect: llm-effect.",
  );

// ---------------------------------------------------------------------------
// LLM effect
// ---------------------------------------------------------------------------

/**
 * One named output produced by an llm-effect call. The `field` name enters an
 * ephemeral per-invocation context (accessible as `{{llm.<field>}}` in subsequent
 * template strings). Optionally delivered as a player message and/or written to
 * a state path.
 *
 * At least one of `message` or `stateWrite` must be present — an output that
 * does neither is meaningless.
 *
 * @example Round narrative delivered as public message
 * ```yaml
 * field: roundNarrative
 * message:
 *   to: all
 *   visibility: public
 * ```
 * @example Winner written to state for follow-on effects to read
 * ```yaml
 * field: roundWinner
 * stateWrite: game.property.roundWinner
 * ```
 * @example Per-player private reveal
 * ```yaml
 * field: player1Reveal
 * message:
 *   to: player1
 *   visibility: private
 * ```
 */
export const LlmOutputSchema = z
  .object({
    field: z
      .string()
      .describe(
        "Name of this output in the LLM's structured response. " +
          "Enters ephemeral invocation context as {{llm.<field>}} for use in templates.",
      ),
    message: z
      .object({
        to: MessageRecipientSchema.describe(
          "Who receives this output as a message. " +
            "'all'/'opponents'/'role:<id>' = broadcast. " +
            "'actor' or player ID = private.",
        ),
      })
      .optional()
      .describe(
        "If present, deliver this field as a player message. " +
          "The engine uses the LLM's raw text for this field as the message body. " +
          "Visibility is determined by 'to': broadcast targets are visible to all addressed; " +
          "'actor' and player ID targets are private.",
      ),
    stateWrite: z
      .string()
      .optional()
      .describe(
        "Dot-path into game state where this output should be written " +
          "(e.g., 'game.property.roundWinner'). " +
          "The LLM must return a value parseable for the target state field's type. " +
          "Engine applies the write after the LLM call completes.",
      ),
  })
  .describe(
    "One named output field from an llm-effect call. " +
      "At least one of 'message' or 'stateWrite' must be present.",
  );

/**
 * One declared input to an llm-effect: a named handle the engine resolves from
 * game state, pieces, or an action parameter and injects into the prompt context
 * (referenced as `{{<name>}}` in rules and computation). Declaring inputs makes
 * the data the prompt depends on explicit and lets the spec restrict what the LLM
 * sees — rather than burying dot-paths in prose for the engine to parse.
 *
 * Exactly one source — `state`, `pieces`, or `param` — must be provided.
 *
 * @example Inject a state property
 * ```yaml
 * name: roundWinner
 * state: game.property.roundWinner
 * ```
 * @example Inject piece data, exposing only safe properties
 * ```yaml
 * name: arenaWeapons
 * pieces: { inventory: arena, select: all }
 * properties: [description]   # omit the hidden 'rps' so the LLM can't leak it
 * ```
 * @example Inject an action input (inline effect inside an action)
 * ```yaml
 * name: wager
 * param: wagerAmount
 * ```
 */
export const LlmInputSchema = z
  .object({
    name: z
      .string()
      .describe(
        "Handle for this input inside the prompt, referenced as {{<name>}} in rules and computation.",
      ),
    state: z
      .string()
      .optional()
      .describe(
        "Dot-path to a game/player state property to inject " +
          "(e.g. 'game.property.roundWinner'). Forward reference to the state module.",
      ),
    pieces: GamepieceSelectorSchema.optional().describe(
      "Piece set whose data to inject into the prompt context. The engine serializes the " +
        "selected pieces' visible properties (subject to 'properties').",
    ),
    properties: z
      .array(z.string())
      .min(1)
      .optional()
      .describe(
        "Only with 'pieces': whitelist of piece property IDs to expose to the LLM. " +
          "Omit hidden properties (e.g. 'rps') to keep them secret from narration. " +
          "Omit this field entirely to expose every owner-visible property.",
      ),
    param: z
      .string()
      .optional()
      .describe(
        "Action input id to inject. Only valid in inline effects inside an action that " +
          "declares a matching input id.",
      ),
  })
  .refine(
    (v) =>
      [v.state, v.pieces, v.param].filter((x) => x !== undefined).length === 1,
    { message: "Provide exactly one source: 'state', 'pieces', or 'param'." },
  )
  .describe(
    "A named input the engine resolves and injects into the llm-effect prompt context as " +
      "{{<name>}}. Exactly one of 'state', 'pieces', or 'param'.",
  );

/**
 * @example Opening announcement broadcast to all (Absurd Armaments initialize_game)
 * ```yaml
 * id: generateOpening
 * effect: llm-effect
 * prompt:
 *   rules:
 *     - "Use enthusiastic game-show announcer style with obnoxious energy"
 *     - "Welcome both players by name"
 *   computation: >
 *     Create a boisterous opening announcement welcoming both players and
 *     building excitement for the weapon battle.
 * outputs:
 *   - field: openingAnnouncement
 *     message:
 *       to: all
 *       visibility: public
 * ```
 * @example Round resolution — compute winner AND narrate (Absurd Armaments match_continues)
 * ```yaml
 * id: resolveRound
 * effect: llm-effect
 * inputs:
 *   - name: roundWinner
 *     state: game.property.roundWinner
 *   - name: arenaWeapons
 *     pieces: { inventory: arena, select: all }
 *     properties: [description]   # hidden 'rps' stays secret
 * prompt:
 *   rules:
 *     - "The winner has ALREADY been decided — read it from {{roundWinner}}; empty means a tie"
 *     - "Generate a 2-4 sentence narrative with boisterous announcer style"
 *     - "Reference both weapons in {{arenaWeapons}} by name"
 *   computation: >
 *     Narrate the clash between the weapons in {{arenaWeapons}}, consistent with
 *     {{roundWinner}}. If includeReversal is true, build dramatic tension first.
 * outputs:
 *   - field: roundNarrative
 *     message:
 *       to: all
 *       visibility: public
 * ```
 * @example Per-player private reveal (Absurd Armaments reveal_complete)
 * ```yaml
 * id: generateReveals
 * effect: llm-effect
 * prompt:
 *   computation: >
 *     Create a unique reveal for each player showcasing their opponent's weapons.
 * outputs:
 *   - field: player1Reveal
 *     message:
 *       to: player1
 *       visibility: private
 *   - field: player2Reveal
 *     message:
 *       to: player2
 *       visibility: private
 * ```
 */
export const LlmEffectSchema = z
  .object({
    effect: z.literal("llm-effect"),
    inputs: z
      .array(LlmInputSchema)
      .optional()
      .describe(
        "Data the engine resolves and injects into the prompt context before the call, each " +
          "referenced as {{<name>}} in rules/computation. Declare every game-state value, piece " +
          "set, or action param the prompt depends on — rather than burying dot-paths in prose — " +
          "so the engine can supply it and the spec can restrict what the LLM sees " +
          "(e.g. exposing a weapon's description but not its hidden class). The player roster and " +
          "metadata are always available implicitly. Omit for pure ceremony that needs no game data.",
      ),
    prompt: z
      .object({
        rules: z
          .array(z.string())
          .optional()
          .describe(
            "Ordered list of style, tone, and constraint rules for the LLM. " +
              "Applied before the computation directive. Use for: narrative style, " +
              "game rule reminders, output format requirements.",
          ),
        computation: z
          .string()
          .describe(
            "What the LLM should compute, decide, or generate. " +
              "Be specific about what each output field should contain. " +
              "References to game state are resolved by the engine before the call.",
          ),
      })
      .describe("Prompt directives for the LLM invocation."),
    outputs: z
      .array(LlmOutputSchema)
      .min(1)
      .describe(
        "Named output fields the LLM must return in its structured response. " +
          "Each field is either delivered as a player message, written to game state, or both. " +
          "The engine marshals the LLM's JSON response into these fields automatically.",
      ),
  })
  .describe(
    "Calls an LLM and distributes its structured outputs as player messages and/or state writes. " +
      "Use for AI-generated narrative, adjudication of ambiguous outcomes, or NPC decisions. " +
      "For non-text games: outputs with only 'message' are skipped; outputs with 'stateWrite' " +
      "are always applied (the LLM is called if any stateWrite output exists). " +
      "Separation of concerns: prefer computing deterministic outcomes in primitive effects and " +
      "using llm-effect only for narration — this keeps game logic testable without LLM mocks.",
  );

// ---------------------------------------------------------------------------
// Generate-gamepiece-image effect (LLM image generation attached to a piece)
// ---------------------------------------------------------------------------

/**
 * Generate an image for one or more pieces and store the resulting image
 * reference on the piece. A no-op in engines that don't support image
 * generation (text-only play continues unaffected).
 *
 * Mirrors game-builder's image-generation functions:
 *   - mode 'described' → generateImageWithDescription(contextText, templateVars, config):
 *       an LLM first writes an image description from the `source` property, then the
 *       preset's prompt template renders it.
 *   - mode 'direct' → generateImageDirect(templateVars, config):
 *       `templateVars` are injected straight into the preset's prompt template, no
 *       description step.
 * The `imageType` selects the engine's preset config (model, dimensions, prompt
 * template, optional description system prompt, negative prompt) by name — the same
 * way `image_type` selects a preset today.
 *
 * @example Generate weapon art from its description (Absurd Armaments)
 * ```yaml
 * id: illustrateWeapon
 * effect: generate-gamepiece-image
 * pieces: { inventory: forge, select: top }
 * imageType: token
 * mode: described
 * source: description
 * target: imageUrl
 * ```
 * @example Direct render from template variables (no description step)
 * ```yaml
 * id: renderCard
 * effect: generate-gamepiece-image
 * pieces: { inventory: arsenal, select: top }
 * imageType: token
 * mode: direct
 * templateVars: { token_description: description, token_data: rps }
 * target: imageUrl
 * ```
 */
export const GenerateImageEffectSchema = z
  .object({
    effect: z.literal("generate-gamepiece-image"),
    pieces: GamepieceSelectorSchema.describe(
      "Which piece(s) to illustrate. The generator is invoked once per selected piece.",
    ),
    imageType: z
      .string()
      .describe(
        "Named preset that selects the engine's image-generation config (`config` argument): " +
          "model, dimensions, prompt template, optional description system prompt and negative " +
          "prompt. Chosen by name the same way image_type selects a preset today " +
          "(e.g. 'token', 'cartridge', 'raw'). Whether the preset is two-step or single-step " +
          "is determined by `mode`.",
      ),
    mode: z
      .enum(["described", "direct"])
      .default("described")
      .describe(
        "Which generation flow to use. 'described' (two-step) mirrors " +
          "generateImageWithDescription: an LLM writes an image description from `source`, then " +
          "the preset's promptTemplate renders it. 'direct' (single-step) mirrors " +
          "generateImageDirect: `templateVars` are injected straight into the promptTemplate " +
          "with no description step.",
      ),
    source: z
      .string()
      .optional()
      .describe(
        "Property ID supplying the contextText for the 'described' flow (e.g. 'description'). " +
          "Forward reference to a text property on the selected pieces' gamepiece type. " +
          "Required when mode is 'described'; ignored when mode is 'direct'.",
      ),
    templateVars: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        "Additional {placeholder} substitutions for the preset's prompt template " +
          "(the `templateVars` argument), as a map of placeholder name to a property ID or " +
          "string literal. In the 'described' flow the LLM-written description is supplied " +
          "automatically as {image_description}; in 'direct' mode these are the only inputs.",
      ),
    target: z
      .string()
      .describe(
        "Property ID to store the generated image reference (URL or asset id) into — receives " +
          "the function's return value. Forward reference to a mutable string property on the " +
          "selected pieces' gamepiece type.",
      ),
  })
  .describe(
    "Generates an image for a piece and stores the image reference on the piece. Both `source` " +
      "and `target` are property IDs on the selected piece type, keeping the effect piece-scoped. " +
      "Mirrors game-builder's generateImageWithDescription (mode 'described') and generateImageDirect " +
      "(mode 'direct'), with `imageType` selecting the preset config. No-op in engines without " +
      "image support — text-only play is unaffected.",
  );

// ---------------------------------------------------------------------------
// Set-state effect
// ---------------------------------------------------------------------------

/**
 * Write a value to an abstract state property declared in the state module.
 * Does not operate on gamepieces — use 'update' for piece properties.
 *
 * Path format:
 *   game.property.<id>    → game-scoped property
 *   player.property.<id>  → target player's per-player property
 *
 * When `path` starts with 'player.property.', the `target` field determines
 * which player(s) are affected. Defaults to the acting player when omitted.
 *
 * @example Reset the bid quantity to 0 after a challenge
 * ```yaml
 * effect: set-state
 * path: game.property.currentBidQuantity
 * value: 0
 * ```
 * @example Set bid quantity from an action input
 * ```yaml
 * effect: set-state
 * path: game.property.currentBidQuantity
 * value: { param: quantity }
 * ```
 * @example Eliminate the acting player (built-in property; engine skips their turns)
 * ```yaml
 * effect: set-state
 * path: player.property.eliminated
 * value: true
 * ```
 * @example Deal 2 damage to a chosen opponent
 * ```yaml
 * effect: set-state
 * path: player.property.health
 * value: { delta: -2 }
 * target: { kind: param, inputId: targetPlayer }
 * ```
 * @example All other players lose 1 gold
 * ```yaml
 * effect: set-state
 * path: player.property.gold
 * value: { delta: -1 }
 * target: { kind: all-other }
 * ```
 * @example Tax all players who have >= 1 building
 * ```yaml
 * effect: set-state
 * path: player.property.gold
 * value: { delta: -1 }
 * target:
 *   kind: matching
 *   condition: "player.property.buildingCount >= 1"
 * ```
 */
export const SetStateEffectSchema = z
  .object({
    effect: z.literal("set-state"),
    source: PieceRefSchema.optional().describe(
      "Optional reference to a source gamepiece whose properties can be read " +
        "via 'source.property.<id>' var paths in the value expression.",
    ),
    path: z
      .string()
      .describe(
        "Dot-path to the state property to write. " +
          "Format: 'game.property.<id>' for game-scoped state, " +
          "'player.property.<id>' for player-scoped state. " +
          "Forward reference to a property declared in the state module.",
      ),
    value: PropertyValueSchema.describe(
      "New value to write, relative delta, or param reference. " +
        "Same vocabulary as update effects — literal, delta, toggle, or param.",
    ),
    target: PlayerTargetSchema.optional().describe(
      "Which player(s) to apply this effect to when the path targets a player property. " +
        "Defaults to the acting player when omitted. Ignored for game-scoped paths.",
    ),
  })
  .describe(
    "Writes to abstract game or player state declared in the state module. " +
      "Use 'target' to apply player-scoped effects to specific or multiple players. " +
      "Use 'source' to reference a triggering piece's properties in the value expression. " +
      "For piece property mutations use 'update'. " +
      "Readable in preconditions and flow endConditions via the same dot-path.",
  );

// ---------------------------------------------------------------------------
// Cancel effect
// ---------------------------------------------------------------------------

/**
 * @example Used inside a reactive "before" action to negate the trigger
 * ```yaml
 * id: blockDamage
 * label: Block
 * reactive:
 *   trigger: dealDamage
 *   timing: before
 * steps:
 *   - effect: cancel-effect
 * ```
 */
export const CancelEffectSchema = z
  .object({
    effect: z.literal("cancel-effect"),
  })
  .describe(
    "Cancels the named effect that triggered the current reactive action window. " +
      "Only valid inside a reactive action (one with a 'reactive' declaration). " +
      "Has no additional fields — the engine knows which effect to cancel from the " +
      "reactive context. When this effect executes, the triggering effect is voided " +
      "and any state changes it would have made are prevented. " +
      "Typically the sole or first effect in a timing: 'before' reactive action.",
  );

// ---------------------------------------------------------------------------
// Adjust effect (modify the triggering effect's numeric value)
// ---------------------------------------------------------------------------

/**
 * Adjusts the numeric value of the triggering effect before it writes to state.
 * Only valid inside a reactive action with timing: 'before'. Only meaningful when
 * the triggering effect is a set-state or update that applies a numeric delta or
 * literal value — for non-numeric effects, use cancel-effect instead.
 *
 * Adjustment uses the same delta/mult shapes as PropertyValue:
 * - delta: additive — added to the triggering effect's resolved value. 
 *   Can be a literal number or a { var, negate? } state reference.
 * - mult: multiplicative — the triggering effect's resolved value is scaled by this
 *   factor (rounded to nearest integer if property is integer-typed). Can be a literal
 *   number or a { var, negate? } state reference.
 *
 * @example Reduce incoming damage by 2 (armor — literal delta)
 * ```yaml
 * id: brace
 * label: Brace for Impact
 * reactive:
 *   trigger: dealDamage
 *   timing: before
 * steps:
 *   - effect: adjust
 *     adjustment: { delta: 2 }       # +2 on a -5 delta → net -3 damage
 * ```
 * @example Reduce damage by armor rating (var delta)
 * ```yaml
 * id: armorAbsorb
 * label: Armor Absorb
 * reactive:
 *   trigger: dealDamage
 *   timing: before
 * steps:
 *   - effect: adjust
 *     adjustment: { delta: { var: "player.property.armorRating" } }
 * ```
 * @example Halve incoming damage (shield — literal mult)
 * ```yaml
 * id: shieldBlock
 * label: Shield Block
 * reactive:
 *   trigger: dealDamage
 *   timing: before
 * steps:
 *   - effect: adjust
 *     adjustment: { mult: 0.5 }
 * ```
 * @example Scale healing by a blessing multiplier (var mult)
 * ```yaml
 * id: blessing
 * label: Divine Blessing
 * reactive:
 *   trigger: heal
 *   timing: before
 * steps:
 *   - effect: adjust
 *     adjustment: { mult: { var: "player.property.blessingPower" } }
 * ```
 * @example Amplify damage by curse stacks (var delta with negate)
 * ```yaml
 * id: curseAmplify
 * label: Curse Amplification
 * reactive:
 *   trigger: dealDamage
 *   timing: before
 * steps:
 *   - effect: adjust
 *     adjustment: { delta: { var: "player.property.curseStacks", negate: true } }
 * ```
 */
export const AdjustEffectSchema = z
  .object({
    effect: z.literal("adjust"),
    adjustment: z
      .union([DeltaSchema, MultSchema])
      .describe(
        "How to modify the triggering effect's numeric value. " +
          "Same shape as delta/mult in PropertyValue — literal number or { var, negate? }. " +
          "Either additive (delta) or multiplicative (mult), not both.",
      ),
  })
  .describe(
    "Modifies the numeric value of the triggering effect before it writes to state. " +
      "Only valid inside a reactive action with timing: 'before'. " +
      "Applies only to set-state and update effects that resolve to a numeric change. " +
      "Adjustment supports literal numbers and { var, negate? } state references, " +
      "just like delta/mult in PropertyValue. " +
      "After adjust, the triggering effect still fires — it just writes the modified value. " +
      "To prevent the effect entirely, use cancel-effect instead.",
  );

// ---------------------------------------------------------------------------
// Named effect (id + kind body — the unit stored in the effects module)
// ---------------------------------------------------------------------------

const effectId = IdentifierSchema.describe(
  "Unique identifier for this effect. Referenced by actions, flow transitions, " +
    "and mechanics. Use camelCase (e.g., 'drawCard', 'resolveCombat').",
);

const namedEffectBase = { id: effectId };

export const NamedEffectSchema = z.discriminatedUnion("effect", [
  MoveEffectSchema.extend(namedEffectBase),
  FlipEffectSchema.extend(namedEffectBase),
  RevealEffectSchema.extend(namedEffectBase),
  HideEffectSchema.extend(namedEffectBase),
  UpdateEffectSchema.extend(namedEffectBase),
  SetStateEffectSchema.extend(namedEffectBase),
  ShuffleEffectSchema.extend(namedEffectBase),
  DistributeEffectSchema.extend(namedEffectBase),
  RollEffectSchema.extend(namedEffectBase),
  SetRandomEffectSchema.extend(namedEffectBase),
  OrientEffectSchema.extend(namedEffectBase),
  CustomEffectSchema.extend(namedEffectBase),
  CancelEffectSchema.extend(namedEffectBase),
  AdjustEffectSchema.extend(namedEffectBase),
  MessageEffectSchema.extend(namedEffectBase),
  LlmEffectSchema.extend(namedEffectBase),
  GenerateImageEffectSchema.extend(namedEffectBase),
]).describe(
  "A named, concrete, reusable effect stored in the effects module. " +
    "Always fully self-contained — all values are literal. " +
    "Referenced by id from actions, flow transitions, and mechanics.",
);

// ---------------------------------------------------------------------------
// Effect call (used by actions, flow, mechanics)
// ---------------------------------------------------------------------------

/**
 * The anonymous inline effect body — any effect kind, without id or params.
 * Used at call sites for one-off effects that don't need to be named.
 */
export const EffectSchema = z.discriminatedUnion("effect", [
  MoveEffectSchema,
  FlipEffectSchema,
  RevealEffectSchema,
  HideEffectSchema,
  UpdateEffectSchema,
  SetStateEffectSchema,
  ShuffleEffectSchema,
  DistributeEffectSchema,
  RollEffectSchema,
  SetRandomEffectSchema,
  OrientEffectSchema,
  CustomEffectSchema,
  CancelEffectSchema,
  AdjustEffectSchema,
  MessageEffectSchema,
  LlmEffectSchema,
  GenerateImageEffectSchema,
]);

// ---------------------------------------------------------------------------
// Passive / Reactive trigger schemas
// ---------------------------------------------------------------------------

const StateWriteTriggerSchema = z.object({
  kind: z.literal("state-write"),
  scope: z
    .enum(["target", "actor"])
    .describe(
      "'target': the owner's property is being written (defensive). " +
        "'actor': the owner is performing the write (offensive).",
    ),
  path: z
    .string()
    .describe(
      "State path being written. E.g. 'player.property.hp', 'gamepiece.property.charges'. " +
        "Forward reference to properties declared on a gamepiece or player type.",
    ),
  direction: z
    .enum(["increase", "decrease", "any"])
    .default("any")
    .describe(
      "'increase': only fires when value goes up. " +
        "'decrease': only fires when value goes down. " +
        "'any' (default): fires on any write regardless of direction.",
    ),
});

const MoveTriggerSchema = z.object({
  kind: z.literal("move"),
  scope: z
    .enum(["target", "actor"])
    .describe(
      "'target': a piece owned by the holder is moved by someone else. " +
        "'actor': the holder initiates the move.",
    ),
  fromInventory: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict to moves from these inventory type IDs. Omit to match any source. " +
        "Forward references to the inventories module.",
    ),
  toInventory: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict to moves targeting these inventory type IDs. Omit to match any destination. " +
        "Forward references to the inventories module.",
    ),
});

const RevealTriggerSchema = z.object({
  kind: z.literal("reveal"),
  scope: z
    .enum(["target", "actor"])
    .describe(
      "'target': a piece held by the holder is revealed to others. " +
        "'actor': the holder reveals a piece.",
    ),
  inventory: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict to pieces in these inventory type IDs at time of reveal. " +
        "Forward references to the inventories module. Omit to match any inventory.",
    ),
});

const SkipTurnTriggerSchema = z.object({
  kind: z.literal("skip-turn"),
  // Scope is always 'target' — the holder's turn is being skipped by an external effect.
});

/**
 * Discriminated union of all structural passive/reactive triggers.
 * Identifies what event activates a passive or reactive without naming specific effect IDs.
 */
export const PassiveTriggerSchema = z
  .discriminatedUnion("kind", [
    StateWriteTriggerSchema,
    MoveTriggerSchema,
    RevealTriggerSchema,
    SkipTurnTriggerSchema,
  ])
  .describe(
    "Structural trigger for a passive or reactive. Identifies the interaction kind " +
      "(state-write, move, reveal, skip-turn) and scope (target/actor). " +
      "Replaces effect-ID fan-out: instead of listing every damage effect ID, " +
      "declare: { kind: 'state-write', path: 'player.property.hp', direction: 'decrease' }.",
  );

// ---------------------------------------------------------------------------
// Passive effect declaration (carried by gamepiece types and player roles)
// ---------------------------------------------------------------------------

/**
 * A passive effect that fires automatically when the structural trigger matches,
 * without requiring player choice. Enabled while the carrying gamepiece is in a
 * qualifying inventory (specified by `enabledIn`) or the carrying role is held.
 *
 * Timing is inferred from the effects list:
 * - Contains adjust or cancel-effect → fires before the trigger resolves (intercept)
 * - Contains only regular effects → fires after the trigger resolves (reaction)
 *
 * Trigger scope:
 * - target: fires when the owner is receiving the effect (defensive — armor, healing amp)
 * - actor:  fires when the owner is causing the effect (offensive — power strike, lifesteal)
 *
 * Enablement conditions (gamepiece passives only, ignored for role passives):
 * - enabledIn: which inventories the piece must be in for the passive to be active
 * - exhaustedFilter: "any" | "ready-only" | "exhausted-only"
 * - faceFilter: "any" | "face-up-only" | "face-down-only"
 *
 * @example Reduce all incoming HP damage by 2 while on battlefield (defensive)
 * ```yaml
 * passives:
 *   - id: armor-absorb
 *     trigger:
 *       kind: state-write
 *       scope: target
 *       path: player.property.hp
 *       direction: decrease
 *     enabledIn: [battlefield]
 *     effects:
 *       - effect: adjust
 *         adjustment: { delta: 2 }
 * ```
 * @example Deal 1 damage back to attacker (thorns — after)
 * ```yaml
 * passives:
 *   - id: thorns
 *     trigger:
 *       kind: state-write
 *       scope: target
 *       path: player.property.hp
 *       direction: decrease
 *     enabledIn: [battlefield]
 *     effects:
 *       - effect: custom
 *         description: Deal 1 damage to the player who initiated the triggering effect.
 * ```
 * @example All outgoing damage increased by rage stacks (offensive)
 * ```yaml
 * passives:
 *   - id: berserker-rage
 *     trigger:
 *       kind: state-write
 *       scope: actor
 *       path: player.property.hp
 *       direction: decrease
 *     enabledIn: [battlefield]
 *     effects:
 *       - effect: adjust
 *         adjustment: { delta: { var: "player.property.rageStacks", negate: true } }
 * ```
 * @example Lifesteal — heal for 1 whenever owner reduces opponent HP (offensive, after)
 * ```yaml
 * passives:
 *   - id: lifesteal
 *     trigger:
 *       kind: state-write
 *       scope: actor
 *       path: player.property.hp
 *       direction: decrease
 *     enabledIn: [equipment-slot]
 *     effects:
 *       - effect: set-state
 *         path: player.property.hp
 *         value: { delta: 1 }
 * ```
 * @example Proportional lifesteal — heal exactly the damage dealt via trigger.delta
 * ```yaml
 * passives:
 *   - id: true-lifesteal
 *     trigger:
 *       kind: state-write
 *       scope: actor
 *       path: player.property.hp
 *       direction: decrease
 *     effects:
 *       - effect: set-state
 *         path: player.property.hp
 *         value: { delta: { var: "trigger.delta", negate: true } }  # delta is negative for damage
 * ```
 * @example Thorns scaled by the attacking piece — source.property.* is the triggering effect's source
 * ```yaml
 * passives:
 *   - id: spiked-hide
 *     trigger:
 *       kind: state-write
 *       scope: target
 *       path: gamepiece.property.defense
 *       direction: decrease
 *     effects:
 *       - effect: set-state
 *         path: player.property.hp   # no target → defaults to the actor, i.e. the attacking player
 *         value: { delta: { var: "source.property.power", negate: true } }
 * ```
 * @example Passive fires when owner's piece is stolen (defensive move trigger)
 * ```yaml
 * passives:
 *   - id: unstealable
 *     trigger:
 *       kind: move
 *       scope: target
 *       fromInventory: [hand]
 *     enabledIn: [hand]
 *     effects:
 *       - effect: cancel-effect
 * ```
 * @example Trap card — enabled face-down, cancels first incoming damage
 * ```yaml
 * passives:
 *   - id: hidden-trap
 *     trigger:
 *       kind: state-write
 *       scope: target
 *       path: player.property.hp
 *       direction: decrease
 *     enabledIn: [trap-zone]
 *     faceFilter: face-down-only
 *     effects:
 *       - effect: cancel-effect
 * ```
 * @example Shield passive — disabled when exhausted
 * ```yaml
 * passives:
 *   - id: shield-wall
 *     trigger:
 *       kind: state-write
 *       scope: target
 *       path: player.property.hp
 *       direction: decrease
 *     enabledIn: [battlefield]
 *     exhaustedFilter: ready-only
 *     effects:
 *       - effect: adjust
 *         adjustment: { mult: 0.5 }
 * ```
 * @example Passive only active while exhausted (e.g. a "tapped" aura)
 * ```yaml
 * passives:
 *   - id: tapped-aura
 *     trigger:
 *       kind: state-write
 *       scope: target
 *       path: player.property.hp
 *       direction: decrease
 *     enabledIn: [battlefield]
 *     exhaustedFilter: exhausted-only
 *     effects:
 *       - effect: adjust
 *         adjustment: { delta: 3 }
 * ```
 */
export const PassiveEffectSchema = z
  .object({
    id: z
      .string()
      .describe(
        "Unique identifier for this passive within its carrier (piece type or role). " +
          "Used for logging and debugging.",
      ),
    trigger: PassiveTriggerSchema.describe(
      "Structural trigger — what event activates this passive. Identifies the interaction " +
        "kind (state-write, move, reveal, skip-turn) and scope (target/actor). " +
        "Replaces effect-ID fan-out: instead of listing every damage effect ID, " +
        "declare: { kind: 'state-write', path: 'player.property.hp', direction: 'decrease' }.",
    ),
    effects: z
      .array(EffectSchema)
      .min(1)
      .describe(
        "Effects to execute when this passive fires. " +
          "If the list contains adjust or cancel-effect, the passive intercepts before " +
          "the trigger resolves. Otherwise, effects fire after the trigger resolves. " +
          "After-effects on a state-write trigger may read the triggering write via " +
          "'trigger.delta' / 'trigger.previousValue' / 'trigger.newValue' var paths, and the " +
          "triggering effect's source piece (if it declared one) via 'source.property.<id>'.",
      ),
  })
  .describe(
    "A passive effect declaration. Enabled while the carrying gamepiece is in a qualifying " +
      "inventory (per enabledIn) or the carrying role is held. Fires automatically (no player " +
      "choice) whenever the structural trigger matches and its enablement conditions are met. " +
      "Timing is inferred: adjust/cancel-effect → before; regular effects → after. " +
      "For player-choice responses to triggers, use reactive slots instead.",
  );

// ---------------------------------------------------------------------------
// Reactive effect declaration (player-choice response to a structural trigger)
// ---------------------------------------------------------------------------

/**
 * A reactive effect declaration — player-choice response to a structural trigger.
 * Unlike passives (which fire automatically), reactives highlight eligible pieces
 * and wait for player input before applying the effect.
 *
 * When the trigger fires, the engine offers the player the choice to activate.
 * If chosen: `apply` fires first (intercepting the trigger), then `onUse` executes.
 * The player may also decline — the trigger resolves normally.
 *
 * Enablement works identically to passives (enabledIn, exhaustedFilter, faceFilter).
 *
 * @example Block incoming damage (cancel, discard the shield card)
 * ```yaml
 * reactives:
 *   - id: block-damage
 *     trigger:
 *       kind: state-write
 *       scope: target
 *       path: player.property.hp
 *       direction: decrease
 *     label: "Block incoming damage"
 *     apply:
 *       effect: cancel-effect
 *     onUse:
 *       - effect: move
 *         from: { inventory: hand, select: this }
 *         to: { inventory: discard }
 *     enabledIn: [hand]
 * ```
 * @example Counter a steal (cancel the move, exhaust the piece)
 * ```yaml
 * reactives:
 *   - id: refuse-steal
 *     trigger:
 *       kind: move
 *       scope: target
 *       fromInventory: [hand]
 *     label: "Refuse the steal"
 *     apply:
 *       effect: cancel-effect
 *     onUse:
 *       - effect: orient
 *         pieces: { select: this }
 *         to: rotate-cw
 *     enabledIn: [hand]
 * ```
 * @example Reduce incoming damage instead of cancelling (partial block)
 * ```yaml
 * reactives:
 *   - id: partial-block
 *     trigger:
 *       kind: state-write
 *       scope: target
 *       path: player.property.hp
 *       direction: decrease
 *     label: "Reduce damage by 2"
 *     apply:
 *       effect: adjust
 *       adjustment: { delta: 2 }
 *     onUse:
 *       - effect: move
 *         from: { inventory: hand, select: this }
 *         to: { inventory: discard }
 *     enabledIn: [hand]
 *     exhaustedFilter: ready-only
 * ```
 */
export const ReactiveEffectSchema = z
  .object({
    id: z
      .string()
      .describe(
        "Unique identifier for this reactive. Referenced by catalog reactiveBindings " +
          "or inline reactive slot declarations on gamepiece types.",
      ),
    trigger: PassiveTriggerSchema.describe(
      "Structural trigger — what event opens the player response window. " +
        "Uses the same trigger shapes as passives.",
    ),
    label: z
      .string()
      .describe(
        "Call-to-action shown in the UX when this piece is highlighted as an eligible reactive. " +
          "Examples: 'Block incoming damage', 'Refuse the steal', 'Redirect the attack'.",
      ),
    apply: EffectSchema.describe(
      "The effect applied to the trigger when the player chooses to activate this reactive. " +
        "Typically cancel-effect (to negate the trigger) or adjust (to modify it). " +
        "Fires before onUse.",
    ),
    onUse: z
      .array(EffectSchema)
      .optional()
      .describe(
        "Effects executed after the reactive fires — used to pay the activation cost " +
          "(discard, exhaust, decrement charges, etc.). Omit for cost-free reactives.",
      ),
    enabledIn: z
      .array(z.string())
      .min(1)
      .optional()
      .describe(
        "Inventory type IDs where this reactive is eligible. The player is only offered " +
          "this reactive when the carrying piece is in one of these inventories. " +
          "Forward references to the inventories module. " +
          "Required for gamepiece reactives. Omit for role reactives.",
      ),
    exhaustedFilter: z
      .enum(["any", "ready-only", "exhausted-only"])
      .default("any")
      .describe(
        "Which exhausted states allow this reactive to be offered. " +
          "'any' (default): offered regardless of exhausted state. " +
          "'ready-only': only offered when the piece is ready/untapped. " +
          "'exhausted-only': only offered when the piece is exhausted/tapped.",
      ),
    faceFilter: z
      .enum(["any", "face-up-only", "face-down-only"])
      .default("face-up-only")
      .describe(
        "Which face states allow this reactive to be offered. " +
          "'face-up-only' (default): hidden pieces cannot be offered as reactives. " +
          "'any': offered regardless of face state. " +
          "'face-down-only': only offered when the piece is face-down.",
      ),
  })
  .describe(
    "A player-choice reactive declaration. When the structural trigger fires, eligible pieces " +
      "are highlighted and the player may choose to activate. If activated, `apply` fires " +
      "immediately (intercepting the trigger), then `onUse` executes. The player may decline.",
  );

// ---------------------------------------------------------------------------
// Effects module
// ---------------------------------------------------------------------------

export const EffectsModuleSchema = z
  .object({
    effects: z
      .array(NamedEffectSchema)
      .min(1)
      .describe(
        "All named effects in this game. Each effect is a reusable, named state transition. " +
          "Actions, flow transitions, and mechanics reference effects by their id.",
      ),
    passives: z
      .array(PassiveEffectSchema)
      .optional()
      .describe(
        "Named passive effect declarations available to be bound to gamepiece passive slots " +
          "or role passives. Each passive has a unique id referenced by catalog passiveBindings " +
          "or role passives[]. Omit if the game has no passive effects.",
      ),
    reactives: z
      .array(ReactiveEffectSchema)
      .optional()
      .describe(
        "Named reactive declarations available to be bound to gamepiece reactive slots. " +
          "Each reactive has a unique id referenced by catalog reactiveBindings. " +
          "Unlike passives (automatic), reactives highlight eligible pieces and await player input. " +
          "Omit if the game has no player-choice reactive effects.",
      ),
  })
  .describe(
    "The effects module — a named library of all atomic game-state operations, passive " +
      "effect declarations, and reactive declarations. No dependencies on other spec modules " +
      "(all IDs are forward references). Referenced by actions, flow, mechanics, and the catalog.",
  );

/**
 * A reference to a named effect by ID.
 *
 * @example
 * ```yaml
 * effectRef: shuffleDeck
 * ```
 */
export const EffectCallRefSchema = z
  .object({
    effectRef: z
      .string()
      .describe(
        "ID of the named effect to invoke. Forward reference to the effects module.",
      ),
  })
  .describe("A call-site reference to a named effect.");

/**
 * A single entry in an effect call list — either an inline effect body
 * or a reference to a named effect.
 *
 * @example Mixed inline and named
 * ```yaml
 * onEnter:
 *   - effectRef: shuffleDeck                    # named
 *   - effect: move                              # inline
 *     from: { inventory: drawDeck, select: top }
 *     to: { inventory: playerHand }
 * ```
 */
export const EffectCallSchema = keyedUnion({
  effectRef: EffectCallRefSchema,
  effect: EffectSchema,
}).describe(
  "One entry in an effect call list. Either a named-effect reference ({ effectRef: <id> }) " +
    "or an inline anonymous effect ({ effect: <kind>, ... }).",
);

/**
 * Ordered list of effect calls — used everywhere effects are triggered.
 */
export const EffectCallsSchema = z
  .array(EffectCallSchema)
  .min(1)
  .describe(
    "Ordered list of effect calls to execute sequentially. " +
      "Each entry is either a named-effect reference ({ effectRef: <id> }) " +
      "or an inline effect body ({ effect: <kind>, ... }).",
  );

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GamepieceSelector = z.infer<typeof GamepieceSelectorSchema>;
export type InventoryPosition = z.infer<typeof InventoryPlacementSchema>;
export type InventoryTarget = z.infer<typeof InventoryTargetSchema>;
export type DistributeTarget = z.infer<typeof DistributeTargetSchema>;
export type PropertyValue = z.infer<typeof PropertyValueSchema>;
export type MoveEffect = z.infer<typeof MoveEffectSchema>;
export type FlipEffect = z.infer<typeof FlipEffectSchema>;
export type RevealEffect = z.infer<typeof RevealEffectSchema>;
export type HideEffect = z.infer<typeof HideEffectSchema>;
export type UpdateEffect = z.infer<typeof UpdateEffectSchema>;
export type SetStateEffect = z.infer<typeof SetStateEffectSchema>;
export type ShuffleEffect = z.infer<typeof ShuffleEffectSchema>;
export type DistributeEffect = z.infer<typeof DistributeEffectSchema>;
export type RollEffect = z.infer<typeof RollEffectSchema>;
export type SetRandomEffect = z.infer<typeof SetRandomEffectSchema>;
export type OrientEffect = z.infer<typeof OrientEffectSchema>;
export type CustomEffect = z.infer<typeof CustomEffectSchema>;
export type CancelEffect = z.infer<typeof CancelEffectSchema>;
export type AdjustEffect = z.infer<typeof AdjustEffectSchema>;
export type PassiveTrigger = z.infer<typeof PassiveTriggerSchema>;
export type PassiveEffect = z.infer<typeof PassiveEffectSchema>;
export type ReactiveEffect = z.infer<typeof ReactiveEffectSchema>;
export type MessageRecipient = z.infer<typeof MessageRecipientSchema>;
export type MessageEffect = z.infer<typeof MessageEffectSchema>;
export type LlmOutput = z.infer<typeof LlmOutputSchema>;
export type LlmInput = z.infer<typeof LlmInputSchema>;
export type LlmEffect = z.infer<typeof LlmEffectSchema>;export type GenerateImageEffect = z.infer<typeof GenerateImageEffectSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type NamedEffect = z.infer<typeof NamedEffectSchema>;
export type EffectsModule = z.infer<typeof EffectsModuleSchema>;
export type EffectCallRef = z.infer<typeof EffectCallRefSchema>;
export type EffectCall = z.infer<typeof EffectCallSchema>;
export type EffectCalls = z.infer<typeof EffectCallsSchema>;
