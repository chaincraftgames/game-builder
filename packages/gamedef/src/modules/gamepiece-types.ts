/**
 * Gamepiece Types Module Schema
 *
 * No dependencies on other spec modules (self-contained type references only).
 * Referenced by: inventories (accepts), actions (targets, parameters),
 *                effects (move/flip targets), flow (gamepiece-actions meta-reference),
 *                mechanics (requires, extends), catalog (every instance has a typeId).
 *
 * Key distinctions:
 * - Properties: all attributes of a gamepiece, unified. mutable=false properties come from the
 *   catalog and never change at runtime. mutable=true properties are initialized from 'default'
 *   and tracked by the engine. Visibility controls when/to whom the value is shown:
 *     - always:    always visible to all players regardless of face state (card-back info)
 *     - revealed:  visible to all when the piece is face-up/revealed; hidden when face-down
 *     - owner:     visible only to the controlling player
 *     - never:     engine-tracked, never displayed
 * - InventorySlots: named references to inventory types this piece holds. All inventory
 *   properties (accepts, visibility, capacity, scope, layoutHint, ordered) are defined in
 *   the inventories module. The slot just provides the local name used in effect target paths
 *   (e.g., 'player.hand', 'board.resources') and the forward reference to the inventory type.
 *   Forward reference: inventorySlot.inventoryTypeId → inventories module.
 * - ActionSlots: named bindings for gamepiece-bound actions (slot name referenced by flow DSL;
 *   catalog instance fills in the actual action — enables expansions without spec changes).
 * Spatial relationships (adjacency, grid row/column, line neighbors) are NOT properties of
 * a gamepiece type. They are properties of the inventory that contains the pieces — defined
 * via layout on the inventory type in the inventories module.
 *
 * @example Full module (standard playing card + player board)
 * ```yaml
 * types:
 *   - id: card
 *     category: card
 *     description: A standard playing card
 *     properties:
 *       - id: suit
 *         type: { kind: enum, values: [hearts, diamonds, clubs, spades] }
 *         mutable: false
 *         visibility: revealed
 *       - id: rank
 *         label: Rank
 *         type: { kind: number, min: 1, max: 13 }
 *         mutable: false
 *         visibility: revealed
 *     hasFaceState: true
 *     inventorySlots:
 *       - id: attachedTokens
 *         inventoryTypeId: tokenPool
 *   - id: carcassonneTile
 *     category: tile
 *     orientationCount: 4
 *   - id: standardDie
 *     category: dice
 *     faceCount: 6            # shorthand for faces 1..6
 *   - id: fudgeDie
 *     category: dice
 *     faces: [-1, -1, 0, 0, 1, 1]   # any other numbering, symbols, or weighting
 *   - id: playerBoard
 *     category: board
 *     description: Each player's personal play area
 *     inventorySlots:
 *       - id: hand
 *         inventoryTypeId: playerHand
 *       - id: discard
 *         inventoryTypeId: discardPile
 * ```
 */

import { z } from "zod";
import { ConditionExpressionSchema, IdentifierSchema, PropertyTypeSchema } from "#gamedef/modules/common.js";
import { PieceMechanicSchema } from "#gamedef/mechanics/index.js";


// ---------------------------------------------------------------------------
// Property value types
// ---------------------------------------------------------------------------

// Property value types are defined in common.ts and re-exported here for backward compatibility.
export { PropertyTypeSchema } from "#gamedef/modules/common.js";

// ---------------------------------------------------------------------------
// Property visibility
// ---------------------------------------------------------------------------

export const PropertyVisibilitySchema = z
  .enum(["always", "revealed", "owner", "never"])
  .describe(
    "Controls when and to whom a property's value is shown. " +
      "'always': visible to all players regardless of the piece's face state " +
      "(e.g., card-back info like set symbol or card type). " +
      "'revealed': visible to all when the piece is face-up or revealed; hidden when face-down " +
      "(e.g., a card's attack power). " +
      "'owner': visible only to the player who controls or owns this piece. " +
      "'never': engine-tracked but never displayed to any player " +
      "(e.g., 'wasActivatedThisTurn', 'timesTargeted').",
  );

// ---------------------------------------------------------------------------
// Property definition
// ---------------------------------------------------------------------------

/**
 * @example Static property — value set in catalog, never changes at runtime
 * ```yaml
 * id: suit
 * label: Suit                                 # optional; renderer humanizes id if omitted
 * type: { kind: enum, values: [hearts, diamonds, clubs, spades] }
 * mutable: false
 * visibility: revealed
 * ```
 * @example Mutable property — engine-tracked, updated by effects
 * ```yaml
 * id: hitPoints
 * label: Hit Points
 * type: { kind: number, min: 0, max: 10 }
 * mutable: true
 * default: 10
 * visibility: always
 * ```
 * @example Engine-only flag — never shown to players, never set in the catalog
 * ```yaml
 * id: activatedThisTurn
 * type: { kind: boolean }
 * mutable: true
 * source: runtime
 * default: false
 * visibility: never
 * ```
 */
export const GamepiecePropertySchema = z
  .object({
    id: IdentifierSchema.describe(
        "Programmatic identifier for this property. Used as the key in catalog instances, " +
          "runtime state, and effect target paths (e.g., 'hitPoints', 'manaCost', 'exhausted'). " +
          "Must be camelCase. Referenced by effects and actions — must be stable.",
      ),
    label: z
      .string()
      .optional()
      .describe(
        "Human-readable display name shown to players (e.g., 'Hit Points', 'Mana Cost'). " +
          "Omit if the id is already human-friendly; the renderer will humanize it.",
      ),
    type: PropertyTypeSchema,
    mutable: z
      .boolean()
      .describe(
        "Whether this property can change at runtime. " +
          "false = static; value comes from the catalog instance and never changes " +
          "(e.g., card name, mana cost, die face count). " +
          "true = runtime-tracked; engine initializes from 'default' and effects can modify it " +
          "(e.g., hitPoints, exhausted, chargeCount). " +
          "Says nothing about who authors the starting value \u2014 see 'source'.",
      ),
    source: z
      .enum(["catalog", "runtime"])
      .optional()
      .describe(
        "Where this property's starting value comes from. Defaults to 'catalog'. " +
          "'catalog': card data authored per piece instance; catalog entries may set it " +
          "(e.g., power, defense, mana cost). Independent of 'mutable' — a catalog property " +
          "may still change during play. " +
          "'runtime': engine-managed state (e.g., frozen, activatedThisTurn); initialized " +
          "from 'default' and never set in the catalog. Must be mutable: true. " +
          "Catalog editors hide runtime properties." +
          "Defaults to 'catalog' if not specified."
      ),
    default: z
      .any()
      .optional()
      .describe(
        "Initial value when the gamepiece enters play. Only meaningful for mutable properties. " +
          "Must be valid for the declared type. Omit if the initial value is always set " +
          "by a setup effect (e.g., dice rolled on setup).",
      ),
    visibility: PropertyVisibilitySchema,
    description: z
      .string()
      .optional()
      .describe("Human-readable description of what this property represents."),
  })
  .describe(
    "A named attribute of a gamepiece type. Covers both static catalog data (mutable: false) " +
      "and runtime-tracked state (mutable: true) in a single unified definition.",
  );

/** @deprecated use GamepiecePropertySchema */
export const GamepieceFieldSchema = GamepiecePropertySchema;

// ---------------------------------------------------------------------------
// Inventory slots (references to inventory types held by this piece)
// ---------------------------------------------------------------------------

/**
 * @example Player hand slot
 * ```yaml
 * id: hand
 * inventoryTypeId: playerHand
 * description: Cards held by this player
 * ```
 * @example Two equipment slots referencing the same inventory type
 * ```yaml
 * - id: leftHand
 *   inventoryTypeId: equipmentSlot
 * - id: rightHand
 *   inventoryTypeId: equipmentSlot
 * ```
 */
export const InventorySlotSchema = z
  .object({
    id: IdentifierSchema.describe(
        "Local slot identifier. Used as the key in effect target paths " +
          "(e.g., 'player.hand', 'board.resources'). " +
          "Must be unique within this gamepiece type. " +
          "A piece type may hold multiple slots referencing the same inventory type " +
          "under different ids (e.g., 'leftHand' and 'rightHand' both reference 'equipment').",
      ),
    inventoryTypeId: z
      .string()
      .describe(
        "ID of the inventory type this slot holds. " +
          "Forward reference to the inventories module — validated cross-section. " +
          "All inventory properties (accepts, visibility, capacity, scope, layoutHint, ordered) " +
          "are defined on the inventory type, not here.",
      ),
    description: z
      .string()
      .optional()
      .describe("Human-readable description of this slot and its role on the piece."),
  })
  .describe(
    "A named slot on a gamepiece that holds a collection of other gamepieces, " +
      "defined by reference to an inventory type in the inventories module. " +
      "Examples: player piece has 'hand' slot (→ hand inventory), " +
      "board space has 'resources' slot (→ resource-pool inventory).",
  );

// ---------------------------------------------------------------------------
// Action slots (gamepiece-bound action bindings)
// ---------------------------------------------------------------------------

/**
 * @example Phase-specific action slot
 * ```yaml
 * id: dayAction
 * description: Action available during the day phase
 * availableInSubflows: [dayPhase]
 * ```
 * @example Phase-independent slot (availability governed by flow context)
 * ```yaml
 * id: specialAbility
 * description: This card's unique triggered ability
 * ```
 */
export const PassiveSlotSchema = z
  .object({
    id: IdentifierSchema.describe(
        "Slot identifier. Referenced in catalog passiveBindings to bind a named or inline " +
          "passive effect to this piece instance. The catalog entry fills in which specific " +
          "passive occupies this slot — enabling different instances of the same type to " +
          "carry different (or no) passives.",
      ),
    description: z
      .string()
      .optional()
      .describe("Human-readable description of what kind of passive this slot holds."),
    enabledIn: z
      .array(z.string())
      .min(1)
      .describe(
        "Inventory type IDs where a passive in this slot is active. " +
          "Forward references to the inventories module. " +
          "Example: ['field'] — passive only fires while the piece is on the field.",
      ),
    faceFilter: z
      .enum(["any", "face-up-only", "face-down-only"])
      .default("face-up-only")
      .describe(
        "Face state required for the passive to fire. " +
          "'face-up-only' (default): disabled when hidden/face-down. " +
          "'any': fires regardless of face state. " +
          "'face-down-only': trap-style — only fires face-down.",
      ),
    exhaustedFilter: z
      .enum(["any", "ready-only", "exhausted-only"])
      .default("any")
      .describe(
        "Exhausted state required for the passive to fire. " +
          "'any' (default): fires regardless of exhausted state. " +
          "'ready-only': only fires when the piece is ready/untapped. " +
          "'exhausted-only': only fires when the piece is exhausted/tapped.",
      ),
    condition: ConditionExpressionSchema.optional().describe(
      "Infix expression evaluated against the carrying piece before the passive fires. " +
        "Available paths: 'piece.property.<id>'. " +
        "Example: 'piece.property.frozen == false' — passive is suppressed while frozen.",
    ),
  })
  .describe(
    "A named binding point for a piece-instance passive effect. " +
      "Carries all enablement constraints: which inventories activate it, face/exhausted gates, " +
      "and an optional piece-property condition. The passive itself is purely behavioral. " +
      "Different slots on the same type can have different enablement envelopes.",
  );

export const ReactiveSlotSchema = z
  .object({
    id: IdentifierSchema.describe(
        "Slot identifier. Referenced in catalog reactiveBindings to bind a named or inline " +
          "reactive to this piece instance. The catalog entry fills in which specific " +
          "reactive occupies this slot — enabling different instances of the same type to " +
          "carry different (or no) reactives.",
      ),
    description: z
      .string()
      .optional()
      .describe("Human-readable description of what kind of reactive this slot holds."),
  })
  .describe(
    "A named binding point for a piece-instance reactive effect. " +
      "Defined on the type; the catalog entry provides the actual reactive. " +
      "This decouples piece type structure from per-card reactive effects.",
  );

export const ActionSlotSchema = z
  .object({
    id: IdentifierSchema.describe(
        "Slot identifier. Referenced in the flow DSL via gamepiece-actions nodes " +
          "(e.g., slot: 'dayAction', slot: 'nightAction'). " +
          "The catalog instance fills in which specific action occupies this slot.",
      ),
    description: z
      .string()
      .optional()
      .describe("Human-readable description of when/how this action slot is used."),
    availableInSubflows: z
      .array(z.string())
      .optional()
      .describe(
        "Subflow IDs during which this action slot is active. Forward references to flow subflow IDs. " +
          "Omit for slots that are phase-independent (availability governed entirely by flow context). " +
          "When provided, the engine only offers this slot during matching subflows — " +
          "e.g., a 'day-action' slot available only during the 'day' subflow.",
      ),
    preconditions: ConditionExpressionSchema.optional().describe(
      "Infix expression evaluated against the gamepiece instance's state before " +
        "this slot is offered. If false, the slot is unavailable for this piece instance. " +
        "Available paths: 'piece.property.<id>' (property on the piece holding this slot), " +
        "'actor.property.<id>', 'count(actor.inventory.<id>)'. " +
        "Example: 'piece.property.charges >= 1'",
    ),
  })
  .describe(
    "A named binding point for a gamepiece-bound action. The slot is defined on the type; " +
      "the catalog instance provides the actual action. This enables deck expansions and new " +
      "card designs without modifying the game spec.",
  );

// ---------------------------------------------------------------------------
// Gamepiece type
// ---------------------------------------------------------------------------

export const GamepieceTypeSchema = z
  .object({
    id: IdentifierSchema.describe(
        "Unique identifier for this type. Referenced throughout the spec by other modules " +
          "(inventories, actions, effects, mechanics, catalog).",
      ),
    category: z
      .enum(["card", "token", "dice", "tile", "board"])
      .describe(
        "The physical category of this gamepiece. Drives rendering decisions and catalog " +
          "generation logic. Mechanical capabilities vary by category: " +
          "'card': flippable (front/back), stackable, rotatable (e.g. tap/exhaust), " +
          "can have sub-inventories/slots (equipment on a creature, counters on a card). " +
          "'token': flippable (optional), not stackable, not rotatable, no sub-inventories. " +
          "Covers pawns, figurines, resource markers, score counters, player position markers, " +
          "wargame units, and any small discrete game object. " +
          "'dice': has numbered faces, rolled for randomness. " +
          "'tile': flippable, rotatable (edges matter), can have sub-inventories. " +
          "Board component laid out spatially with adjacency. " +
          "'board': the play surface, can have sub-inventories (spaces, regions). " +
          "Typically holds other gamepieces.",
      ),
    description: z
      .string()
      .optional()
      .describe(
        "Human-readable description of what this gamepiece represents in the game.",
      ),
    properties: z
      .array(GamepiecePropertySchema)
      .optional()
      .describe(
        "All attributes of this gamepiece type — both static catalog data (mutable: false) " +
          "and runtime-tracked state (mutable: true). Omit if this piece type has no " +
          "attributes beyond its identity (rare; most pieces have at least one property).",
      ),
    inventorySlots: z
      .array(InventorySlotSchema)
      .optional()
      .describe(
        "Named slots referencing inventory types that instances of this piece hold. " +
          "All inventory properties are defined in the inventories module. " +
          "Omit if this piece type does not hold other pieces.",
      ),
    actionSlots: z
      .array(ActionSlotSchema)
      .optional()
      .describe(
        "Named binding points for gamepiece-bound actions. " +
          "The catalog instance fills in which action occupies each slot. " +
          "Omit for piece types that have no actions of their own " +
          "(e.g., tokens, resources used only as targets). " +
          "Do not duplicate slot IDs declared by mechanics[].",
      ),
    mechanics: z
      .array(PieceMechanicSchema)
      .optional()
      .describe(
        "Piece-scoped mechanic declarations. Each mechanic generates one or more action slots, " +
          "preconditions, or lifecycle hooks from a compact declaration — no manual slot, " +
          "precondition, or cleanup effect authoring required. " +
          "Mechanic-generated slot IDs share the namespace with actionSlots[]; IDs must be unique. " +
          "Omit if this piece type has no mechanic-driven behaviour.",
      ),
    passiveSlots: z
      .array(PassiveSlotSchema)
      .optional()
      .describe(
        "Named binding points for piece-instance passive effects. " +
          "The catalog entry fills in which passive (by ID reference or inline definition) " +
          "occupies each slot — so different instances of the same type can have different passives. " +
          "Omit for piece types that never carry passive effects.",
      ),
    reactiveSlots: z
      .array(ReactiveSlotSchema)
      .optional()
      .describe(
        "Named binding points for piece-instance reactive effects. " +
          "The catalog entry fills in which reactive (by ID reference or inline definition) " +
          "occupies each slot — so different instances of the same type can have different reactives. " +
          "Omit for piece types that never carry player-choice reactive effects.",
      ),
    hasFaceState: z
      .boolean()
      .default(false)
      .describe(
        "Whether instances of this type have a face-up/face-down state (two-sided). " +
          "When true, the engine tracks face state as a built-in property and flipping " +
          "the piece means reveal/hide. Properties with 'visibility: revealed' are hidden " +
          "when face-down and visible when face-up. " +
          "Typically true for cards and tiles; false for tokens, boards, and dice. " +
          "Set true for tokens that have hidden states (e.g., hidden-role tokens). " +
          "If both hasFaceState and exhaustible are true, flipping means reveal/hide " +
          "and the exhausted state is shown via a separate visual indicator.",
      ),
    exhaustible: z
      .boolean()
      .default(false)
      .describe(
        "Whether instances of this type can be exhausted (tapped/spent/on cooldown). " +
          "When true, the engine tracks an exhausted/ready state as a built-in property. " +
          "If hasFaceState is false, flipping the piece toggles exhausted/ready. " +
          "If hasFaceState is true, flipping means reveal/hide and the renderer shows " +
          "exhaustion via rotation, overlay, or other visual indicator. " +
          "Typically true for cards that can be tapped (e.g. MTG) or tokens representing " +
          "abilities with cooldowns.",
      ),
    faceCount: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe(
        "Shorthand for 'faces: [1, 2, ..., faceCount]' — faces numbered 1 to N, one apart. " +
          "For any other numbering (starting at 0, negative, stepped, non-linear) or for " +
          "symbols, use 'faces' instead. Mutually exclusive with 'faces'. " +
          "Examples: 6 for a standard d6, 10 for a d10, 20 for a d20. " +
          "Dice (category: 'dice') require either faceCount or faces. " +
          "The face currently showing is readable in expressions as 'piece.faceValue'.",
      ),
    faces: z
      .array(z.union([z.number(), z.string()]))
      .min(2)
      .optional()
      .describe(
        "Ordered table of the values a piece of this type can show; use it for anything " +
          "faceCount can't express. Entries may be numbers or strings: symbol dice " +
          "(['skull', 'brain', 'brain', 'footprint']), numbers from 0 or negative " +
          "([-2, -1, 0, 1, 2, 3]), or stepped / non-linear numbers ([2, 4, 6, 8]). " +
          "A roll picks one entry uniformly, so repeated entries weight that face " +
          "([-1, -1, 0, 0, 1, 1]). " +
          "Mutually exclusive with 'faceCount'. The face showing is readable in " +
          "expressions as 'piece.faceValue'.",
      ),
    orientationCount: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe(
        "Number of discrete orientations instances of this type can have. " +
          "Default 1 means no rotation — the piece has a single fixed orientation. " +
          "Meaningful for tiles where edge alignment matters (e.g. Carcassonne). " +
          "Common values: 4 (90° rotations), 6 (hex facings). " +
          "Note: visual rotation to indicate exhaustion (e.g. tapping a card) is NOT " +
          "modeled by orientationCount — use 'exhaustible: true' instead. " +
          "Orientation is independent of face state — a tile can have both " +
          "hasFaceState: true (front/back) and orientationCount: 4 (4 rotations).",
      ),
  })
  .describe(
    "A gamepiece type definition. Mechanical capabilities by category:\n" +
      "| Category | Flippable | Stackable | Rotatable | Sub-inventories |\n" +
      "| card     | yes       | yes       | no        | yes             |\n" +
      "| token    | optional  | no        | no        | no              |\n" +
      "| dice     | N/A       | no        | no        | no              |\n" +
      "| tile     | yes       | no        | yes       | yes             |\n" +
      "| board    | optional  | no        | no        | yes             |\n" +
      "Any category can set 'exhaustible: true' for tap/cooldown state.\n" +
      "The spec declares types; the catalog declares instances.",
  );

// ---------------------------------------------------------------------------
// Gamepiece types module
// ---------------------------------------------------------------------------

export const GamepieceTypesModuleSchema = z
  .object({
    types: z
      .array(GamepieceTypeSchema)
      .min(1)
      .describe("All gamepiece types used in this game. Must have at least one entry."),
  })
  .describe(
    "All gamepiece types in the game: boards, cards, dice, tokens, counters, spaces. " +
      "No dependencies on other spec modules — this module is the foundation that " +
      "inventories, actions, effects, and mechanics all reference.",
  );

export type PropertyVisibility = z.infer<typeof PropertyVisibilitySchema>;
export type GamepieceProperty = z.infer<typeof GamepiecePropertySchema>;
export type InventorySlot = z.infer<typeof InventorySlotSchema>;
export type PassiveSlot = z.infer<typeof PassiveSlotSchema>;
export type ReactiveSlot = z.infer<typeof ReactiveSlotSchema>;
export type ActionSlot = z.infer<typeof ActionSlotSchema>;
export type GamepieceType = z.infer<typeof GamepieceTypeSchema>;
export type GamepieceTypesModule = z.infer<typeof GamepieceTypesModuleSchema>;
