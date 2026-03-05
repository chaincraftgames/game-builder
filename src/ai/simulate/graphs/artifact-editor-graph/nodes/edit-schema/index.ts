/**
 * Edit Schema Node (Deterministic)
 *
 * Applies structured schemaOps from the coordinator's ChangePlan to the
 * GameStateField[] stored in state.stateSchema. No LLM is used — operations
 * are applied deterministically.
 *
 * Also updates schemaFields (human-readable summary) to stay in sync.
 *
 * Supported operations:
 *   - addField: Pushes a new GameStateField into the array
 *   - removeField: Filters out the matching field by name + path
 */

import type { ArtifactEditorStateType } from '../../artifact-editor-state.js';
import type { SchemaOp } from '../../types.js';
import type { GameStateField } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/schema.js';

// ─── GameStateField[] Helpers ───

/**
 * Apply a single schema operation to the GameStateField array.
 * Returns a description of what was done (for logging).
 */
function applySchemaOp(fields: GameStateField[], op: SchemaOp): string {
  if (op.op === 'addField') {
    const existing = fields.find(f => f.name === op.field && f.path === op.scope);
    if (existing) {
      return `SKIP: field "${op.scope}.${op.field}" already exists`;
    }
    fields.push({
      name: op.field,
      type: op.type ?? 'string',
      path: op.scope,
      source: 'artifact-editor',
      purpose: op.description ?? '',
    });
    return `ADD: ${op.scope}.${op.field} (${op.type ?? 'string'})`;
  }

  if (op.op === 'removeField') {
    const idx = fields.findIndex(f => f.name === op.field && f.path === op.scope);
    if (idx === -1) {
      return `SKIP: field "${op.scope}.${op.field}" does not exist`;
    }
    fields.splice(idx, 1);
    return `REMOVE: ${op.scope}.${op.field}`;
  }

  return `SKIP: unknown op "${(op as SchemaOp).op}"`;
}

/**
 * Derive a human-readable schemaFields summary from GameStateField[].
 * Produces lines like: "game.fieldName: type (purpose)"
 */
function deriveSchemaFields(fields: GameStateField[]): string {
  return fields.map(f => {
    const prefix = f.path === 'game' ? 'game.' : 'players.*.';
    const desc = f.purpose ? ` (${f.purpose})` : '';
    return `${prefix}${f.name}: ${f.type}${desc}`;
  }).join('\n');
}

// ─── Node Factory ───

/**
 * Create the edit-schema node function.
 * Reads schemaOps from the changePlan and applies them deterministically.
 */
export function createEditSchemaNode() {
  return async (state: ArtifactEditorStateType) => {
    const schemaChanges = state.changePlan?.changes.filter(c => c.artifact === 'schema') ?? [];
    const schemaOps = state.changePlan?.schemaOps ?? [];

    if (schemaChanges.length === 0 && schemaOps.length === 0) {
      return {};
    }

    // Coordinator produced schema changes but forgot to include schemaOps
    if (schemaChanges.length > 0 && schemaOps.length === 0) {
      const msg = `schema: coordinator planned ${schemaChanges.length} schema change(s) but provided no schemaOps. ` +
        `Schema editing is deterministic and requires schemaOps. ` +
        `Changes: ${schemaChanges.map(c => `"${c.description}"`).join('; ')}`;
      console.error(`[ArtifactEditor:edit-schema] ${msg}`);
      return {
        editFailures: [msg],
      };
    }

    // Parse the current GameStateField[] schema
    let fields: GameStateField[];
    try {
      const parsed = JSON.parse(state.stateSchema);
      if (!Array.isArray(parsed)) {
        console.error('[ArtifactEditor:edit-schema] stateSchema is not a GameStateField[] array');
        return {};
      }
      fields = parsed as GameStateField[];
    } catch (e) {
      console.error('[ArtifactEditor:edit-schema] Failed to parse stateSchema:', e);
      return {};
    }

    // Apply each operation (mutates the array in place)
    const results: string[] = [];
    for (const op of schemaOps) {
      const result = applySchemaOp(fields, op);
      results.push(result);
    }

    console.log(`[ArtifactEditor:edit-schema] Applied ${schemaOps.length} schema op(s):`, results);

    // Serialize back and update schemaFields
    const updatedStateSchema = JSON.stringify(fields);
    const updatedSchemaFields = deriveSchemaFields(fields);

    return {
      stateSchema: updatedStateSchema,
      schemaFields: updatedSchemaFields,
    };
  };
}
