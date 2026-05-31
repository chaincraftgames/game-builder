/**
 * currentAction Shape Scanner
 *
 * Two pure functions that extract the set of `currentAction.*` sub-field names
 * used on each side of the player-action contract:
 *
 *   collectCurrentActionWrites(artifact)
 *     → fields written by player-action stateDelta ops in the instructions artifact
 *       e.g. "players.{{playerId}}.currentAction.weapon1Name" → "weapon1Name"
 *
 *   collectCurrentActionReads(code)
 *     → fields read from currentAction in generated mechanic TypeScript code
 *       using the TS AST (not regex) to handle property access, optional chaining,
 *       and destructuring.
 *
 * Used by validateCurrentActionCoherenceCore to catch shape mismatches before
 * they become runtime crashes.
 */

import ts from 'typescript';
import type { InstructionsArtifact } from '#chaincraft/ai/simulate/schema.js';

// ── Writes side ──────────────────────────────────────────────────────────────

/**
 * Collect all currentAction sub-field names written by player-action stateDelta
 * ops across the entire instructions artifact.
 *
 * Paths have the form:
 *   players.{{playerId}}.currentAction.<field>
 *   players.<alias>.currentAction.<field>
 *
 * We normalise to just the sub-field name (the segment after "currentAction.").
 * "type" is always implicitly written by the runtime, so we include it too.
 */
export function collectCurrentActionWrites(artifact: InstructionsArtifact): Set<string> {
  const written = new Set<string>();
  // "type" is always set by execute-changes as part of action identification
  written.add('type');

  for (const phase of Object.values(artifact.playerPhases)) {
    for (const action of phase.playerActions) {
      for (const op of action.stateDelta) {
        const path: string | undefined = (op as any).path;
        if (!path) continue;
        // Match: players.<anything>.currentAction.<subfield>
        const m = path.match(/^players\.[^.]+\.currentAction\.(.+)$/);
        if (m) {
          written.add(m[1]);
        }
        // Handle parent-path set ops: { op: "set", path: "players.*.currentAction", value: { type: ..., count: ... } }
        // These are now rejected by the validator at generation time, but historical artifacts
        // or any that slip through must not cause false-positive coherence errors — extract
        // all keys from the object value and register them as written sub-fields.
        if (
          (op as any).op === 'set' &&
          /^players\.[^.]+\.currentAction$/.test(path)
        ) {
          const value = (op as any).value;
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            for (const key of Object.keys(value)) {
              written.add(key);
            }
          }
        }
      }
    }
  }

  return written;
}

// ── Reads side ───────────────────────────────────────────────────────────────

/**
 * Collect all currentAction sub-field names read by a mechanic's TypeScript code.
 *
 * Uses the TS compiler AST to detect:
 *   - Property access:   currentAction.weapons  /  currentAction?.weapons
 *   - Element access:    currentAction['weapons']  /  currentAction["weapons"]
 *   - Destructuring:     const { weapons } = currentAction
 *                        const { weapons, rpsValue } = player.currentAction
 *
 * Returns field names (strings), not full paths.
 */
export function collectCurrentActionReads(code: string): Set<string> {
  const reads = new Set<string>();

  const sourceFile = ts.createSourceFile(
    'mechanic.ts',
    code,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
  );

  function isCurrentActionExpr(node: ts.Expression): boolean {
    // Direct: currentAction
    if (ts.isIdentifier(node) && node.text === 'currentAction') return true;
    // Chained: something.currentAction  (e.g. player.currentAction, state.currentAction)
    if (
      (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node as any)) &&
      ts.isPropertyAccessExpression(node)
    ) {
      return node.name.text === 'currentAction';
    }
    // Optional chained: foo?.currentAction
    if (ts.isPropertyAccessExpression(node)) {
      return node.name.text === 'currentAction';
    }
    return false;
  }

  function visit(node: ts.Node): void {
    // ── Property access: currentAction.field  /  currentAction?.field ──
    if (ts.isPropertyAccessExpression(node)) {
      if (isCurrentActionExpr(node.expression)) {
        reads.add(node.name.text);
      }
    }

    // ── Element access: currentAction['field']  /  currentAction["field"] ──
    if (ts.isElementAccessExpression(node)) {
      if (isCurrentActionExpr(node.expression)) {
        const arg = node.argumentExpression;
        if (ts.isStringLiteral(arg)) {
          reads.add(arg.text);
        }
      }
    }

    // ── Destructuring: const { field1, field2 } = currentAction ──
    if (ts.isVariableDeclaration(node)) {
      const init = node.initializer;
      if (init && isCurrentActionExpr(init) && ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          // { field }  or  { field: localName }
          const propName = element.propertyName ?? element.name;
          if (ts.isIdentifier(propName)) {
            reads.add(propName.text);
          } else if (ts.isStringLiteral(propName)) {
            reads.add(propName.text);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return reads;
}
