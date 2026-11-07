// ---------------------------------------------------------------------------
// Effects assembler
//
// Produces:
//   1. buildExecutorRegistry: Record<string, EffectRegistration> — one entry
//      per distinct effect kind found in effectDefs, mapped to the runtime
//      executor.
//   2. effectDefs: Record<string, Record<string, unknown>> — every named
//      effect compiled and stored by ID.
//   3. walkEffectBody: shared walker that compiles a single effect body
//      (walks value fields, compiles { expr: string } to CompiledValueFn closures).
//
// Design: inline effects are NOT passed through as opaque JSON. Every effect
// body is walked via walkEffectBody so the expression-compilation hook
// has a single integration point.
// ---------------------------------------------------------------------------

import type {
  ModularGameSpec,
  NamedEffect,
  Effect,
  EffectCall,
} from "@chaincraft/gamedef";
import type {
  EffectRegistration,
  EffectRef,
  CompiledValueFn,
} from "@chaincraft/runtime";
import { compileExpression } from "#compiler/expressions/index.js";
import type { ExprRoot } from "#compiler/expressions/index.js";
import { sessionToEvalContext, compilePieceFilter, compilePlayerFilter } from "#compiler/expressions/eval-bridge.js";
import {
  executeDistribute,
  executeFlip,
  executeHide,
  executeMessage,
  executeMove,
  executeOrient,
  executeReveal,
  executeRoll,
  executeSetState,
  executeShuffle,
  executeUpdate,
  createCustomExecutor,
} from "@chaincraft/runtime";

/** All built-in effect executors, keyed by effect kind string. */
const BUILT_IN_EXECUTORS: Record<string, EffectRegistration> = {
  shuffle: { kind: "effect-executor", execute: executeShuffle },
  move: { kind: "effect-executor", execute: executeMove },
  distribute: { kind: "effect-executor", execute: executeDistribute },
  message: { kind: "effect-executor", execute: executeMessage },
  "set-state": { kind: "effect-executor", execute: executeSetState },
  update: { kind: "effect-executor", execute: executeUpdate },
  flip: { kind: "effect-executor", execute: executeFlip },
  roll: { kind: "effect-executor", execute: executeRoll },
  orient: { kind: "effect-executor", execute: executeOrient },
  reveal: { kind: "effect-executor", execute: executeReveal },
  hide: { kind: "effect-executor", execute: executeHide },
  custom: createCustomExecutor({}),
};

/**
 * Build the executor registry from the kinds actually used in effectDefs.
 * Called after all assembler phases have contributed to effectDefs, so every
 * kind — named, action-inline, and flow-inline — is covered.
 * Mechanic-provided kinds (chaincraft:*) are skipped; mechanic passes
 * register their own executors.
 */
export function buildExecutorRegistry(
  effectDefs: Record<string, Record<string, unknown>>,
): Record<string, EffectRegistration> {
  const registry: Record<string, EffectRegistration> = {};
  for (const def of Object.values(effectDefs)) {
    const kind = def.kind as string | undefined;
    if (!kind) continue;
    if (kind.startsWith("chaincraft:")) continue; // handled by mechanic passes
    if (!registry[kind] && BUILT_IN_EXECUTORS[kind]) {
      registry[kind] = BUILT_IN_EXECUTORS[kind];
    }
  }
  return registry;
}

/**
 * Walk a single effect body, compiling value expressions where needed.
 * Returns a new object suitable for storage in effectDefs.
 *
 * The spec's `effect` discriminator becomes the runtime's `kind`.
 * Today this is largely structural passthrough — the { expr } compilation
 * hook will add compileExpression() calls here. The walk
 * ensures we never store raw unparsed YAML; every field is explicitly
 * handled or passed through as a known shape.
 */
export function walkEffectBody(
  effect: NamedEffect | Effect,
  opts: { passive?: boolean } = {},
): Record<string, unknown> {
  const raw = effect as unknown as Record<string, unknown>;
  const kind = raw.effect as string | undefined;
  const result: Record<string, unknown> = {};
  // actor and input stay allowed: a named effect may run from an action or a flow hook.
  const valueRoots: ExprRoot[] = ["game", "actor", "input"];
  if (opts.passive || raw.source != null) valueRoots.push("source");
  if (kind === "update") valueRoots.push("target", "piece");
  if (opts.passive) valueRoots.push("trigger");

  for (const [key, value] of Object.entries(raw)) {
    if (key === "id") continue; // strip the name — stored as the effectDefs key
    const selectorFields = kind ? GAMEPIECE_SELECTOR_FIELDS[kind] : undefined;
    if (key === "effect") {
      result.kind = value;
    } else if (selectorFields?.includes(key)) {
      result[key] = walkSelector(value, valueRoots);
    } else if (PLAYER_TARGET_FIELDS.includes(key) && isWhereTarget(value)) {
      result[key] = { where: compilePlayerFilter(value.where, PLAYER_WHERE_ROOTS) };
    } else {
      result[key] = walkValue(value, valueRoots);
    }
  }

  return result;
}

/** Effect fields that hold a PlayerTarget (set-state `target`; message/reveal `to`). */
const PLAYER_TARGET_FIELDS = ["target", "to"];

/** A PlayerTarget `where` sees the candidate player and the actor, but not action inputs. */
const PLAYER_WHERE_ROOTS: ExprRoot[] = ["game", "actor", "player"];

/** A selector filter sees the candidate piece as `piece`/`target`. */
const SELECTOR_FILTER_ROOTS: ExprRoot[] = ["game", "actor", "input", "piece", "target"];

function isWhereTarget(value: unknown): value is { where: string } {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).where === "string"
  );
}

/** Fields that hold a GamepieceSelector, keyed by effect kind. */
const GAMEPIECE_SELECTOR_FIELDS: Record<string, string[]> = {
  move: ["from"],
  distribute: ["from"],
  flip: ["pieces"],
  update: ["pieces"],
  orient: ["pieces"],
  reveal: ["pieces"],
  hide: ["pieces"],
  roll: ["pieces"],
  shuffle: [],
};

/** Walk a GamepieceSelector, compiling its filter expression if present. */
function walkSelector(value: unknown, valueRoots: readonly ExprRoot[]): unknown {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return walkValue(value, valueRoots);
  }
  const sel = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sel)) {
    if (k === "filter" && typeof v === "string") {
      result[k] = compilePieceFilter(v, SELECTOR_FILTER_ROOTS);
    } else if (k === "player" && isWhereTarget(v)) {
      result[k] = { where: compilePlayerFilter(v.where, PLAYER_WHERE_ROOTS) };
    } else {
      result[k] = walkValue(v, valueRoots);
    }
  }
  return result;
}

/**
 * Normalize an EffectCall[] into EffectRef[], accumulating inline effects into
 * effectDefs with synthetic IDs derived from the given prefix.
 *
 * Named refs (`{ effectRef }`) become runtime `{ ref }`. Inline effects are walked via
 * walkEffectBody and stored under `${prefix}_${index}`.
 *
 * This is the single shared implementation used by both the actions assembler
 * (prefix = `${actionId}._effect`) and the flow assembler (prefix = `${nodeId}.${hookName}`).
 */
export function normalizeEffectList(
  calls: EffectCall[],
  prefix: string,
  effectDefs: Record<string, Record<string, unknown>>,
): EffectRef[] {
  return calls.map((call, i): EffectRef => {
    if ("effectRef" in call) return { ref: call.effectRef };
    const syntheticId = `${prefix}_${i}`;
    effectDefs[syntheticId] = walkEffectBody(call);
    return { ref: syntheticId };
  });
}

/**
 * Recursively walk a value, compiling { expr } nodes when encountered.
 * For now, { expr } is passed through unchanged.
 */
function walkValue(value: unknown, roots: readonly ExprRoot[]): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => walkValue(v, roots));

  const obj = value as Record<string, unknown>;

  if ("expr" in obj && typeof obj.expr === "string") {
    const exprFn = compileExpression(obj.expr, roots);
    const compiled: CompiledValueFn = (session, ctx) =>
      exprFn(
        sessionToEvalContext(
          session,
          ctx.actorId ?? undefined,
          ctx.actionInputs,
          ctx.sourcePieceId,
          ctx.targetPieceId,
          ctx.trigger as Record<string, unknown> | undefined,
        ),
      );
    return { expr: compiled };
  }

  // Recurse into nested objects (from/to/target/value/etc.)
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = walkValue(v, roots);
  }
  return result;
}

// ---------------------------------------------------------------------------
// assembleEffectDefs
// ---------------------------------------------------------------------------

/**
 * Compile all named effects from the effects module into effectDefs.
 * Each entry is keyed by the effect's `id` and contains the walked body.
 */
export function assembleEffectDefs(
  spec: ModularGameSpec,
): Record<string, Record<string, unknown>> {
  const defs: Record<string, Record<string, unknown>> = {};

  if (spec.effects?.effects) {
    for (const effect of spec.effects.effects) {
      defs[effect.id] = walkEffectBody(effect);
    }
  }

  return defs;
}
