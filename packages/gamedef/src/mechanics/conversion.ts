/**
 * Mechanic: chaincraft:conversion
 * Scope: piece-level
 *
 * Spend one or more resource inventories to produce one or more resource inventories
 * in a single activation. Supports many-to-many conversions.
 *
 * ## Integration
 *
 * ### Exposes
 *   Action slots:  <slotId>
 *     The conversion slot ID. Wire into flow directly, or reference as charges.action
 *     to gate it behind a charge cost. Do NOT also declare it in actionSlots[].
 *
 * ### References
 *   inventories.ts (piece-scoped):
 *     `sources[].inventory`  — each source must be a valid piece-scoped inventory ID
 *     `targets[].inventory`  — each target must be a valid piece-scoped inventory ID
 *     Declare in the piece type's inventorySlots[] if referenced elsewhere in the spec.
 *     Omit (mechanic can own) if nothing else references them directly.
 *   flow.ts:      `availableInSubflows` — optional subflow node IDs restricting availability
 *
 * ### Properties defined
 *   (none)
 *
 * ### Configuration
 *   Required: slotId, sources (min 1), targets (min 1)
 *   Optional: label, availableInSubflows
 *
 * ## Engine synthesis
 *   1. Preconditions: each source inventory must have >= count items
 *   2. An action slot (<slotId>) that triggers the conversion
 *   3. Post-execution: drain each source by count, fill each target by count
 *
 * Composition with chaincraft:charges: declare this mechanic first, then reference its
 * slotId as charges.action. This makes conversion player-accessible only through the
 * charges gate. The conversion slot itself should not appear in flow directly in that case.
 *
 * @example Ore smelter: spend 2 ore → gain 1 ingot
 * ```yaml
 * kind: chaincraft:conversion
 * slotId: mygame:smelt
 * label: Smelt Ore
 * sources:
 *   - inventory: ore-storage
 *     count: 2
 * targets:
 *   - inventory: ingot-storage
 *     count: 1
 * ```
 * @example Many-to-many alchemy: 1 fire-essence + 1 water-essence → 1 steam-token + 1 residue
 * ```yaml
 * kind: chaincraft:conversion
 * slotId: mygame:alchemise
 * label: Alchemise
 * sources:
 *   - inventory: fire-essence
 *     count: 1
 *   - inventory: water-essence
 *     count: 1
 * targets:
 *   - inventory: steam-tokens
 *     count: 1
 *   - inventory: residue
 *     count: 1
 * availableInSubflows: [action-phase]
 * ```
 * @example Composing with charges: spend 2 energy to smelt (charges wraps this conversion)
 * ```yaml
 * # In the piece type's mechanics[]:
 * - kind: chaincraft:conversion
 *   slotId: mygame:smelt-action
 *   sources: [{ inventory: ore-storage, count: 2 }]
 *   targets: [{ inventory: ingot-storage, count: 1 }]
 * - kind: chaincraft:charges
 *   slotId: mygame:energized-smelt
 *   chargeType: energy-counter
 *   maxCharges: 3
 *   count: 2
 *   action: smelt-action           # references the conversion action by ID
 * ```
 */

import { z } from "zod";

/**
 * A single resource leg in a conversion — an inventory and how many items are involved.
 */
const ConversionLegSchema = z
  .object({
    inventory: z
      .string()
      .describe(
        "ID of an inventory slot on this piece. " +
          "Forward reference to an entry in this type's inventorySlots[], " +
          "or a mechanic-owned inventory if nothing else references it directly.",
      ),
    count: z
      .number()
      .int()
      .min(1)
      .describe("Number of items in this inventory involved in the conversion."),
  })
  .describe("One resource leg of a conversion — an inventory and item count.");

export const ConversionMechanicSchema = z
  .object({
    kind: z.literal("chaincraft:conversion"),
    slotId: z
      .string()
      .regex(
        /^[^:]+:[^:]+$/,
        "mechanic-generated slot IDs must be namespaced (e.g., 'mygame:smelt')",
      )
      .describe(
        "The namespaced action slot ID this mechanic generates. Format: 'namespace:name'. " +
          "Shared namespace with actionSlots[]; must be unique across both. " +
          "Do NOT also declare this id in actionSlots[] — the mechanic creates the slot.",
      ),
    label: z
      .string()
      .optional()
      .describe("Human-readable name for this mechanic's generated slot."),
    sources: z
      .array(ConversionLegSchema)
      .min(1)
      .describe(
        "Input resources consumed when the conversion activates. " +
          "Engine precondition: each source inventory must have at least 'count' items. " +
          "Engine cleanup: remove 'count' items from each source after the slot resolves.",
      ),
    targets: z
      .array(ConversionLegSchema)
      .min(1)
      .describe(
        "Output resources produced when the conversion activates. " +
          "Engine adds 'count' items to each target inventory after source cleanup.",
      ),
    availableInSubflows: z
      .array(z.string())
      .optional()
      .describe(
        "Flow node IDs during which this slot is active. " +
          "Forward references to loop/turn/simultaneous node IDs. " +
          "Omit for slots available in any context.",
      ),
  })
  .describe(
    "Piece-scoped mechanic: spend one or more resource inventories to produce one or more. " +
      "Supports many-to-many conversions. " +
      "Synthesizes the slot, source preconditions, drain effects, and fill effects. " +
      "Can be composed with chaincraft:charges to add an energy/charge cost.",
  );

export type ConversionLeg = z.infer<typeof ConversionLegSchema>;
export type ConversionMechanic = z.infer<typeof ConversionMechanicSchema>;
