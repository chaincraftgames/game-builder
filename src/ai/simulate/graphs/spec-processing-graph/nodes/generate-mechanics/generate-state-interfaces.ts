/**
 * generate-state-interfaces node
 *
 * Deterministic (no LLM) conversion of GameStateField[] → TypeScript interface source.
 * Sits between extract_schema and extract_transitions in the spec-processing graph.
 */

import type { FieldType, GameStateField } from '../extract-schema/schema.js';

export type { FieldType, GameStateField };

// ---------------------------------------------------------------------------

/**
 * Escape a string for use inside a TypeScript string-literal type (double-quoted).
 * Handles backslash, double-quote, newline, carriage return, and tab.
 */
function escapeEnumValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Build a union-of-string-literals type expression from enumValues.
 * Falls back to `string` when enumValues is empty or missing.
 */
function enumUnion(enumValues: string[] | undefined): string {
  if (!enumValues || enumValues.length === 0) return 'string';
  return enumValues.map(v => `"${escapeEnumValue(v)}"`).join(' | ');
}

/**
 * Map a single GameStateField to its TypeScript type string.
 */
function fieldToTsType(field: GameStateField): string {
  switch (field.type) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'enum':
      return enumUnion(field.enumValues);
    case 'array': {
      if (!field.valueType) return 'unknown[]';
      if (field.valueType === 'enum') {
        const inner = enumUnion(field.enumValues);
        // Wrap compound union in parens for array syntax
        return field.enumValues && field.enumValues.length > 1
          ? `(${inner})[]`
          : `${inner}[]`;
      }
      return `${fieldToTsType({ ...field, type: field.valueType } as GameStateField)}[]`;
    }
    case 'record': {
      if (!field.valueType) return 'Record<string, unknown>';
      if (field.valueType === 'enum') {
        return `Record<string, ${enumUnion(field.enumValues)}>`;
      }
      const valType = fieldToTsType({ ...field, type: field.valueType } as GameStateField);
      return `Record<string, ${valType}>`;
    }
    default:
      return 'unknown';
  }
}

/**
 * Render a single interface property line.
 */
function renderProperty(field: GameStateField): string {
  const optional = field.required === false ? '?' : '';
  return `  ${field.name}${optional}: ${fieldToTsType(field)};`;
}

/**
 * Deterministically convert GameStateField[] to TypeScript interface source code.
 *
 * Produces: GameState, PlayerState, MechanicState, CallLLM, and MechanicResult
 * interfaces/types matching the design document §5 contract.
 */
export function generateStateInterfaces(fields: GameStateField[]): string {
  const gameFields = fields.filter(f => f.path === 'game');
  const playerFields = fields.filter(f => f.path === 'player');

  const gameProps = gameFields.map(renderProperty).join('\n');
  const playerProps = playerFields.map(renderProperty).join('\n');

  const lines: string[] = [
    '// Auto-generated from stateSchema — DO NOT EDIT',
    '',
    'export interface GameState {',
    ...(gameProps ? [gameProps] : []),
    '}',
    '',
    'export interface PlayerState {',
    ...(playerProps ? [playerProps] : []),
    '}',
    '',
    'export interface MechanicState {',
    '  game: GameState;',
    '  [playerAlias: `player${number}`]: PlayerState;',
    '}',
    '',
    'export type CallLLM = (prompt: string) => Promise<string>;',
    '',
    'export interface MechanicResult {',
    '  game?: Partial<GameState>;',
    '  [playerAlias: `player${number}`]: Partial<PlayerState>;',
    '  publicMessage?: string;',
    '  privateMessages?: Record<string, string>;',
    '}',
    '',
  ];

  return lines.join('\n');
}
