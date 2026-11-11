/**
 * UnusedContentValidator — warnings for content nothing can reach.
 *
 * "Used" comes from collectReferences (references.ts), the single inventory of reference sites.
 * All findings are warnings: dead content compiles and plays, it is just probably a mistake.
 *
 * Rules:
 *   - unused-effect:   a named effect that nothing references
 *   - unused-action:   an action no grammar, interrupt window, catalog binding or charges
 *                      mechanic references (actions declaring reactive / availableInSubflows
 *                      are reached another way and are skipped)
 *   - unbound-passive: a declared passive no catalog entry binds (skipped without a catalog)
 *   - unbound-slot:    a passive slot on a type that no catalog entry binds (skipped without a catalog)
 *
 * The catalog is authored separately and may not exist yet, and a draft may not have a flow yet,
 * so checks that depend on a missing module are skipped rather than reporting everything as unused.
 */

import type { ModularGameSpec } from "#gamedef/index.js";
import { ValidationCode, type SpecValidator, type ValidationError } from "../types.js";
import { collectReferences } from "../references.js";

export class UnusedContentValidator implements SpecValidator {
  readonly name = "UnusedContent";

  validate(spec: ModularGameSpec): ValidationError[] {
    const warnings: ValidationError[] = [];
    const refs = collectReferences(spec);
    const hasCatalog = (spec.catalog?.entries?.length ?? 0) > 0;
    const hasFlow = spec.flow?.root !== undefined;
    const warn = (path: string, code: ValidationError["code"], message: string): void => {
      warnings.push({ path, message, code, severity: "warning" });
    };

    spec.effects?.effects?.forEach((effect, i) => {
      if (hasFlow && !refs.effects.has(effect.id)) {
        warn(
          `effects.effects[${i}]`,
          ValidationCode.UnusedEffect,
          `Effect "${effect.id}" is never referenced. Reference it with { effectRef: ${effect.id} } or delete it.`,
        );
      }
    });

    // Without a catalog, actions bound through piece action slots cannot be seen.
    const slotsMayBindActions =
      !hasCatalog && (spec.gamepieceTypes?.types ?? []).some((t) => (t.actionSlots?.length ?? 0) > 0);
    if (hasFlow && !slotsMayBindActions) {
      spec.actions?.actions?.forEach((action, i) => {
        const reachedElsewhere =
          action.reactive !== undefined || action.availableInSubflows !== undefined;
        if (!refs.actions.has(action.id) && !reachedElsewhere) {
          warn(
            `actions.actions[${i}]`,
            ValidationCode.UnusedAction,
            `Action "${action.id}" is not referenced by any turn grammar, interrupt window, catalog binding or charges mechanic. Add { kind: action, ref: ${action.id} } to a grammar or delete it.`,
          );
        }
      });
    }

    if (hasCatalog) {
      spec.effects?.passives?.forEach((passive, i) => {
        if (!refs.passives.has(passive.id)) {
          warn(
            `effects.passives[${i}]`,
            ValidationCode.UnboundPassive,
            `Passive "${passive.id}" is never bound. Bind it in a catalog entry's passiveBindings or delete it.`,
          );
        }
      });

      spec.gamepieceTypes?.types?.forEach((type, ti) => {
        const bound = refs.boundPassiveSlots.get(type.id);
        type.passiveSlots?.forEach((slot, si) => {
          if (!bound?.has(slot.id)) {
            warn(
              `gamepieceTypes.types[${ti}].passiveSlots[${si}]`,
              ValidationCode.UnboundSlot,
              `Passive slot "${slot.id}" on type "${type.id}" is not bound by any catalog entry. Bind it in a catalog entry's passiveBindings or remove the slot.`,
            );
          }
        });
      });
    }

    return warnings;
  }
}
