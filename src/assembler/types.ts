// ---------------------------------------------------------------------------
// Assembler types — re-exported from @chaincraft/runtime.
//
// Previously this file contained local copies of the runtime types.
// Now that @chaincraft/runtime is a dependency, we re-export directly.
// ---------------------------------------------------------------------------

import type {
  GameConfig,
  EffectRegistration,
  ActionDef,
} from "@chaincraft/runtime";

export type {
  RefType,
  InventoryStructure,
  BagInventoryData,
  StackInventoryData,
  LineInventoryData,
  GridInventoryData,
  GraphInventoryData,
  InventoryData,
  Gamepiece,
  PlayerState,
  GameState,
  ComputedPropertyConfig,
  PropertyConfig,
  GamepieceTypeConfig,
  InventoryConfig,
  GameConfig,
  RngProvider,
  GameSession,
  EffectRegistration,
  ActionDef,
} from "@chaincraft/runtime";

/** Reserved inventory ID: every catalog piece starts here before setup effects run. */
export const UNASSIGNED_INVENTORY_ID = "game:unassigned";

/** The mutable intermediate artifact passed between assembler phases. */
export interface ModuleBuilder {
  specId: string;
  config: GameConfig;
  effectDefs: Record<string, Record<string, unknown>>;
  effects: Record<string, EffectRegistration>;
  actions: Record<string, ActionDef>;
}
