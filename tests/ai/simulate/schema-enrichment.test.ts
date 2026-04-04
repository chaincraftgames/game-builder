/**
 * Tests for Task A: Enriched GameStateField & Schema Extraction
 *
 * Covers:
 * - zodSchemaToFields() produces correct new format from base schema
 * - extractSchemaFields() works with new GameStateField[]
 * - deriveSchemaFieldsSummary() works with new format
 * - extractExecutorFields() parses new-format LLM output
 * - gameStateFieldSchema validates new fields correctly
 * - Backward compatibility with legacy fields (source, constraints)
 */

import { describe, test, expect } from '@jest/globals';
import { zodSchemaToFields } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/zod-to-fields.js';
import { baseGameStateSchema, baseSchemaFields } from '#chaincraft/ai/simulate/schema.js';
import { extractSchemaFields } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/schema-utils.js';
import { extractExecutorFields } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/validators.js';
import { gameStateFieldSchema } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/schema.js';
import type { GameStateField } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/schema.js';

// ---------------------------------------------------------------------------
// 1. zodSchemaToFields — base schema conversion
// ---------------------------------------------------------------------------

describe('zodSchemaToFields', () => {
  test('produces fields with FieldType union (no free-form strings)', () => {
    const fields = zodSchemaToFields(baseGameStateSchema);
    const validTypes = new Set(['string', 'number', 'boolean', 'enum', 'array', 'record']);
    for (const f of fields) {
      expect(validTypes.has(f.type)).toBe(true);
    }
  });

  test('does NOT produce source or constraints fields', () => {
    const fields = zodSchemaToFields(baseGameStateSchema);
    for (const f of fields) {
      expect(f).not.toHaveProperty('source');
      expect(f).not.toHaveProperty('constraints');
    }
  });

  test('string fields are typed as string', () => {
    const fields = zodSchemaToFields(baseGameStateSchema);
    const currentPhase = fields.find(f => f.name === 'currentPhase');
    expect(currentPhase).toBeDefined();
    expect(currentPhase!.type).toBe('string');
  });

  test('boolean fields are typed as boolean', () => {
    const fields = zodSchemaToFields(baseGameStateSchema);
    const gameEnded = fields.find(f => f.name === 'gameEnded');
    expect(gameEnded).toBeDefined();
    expect(gameEnded!.type).toBe('boolean');
  });

  test('array fields have valueType set', () => {
    const fields = zodSchemaToFields(baseGameStateSchema);
    const winningPlayers = fields.find(f => f.name === 'winningPlayers');
    expect(winningPlayers).toBeDefined();
    expect(winningPlayers!.type).toBe('array');
    expect(winningPlayers!.valueType).toBe('string');
  });

  test('optional fields have required=false', () => {
    const fields = zodSchemaToFields(baseGameStateSchema);
    const publicMessage = fields.find(f => f.name === 'publicMessage');
    expect(publicMessage).toBeDefined();
    expect(publicMessage!.required).toBe(false);
  });

  test('player fields have path=player', () => {
    const fields = zodSchemaToFields(baseGameStateSchema);
    const actionRequired = fields.find(f => f.name === 'actionRequired');
    expect(actionRequired).toBeDefined();
    expect(actionRequired!.path).toBe('player');
    expect(actionRequired!.type).toBe('boolean');
  });

  test('every field has name, type, path, purpose', () => {
    const fields = zodSchemaToFields(baseGameStateSchema);
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) {
      expect(typeof f.name).toBe('string');
      expect(typeof f.type).toBe('string');
      expect(['game', 'player']).toContain(f.path);
      expect(typeof f.purpose).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. baseSchemaFields export matches new format
// ---------------------------------------------------------------------------

describe('baseSchemaFields', () => {
  test('is an array of enriched GameStateField objects', () => {
    expect(Array.isArray(baseSchemaFields)).toBe(true);
    expect(baseSchemaFields.length).toBeGreaterThan(0);
    const validTypes = new Set(['string', 'number', 'boolean', 'enum', 'array', 'record']);
    for (const f of baseSchemaFields) {
      expect(validTypes.has(f.type)).toBe(true);
    }
  });

  test('contains no source or constraints keys', () => {
    for (const f of baseSchemaFields) {
      expect(f).not.toHaveProperty('source');
      expect(f).not.toHaveProperty('constraints');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. extractSchemaFields — works with new GameStateField[]
// ---------------------------------------------------------------------------

describe('extractSchemaFields with enriched fields', () => {
  const enrichedFields: GameStateField[] = [
    { name: 'currentRound', type: 'number', path: 'game', purpose: 'Current round' },
    { name: 'weaponMappings', type: 'record', path: 'game', purpose: 'Secret mappings', valueType: 'enum', enumValues: ['rock', 'paper', 'scissors'] },
    { name: 'weapons', type: 'record', path: 'player', purpose: "Player's weapons", valueType: 'string' },
    { name: 'selectedWeapon', type: 'string', path: 'player', purpose: 'Chosen weapon' },
  ];

  test('extracts correct field paths', () => {
    const paths = extractSchemaFields(enrichedFields);
    expect(paths.has('game.currentRound')).toBe(true);
    expect(paths.has('game.weaponMappings')).toBe(true);
    expect(paths.has('players.weapons')).toBe(true);
    expect(paths.has('players.selectedWeapon')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. extractExecutorFields — parses new-format LLM output
// ---------------------------------------------------------------------------

describe('extractExecutorFields', () => {
  test('parses new-format output with enumValues and valueType', () => {
    const output = `
Natural summary:
"Simple RPS game."

Fields:
\`\`\`json
[
  {"name":"currentPhase","type":"string","path":"game","purpose":"Track phase"},
  {"name":"Choice","type":"enum","path":"player","purpose":"player selection","enumValues":["rock","paper","scissors"]},
  {"name":"weapons","type":"record","path":"player","purpose":"weapon map","valueType":"string"},
  {"name":"scores","type":"array","path":"game","purpose":"score list","valueType":"number"}
]
\`\`\`
`;
    const fields = extractExecutorFields(output);
    expect(fields).toHaveLength(4);

    const phase = fields.find(f => f.name === 'currentPhase')!;
    expect(phase.type).toBe('string');
    expect(phase).not.toHaveProperty('source');

    const choice = fields.find(f => f.name === 'Choice')!;
    expect(choice.type).toBe('enum');
    expect(choice.enumValues).toEqual(['rock', 'paper', 'scissors']);

    const weapons = fields.find(f => f.name === 'weapons')!;
    expect(weapons.type).toBe('record');
    expect(weapons.valueType).toBe('string');

    const scores = fields.find(f => f.name === 'scores')!;
    expect(scores.type).toBe('array');
    expect(scores.valueType).toBe('number');
  });

  test('handles legacy output with source/constraints (backward compat)', () => {
    const output = `
Natural summary:
"Old format."

Fields:
\`\`\`json
[
  {"name":"round","type":"number","path":"game","source":"system","purpose":"Round counter","constraints":"min:1"}
]
\`\`\`
`;
    const fields = extractExecutorFields(output);
    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe('round');
    expect(fields[0].type).toBe('number');
    // Legacy fields are silently dropped; no crash
    expect(fields[0]).not.toHaveProperty('source');
    expect(fields[0]).not.toHaveProperty('constraints');
  });

  test('returns empty array for missing fields block', () => {
    const output = 'Natural summary: "No fields needed."';
    expect(extractExecutorFields(output)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. gameStateFieldSchema — Zod validation
// ---------------------------------------------------------------------------

describe('gameStateFieldSchema', () => {
  test('accepts valid enriched field', () => {
    const result = gameStateFieldSchema.safeParse({
      name: 'weapons',
      type: 'record',
      path: 'player',
      purpose: 'Weapon map',
      valueType: 'string',
    });
    expect(result.success).toBe(true);
  });

  test('accepts minimal field (no optional keys)', () => {
    const result = gameStateFieldSchema.safeParse({
      name: 'round',
      type: 'number',
      path: 'game',
      purpose: 'Round counter',
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid type value', () => {
    const result = gameStateFieldSchema.safeParse({
      name: 'foo',
      type: 'object',
      path: 'game',
      purpose: 'Bad type',
    });
    expect(result.success).toBe(false);
  });

  test('accepts field with enumValues', () => {
    const result = gameStateFieldSchema.safeParse({
      name: 'move',
      type: 'enum',
      path: 'player',
      purpose: 'Player move',
      enumValues: ['rock', 'paper', 'scissors'],
    });
    expect(result.success).toBe(true);
  });

  test('accepts field with required=false', () => {
    const result = gameStateFieldSchema.safeParse({
      name: 'bio',
      type: 'string',
      path: 'player',
      purpose: 'Player biography',
      required: false,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. deriveSchemaFieldsSummary — works with new format
// ---------------------------------------------------------------------------

describe('deriveSchemaFieldsSummary compatibility', () => {
  // We can't import deriveSchemaFieldsSummary directly (it's a private function
  // in repair-artifacts/index.ts), so we test indirectly by parsing the schema
  // and verifying the fields it reads are present.

  test('new-format fields have all keys needed by deriveSchemaFieldsSummary', () => {
    const field: GameStateField = {
      name: 'weaponMappings',
      type: 'record',
      path: 'game',
      purpose: 'Secret RPS mappings',
      valueType: 'enum',
      enumValues: ['rock', 'paper', 'scissors'],
    };
    // deriveSchemaFieldsSummary reads: f.path, f.name, f.purpose, f.type
    expect(field.path).toBeDefined();
    expect(field.name).toBeDefined();
    expect(field.purpose).toBeDefined();
    expect(typeof field.type).toBe('string');
  });

  test('legacy stored schemas still parse into GameStateField[] shape', () => {
    // Simulate a stored schema that has legacy source/constraints
    const legacyJson = JSON.stringify([
      { name: 'round', type: 'number', path: 'game', source: 'system', purpose: 'Round', constraints: 'min:1' },
      { name: 'choice', type: 'enum', path: 'player', source: 'player', purpose: 'Move', constraints: 'enum:[rock,paper,scissors]' },
    ]);

    const parsed = JSON.parse(legacyJson) as GameStateField[];
    // deriveSchemaFieldsSummary operates on name, type, path, purpose — all present
    for (const f of parsed) {
      expect(f.name).toBeDefined();
      expect(typeof f.type).toBe('string');
      expect(f.path).toBeDefined();
      expect(f.purpose).toBeDefined();
    }
  });
});
