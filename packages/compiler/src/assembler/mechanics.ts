// ---------------------------------------------------------------------------
// Phase 4 — Mechanic assembler passes
//
// Runs AFTER the core assemblers on a mutable ModuleBuilder. Each mechanic
// pass contributes effect defs and executors under namespaced IDs. Hard-coded
// dispatch on mechanic kind — no generic framework yet (Phase 7).
//
// Current support:
//   chaincraft:dominant-gamepiece — comparison rule only (Phase 6 adds matrix/dominant)
// ---------------------------------------------------------------------------

// TODO this is a temporary shim.  Mechanics assemblers should be registered 
// and invoked during the mechanics phase of the compiler, rather than being 
// hard-coded here.
import type { GameMechanic } from '@chaincraft/gamedef';
import { createDominantGamepieceResolver } from '@chaincraft/runtime';
import type { DominantGamepieceMechanic } from '@chaincraft/runtime';
import type { ModuleBuilder } from './types.js';

/**
 * Apply all mechanic passes to the in-progress module builder.
 * Mutates `builder.effectDefs` and `builder.effects`.
 */
export function applyMechanics(
  mechanics: GameMechanic[] | undefined,
  builder: ModuleBuilder,
): void {
  if (!mechanics?.length) return;

  for (const mechanic of mechanics) {
    if (mechanic.kind === 'chaincraft:dominant-gamepiece') {
      applyDominantGamepieceMechanic(mechanic as unknown as Record<string, unknown>, builder);
    } else {
      throw new Error(
        `mechanic assembler: unknown mechanic kind '${mechanic.kind}'. ` +
          `Only 'chaincraft:dominant-gamepiece' is supported in Phase 4.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// chaincraft:dominant-gamepiece pass
// ---------------------------------------------------------------------------

function applyDominantGamepieceMechanic(
  raw: Record<string, unknown>,
  builder: ModuleBuilder,
): void {
  const mechanic: DominantGamepieceMechanic = {
    ...(raw.id != null && { id: raw.id as string }),
    ...(raw.label != null && { label: raw.label as string }),
    evaluationInventory: raw.evaluationInventory as string,
    ...(raw.winnerToState != null && { winnerToState: raw.winnerToState as string }),
    ...(raw.winningPieceToState != null && { winningPieceToState: raw.winningPieceToState as string }),
    rules: raw.rules as DominantGamepieceMechanic['rules'],
  };

  // Namespaced resolve-effect ref
  const resolveRefId = mechanic.id
    ? `chaincraft:dominant-gamepiece:${mechanic.id}:resolve`
    : 'chaincraft:dominant-gamepiece:resolve';

  // The kind key used in effects registry and effectDef.kind
  const executorKind = mechanic.id
    ? `chaincraft:dominant-gamepiece:${mechanic.id}`
    : 'chaincraft:dominant-gamepiece';

  // Add the effect def — the resolver closes over the config, so the def
  // just needs the kind for dispatch; we store the full config for debugging.
  builder.effectDefs[resolveRefId] = {
    kind: executorKind,
    evaluationInventory: mechanic.evaluationInventory,
    ...(mechanic.winnerToState && { winnerToState: mechanic.winnerToState }),
    ...(mechanic.winningPieceToState && { winningPieceToState: mechanic.winningPieceToState }),
    rules: mechanic.rules,
  };

  // Register the executor (closes over compiled mechanic config)
  builder.effects[executorKind] = createDominantGamepieceResolver(mechanic);
}
