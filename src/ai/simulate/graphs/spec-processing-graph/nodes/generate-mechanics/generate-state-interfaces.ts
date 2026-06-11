/**
 * generate-state-interfaces node
 *
 * Deterministic (no LLM) conversion of GameStateField[] → TypeScript interface source.
 * Sits between extract_schema and extract_transitions in the spec-processing graph.
 */

import { SYSTEM_CONTROLLED_FIELDS } from '../extract-schema/schema.js';
import type { FieldType, GameStateField } from '../extract-schema/schema.js';
import type { ActionDefinition, ActionInputField } from '../extract-action-definitions/schema.js';

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
 * PascalCase a dot-path or camelCase name for use as an interface name.
 * "currentBid" → "CurrentBid", "lastChallengeResult" → "LastChallengeResult"
 */
function pascalCase(name: string): string {
  return name.replace(/(^|[._-])([a-z])/g, (_, _sep, c) => c.toUpperCase());
}

/** Collector for object sub-interfaces that need to be emitted before the main interfaces. */
type SubInterface = { name: string; body: string };

/**
 * Map a single GameStateField to its TypeScript type string.
 * When the field is type 'object', generates a named sub-interface and
 * pushes it to the collector array.
 */
function fieldToTsType(
  field: GameStateField,
  parentInterface: string,
  subInterfaces: SubInterface[],
): string {
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
      return `${fieldToTsType({ ...field, type: field.valueType, valueType: undefined } as GameStateField, parentInterface, subInterfaces)}[]`;
    }
    case 'record': {
      if (!field.valueType) return 'Record<string, unknown>';
      if (field.valueType === 'enum') {
        return `Record<string, ${enumUnion(field.enumValues)}>`;
      }
      const valType = fieldToTsType({ ...field, type: field.valueType, valueType: undefined } as GameStateField, parentInterface, subInterfaces);
      return `Record<string, ${valType}>`;
    }
    case 'object': {
      if (!field.fields || field.fields.length === 0) {
        return 'Record<string, unknown>';
      }
      const ifaceName = `${parentInterface}_${pascalCase(field.name)}`;
      const props = field.fields.map(sub => {
        const opt = sub.required === false ? '?' : '';
        // Sub-fields don't allow further object nesting (enforced by Zod schema)
        const subType = fieldToTsType(
          { ...sub, type: sub.type === 'object' ? 'record' as FieldType : sub.type },
          ifaceName,
          subInterfaces,
        );
        return `  ${sub.name}${opt}: ${subType};`;
      }).join('\n');
      subInterfaces.push({ name: ifaceName, body: props });
      return ifaceName;
    }
    default:
      return 'unknown';
  }
}

/**
 * Render a single interface property line.
 */
function renderProperty(
  field: GameStateField,
  parentInterface: string,
  subInterfaces: SubInterface[],
): string {
  const optional = field.required === false ? '?' : '';
  return `  ${field.name}${optional}: ${fieldToTsType(field, parentInterface, subInterfaces)};`;
}

/**
 * Map an ActionInputField type to a TypeScript type string.
 */
function actionInputFieldToTsType(field: ActionInputField): string {
  switch (field.type) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'enum':
      return field.enumValues && field.enumValues.length > 0
        ? field.enumValues.map(v => `"${v.replace(/"/g, '\\"')}"`).join(' | ')
        : 'string';
    default:
      return 'unknown';
  }
}

/**
 * Generate a TypeScript discriminated union type for player.currentAction
 * from the ActionDefinitionsArtifact.
 */
function generateCurrentActionType(actions: ActionDefinition[]): string {
  if (actions.length === 0) {
    return 'export type CurrentAction = Record<string, unknown> | null;';
  }

  const variants = actions.map(action => {
    if (action.inputFields.length === 0) {
      return `  | { type: "${action.id}" }`;
    }
    const fields = action.inputFields.map(f => {
      const tsType = actionInputFieldToTsType(f);
      const optional = f.required ? '' : '?';
      return `    ${f.name}${optional}: ${tsType};`;
    }).join('\n');
    return `  | { type: "${action.id}";\n${fields}\n    }`;
  });

  return `export type CurrentAction =\n${variants.join('\n')}\n  | null;`;
}

/**
 * Deterministically convert GameStateField[] to TypeScript interface source code.
 *
 * Produces: GameState, PlayerState, MechanicState, CallLLM, RollDice, GenerateImage, and MechanicResult
 * interfaces/types matching the design document §5 contract.
 */
export function generateStateInterfaces(fields: GameStateField[], actionDefinitions?: ActionDefinition[]): string {
  const gameFields = fields.filter(f => f.path === 'game');
  // Exclude platform-owned player fields — they are hardcoded below with their canonical types.
  // This prevents a schema artifact that mis-types these fields (e.g. actionsAllowed as array)
  // from corrupting the generated PlayerState and causing tsc errors in generated mechanics.
  const PLATFORM_PLAYER_FIELDS = new Set([
    'currentAction',    // hardcoded below as CurrentAction | null
    'actionRequired',   // boolean
    'actionsAllowed',   // boolean | null
    'illegalActionCount', // number
    'privateMessage',   // string | null
    'isGameWinner',     // boolean
  ]);
  const playerFields = fields.filter(f => f.path === 'player' && !PLATFORM_PLAYER_FIELDS.has(f.name));

  const subInterfaces: SubInterface[] = [];

  const gameProps = gameFields.map(f => renderProperty(f, 'GameState', subInterfaces)).join('\n');
  const playerProps = playerFields.map(f => renderProperty(f, 'PlayerState', subInterfaces)).join('\n');

  // Collect system-controlled game field names for Omit type
  const systemControlledGameFields = gameFields
    .filter(f => f.systemControlled || SYSTEM_CONTROLLED_FIELDS.has(f.name))
    .map(f => `'${f.name}'`);
  const systemControlledPlayerFields = playerFields
    .filter(f => f.systemControlled || SYSTEM_CONTROLLED_FIELDS.has(f.name))
    .map(f => `'${f.name}'`);

  const lines: string[] = [
    '// Auto-generated from stateSchema — DO NOT EDIT',
    '',
  ];

  // Emit CurrentAction discriminated union if action definitions provided
  const hasActionDefs = actionDefinitions && actionDefinitions.length > 0;
  if (hasActionDefs) {
    lines.push(generateCurrentActionType(actionDefinitions!));
    lines.push('');
  }

  // Emit sub-interfaces before the main interfaces that reference them
  for (const sub of subInterfaces) {
    lines.push(`export interface ${sub.name} {`);
    lines.push(sub.body);
    lines.push('}');
    lines.push('');
  }

  lines.push(
    'export interface GameState {',
    ...(gameProps ? [gameProps] : []),
    '}',
    '',
    'export interface PlayerState {',
    // Platform-owned fields — types are fixed regardless of schema artifact content.
    `  currentAction: ${hasActionDefs ? 'CurrentAction' : 'Record<string, unknown> | null'};`,
    '  actionRequired: boolean;',
    '  actionsAllowed: boolean | null;',
    '  illegalActionCount: number;',
    '  privateMessage: string | null;',
    '  isGameWinner: boolean;',
    ...(playerProps ? [playerProps] : []),
    '}',
    '',
  );

  // Emit writable types that exclude system-controlled fields
  if (systemControlledGameFields.length > 0) {
    lines.push(
      `/** GameState fields writable by mechanics (excludes router-managed fields). */`,
      `type GameStateUpdate = Omit<GameState, ${systemControlledGameFields.join(' | ')}>;`,
      '',
    );
  }
  if (systemControlledPlayerFields.length > 0) {
    lines.push(
      `/** PlayerState fields writable by mechanics (excludes router-managed fields). */`,
      `type PlayerStateUpdate = Omit<PlayerState, ${systemControlledPlayerFields.join(' | ')}>;`,
      '',
    );
  }

  const gameResultType = systemControlledGameFields.length > 0
    ? 'Partial<GameStateUpdate>'
    : 'Partial<GameState>';
  const playerResultType = systemControlledPlayerFields.length > 0
    ? 'Partial<PlayerStateUpdate>'
    : 'Partial<PlayerState>';

  // Derive the writable type names for setter generics
  const writableGameType = systemControlledGameFields.length > 0 ? 'GameStateUpdate' : 'GameState';
  const writablePlayerType = systemControlledPlayerFields.length > 0 ? 'PlayerStateUpdate' : 'PlayerState';

  lines.push(
    'export interface MechanicState {',
    '  game: GameState;',
    '  [playerAlias: `player${number}`]: PlayerState;',
    '}',
    '',
    'export type CallLLM = (prompt: string) => Promise<string>;',
    '',
    '/**',
    ' * Roll a die with values from min to max (inclusive).',
    ' * Uses a seeded/auditable RNG — results are logged for replay & fairness proofs.',
    ' * Prefer this over Math.random() for all game-affecting randomness.',
    ' */',
    'export type RollDice = (min: number, max: number) => number;',
    '',
    '/**',
    ' * Generate an image from a descriptive prompt. Returns the image URL.',
    ' * Use for gameplay scene images, combat visuals, commemorative scenes, etc.',
    ' * Pass a vivid 2-4 sentence description of the visual scene to render.',
    ' */',
    'export type GenerateImage = (prompt: string) => Promise<string>;',
    '',
    '/**',
    ' * Opaque result builder. Use setGame/setPlayer to record changes.',
    ' * Direct property assignment is not permitted — tsc will reject it.',
    ' */',
    'export declare class MechanicResult {',
    '  private constructor();',
    '}',
    '',
    '/**',
    ' * Set a game-level field in the result.',
    ' * Field must be a literal key of GameState — tsc rejects dynamic/interpolated keys.',
    ' */',
    `export declare function setGame<K extends keyof ${writableGameType}>(field: K, value: ${writableGameType}[K] | null): void;`,
    '',
    '/**',
    ' * Read a game-level field from the current state.',
    ' */',
    'export declare function getGame<K extends keyof GameState>(field: K): GameState[K];',
    '',
    '/**',
    ' * Set a per-player field in the result.',
    ' * field must be a literal key of PlayerState — tsc rejects dynamic/interpolated keys.',
    ' * playerAlias is the aliased name used in MechanicState (e.g. "player1", "player2").',
    ' */',
    `export declare function setPlayer<K extends keyof ${writablePlayerType}>(playerAlias: string, field: K, value: ${writablePlayerType}[K] | null): void;`,
    '',
    '/**',
    ' * Read a per-player field from the current state.',
    ' */',
    'export declare function getPlayer<K extends keyof PlayerState>(playerAlias: string, field: K): PlayerState[K];',
    '',
    '/**',
    ' * Set a public message visible to all players.',
    ' */',
    'export declare function setPublicMessage(message: string): void;',
    '',
    '/**',
    ' * Send a private message to a specific player.',
    ' */',
    'export declare function setPrivateMessage(playerAlias: string, message: string): void;',
    '',
    '/**',
    ' * Mark a player action as illegal. Rejects the action with an error message.',
    ' * No state changes will be applied when this is called.',
    ' */',
    'export declare function rejectAction(errorMessage: string): void;',
    '',
    '/**',
    ' * Build and return the final MechanicResult. Must be the last call.',
    ' */',
    'export declare function buildResult(): MechanicResult;',
    '',
  );

  return lines.join('\n');
}
