/**
 * FlowIntegrityValidator — Pass 3: Flow structural integrity.
 *
 * Verifies that the flow tree is well-formed and that every loop can terminate.
 * These constraints cannot be expressed in Zod (they require semantic reasoning
 * across the full spec, not just the flow module in isolation).
 *
 * Rules:
 *   - flow module must have a root node if the module is present
 *   - root must be kind: game (not a loop)
 *   - every loop node (anywhere in the tree) must have an exit path:
 *       (a) an explicit `count` field, OR
 *       (b) an explicit `endCondition` field, OR
 *       (c) a game-level mechanic that auto-wires an endCondition
 *           (currently: chaincraft:score-track with a winAt value)
 *   - the auto-wire exception applies to the first child loop of root
 *   - `optional: true` is valid only on a direct step of a sequence
 */

import type { ModularGameSpec } from "#gamedef/index.js";
import { ValidationCode, type SpecValidator, type ValidationError } from "../types.js";

/** True if any game-level mechanic auto-wires an endCondition onto the root loop. */
function mechanicsAutoWireRootEnd(spec: ModularGameSpec): boolean {
  return (spec.mechanics ?? []).some(
    (m) =>
      m.kind === "chaincraft:score-track" &&
      (m as Record<string, unknown>)["winAt"] !== undefined,
  );
}

function checkGrammar(
  node: unknown,
  path: string,
  isSequenceStep: boolean,
  errors: ValidationError[],
): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;

  if (n["optional"] !== undefined && !isSequenceStep) {
    errors.push({
      path: `${path}.optional`,
      message:
        `"optional" is valid only on a step of a sequence. ` +
        `Remove it, or make this action a step of a "sequence".`,
      code: ValidationCode.FlowIntegrity,
    });
  }

  if (n["kind"] === "sequence" && Array.isArray(n["steps"])) {
    n["steps"].forEach((s, i) => checkGrammar(s, `${path}.steps[${i}]`, true, errors));
  } else if (n["kind"] === "choice" && Array.isArray(n["options"])) {
    n["options"].forEach((o, i) => checkGrammar(o, `${path}.options[${i}]`, false, errors));
  } else if (n["kind"] === "repeat") {
    checkGrammar(n["body"], `${path}.body`, false, errors);
  }
}

function checkNode(
  node: unknown,
  path: string,
  isTopLevelChild: boolean,
  autoWiredEnd: boolean,
  errors: ValidationError[],
): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;

  checkGrammar(n["grammar"], `${path}.grammar`, false, errors);

  if (n["kind"] === "loop") {
    const hasExit =
      n["endCondition"] !== undefined ||
      n["count"] !== undefined ||
      (isTopLevelChild && autoWiredEnd);

    if (!hasExit) {
      errors.push({
        path,
        message:
          `Loop node has no exit condition — add an "endCondition", a "count", ` +
          `or a game-level mechanic that auto-wires an end condition ` +
          `(e.g., chaincraft:score-track with winAt)`,
        code: ValidationCode.FlowIntegrity,
      });
    }

    const children = n["children"];
    if (Array.isArray(children)) {
      children.forEach((c, i) =>
        checkNode(c, `${path}.children[${i}]`, false, autoWiredEnd, errors),
      );
    }
  } else {
    // turn / simultaneous — recurse into children if present
    const children = n["children"];
    if (Array.isArray(children)) {
      children.forEach((c, i) =>
        checkNode(c, `${path}.children[${i}]`, false, autoWiredEnd, errors),
      );
    }
  }
}

export class FlowIntegrityValidator implements SpecValidator {
  readonly name = "FlowIntegrity";

  validate(spec: ModularGameSpec): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!spec.flow) return errors;

    const root = spec.flow.root;
    if (!root) {
      errors.push({ path: "flow.root", message: "Flow module must have a root node", code: ValidationCode.FlowIntegrity });
      return errors;
    }

    if ((root as Record<string, unknown>)["kind"] !== "game") {
      errors.push({ path: "flow.root", message: 'Root node must be kind: "game"', code: ValidationCode.FlowIntegrity });
      return errors;
    }

    const autoWiredEnd = mechanicsAutoWireRootEnd(spec);
    const rootChildren = (root as Record<string, unknown>)["children"];
    if (Array.isArray(rootChildren)) {
      rootChildren.forEach((c, i) =>
        checkNode(c, `flow.root.children[${i}]`, true, autoWiredEnd, errors),
      );
    }

    return errors;
  }
}
