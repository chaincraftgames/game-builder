import { describe, test, expect } from '@jest/globals';
import ts from 'typescript';
import {
  generateStateInterfaces,
  GameStateField,
} from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/generate-state-interfaces.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert the output is syntactically valid TypeScript using the compiler API. */
function assertValidTypeScript(source: string): void {
  const sf = ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true);
  const diagnostics = (sf as any).parseDiagnostics as ts.DiagnosticWithLocation[] | undefined;
  if (diagnostics && diagnostics.length > 0) {
    const messages = diagnostics.map(d =>
      `  Line ${sf.getLineAndCharacterOfPosition(d.start!).line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`
    ).join('\n');
    throw new Error(`TypeScript syntax errors:\n${messages}\n\nSource:\n${source}`);
  }
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('generateStateInterfaces', () => {
  // -----------------------------------------------------------------------
  // 1. Simple / primitive fields
  // -----------------------------------------------------------------------
  test('simple fields — all primitive types produce correct TypeScript', () => {
    const fields: GameStateField[] = [
      { name: 'score', type: 'number', path: 'game', purpose: 'Total score' },
      { name: 'label', type: 'string', path: 'game', purpose: 'Label' },
      { name: 'active', type: 'boolean', path: 'game', purpose: 'Is active' },
      { name: 'health', type: 'number', path: 'player', purpose: 'HP' },
      { name: 'nickname', type: 'string', path: 'player', purpose: 'Display name' },
      { name: 'alive', type: 'boolean', path: 'player', purpose: 'Is alive' },
    ];

    const output = generateStateInterfaces(fields);

    // GameState should contain game-path fields
    expect(output).toContain('score: number;');
    expect(output).toContain('label: string;');
    expect(output).toContain('active: boolean;');

    // PlayerState should contain player-path fields
    expect(output).toContain('health: number;');
    expect(output).toContain('nickname: string;');
    expect(output).toContain('alive: boolean;');

    assertValidTypeScript(output);
  });

  // -----------------------------------------------------------------------
  // 2. Wacky Weapons canonical test case
  // -----------------------------------------------------------------------
  test('wacky weapons schema matches design doc output', () => {
    const fields: GameStateField[] = [
      { name: 'currentRound', type: 'number', path: 'game', purpose: 'Current round number' },
      { name: 'maxRounds', type: 'number', path: 'game', purpose: 'Total number of rounds' },
      { name: 'weaponMappings', type: 'record', path: 'game', purpose: 'Secret RPS mappings', valueType: 'enum', enumValues: ['rock', 'paper', 'scissors'] },
      { name: 'roundOutcome', type: 'string', path: 'game', purpose: 'Round outcome narrative' },
      { name: 'gameEnded', type: 'boolean', path: 'game', purpose: 'Whether the game has ended' },
      { name: 'winningPlayers', type: 'array', path: 'game', purpose: 'List of winning player IDs', valueType: 'string' },
      { name: 'publicMessages', type: 'array', path: 'game', purpose: 'Public message log', valueType: 'string' },
      { name: 'roundsWon', type: 'number', path: 'player', purpose: 'Rounds won by player' },
      { name: 'selectedWeapon', type: 'string', path: 'player', purpose: 'Current weapon selection' },
      { name: 'weapons', type: 'record', path: 'player', purpose: "Player's 3 weapons", valueType: 'string' },
      { name: 'ready', type: 'boolean', path: 'player', purpose: 'Player ready status' },
      { name: 'actionRequired', type: 'boolean', path: 'player', purpose: 'Whether action is needed' },
      { name: 'isGameWinner', type: 'boolean', path: 'player', purpose: 'Whether player won the game' },
    ];

    const output = generateStateInterfaces(fields);

    // Verify key type mappings from the design doc example
    expect(output).toContain('currentRound: number;');
    expect(output).toContain('maxRounds: number;');
    expect(output).toContain('weaponMappings: Record<string, "rock" | "paper" | "scissors">;');
    expect(output).toContain('roundOutcome: string;');
    expect(output).toContain('gameEnded: boolean;');
    expect(output).toContain('winningPlayers: string[];');
    expect(output).toContain('publicMessages: string[];');
    expect(output).toContain('roundsWon: number;');
    expect(output).toContain('selectedWeapon: string;');
    expect(output).toContain('weapons: Record<string, string>;');
    expect(output).toContain('ready: boolean;');
    expect(output).toContain('actionRequired: boolean;');
    expect(output).toContain('isGameWinner: boolean;');

    // Structural pieces
    expect(output).toContain('export interface GameState {');
    expect(output).toContain('export interface PlayerState {');
    expect(output).toContain('export interface MechanicState {');
    expect(output).toContain('export type CallLLM');
    expect(output).toContain('export interface MechanicResult {');
    expect(output).toContain('// Auto-generated from stateSchema — DO NOT EDIT');

    assertValidTypeScript(output);
  });

  // -----------------------------------------------------------------------
  // 3. Optional fields
  // -----------------------------------------------------------------------
  test('optional fields — required: false produces optional properties', () => {
    const fields: GameStateField[] = [
      { name: 'selectedWeapon', type: 'string', path: 'player', purpose: 'Weapon', required: false },
      { name: 'score', type: 'number', path: 'player', purpose: 'Score', required: true },
      { name: 'phase', type: 'string', path: 'game', purpose: 'Phase' },  // default true
    ];

    const output = generateStateInterfaces(fields);

    expect(output).toContain('selectedWeapon?: string;');
    expect(output).toContain('score: number;');
    expect(output).toContain('phase: string;');
    // Ensure required: true doesn't produce ?
    expect(output).not.toContain('score?');
    expect(output).not.toContain('phase?');

    assertValidTypeScript(output);
  });

  // -----------------------------------------------------------------------
  // 4. Enum at all levels
  // -----------------------------------------------------------------------
  test('enum at all levels — top-level, array element, record value', () => {
    const fields: GameStateField[] = [
      { name: 'status', type: 'enum', path: 'game', purpose: 'Game status', enumValues: ['waiting', 'active', 'finished'] },
      { name: 'moves', type: 'array', path: 'player', purpose: 'Move history', valueType: 'enum', enumValues: ['rock', 'paper', 'scissors'] },
      { name: 'mapping', type: 'record', path: 'game', purpose: 'Weapon mapping', valueType: 'enum', enumValues: ['rock', 'paper', 'scissors'] },
    ];

    const output = generateStateInterfaces(fields);

    expect(output).toContain('status: "waiting" | "active" | "finished";');
    expect(output).toContain('moves: ("rock" | "paper" | "scissors")[];');
    expect(output).toContain('mapping: Record<string, "rock" | "paper" | "scissors">;');

    assertValidTypeScript(output);
  });

  // -----------------------------------------------------------------------
  // 5. Empty / missing valueType fallback
  // -----------------------------------------------------------------------
  test('empty/missing valueType — array → unknown[], record → Record<string, unknown>', () => {
    const fields: GameStateField[] = [
      { name: 'items', type: 'array', path: 'game', purpose: 'Generic items' },
      { name: 'data', type: 'record', path: 'game', purpose: 'Generic data' },
    ];

    const output = generateStateInterfaces(fields);

    expect(output).toContain('items: unknown[];');
    expect(output).toContain('data: Record<string, unknown>;');

    assertValidTypeScript(output);
  });

  // -----------------------------------------------------------------------
  // 6. Empty/missing enumValues for type: 'enum' falls back to string
  // -----------------------------------------------------------------------
  test('enum with empty or missing enumValues falls back to string', () => {
    const fields: GameStateField[] = [
      { name: 'color', type: 'enum', path: 'game', purpose: 'Color', enumValues: [] },
      { name: 'size', type: 'enum', path: 'game', purpose: 'Size' },
    ];

    const output = generateStateInterfaces(fields);

    expect(output).toContain('color: string;');
    expect(output).toContain('size: string;');

    assertValidTypeScript(output);
  });

  // -----------------------------------------------------------------------
  // 7. Enum values with special characters are escaped
  // -----------------------------------------------------------------------
  test('enum values with special characters are escaped', () => {
    const fields: GameStateField[] = [
      { name: 'label', type: 'enum', path: 'game', purpose: 'Label', enumValues: ['he said "hello"', 'back\\slash', 'new\nline'] },
    ];

    const output = generateStateInterfaces(fields);

    expect(output).toContain('"he said \\"hello\\""');
    expect(output).toContain('"back\\\\slash"');
    expect(output).toContain('"new\\nline"');

    assertValidTypeScript(output);
  });

  // -----------------------------------------------------------------------
  // 8. Duplicate field names across game/player — different interfaces
  // -----------------------------------------------------------------------
  test('duplicate field names across game/player go into different interfaces', () => {
    const fields: GameStateField[] = [
      { name: 'score', type: 'number', path: 'game', purpose: 'Game total' },
      { name: 'score', type: 'number', path: 'player', purpose: 'Player score' },
    ];

    const output = generateStateInterfaces(fields);

    // Both should be present; verify by checking they appear in their respective interfaces
    const gameMatch = output.match(/export interface GameState \{[\s\S]*?\}/);
    const playerMatch = output.match(/export interface PlayerState \{[\s\S]*?\}/);
    expect(gameMatch).not.toBeNull();
    expect(playerMatch).not.toBeNull();
    expect(gameMatch![0]).toContain('score: number;');
    expect(playerMatch![0]).toContain('score: number;');

    assertValidTypeScript(output);
  });

  // -----------------------------------------------------------------------
  // 9. Output compiles — ts.createSourceFile syntax check
  // -----------------------------------------------------------------------
  test('output compiles — complex schema produces valid TypeScript syntax', () => {
    const fields: GameStateField[] = [
      { name: 'round', type: 'number', path: 'game', purpose: 'Round' },
      { name: 'phase', type: 'enum', path: 'game', purpose: 'Phase', enumValues: ['setup', 'play', 'end'] },
      { name: 'log', type: 'array', path: 'game', purpose: 'Log', valueType: 'string' },
      { name: 'meta', type: 'record', path: 'game', purpose: 'Meta' },
      { name: 'hand', type: 'array', path: 'player', purpose: 'Cards', valueType: 'enum', enumValues: ['ace', 'king', 'queen'] },
      { name: 'stats', type: 'record', path: 'player', purpose: 'Stats', valueType: 'number' },
      { name: 'active', type: 'boolean', path: 'player', purpose: 'Active', required: false },
    ];

    const output = generateStateInterfaces(fields);
    // This will throw if syntax is invalid
    assertValidTypeScript(output);
  });

  // -----------------------------------------------------------------------
  // 10. Empty fields array — produces empty interfaces
  // -----------------------------------------------------------------------
  test('empty fields array — produces valid but empty interfaces', () => {
    const output = generateStateInterfaces([]);

    expect(output).toContain('export interface GameState {');
    expect(output).toContain('export interface PlayerState {');
    assertValidTypeScript(output);
  });

  // -----------------------------------------------------------------------
  // 11. Single enum value — no parens needed for array
  // -----------------------------------------------------------------------
  test('single enum value array — no unnecessary parens', () => {
    const fields: GameStateField[] = [
      { name: 'choices', type: 'array', path: 'game', purpose: 'Options', valueType: 'enum', enumValues: ['only'] },
    ];

    const output = generateStateInterfaces(fields);
    expect(output).toContain('choices: "only"[];');
    assertValidTypeScript(output);
  });

  // -----------------------------------------------------------------------
  // 12. Array/record with primitive valueType
  // -----------------------------------------------------------------------
  test('array and record with non-enum valueTypes', () => {
    const fields: GameStateField[] = [
      { name: 'scores', type: 'array', path: 'game', purpose: 'Scores', valueType: 'number' },
      { name: 'flags', type: 'array', path: 'game', purpose: 'Flags', valueType: 'boolean' },
      { name: 'counts', type: 'record', path: 'player', purpose: 'Counts', valueType: 'number' },
    ];

    const output = generateStateInterfaces(fields);

    expect(output).toContain('scores: number[];');
    expect(output).toContain('flags: boolean[];');
    expect(output).toContain('counts: Record<string, number>;');

    assertValidTypeScript(output);
  });
});
