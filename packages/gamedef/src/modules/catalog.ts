/**
 * Catalog Module Schema
 *
 * Depends on: gamepiece-types (forward refs to type IDs).
 * No inventory references — catalog is a pure piece registry.
 *
 * The catalog declares every gamepiece instance that exists in the game.
 * All pieces start in the reserved system inventory `game:unassigned`.
 * Game setup (shuffle, deal, place) is expressed as `onEnter` effects on the
 * root flow loop. During play, acquiring from / returning to an implicit pool
 * is done by moving pieces to/from `game:unassigned`.
 *
 * Key design decisions:
 * - Catalog is intentionally decoupled from inventory assignment so that
 *   content expansion (generating piece types and instances) can work
 *   independently of setup logic.
 * - `quantity` creates N anonymous identical copies. Use for fungible pieces
 *   (dice, tokens, resource cubes). Content expansion can freely enumerate
 *   quantities without knowing anything about how pieces are distributed.
 * - `properties` sets initial scalar values. Omit to use declared defaults.
 * - `id` on a single piece enables targeting by name in setup effects:
 *   `select: { id: whiteKing }`.
 * - No `inventory`, `placement`, or `forRoles` — all of that is setup logic
 *   expressed in flow `onEnter` hooks, keeping catalog and setup orthogonal.
 *
 * @example Liar's Dice — 5 dice per player (setup deals them in onEnter)
 * ```yaml
 * entries:
 *   - typeId: die
 *     quantity: 30    # max 6 players × 5 dice; setup distributes 5 per player
 * ```
 * @example Chess — named pieces with color property
 * ```yaml
 * entries:
 *   - id: whiteKing
 *     typeId: king
 *     properties: { color: white }
 *   - id: whiteQueen
 *     typeId: queen
 *     properties: { color: white }
 *   - typeId: pawn
 *     quantity: 8
 *     properties: { color: white }
 *   - typeId: pawn
 *     quantity: 8
 *     properties: { color: black }
 *   - id: blackKing
 *     typeId: king
 *     properties: { color: black }
 *   # Setup (root loop onEnter) places each piece on the board via move effects.
 * ```
 * @example Card game — standard 52-card deck
 * ```yaml
 * # All 52 cards share one typeId; rank and suit are properties.
 * entries:
 *   - typeId: playingCard
 *     properties: { rank: "2", suit: hearts }
 *   - typeId: playingCard
 *     properties: { rank: "3", suit: hearts }
 *   # ... one entry per card (52 total)
 *   - typeId: playingCard
 *     properties: { rank: ace, suit: spades }
 *   # Setup (root loop onEnter): shuffle game:unassigned, distribute 5 to each player hand.
 * ```
 * @example Resource game — token supply
 * ```yaml
 * entries:
 *   - typeId: goldCoin
 *     quantity: 30
 *   - typeId: woodToken
 *     quantity: 20
 *   # Setup moves them to a bank inventory if visual display is needed,
 *   # or leaves them in game:unassigned for implicit pool behaviour.
 * ```
 * @example Werewolf — role-specific items (setup assigns in onEnter per role)
 * ```yaml
 * entries:
 *   - typeId: killCard
 *     quantity: 1
 *   - typeId: healPotion
 *     quantity: 2
 *   - typeId: voteToken
 *     quantity: 10
 *   # Setup distributes to role-specific players via distribute effects with roles filter.
 * ```
 */

import { z } from "zod";
import { IdentifierSchema } from "#gamedef/modules/common.js";
import { ActionSchema } from "#gamedef/modules/actions.js";
import { PassiveEffectSchema } from "#gamedef/modules/effects.js";

// ---------------------------------------------------------------------------
// Inline binding schemas (slot value = reference ID or inline definition)
// ---------------------------------------------------------------------------

/**
 * An action slot binding value: either a named action ID (string reference)
 * or an inline action definition (all ActionSchema fields except id).
 */
const InlineActionBindingSchema = ActionSchema.omit({ id: true });
export const ActionBindingValueSchema = z.union([
  z.string().describe("Action ID reference — forward ref to actions.actions[].id."),
  InlineActionBindingSchema,
]);

/**
 * A passive slot binding value: either a named passive ID (string reference)
 * or an inline passive definition (all PassiveEffectSchema fields except id).
 */
const InlinePassiveBindingSchema = PassiveEffectSchema.omit({ id: true });
export const PassiveBindingValueSchema = z.union([
  z.string().describe("Passive ID reference — forward ref to effects.passives[].id."),
  InlinePassiveBindingSchema,
]);

// ---------------------------------------------------------------------------
// Initial property values
// ---------------------------------------------------------------------------

/**
 * A map of property IDs to initial scalar values.
 * Keys are property IDs (forward refs to properties[] on the gamepiece type).
 * Values must match the declared property type:
 *   - integer / float → number
 *   - string / enum   → string
 *   - boolean         → boolean
 */
const InitialPropertiesSchema = z
  .record(z.union([z.string(), z.number(), z.boolean()]))
  .describe(
    "Initial property values for this piece instance. " +
      "Keys are property IDs matching properties[] declared on the gamepiece type. " +
      "Values must match the declared type: number for integer/float, " +
      "string for string/enum, boolean for boolean. " +
      "Omit a property to leave it at its declared default or unset.",
  );

// ---------------------------------------------------------------------------
// Catalog entry
// ---------------------------------------------------------------------------

/**
 * A single catalog entry — declares one or more gamepiece instances.
 * All pieces start in `game:unassigned`; setup effects move them where needed.
 *
 * @example Named unique piece
 * ```yaml
 * id: whiteKing
 * typeId: king
 * properties: { color: white }
 * ```
 * @example Fungible identical pieces (anonymous)
 * ```yaml
 * typeId: goldCoin
 * quantity: 30
 * ```
 * @example Pieces with distinct property values (one entry per piece)
 * ```yaml
 * typeId: playingCard
 * properties: { rank: ace, suit: spades }
 * ```
 */
export const CatalogEntrySchema = z
  .object({
    id: IdentifierSchema.optional().describe(
        "Optional unique identifier for this specific piece instance. " +
          "Assign when you need to reference this piece by name in setup effects: " +
          "{ select: { id: whiteKing } }. " +
          "Not meaningful when quantity > 1 (copies are anonymous).",
      ),
    typeId: z
      .string()
      .describe(
        "Gamepiece type ID. Forward reference to a type declared in the gamepiece-types module. " +
          "Determines the piece's properties, action slots, and mechanics.",
      ),
    quantity: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "Number of identical anonymous copies to create. Defaults to 1. " +
          "Use for fungible pieces: dice, tokens, resource cubes. " +
          "All copies receive the same 'properties' values. " +
          "Do NOT use when pieces differ in any property — list one entry per piece instead.",
      ),
    properties: InitialPropertiesSchema.optional().describe(
      "Initial property values applied to all created copies. " +
        "Omit to leave all properties at their declared defaults.",
    ),
    actionBindings: z
      .record(ActionBindingValueSchema)
      .optional()
      .describe(
        "Binds actions to this piece instance's action slots. " +
          "Keys are slot IDs declared in actionSlots[] on the gamepiece type. " +
          "Values are either a named action ID (string reference to actions.actions[].id) " +
          "or an inline action definition for one-off card effects. " +
          "Omit slots that should remain empty.",
      ),
    passiveBindings: z
      .record(PassiveBindingValueSchema)
      .optional()
      .describe(
        "Binds passives to this piece instance's passive slots. " +
          "Keys are slot IDs declared in passiveSlots[] on the gamepiece type. " +
          "Values are either a named passive ID (string reference to effects.passives[].id) " +
          "or an inline passive definition for unique per-card effects. " +
          "Omit slots that should remain empty (piece has no passive for that slot).",
      ),
  })
  .describe(
    "Declares one or more gamepiece instances. All pieces start in game:unassigned. " +
      "Use 'id' for unique named pieces, 'quantity' for fungible anonymous copies.",
  );

// ---------------------------------------------------------------------------
// Catalog module
// ---------------------------------------------------------------------------

export const CatalogModuleSchema = z
  .object({
    entries: z
      .array(CatalogEntrySchema)
      .min(1)
      .describe(
        "All gamepiece instances that exist in the game. " +
          "Every piece starts in the reserved system inventory 'game:unassigned'. " +
          "Setup effects (in the root loop's onEnter hooks) move pieces into their " +
          "starting inventories before play begins.",
      ),
  })
  .describe(
    "The catalog module — a pure piece registry, decoupled from setup logic. " +
      "Declares what pieces exist and their initial property values. " +
      "How pieces are distributed, placed, and shuffled is expressed in flow onEnter hooks.",
  );

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type InitialProperties = z.infer<typeof InitialPropertiesSchema>;
export type ActionBindingValue = z.infer<typeof ActionBindingValueSchema>;
export type PassiveBindingValue = z.infer<typeof PassiveBindingValueSchema>;
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
export type CatalogModule = z.infer<typeof CatalogModuleSchema>;
