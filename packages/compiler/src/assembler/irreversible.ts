// ---------------------------------------------------------------------------
// Irreversible-effect classification
//
// An effect is irreversible when running it cannot be undone without a player
// having learned something or without breaking determinism. Default-deny: only
// effect kinds that are provably safe (move, distribute, update, set-state,
// orient) are ever reversible, and only when every check below passes.
//
// Irreversible when:
//   - the kind is not on the safe list (RNG, flip/reveal/hide, message,
//     llm/image, custom, mechanic-provided, reactive-only kinds);
//   - a move/distribute picks randomly, or carries information across a
//     visibility boundary (source and destination viewers differ, or cannot
//     be proven equal);
//   - an update/set-state writes a value that may read hidden information
//     or draws from the RNG;
//   - a compiled passive could fire in response to it.
//
// Turn end is always a checkpoint and is not modeled here.
// ---------------------------------------------------------------------------

import type { GameConfig, InventoryConfig, PassiveActivation } from "@chaincraft/runtime";

type Def = Record<string, unknown>;

const isObject = (v: unknown): v is Def =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Viewer set of an inventory's pieces and count; undefined when it cannot be proven. */
function audience(inv: InventoryConfig): string | undefined {
  if (inv.visibility === "top-revealed") return undefined;
  const ownerBound = inv.visibility === "owner" || inv.countVisibility === "owner";
  if (ownerBound && inv.scope !== "player") return undefined;
  return `${inv.visibility}/${inv.countVisibility}`;
}

/** Stable key for a player reference; undefined for non-literal references. */
function playerKey(ref: unknown): string | undefined {
  if (ref === undefined || ref === "actor") return "actor";
  if (isObject(ref)) {
    if (typeof ref.param === "string") return `param:${ref.param}`;
    if (typeof ref.stateRef === "string") return `stateRef:${ref.stateRef}`;
  }
  return undefined;
}

function isRandomSelect(selector: unknown): boolean {
  return isObject(selector) && selector.select === "random";
}

function resolveInventory(selectorOrTarget: unknown, config: GameConfig): InventoryConfig | undefined {
  if (!isObject(selectorOrTarget)) return undefined;
  const id = selectorOrTarget.inventory;
  return typeof id === "string" ? config.inventories[id] : undefined;
}

/** True when moving pieces from `from` to `to` shows them to exactly the same players. */
function sameViewers(from: unknown, to: unknown, config: GameConfig, perOwner: boolean): boolean {
  const a = resolveInventory(from, config);
  const b = resolveInventory(to, config);
  if (!a || !b) return false;
  const aud = audience(a);
  if (aud === undefined || aud !== audience(b)) return false;
  if (a.visibility !== "owner" && a.countVisibility !== "owner") return true;
  // Owner-visible: the same single player must own both sides.
  if (perOwner) return false;
  const fromKey = playerKey((from as Def).player);
  return fromKey !== undefined && fromKey === playerKey((to as Def).player);
}

function isPublicStatePath(path: unknown, config: GameConfig): boolean {
  if (typeof path !== "string") return false;
  const [scope, kind, id, ...rest] = path.split(".");
  if (kind !== "property" || !id || rest.length > 0) return false;
  const props =
    scope === "game" ? config.gameProperties : scope === "player" ? config.playerProperties : undefined;
  const prop = props?.[id];
  return prop !== undefined && !prop.computed;
}

/** True when a written value is provably free of hidden information. */
function valueIsPublic(value: unknown, config: GameConfig): boolean {
  if (!isObject(value)) return true;
  if ("delta" in value) return valueIsPublic(value.delta, config);
  if ("mult" in value) return valueIsPublic(value.mult, config);
  if ("toggle" in value || "param" in value || "actor" in value) return true;
  if ("random" in value) return false; // RNG draw cannot be replayed
  if ("var" in value) return isPublicStatePath(value.var, config);
  return false; // { expr } is an opaque closure
}

function isIntrinsicallyReversible(def: Def, config: GameConfig): boolean {
  switch (def.kind) {
    case "move":
      return !isRandomSelect(def.from) && sameViewers(def.from, def.to, config, false);
    case "distribute":
      return !isRandomSelect(def.from) && sameViewers(def.from, def.to, config, true);
    case "update":
    case "set-state":
      return valueIsPublic(def.value, config);
    case "orient":
      return true;
    default:
      return false;
  }
}

function mayFirePassive(def: Def, passives: readonly PassiveActivation[]): boolean {
  return passives.some(({ trigger }) => {
    switch (trigger.kind) {
      case "state-write":
        if (def.kind === "set-state") return typeof def.path !== "string" || def.path === trigger.path;
        if (def.kind === "update") {
          return typeof def.property !== "string" || `gamepiece.property.${def.property}` === trigger.path;
        }
        return false;
      case "move":
        return def.kind === "move" || def.kind === "distribute";
      case "reveal":
        return def.kind === "reveal" || def.kind === "flip";
      case "skip-turn":
        return def.kind === "set-state"; // elimination is a set-state write
    }
  });
}

/** Ids of every effectDef that cannot be undone, sorted. */
export function classifyIrreversibleEffects(
  effectDefs: Record<string, Def>,
  config: GameConfig,
  passives: readonly PassiveActivation[] = [],
): string[] {
  return Object.entries(effectDefs)
    .filter(([, def]) => !isIntrinsicallyReversible(def, config) || mayFirePassive(def, passives))
    .map(([id]) => id)
    .sort();
}
