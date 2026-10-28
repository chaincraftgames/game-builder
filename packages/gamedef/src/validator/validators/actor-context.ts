/**
 * ActorContextValidator — effects that need an actor but run without one.
 *
 * Flow hooks (onEnter / onComplete) and win-condition onVictory effects run
 * with no acting player. An effect there must name its players explicitly;
 * otherwise the runtime would have nothing to resolve "the actor" against.
 * Action steps always have an actor, so they are not checked. Passives depend
 * on their trigger and are not checked yet.
 *
 * Rules, applied to every effect reachable from an actor-less location
 * (following effectRef into the effects module):
 *   - a gamepiece selector (move/distribute `from`, `pieces` of
 *     flip/update/orient/reveal/hide/roll/generate-gamepiece-image) on a
 *     player-scoped inventory must have a `player` target
 *   - a move destination on a player-scoped inventory must have a `player` target
 *   - `player` / `target` of kind `actor` or `all-other` is rejected
 *   - set-state on a `player.property.*` path must have a `target`
 */

import type { ModularGameSpec } from "#gamedef/index.js";
import { ValidationCode, type SpecValidator, type ValidationError } from "../types.js";

type Obj = Record<string, unknown>;

const SELECTOR_FIELDS: Record<string, string[]> = {
  move: ["from"],
  distribute: ["from"],
  flip: ["pieces"],
  update: ["pieces"],
  orient: ["pieces"],
  reveal: ["pieces"],
  hide: ["pieces"],
  roll: ["pieces"],
  "generate-gamepiece-image": ["pieces"],
};

const NEEDS_ACTOR_KINDS = new Set(["actor", "all-other"]);

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export class ActorContextValidator implements SpecValidator {
  readonly name = "ActorContext";

  validate(spec: ModularGameSpec): ValidationError[] {
    const errors: ValidationError[] = [];
    if (!spec.flow?.root) return errors;

    const effectsById = new Map<string, Obj>(
      (spec.effects?.effects ?? []).map((e) => [e.id, e as unknown as Obj]),
    );
    const playerScoped = new Set(
      (spec.inventories?.types ?? [])
        .filter((inv) => inv.scope.kind === "player")
        .map((inv) => inv.id),
    );

    const checkEffect = (effect: Obj, label: string, path: string): void => {
      const kind = effect["effect"];
      if (typeof kind !== "string") return;
      const report = (problem: string, fix: string) =>
        errors.push({
          path,
          message: `${label} (${kind}): ${problem}, but this runs in a context with no acting player. ${fix}`,
          code: ValidationCode.ActorContext,
        });

      for (const field of SELECTOR_FIELDS[kind] ?? []) {
        const selector = effect[field];
        if (!isObj(selector)) continue;
        const inventory = selector["inventory"];
        const player = selector["player"];
        if (typeof inventory === "string" && playerScoped.has(inventory) && !isObj(player)) {
          report(
            `"${field}" selects from player-scoped inventory "${inventory}" without a player`,
            `Add player: { kind: all } (or another player target) to "${field}".`,
          );
        }
        if (isObj(player) && NEEDS_ACTOR_KINDS.has(player["kind"] as string)) {
          report(
            `"${field}.player" is kind "${player["kind"]}"`,
            `Use kind: all, param, stateRef or matching instead.`,
          );
        }
      }

      if (kind === "move" && isObj(effect["to"])) {
        const to = effect["to"];
        const inventory = to["inventory"];
        const player = to["player"];
        if (typeof inventory === "string" && playerScoped.has(inventory) && !isObj(player)) {
          report(
            `"to" targets player-scoped inventory "${inventory}" without a player`,
            `Add player: { kind: stateRef, path: ... } (or kind: param) to "to".`,
          );
        }
        if (isObj(player) && player["kind"] === "actor") {
          report(`"to.player" is kind "actor"`, `Use kind: stateRef or param instead.`);
        }
      }

      if (kind === "set-state" && typeof effect["path"] === "string") {
        if (effect["path"].startsWith("player.property.")) {
          const target = effect["target"];
          if (!isObj(target)) {
            report(
              `writes ${effect["path"]} without a target`,
              `Add target: { kind: all } (or another player target).`,
            );
          } else if (NEEDS_ACTOR_KINDS.has(target["kind"] as string)) {
            report(
              `"target" is kind "${target["kind"]}"`,
              `Use kind: all, param, stateRef or matching instead.`,
            );
          }
        }
      }
    };

    const checkCalls = (calls: unknown, path: string): void => {
      if (!Array.isArray(calls)) return;
      calls.forEach((call, i) => {
        if (!isObj(call)) return;
        const callPath = `${path}[${i}]`;
        if (typeof call["effectRef"] === "string") {
          const effect = effectsById.get(call["effectRef"]);
          if (effect) checkEffect(effect, `Effect "${call["effectRef"]}"`, callPath);
        } else {
          checkEffect(call, "Inline effect", callPath);
        }
      });
    };

    const walk = (node: unknown, path: string): void => {
      if (!isObj(node)) return;
      const hooks = node["hooks"];
      if (isObj(hooks)) {
        checkCalls(hooks["onEnter"], `${path}.hooks.onEnter`);
        checkCalls(hooks["onComplete"], `${path}.hooks.onComplete`);
      }
      if (Array.isArray(node["winConditions"])) {
        node["winConditions"].forEach((wc, i) => {
          if (isObj(wc)) checkCalls(wc["onVictory"], `${path}.winConditions[${i}].onVictory`);
        });
      }
      if (Array.isArray(node["children"])) {
        node["children"].forEach((c, i) => walk(c, `${path}.children[${i}]`));
      }
    };

    walk(spec.flow.root, "flow.root");
    return errors;
  }
}
