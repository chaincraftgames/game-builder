/**
 * FaceStateValidator — face state rules for gamepiece types.
 *
 * A type without `hasFaceState: true` has no face state: its pieces are always face-up and
 * cannot be flipped.
 *
 * Rules:
 *   - a property with `visibility: revealed` on a type without hasFaceState is an error
 *     (the value would never be hidden by face state; use `always`, or set hasFaceState)
 *   - a `flip` effect whose selector can only reach types without hasFaceState is an error
 *     (the types come from `ofType`, else from the selected inventory's `accepts`;
 *     a selector whose types cannot be known is not checked)
 *
 * `reveal` / `hide` are not checked: they override who can see a piece and work on any type.
 */

import type { ModularGameSpec } from "#gamedef/index.js";
import {
  ValidationCode,
  type SpecValidator,
  type ValidationError,
} from "#gamedef/validator/types.js";

/** A generic object type for validation purposes. */
type Obj = Record<string, unknown>;

/** Type guard for generic object type. */
function isObj(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Validator for face state rules on gamepiece types. */
export class FaceStateValidator implements SpecValidator {
  readonly name = "FaceState";

  validate(spec: ModularGameSpec): ValidationError[] {
    const errors: ValidationError[] = [];
    const types = spec.gamepieceTypes?.types ?? [];
    const hasFaceState = new Map(types.map((t) => [t.id, t.hasFaceState]));

    types.forEach((type, ti) => {
      if (type.hasFaceState) return;
      type.properties?.forEach((prop, pi) => {
        if (prop.visibility !== "revealed") return;
        errors.push({
          path: `gamepieceTypes.types[${ti}].properties[${pi}]`,
          message:
            `Property "${prop.id}" on type "${type.id}" has visibility "revealed", but "${type.id}" has no face state ` +
            `(hasFaceState is not true), so its pieces are always face-up. Use visibility "always", or set ` +
            `hasFaceState: true on "${type.id}" if its pieces can be face-down. ` +
            `To hide pieces from other players, set the inventory's visibility (e.g. owner).`,
          code: ValidationCode.FaceState,
        });
      });
    });

    const inventoryAccepts = new Map(
      (spec.inventories?.types ?? []).map((inv) => [inv.id, inv.accepts]),
    );

    const checkFlip = (effect: Obj, path: string): void => {
      const selector = effect["pieces"];
      if (!isObj(selector)) return;
      const reachable =
        typeof selector["ofType"] === "string"
          ? [selector["ofType"]]
          : typeof selector["inventory"] === "string"
            ? inventoryAccepts.get(selector["inventory"])
            : undefined;
      if (!reachable || reachable.length === 0) return;
      if (!reachable.every((id) => hasFaceState.get(id) === false)) return;
      errors.push({
        path,
        message:
          `Flip effect selects only pieces of ${reachable.map((id) => `"${id}"`).join(", ")}, which ` +
          `${reachable.length === 1 ? "has" : "have"} no face state (hasFaceState is not true), so there is nothing to flip. ` +
          `Set hasFaceState: true on the type, or remove the effect. ` +
          `To show a piece to a player, use a reveal effect instead.`,
        code: ValidationCode.FaceState,
      });
    };

    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((child, i) => walk(child, `${path}[${i}]`));
        return;
      }
      if (!isObj(node)) return;
      if (node["effect"] === "flip") checkFlip(node, path);
      for (const [key, child] of Object.entries(node)) {
        walk(child, path === "" ? key : `${path}.${key}`);
      }
    };

    walk(spec, "");
    return errors;
  }
}
