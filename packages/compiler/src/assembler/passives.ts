// ---------------------------------------------------------------------------
// Passives assembler
//
// Produces: PassiveActivation[] — one record per (pieceId × slotId) passive
// binding, joining enablement from the gamepiece type's passiveSlots with
// behavior from the referenced (or inline) passive definition.
//
// The slot/passive split is compile-time only; the runtime sees only the
// flat PassiveActivation record. Timing is inferred from the effects list:
// any adjust or cancel-effect effect → 'before' (intercept); otherwise 'after'.
//
// Piece ID generation MUST match assembleGamepieces() in state.ts: named
// entries use entry.id; quantity-based entries use '${typeId}-${counter}'
// with a per-type counter incremented across all catalog entries in order.
// ---------------------------------------------------------------------------

import type {
  ModularGameSpec,
  Effect,
  GamepieceType,
  PassiveSlot,
} from "@chaincraft/gamedef";
import type { 
  PassiveActivation,
  PassivePieceActivation,
} from "@chaincraft/runtime";
import { enumerateCatalogPieces } from "#compiler/assembler/catalog.js";
import { walkEffectBody } from "#compiler/assembler/effects.js";
import { compilePieceFilter } from "#compiler/expressions/eval-bridge.js";

const BEFORE_KINDS = new Set(["adjust", "cancel-effect"]);

/** Infer passive timing from its effects list. */
function inferTiming(effects: Effect[]): "before" | "after" {
  return effects.some((e) => BEFORE_KINDS.has(e.effect)) ? "before" : "after";
}

/**
 * Compile all catalog passive bindings into flat PassiveActivation records.
 *
 * Each record joins:
 *   - enablement: enabledIn, faceFilter, exhaustedFilter, condition from the slot
 *   - behavior:   trigger, effects from the passive def (named ref or inline)
 */
export function assemblePassives(spec: ModularGameSpec): PassivePieceActivation[] {
  const typeDefs = spec.gamepieceTypes?.types ?? [];
  const namedPassives = spec.effects?.passives ?? [];

  const activations: PassivePieceActivation[] = [];

  for (const { entry, pieceIds } of enumerateCatalogPieces(spec)) {
    if (
      !entry.passiveBindings ||
      Object.keys(entry.passiveBindings).length === 0
    ) {
      continue;
    }

    const typeDef = typeDefs.find((t: GamepieceType) => t.id === entry.typeId);
    if (!typeDef) continue;

    for (const [slotId, bindingValue] of Object.entries(
      entry.passiveBindings,
    )) {
      const slot = (typeDef.passiveSlots ?? []).find(
        (s: PassiveSlot) => s.id === slotId,
      );
      if (!slot) continue;

      // Resolve passive def: named string ref or inline object.
      let passiveId: string;
      let trigger: Record<string, unknown>;
      let effects: Effect[];

      if (typeof bindingValue === "string") {
        const found = namedPassives.find((p) => p.id === bindingValue);
        if (!found) continue;
        passiveId = bindingValue;
        trigger = found.trigger as Record<string, unknown>;
        effects = found.effects as Effect[];
      } else {
        const inline = bindingValue as {
          trigger: Record<string, unknown>;
          effects: Effect[];
        };
        passiveId = `${entry.typeId}/${slotId}`;
        trigger = inline.trigger;
        effects = inline.effects;
      }

      const timing = inferTiming(effects);
      const compiledEffects = effects.map((e) => walkEffectBody(e));
      const condition = slot.condition
        ? compilePieceFilter(slot.condition)
        : undefined;

      for (const pieceId of pieceIds) {
        activations.push({
          binding: { kind: "piece", pieceId },
          passiveId,
          slotId,
          // PassiveTrigger shapes mirror each other between gamedef and runtime.
          trigger: trigger as PassiveActivation["trigger"],
          timing,
          enabledIn: slot.enabledIn,
          faceFilter: slot.faceFilter ?? "face-up-only",
          exhaustedFilter: slot.exhaustedFilter ?? "any",
          ...(condition && { condition }),
          compiledEffects,
        });
      }
    }
  }

  return activations;
}
