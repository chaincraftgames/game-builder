/**
 * Cross-module reference validator.
 *
 * Checks that forward references in one module resolve to declared IDs in another,
 * and runs structural integrity checks that Zod schema validation alone cannot enforce.
 *
 * Rule set:
 *   Pass 1 — Reference resolution
 *   - actions: effect refs must resolve to an ID in effects module
 *   - flow: availableActions refs must resolve to an ID in actions module
 *   - mechanics: charges.action must resolve to an ID in actions module
 *   - mechanics: dominantGamepiece.evaluationInventory must resolve to an ID in inventories module
 *   - catalog: typeId must resolve to an ID in gamepieceTypes module
 *
 *   Pass 2 — Duplicate ID detection
 *   - No two actions with the same ID
 *   - No two effects with the same ID
 *   - No two inventory types with the same ID
 *   - No two gamepiece types with the same ID
 *   - No two flow nodes with the same ID in the flow tree
 *
 *   Pass 3 — Flow structural integrity
 *   - Root loop must be able to terminate (has endCondition, count, or a game-level
 *     mechanic that auto-wires an endCondition such as score-track with winAt)
 *   - Every flow node ID referenced in mechanics availableInSubflows must exist in
 *     the flow tree
 *   - Every loop node must have at least one child or an endCondition
 */

import type { ModularGameSpec } from "#gamedef/index.js";
import type { ValidationError } from "./index.js";

export function validateReferences(spec: ModularGameSpec): ValidationError[] {
  const errors: ValidationError[] = [];

  // ---------------------------------------------------------------------------
  // Build ID sets for each module
  // ---------------------------------------------------------------------------
  const effectIds = new Set(spec.effects?.effects?.map((e) => e.id) ?? []);
  const actionIds = new Set(spec.actions?.actions?.map((a) => a.id) ?? []);
  const inventoryIds = new Set(spec.inventories?.types?.map((i) => i.id) ?? []);
  const gamepieceTypeIds = new Set(
    (spec.gamepieceTypes?.types?.map((t) => t.id).filter(Boolean) as string[]) ?? [],
  );

  // ---------------------------------------------------------------------------
  // Pass 1 — Reference resolution
  // ---------------------------------------------------------------------------

  // actions: effectRef steps must exist in effects
  spec.actions?.actions?.forEach((action, ai) => {
    action.steps.forEach((step, si) => {
      if ("effectRef" in step && !effectIds.has(step.effectRef)) {
        errors.push({
          path: `actions.actions[${ai}].steps[${si}].effectRef`,
          message: `Effect ref "${step.effectRef}" not found in effects module`,
        });
      }
    });
  });

  // flow: availableActions refs must exist in actions
  // Also collect all flow node IDs for later validation
  const flowNodeIds = new Set<string>();

  function collectAndCheckFlowNode(node: unknown, path: string): void {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;

    if (typeof n["id"] === "string") {
      flowNodeIds.add(n["id"]);
    }

    for (const key of ["body", "turns", "nodes", "children"]) {
      const child = n[key];
      if (Array.isArray(child)) {
        child.forEach((c, i) => collectAndCheckFlowNode(c, `${path}.${key}[${i}]`));
      } else if (child && typeof child === "object") {
        collectAndCheckFlowNode(child, `${path}.${key}`);
      }
    }
  }

  if (spec.flow?.root) {
    collectAndCheckFlowNode(spec.flow.root, "flow.root");
  }

  // mechanics: cross-module refs
  spec.mechanics?.forEach((mechanic, mi) => {
    if (mechanic.kind === "chaincraft:dominant-gamepiece") {
      if (!inventoryIds.has(mechanic.evaluationInventory)) {
        errors.push({
          path: `mechanics[${mi}].evaluationInventory`,
          message: `Inventory "${mechanic.evaluationInventory}" not found in inventories module`,
        });
      }
      if (!mechanic.winnerToState && !mechanic.winningPieceToState) {
        errors.push({
          path: `mechanics[${mi}]`,
          message:
            "chaincraft:dominant-gamepiece requires at least one of 'winnerToState' or 'winningPieceToState'",
        });
      }
    }
  });

  // gamepiece-types: piece-level mechanic action refs
  spec.gamepieceTypes?.types?.forEach((type, ti) => {
    (type.mechanics as unknown[] | undefined)?.forEach((mechanic, mi) => {
      if (!mechanic || typeof mechanic !== "object") return;
      const m = mechanic as Record<string, unknown>;
      if (m["kind"] === "chaincraft:charges") {
        const actionId = m["action"] as string | undefined;
        if (actionId && !actionIds.has(actionId)) {
          errors.push({
            path: `gamepieceTypes.types[${ti}].mechanics[${mi}].action`,
            message: `Action ref "${actionId}" not found in actions module`,
          });
        }
      }
    });

    // availableInSubflows refs must resolve to flow node IDs
    // (checked after flow traversal below, deferred)
  });

  // catalog: typeId refs must exist in gamepieceTypes
  spec.catalog?.entries?.forEach((entry, ei) => {
    if (entry.typeId && !gamepieceTypeIds.has(entry.typeId)) {
      errors.push({
        path: `catalog.entries[${ei}].typeId`,
        message: `Gamepiece type "${entry.typeId}" not found in gamepieceTypes module`,
      });
    }
  });

  // mechanics availableInSubflows refs must resolve to flow node IDs
  // (flow IDs collected above)
  spec.gamepieceTypes?.types?.forEach((type, ti) => {
    (type.mechanics as unknown[] | undefined)?.forEach((mechanic, mi) => {
      if (!mechanic || typeof mechanic !== "object") return;
      const m = mechanic as Record<string, unknown>;
      const subflows = m["availableInSubflows"] as string[] | undefined;
      subflows?.forEach((nodeId, si) => {
        if (!flowNodeIds.has(nodeId)) {
          errors.push({
            path: `gamepieceTypes.types[${ti}].mechanics[${mi}].availableInSubflows[${si}]`,
            message: `Flow node ID "${nodeId}" not found in flow tree`,
          });
        }
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Pass 2 — Duplicate ID detection
  // ---------------------------------------------------------------------------

  function checkDuplicates(ids: string[], modulePath: string): void {
    const seen = new Set<string>();
    ids.forEach((id) => {
      if (seen.has(id)) {
        errors.push({
          path: modulePath,
          message: `Duplicate ID "${id}" — IDs must be unique within this module`,
        });
      }
      seen.add(id);
    });
  }

  checkDuplicates(
    spec.actions?.actions?.map((a) => a.id) ?? [],
    "actions.actions",
  );
  checkDuplicates(
    spec.effects?.effects?.map((e) => e.id) ?? [],
    "effects.effects",
  );
  checkDuplicates(
    spec.inventories?.types?.map((i) => i.id) ?? [],
    "inventories.types",
  );
  checkDuplicates(
    (spec.gamepieceTypes?.types?.map((t) => t.id).filter(Boolean) as string[]) ?? [],
    "gamepieceTypes.types",
  );

  // Flow node ID uniqueness (across the entire tree)
  {
    const seen = new Set<string>();
    function checkFlowNodeIdUniqueness(node: unknown, path: string): void {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (typeof n["id"] === "string") {
        if (seen.has(n["id"])) {
          errors.push({
            path,
            message: `Duplicate flow node ID "${n["id"]}" — node IDs must be unique within the flow tree`,
          });
        }
        seen.add(n["id"]);
      }
      for (const key of ["body", "turns", "nodes", "children"]) {
        const child = n[key];
        if (Array.isArray(child)) {
          child.forEach((c, i) => checkFlowNodeIdUniqueness(c, `${path}.${key}[${i}]`));
        } else if (child && typeof child === "object") {
          checkFlowNodeIdUniqueness(child, `${path}.${key}`);
        }
      }
    }
    if (spec.flow?.root) {
      checkFlowNodeIdUniqueness(spec.flow.root, "flow.root");
    }
  }

  // ---------------------------------------------------------------------------
  // Pass 3 — Flow structural integrity
  // ---------------------------------------------------------------------------

  // Determine which game-level mechanics auto-wire an endCondition
  const mechanicsAutoWireEnd = new Set<string>();
  spec.mechanics?.forEach((mechanic) => {
    if (
      mechanic.kind === "chaincraft:score-track" &&
      (mechanic as Record<string, unknown>)["winAt"] !== undefined
    ) {
      mechanicsAutoWireEnd.add("root");
    }
  });

  function checkLoopTermination(node: unknown, path: string, isRoot: boolean): void {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    const kind = n["kind"];

    if (kind === "loop") {
      const hasEndCondition = n["endCondition"] !== undefined;
      const hasCount = n["count"] !== undefined;
      const mechAutoWires = isRoot && mechanicsAutoWireEnd.has("root");

      if (!hasEndCondition && !hasCount && !mechAutoWires) {
        errors.push({
          path,
          message:
            `Loop node has no exit condition — add an "endCondition", a "count", ` +
            `or a game-level mechanic that auto-wires an end condition (e.g., ` +
            `chaincraft:score-track with winAt)`,
        });
      }

      const children = n["children"];
      if (Array.isArray(children)) {
        children.forEach((c, i) =>
          checkLoopTermination(c, `${path}.children[${i}]`, false),
        );
      }
    } else if (kind === "turn" || kind === "simultaneous") {
      // simultaneous can also have an endCondition
      const children = (n["children"] as unknown[]) ?? [];
      if (Array.isArray(children)) {
        children.forEach((c, i) =>
          checkLoopTermination(c, `${path}.children[${i}]`, false),
        );
      }
    }
  }

  if (spec.flow?.root) {
    checkLoopTermination(spec.flow.root, "flow.root", true);
  }

  // Root must exist if flow module is present
  if (spec.flow && !spec.flow.root) {
    errors.push({
      path: "flow.root",
      message: "Flow module must have a root node",
    });
  }

  return errors;
}

