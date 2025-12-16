/**
 * Generate test fixtures for runtime testing
 * 
 * This script runs the full artifact generation pipeline (schema → transitions → instructions)
 * for each game spec and saves the results as JSON fixtures.
 * 
 * Usage: npm run fixtures:generate
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Always write fixtures to src directory, not dist
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'src', 'ai', 'simulate', 'test', 'fixtures');
import { createSpecProcessingGraph } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/index.js';
import type { GameSpecification } from '#chaincraft/api/design/schemas.js';

interface GameFixtureMetadata {
  generated: string; // ISO timestamp
  version: string; // artifact schema version
  game: string; // game name
  generator: string; // "extract-schema", "extract-transitions", "extract-instructions"
}

interface GameFixture {
  metadata: GameFixtureMetadata;
  spec: GameSpecification;
  schema: any;
  transitions: any;
  instructions: any;
  initialState: any;
}

/**
 * Game specs to generate fixtures for
 */
const GAME_SPECS: Array<{ name: string; spec: GameSpecification }> = [
  {
    name: 'rps',
    spec: {
      summary: 'Rock Paper Scissors - Classic hand game for two players',
      playerCount: { min: 2, max: 2 },
      designSpecification: `# Rock Paper Scissors

## Game Overview
Classic hand game for two players where they simultaneously choose rock, paper, or scissors.

## Setup Phase
Before gameplay begins:
- Initialize both players' scores to 0
- Set round number to 1
- Mark both players as ready to submit choices
- Set initial game phase to allow player actions

## Gameplay Flow
Players simultaneously choose rock, paper, or scissors. Rock beats scissors, scissors beats paper, paper beats rock. First to 3 wins.

## Rules
- Each player chooses one move per round
- Moves are revealed simultaneously
- Rock beats scissors, scissors beats paper, paper beats rock
- Winner gets 1 point, draw means no points
- First player to 3 points wins the game

## Win Conditions
- First player to score 3 points wins

## Turn Structure
Simultaneous - both players choose at the same time

## Phases
1. Players make choices
2. Choices revealed and round scored
3. Continue or end game based on scores`,
      version: 1
    }
  },
  {
    name: 'oracle',
    spec: {
      summary: 'The Oracle - A narrative game about seeking wisdom from a mysterious oracle',
      playerCount: { min: 1, max: 1 },
      designSpecification: `# The Oracle

## Game Overview
A narrative game about seeking wisdom from a mysterious oracle through dialogue and trust-building.

## Gameplay Flow
Player seeks wisdom from an oracle. Through dialogue, offering gifts, and building trust, the player receives prophecies and insights. The oracle's mood affects responses. High trust leads to profound revelations.

## Rules
- Player can speak freely to the oracle
- Oracle responds based on its mood (calm, irritable, cryptic)
- Trust increases with respectful dialogue and gifts
- Trust decreases with rude behavior or impatience
- Oracle's wisdom becomes more profound as trust grows

## Win Conditions
- Reach trust level 80+ to receive the final wisdom
- Trust falls below 20 and oracle dismisses you (loss)

## Turn Structure
Player-driven - player chooses when to speak, offer gifts, or leave

## Phases
1. Player greets oracle and establishes initial trust
2. Player engages in dialogue, potentially offering gifts
3. Oracle responds based on mood and trust level
4. Trust level determines quality of wisdom shared
5. Game ends when trust threshold reached (win/loss) or player leaves`,
      version: 1
    }
  }
];

/**
 * Generate initial state from schema
 */
function generateInitialState(schema: any): any {
  const initialState: any = {};
  
  for (const [key, prop] of Object.entries(schema.properties || {})) {
    const property = prop as any;
    
    if (property.default !== undefined) {
      initialState[key] = property.default;
    } else if (property.type === 'number' || property.type === 'integer') {
      initialState[key] = 0;
    } else if (property.type === 'string') {
      initialState[key] = '';
    } else if (property.type === 'boolean') {
      initialState[key] = false;
    } else if (property.type === 'array') {
      initialState[key] = [];
    } else if (property.type === 'object') {
      initialState[key] = {};
    }
  }
  
  return initialState;
}

/**
 * Generate fixture for a single game
 */
async function generateGameFixture(gameName: string, spec: GameSpecification): Promise<void> {
  console.log(`\n📦 Generating fixture for: ${gameName}`);
  console.log(`  Spec: ${spec.summary}`);
  
  // Create and run the full spec processing graph (includes validation)
  console.log('  🔍 Running spec processing graph...');
  const graph = await createSpecProcessingGraph();
  const result = await graph.invoke({
    gameSpecification: JSON.stringify(spec),
    gameRules: '',
    stateSchema: '',
    stateTransitions: '',
    playerPhaseInstructions: {},
    transitionInstructions: {},
    exampleState: ''
  });
  
  if (!result.stateSchema) {
    throw new Error(`Schema extraction failed for ${gameName}`);
  }
  
  if (!result.stateTransitions) {
    throw new Error(`Transitions extraction failed for ${gameName}`);
  }
  
  if (!result.playerPhaseInstructions || Object.keys(result.playerPhaseInstructions).length === 0) {
    throw new Error(`Instructions extraction failed for ${gameName}`);
  }
  
  // Parse results
  const schema = typeof result.stateSchema === 'string' 
    ? JSON.parse(result.stateSchema) 
    : result.stateSchema;
  
  const transitions = typeof result.stateTransitions === 'string'
    ? JSON.parse(result.stateTransitions)
    : result.stateTransitions;
    
  const instructions = {
    playerPhases: result.playerPhaseInstructions || {},
    transitions: result.transitionInstructions || {}
  };
  
  console.log(`  ✅ Schema: ${Object.keys(schema.properties || {}).length} properties`);
  console.log(`  ✅ Transitions: ${transitions.transitions?.length || 0} total`);
  console.log(`  ✅ Instructions: ${Object.keys(instructions.playerPhases).length} player phases, ${Object.keys(instructions.transitions).length} transitions`);
  
  // Generate initial state
  const initialState = generateInitialState(schema);
  console.log(`  ✅ Initial state: ${Object.keys(initialState).length} properties`);
  
  // Create fixture object
  const fixture: GameFixture = {
    metadata: {
      generated: new Date().toISOString(),
      version: '1.0.0',
      game: gameName,
      generator: 'generate-test-fixtures.ts'
    },
    spec,
    schema,
    transitions,
    instructions,
    initialState
  };
  
  // Save to file
  const fixtureDir = path.join(FIXTURES_DIR, 'games', gameName);
  await fs.mkdir(fixtureDir, { recursive: true });
  
  const fixturePath = path.join(fixtureDir, 'artifacts.json');
  await fs.writeFile(fixturePath, JSON.stringify(fixture, null, 2), 'utf-8');
  
  console.log(`  💾 Saved to: ${fixturePath}`);
  console.log(`  ✅ Fixture generation complete for ${gameName}`);
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting test fixture generation...');
  console.log(`📋 Generating fixtures for ${GAME_SPECS.length} games\n`);
  
  for (const { name, spec } of GAME_SPECS) {
    try {
      await generateGameFixture(name, spec);
    } catch (error) {
      console.error(`❌ Failed to generate fixture for ${name}:`, error);
      process.exit(1);
    }
  }
  
  console.log('\n✅ All fixtures generated successfully!');
  console.log(`📁 Fixtures saved to: src/ai/simulate/test/fixtures/games/`);
}

main();
