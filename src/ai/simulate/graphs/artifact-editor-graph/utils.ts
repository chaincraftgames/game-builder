/**
 * Shared utilities for preparing inputs to / reading outputs from
 * the artifact editor graph.
 *
 * Used by:
 * - spec-processing repair nodes (repair-artifacts/index.ts)
 * - sim assistant repair bridge (repair-bridge.ts)
 */
import { extractSchemaFields } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/schema-utils.js';
import type { GameStateField } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/schema.js';

/**
 * Derive a human-readable schemaFields summary from the stateSchema
 * (planner field array or JSON Schema) for the coordinator prompt.
 */
export function deriveSchemaFieldsSummary(stateSchema: string): string {
  try {
    const parsed = JSON.parse(stateSchema);

    // GameStateField format: array of field definitions
    if (Array.isArray(parsed)) {
      return (parsed as GameStateField[]).map(f => {
        const prefix = f.path === 'game' ? 'game.' : 'players.*.';
        const name = f.name.startsWith('game.') || f.name.startsWith('players.')
          ? f.name
          : `${prefix}${f.name}`;
        const desc = f.purpose ? ` (${f.purpose})` : '';
        return `${name}: ${f.type}${desc}`;
      }).join('\n');
    }

    // JSON Schema format: use extractSchemaFields for paths
    const fields = extractSchemaFields(parsed);
    return [...fields].sort().join('\n');
  } catch {
    return stateSchema || '';
  }
}

/**
 * Parse instruction maps from runtime/spec-processing format
 * (Record<string, string> where each value is a JSON string)
 * into artifact editor format (Record<string, unknown> where each
 * value is a parsed object).
 */
export function parseInstructionMap(map: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(map)) {
    try {
      result[key] = typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Serialize instruction maps from artifact editor format
 * (Record<string, unknown>) back to runtime/spec-processing format
 * (Record<string, string> where each value is a JSON string).
 */
export function serializeInstructionMap(map: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    result[key] = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
  return result;
}
