/**
 * Mechanic: chaincraft:charges
 * Scope: piece-level
 *
 * Gates an action behind a resource cost drawn from a piece's own inventory.
 *
 * ## Integration
 *
 * ### Exposes
 *   Action slots:  <slotId>
 *     The gated slot ID. Referenced in flow node availableActions[] and piece type
 *     actionSlots[] exactly like any explicit slot. Do NOT also declare it in
 *     actionSlots[] — the mechanic creates it.
 *   Inventories:   "chaincraft:charges:<slotId>:charges"   (mechanic-owned)
 *     Piece-scoped inventory holding charge tokens. Not in inventorySlots[].
 *     Setup effects fill it via game:unassigned before play begins.
 *
 * ### References
 *   actions.ts:   `action`              — action ID executed when the slot fires
 *   flow.ts:      `availableInSubflows` — optional subflow node IDs restricting availability
 *
 * ### Properties defined
 *   (none — charge count is tracked through the injected inventory, not a named property)
 *
 * ### Configuration
 *   Required: slotId, chargeType, maxCharges, count, action
 *   Optional: label, depleteTo (default: "game:unassigned"), availableInSubflows
 *
 * ## Engine synthesis
 *   1. Precondition: count(piece.inventory["chaincraft:charges:<slotId>:charges"]) >= count
 *   2. An action slot (<slotId>) that executes the referenced action's full effect list
 *   3. Post-execution cleanup: move `count` tokens from charge inventory → depleteTo
 *
 * The referenced action is declared normally in the actions module and may be used in
 * other contexts without the charge gate — the mechanic is purely additive.
 *
 * Composition with chaincraft:conversion: declare conversion first with its own slotId,
 * then reference that slotId as charges.action. Do NOT wire the conversion slot into
 * flow directly — only the charges slot is player-accessible. The engine resolves the
 * conversion action internally through the charges gate.
 *
 * The mechanic OWNS the charge inventory slot. Do NOT declare it in the piece type's
 * inventorySlots[].
 *
 * @example Creature card that can spend 2 energy counters to convert resources
 * ```yaml
 * kind: chaincraft:charges
 * slotId: mygame:energy-ability
 * label: Energy Ability
 * chargeType: energy-counter        # gamepiece type for the charge tokens (mechanic owns type)
 * maxCharges: 3                     # capacity of the injected charge inventory
 * count: 2                          # tokens consumed per activation
 * action: convert-ore-to-gold       # action ID in the actions module
 * depleteTo: game:unassigned        # where spent charges go (default)
 * availableInSubflows: [action-phase]
 * ```
 * @example Card that exhausts itself (1 charge, refilled by another action)
 * ```yaml
 * kind: chaincraft:charges
 * slotId: mygame:tap-ability
 * chargeType: readiness-token
 * maxCharges: 1
 * count: 1
 * action: deal-damage
 * depleteTo: game:unassigned
 * ```
 */

import { z } from "zod";

export const ChargesMechanicSchema = z
  .object({
    kind: z.literal("chaincraft:charges"),
    slotId: z
      .string()
      .regex(
        /^[^:]+:[^:]+$/,
        "mechanic-generated slot IDs must be namespaced (e.g., 'mygame:energy-ability')",
      )
      .describe(
        "The namespaced action slot ID this mechanic generates. Format: 'namespace:name'. " +
          "Use your game or registry namespace as the prefix (e.g., 'mygame:tap-ability'). " +
          "Referenced by flow and catalog just like explicit actionSlots[]. " +
          "Do NOT also declare this id in actionSlots[] — the mechanic creates the slot. " +
          "Must be unique among all slots (explicit + mechanic-generated) on this type.",
      ),
    label: z
      .string()
      .optional()
      .describe("Human-readable name for this mechanic's generated slot. Shown in game UI."),
    chargeType: z
      .string()
      .describe(
        "Gamepiece type ID for the charge tokens. " +
          "Forward reference to a type in the gamepiece-types module, or a mechanic-owned type " +
          "if no other part of the spec needs to reference it directly. " +
          "Examples: 'energy-counter', 'readiness-token', 'charge-crystal'.",
      ),
    maxCharges: z
      .number()
      .int()
      .min(1)
      .describe(
        "Maximum number of charge tokens this piece can hold. " +
          "The mechanic injects a piece-scoped inventory (structure: none, capacity: { max: maxCharges }) " +
          "to hold the tokens. Setup effects fill it via game:unassigned.",
      ),
    count: z
      .number()
      .int()
      .min(1)
      .describe(
        "Number of charge tokens consumed per activation. " +
          "Engine precondition: the charge inventory holds at least this many tokens. " +
          "Engine cleanup: move exactly this many tokens to 'depleteTo' after the action resolves.",
      ),
    action: z
      .string()
      .describe(
        "ID of the action to execute when this slot activates. Forward reference to the actions module. " +
          "The action's full effect list executes — inputs, multi-effect sequences, and conversions " +
          "all work naturally. Availability is governed by this mechanic's availableInSubflows.",
      ),
    depleteTo: z
      .string()
      .default("game:unassigned")
      .describe(
        "Inventory ID where spent charge tokens are returned after activation. " +
          "Defaults to 'game:unassigned' (the implicit game pool — tokens disappear from view). " +
          "Set to an explicit inventory (e.g., 'charge-discard') if players need to see spent tokens " +
          "or if tokens are recycled (e.g., refilled from a visible supply).",
      ),
    availableInSubflows: z
      .array(z.string())
      .optional()
      .describe(
        "Flow node IDs during which this mechanic's generated slot is active. " +
          "Forward references to loop/turn/simultaneous node IDs. " +
          "Omit for slots available in any context.",
      ),
  })
  .describe(
    "Piece-scoped mechanic: gates an action behind a charge cost drawn from a piece's own inventory. " +
      "Synthesizes the slot, charge inventory, precondition, and post-action cleanup. " +
      "Covers charge counters, exhaustion, energy costs, and any 'spend N tokens to activate' pattern.",
  );

export type ChargesMechanic = z.infer<typeof ChargesMechanicSchema>;
