/**
 * Reference-site inventory: every place the schema lets one element point at a named
 * effect, action or passive. Shared by the "used" checks so there is one list to keep current.
 *
 * Effects (by id in effects.effects):
 *   - `effectRef` call entries anywhere in the spec (action steps, flow hooks, win-condition
 *     onVictory, inline catalog actions) — found by a deep scan, so new call sites are covered
 *   - flow interruptWindows[].trigger
 *   - actions[].reactive.trigger (also on inline catalog actions)
 *
 * Actions (by id in actions.actions):
 *   - turn/simultaneous grammar `{ kind: action, ref }`, through sequence/choice/repeat
 *   - flow interruptWindows[].actions[]
 *   - catalog entries' actionBindings string values
 *   - piece mechanic `chaincraft:charges` `action`
 *
 * Passives (by id in effects.passives):
 *   - catalog entries' passiveBindings string values. Role passives and inline bindings
 *     are declared in place, so they are not references.
 */

import type { ModularGameSpec } from "#gamedef/index.js";

type Obj = Record<string, unknown>;

export interface SpecReferences {
  /** Named-effect ids that something points at. */
  effects: Set<string>;
  /** Action ids that something points at. */
  actions: Set<string>;
  /** Passive ids bound by a catalog entry. */
  passives: Set<string>;
  /** Gamepiece type id to the passive slot ids a catalog entry binds. */
  boundPassiveSlots: Map<string, Set<string>>;
}

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Collects `effectRef` ids from every call entry nested anywhere under `value`. */
function collectEffectRefs(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((v) => collectEffectRefs(v, into));
    return;
  }
  if (!isObj(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "effectRef" && typeof child === "string") into.add(child);
    else collectEffectRefs(child, into);
  }
}

function collectGrammarActions(node: unknown, into: Set<string>): void {
  if (!isObj(node)) return;
  if (node["kind"] === "action" && typeof node["ref"] === "string") into.add(node["ref"]);
  for (const key of ["steps", "options"]) {
    const children = node[key];
    if (Array.isArray(children)) children.forEach((c) => collectGrammarActions(c, into));
  }
  collectGrammarActions(node["body"], into);
}

function collectFlowRefs(node: unknown, refs: SpecReferences): void {
  if (!isObj(node)) return;
  collectGrammarActions(node["grammar"], refs.actions);
  const windows = node["interruptWindows"];
  if (Array.isArray(windows)) {
    for (const w of windows) {
      if (!isObj(w)) continue;
      if (typeof w["trigger"] === "string") refs.effects.add(w["trigger"]);
      if (Array.isArray(w["actions"])) {
        for (const a of w["actions"]) if (typeof a === "string") refs.actions.add(a);
      }
    }
  }
  const children = node["children"];
  if (Array.isArray(children)) children.forEach((c) => collectFlowRefs(c, refs));
}

function collectReactiveTrigger(action: unknown, into: Set<string>): void {
  if (!isObj(action) || !isObj(action["reactive"])) return;
  const trigger = action["reactive"]["trigger"];
  if (typeof trigger === "string") into.add(trigger);
}

/** Collects every reference to a named effect, action or passive in the spec. */
export function collectReferences(spec: ModularGameSpec): SpecReferences {
  const refs: SpecReferences = {
    effects: new Set(),
    actions: new Set(),
    passives: new Set(),
    boundPassiveSlots: new Map(),
  };

  collectEffectRefs(spec, refs.effects);

  spec.actions?.actions?.forEach((a) => collectReactiveTrigger(a, refs.effects));
  if (spec.flow?.root) collectFlowRefs(spec.flow.root, refs);

  spec.gamepieceTypes?.types?.forEach((type) => {
    (type.mechanics as unknown[] | undefined)?.forEach((m) => {
      if (isObj(m) && m["kind"] === "chaincraft:charges" && typeof m["action"] === "string") {
        refs.actions.add(m["action"]);
      }
    });
  });

  spec.catalog?.entries?.forEach((entry) => {
    for (const value of Object.values(entry.actionBindings ?? {})) {
      if (typeof value === "string") refs.actions.add(value);
      else collectReactiveTrigger(value, refs.effects);
    }
    const slots = refs.boundPassiveSlots.get(entry.typeId) ?? new Set<string>();
    for (const [slotId, value] of Object.entries(entry.passiveBindings ?? {})) {
      slots.add(slotId);
      if (typeof value === "string") refs.passives.add(value);
    }
    refs.boundPassiveSlots.set(entry.typeId, slots);
  });

  return refs;
}
