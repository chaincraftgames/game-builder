/**
 * Modular Game Spec — public API
 *
 * Re-exports all spec module schemas and types and assembles the top-level
 * ModularGameSpecSchema.
 *
 * Dependency order (bottom-up):
 *   common                                      (no deps — shared primitives)
 *   metadata, players, gamepiece-types          (no deps)
 *   → inventories                               (depends on: gamepiece-types)
 *   → state                                     (depends on: gamepiece-types)
 *   → effects                                   (depends on: gamepiece-types, inventories)
 *   → actions                                   (depends on: gamepiece-types, players, effects)
 *   → flow                                      (depends on: actions, players, effects)
 *   → catalog                                   (depends on: none — pure piece registry)
 *   → mechanics                                 (depends on: all of the above)
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------
export * from "#gamedef/modules/common.js";

// ---------------------------------------------------------------------------
// Core modules
// ---------------------------------------------------------------------------
export * from "#gamedef/modules/metadata.js";
export * from "#gamedef/modules/players.js";
export * from "#gamedef/modules/gamepiece-types.js";
export * from "#gamedef/modules/inventories.js";
export * from "#gamedef/modules/state.js";
export * from "#gamedef/modules/effects.js";
export * from "#gamedef/modules/actions.js";
export * from "#gamedef/modules/flow.js";
export * from "#gamedef/modules/catalog.js";

// ---------------------------------------------------------------------------
// Mechanics
// ---------------------------------------------------------------------------
export * from "#gamedef/mechanics/index.js";

// ---------------------------------------------------------------------------
// Top-level game spec
// ---------------------------------------------------------------------------
import { MetadataModuleSchema } from "#gamedef/modules/metadata.js";
import { PlayersModuleSchema } from "#gamedef/modules/players.js";
import { GamepieceTypesModuleSchema } from "#gamedef/modules/gamepiece-types.js";
import { InventoriesModuleSchema } from "#gamedef/modules/inventories.js";
import { StateModuleSchema } from "#gamedef/modules/state.js";
import { EffectsModuleSchema } from "#gamedef/modules/effects.js";
import { ActionsModuleSchema } from "#gamedef/modules/actions.js";
import { FlowModuleSchema } from "#gamedef/modules/flow.js";
import { CatalogModuleSchema } from "#gamedef/modules/catalog.js";
import { GameMechanicSchema } from "#gamedef/mechanics/index.js";

/**
 * Top-level modular game spec.
 *
 * All modules are optional — include only what your game needs. The engine
 * treats absent modules as empty (no pieces, no inventories, etc.).
 *
 * @example Minimal spec (metadata + players + flow only)
 * ```yaml
 * metadata:
 *   title: My Game
 *   playerCount: { min: 2, max: 4 }
 * players:
 *   roles: []
 * flow:
 *   root: { kind: loop, body: [...] }
 * ```
 */
export const ModularGameSpecSchema = z
  .object({
    metadata: MetadataModuleSchema.optional().describe(
      "Game title, player count, and randomness configuration.",
    ),
    players: PlayersModuleSchema.optional().describe(
      "Role definitions, assignment rules, and player-scoped properties.",
    ),
    gamepieceTypes: GamepieceTypesModuleSchema.optional().describe(
      "Gamepiece type definitions — properties, inventory slots, and action slots.",
    ),
    inventories: InventoriesModuleSchema.optional().describe(
      "Inventory type declarations — structure, scope, capacity, and visibility.",
    ),
    state: StateModuleSchema.optional().describe(
      "Abstract state declarations — game and per-player properties with no physical " +
        "gamepiece representation. Mutated by set-state effects.",
    ),
    effects: EffectsModuleSchema.optional().describe(
      "Named reusable effects — referenced by actions and flow hooks.",
    ),
    actions: ActionsModuleSchema.optional().describe(
      "Player-facing actions — inputs, preconditions, and effect sequences.",
    ),
    flow: FlowModuleSchema.optional().describe(
      "Game structural skeleton — loop/turn/simultaneous nodes, hooks, and interrupts.",
    ),
    catalog: CatalogModuleSchema.optional().describe(
      "Piece registry — declares what pieces exist and their initial property values. " +
        "All pieces start in game:unassigned; setup effects move them before play begins.",
    ),
    mechanics: z
      .array(GameMechanicSchema)
      .optional()
      .describe(
        "Game-level mechanic declarations (score tracks, dominant-gamepiece evaluation, etc.). " +
          "Each mechanic synthesizes inventories, effects, and/or flow wiring from a compact config.",
      ),
  })
  .describe("Complete modular game specification. All modules are optional.");

export type ModularGameSpec = z.infer<typeof ModularGameSpecSchema>;
