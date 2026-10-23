/**
 * DuplicateIdsValidator — Pass 2: Duplicate ID detection.
 *
 * IDs must be unique within each module and within the flow tree.
 * Duplicate IDs cause silent aliasing bugs where the engine picks an
 * arbitrary one of the duplicates.
 *
 * Rules:
 *   - actions.actions[*].id        — unique within the actions module
 *   - effects.effects[*].id        — unique within the effects module
 *   - inventories.types[*].id      — unique within the inventories module
 *   - gamepieceTypes.types[*].id   — unique within the gamepiece-types module
 *   - flow node id (all nodes)     — unique across the entire flow tree
 */

import type { ModularGameSpec } from "#gamedef/index.js";
import type { SpecValidator, ValidationError } from "../types.js";

function checkDuplicates(
  ids: string[],
  modulePath: string,
  errors: ValidationError[],
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      errors.push({
        path: modulePath,
        message: `Duplicate ID "${id}" — IDs must be unique within this module`,
      });
    }
    seen.add(id);
  }
}

function collectFlowNodeIds(
  node: unknown,
  path: string,
  seen: Set<string>,
  errors: ValidationError[],
): void {
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
      child.forEach((c, i) =>
        collectFlowNodeIds(c, `${path}.${key}[${i}]`, seen, errors),
      );
    } else if (child && typeof child === "object") {
      collectFlowNodeIds(child, `${path}.${key}`, seen, errors);
    }
  }
}

export class DuplicateIdsValidator implements SpecValidator {
  readonly name = "DuplicateIds";

  validate(spec: ModularGameSpec): ValidationError[] {
    const errors: ValidationError[] = [];

    checkDuplicates(
      spec.actions?.actions?.map((a) => a.id) ?? [],
      "actions.actions",
      errors,
    );
    checkDuplicates(
      spec.effects?.effects?.map((e) => e.id) ?? [],
      "effects.effects",
      errors,
    );
    checkDuplicates(
      spec.effects?.passives?.map((p) => p.id) ?? [],
      "effects.passives",
      errors,
    );
    checkDuplicates(
      spec.inventories?.types?.map((i) => i.id) ?? [],
      "inventories.types",
      errors,
    );
    checkDuplicates(
      (spec.gamepieceTypes?.types?.map((t) => t.id).filter(Boolean) as string[]) ?? [],
      "gamepieceTypes.types",
      errors,
    );

    if (spec.flow?.root) {
      collectFlowNodeIds(spec.flow.root, "flow.root", new Set(), errors);
    }

    return errors;
  }
}
