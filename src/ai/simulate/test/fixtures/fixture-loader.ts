/**
 * Fixture loader utilities for runtime testing
 * 
 * Provides helper functions to load game fixtures and specs without
 * running full LLM generation in every test.
 */

import fs from 'fs/promises';
import path from 'path';
import type { GameSpecification } from '#chaincraft/api/design/schemas.js';

/**
 * Complete game fixture with all artifacts
 */
export interface GameFixture {
  metadata: {
    generated: string;
    version: string;
    game: string;
    generator: string;
  };
  spec: GameSpecification;
  schema: any;
  transitions: any;
  instructions: any;
  initialState: any;
}

/**
 * Load a complete game fixture by name
 * 
 * @param gameName - Name of the game (e.g., 'rps', 'oracle')
 * @returns Complete fixture with spec, schema, transitions, instructions, initialState
 * @throws Error if fixture not found or invalid JSON
 * 
 * @example
 * const rpsFixture = await loadGameFixture('rps');
 * expect(rpsFixture.spec.name).toBe('Rock Paper Scissors');
 * expect(rpsFixture.schema.properties).toBeDefined();
 */
export async function loadGameFixture(gameName: string): Promise<GameFixture> {
  const fixturePath = path.join(
    process.cwd(),
    'src',
    'ai',
    'simulate',
    'test',
    'fixtures',
    'games',
    gameName,
    'artifacts.json'
  );
  
  try {
    const content = await fs.readFile(fixturePath, 'utf-8');
    const fixture = JSON.parse(content) as GameFixture;
    
    // Basic validation
    if (!fixture.metadata || !fixture.spec || !fixture.schema) {
      throw new Error(`Invalid fixture structure in ${fixturePath}`);
    }
    
    return fixture;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Fixture not found for game "${gameName}". ` +
        `Run "npm run fixtures:generate" to create fixtures.`
      );
    }
    throw error;
  }
}

/**
 * Load just the game spec (no artifacts)
 * 
 * @param gameName - Name of the game
 * @returns GameSpecification object
 * 
 * @example
 * const spec = await loadGameSpec('rps');
 * expect(spec.summary).toBeDefined();
 */
export async function loadGameSpec(gameName: string): Promise<GameSpecification> {
  const fixture = await loadGameFixture(gameName);
  return fixture.spec;
}

/**
 * Load just the schema artifact
 * 
 * @param gameName - Name of the game
 * @returns JSON schema object
 */
export async function loadGameSchema(gameName: string): Promise<any> {
  const fixture = await loadGameFixture(gameName);
  return fixture.schema;
}

/**
 * Load just the transitions artifact
 * 
 * @param gameName - Name of the game
 * @returns Transitions object
 */
export async function loadGameTransitions(gameName: string): Promise<any> {
  const fixture = await loadGameFixture(gameName);
  return fixture.transitions;
}

/**
 * Load just the instructions artifact
 * 
 * @param gameName - Name of the game
 * @returns Instructions object
 */
export async function loadGameInstructions(gameName: string): Promise<any> {
  const fixture = await loadGameFixture(gameName);
  return fixture.instructions;
}

/**
 * Load just the initial state
 * 
 * @param gameName - Name of the game
 * @returns Initial state object
 */
export async function loadGameInitialState(gameName: string): Promise<any> {
  const fixture = await loadGameFixture(gameName);
  return fixture.initialState;
}

/**
 * List all available game fixtures
 * 
 * @returns Array of game names
 */
export async function listAvailableFixtures(): Promise<string[]> {
  const fixturesDir = path.join(process.cwd(), 'src', 'ai', 'simulate', 'test', 'fixtures', 'games');
  
  try {
    const entries = await fs.readdir(fixturesDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Check if a fixture exists
 * 
 * @param gameName - Name of the game
 * @returns True if fixture exists
 */
export async function fixtureExists(gameName: string): Promise<boolean> {
  const fixturePath = path.join(
    process.cwd(),
    'src',
    'ai',
    'simulate',
    'test',
    'fixtures',
    'games',
    gameName,
    'artifacts.json'
  );
  
  try {
    await fs.access(fixturePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get fixture metadata without loading full fixture
 * 
 * @param gameName - Name of the game
 * @returns Metadata object
 */
export async function getFixtureMetadata(gameName: string): Promise<GameFixture['metadata']> {
  const fixture = await loadGameFixture(gameName);
  return fixture.metadata;
}
