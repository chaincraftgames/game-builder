#!/usr/bin/env node
/**
 * Import Game Script (LangGraph Checkpoints Only)
 * 
 * Imports LangGraph checkpoints from an exported game into local SQLite.
 * This includes:
 * 1. Injecting design checkpoint (conversation state, spec, narratives)
 * 2. Injecting artifacts checkpoint (schema, transitions, instructions)
 * 3. Validating the import was successful
 * 
 * Note: This script only handles LangGraph state. To create the Supabase games 
 * record, use the orchestrator import script or create manually via Supabase Studio.
 * 
 * Usage:
 *   ./internal-api.sh game-import --file data/exports/game-abc123-v2.json
 */

import "dotenv/config.js";
import { readFile } from "fs/promises";
import { getSaver } from "#chaincraft/ai/memory/checkpoint-memory.js";
import { getConfig } from "#chaincraft/config.js";
import { getCachedDesign } from "#chaincraft/ai/design/design-workflow.js";
import { getCachedSpecArtifacts } from "#chaincraft/ai/simulate/simulate-workflow.js";

// Color codes for terminal output
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

function printError(msg: string) {
  console.error(`${RED}✗ ${msg}${RESET}`);
}

function printSuccess(msg: string) {
  console.log(`${GREEN}✓ ${msg}${RESET}`);
}

function printInfo(msg: string) {
  console.log(`${BLUE}ℹ ${msg}${RESET}`);
}

function printWarning(msg: string) {
  console.log(`${YELLOW}⚠ ${msg}${RESET}`);
}

interface ExportedGame {
  metadata: {
    gameId: string;
    version: number;
    timestamp: string;
    hasArtifacts: boolean;
  };
  design: {
    title: string;
    specification?: {
      summary: string;
      playerCount: { min: number; max: number };
      designSpecification: string;
      version: number;
    };
    specNarratives?: Record<string, string>;
    pendingSpecChanges?: string[];
    consolidationThreshold?: number;
    consolidationCharLimit?: number;
  };
  artifacts?: {
    gameRules: string;
    stateSchema: string;
    stateTransitions: string;
    playerPhaseInstructions: Record<string, string>;
    transitionInstructions: Record<string, string>;
    specNarratives?: Record<string, string>;
  };
}

/**
 * Check if checkpoint already exists
 */
async function checkpointExists(threadId: string, graphType: string): Promise<boolean> {
  try {
    const saver = await getSaver(threadId, graphType);
    const config = { configurable: { thread_id: threadId } };
    const tuple = await saver.getTuple(config);
    return tuple !== undefined;
  } catch (error) {
    return false;
  }
}

/**
 * Inject design checkpoint into local LangGraph storage
 */
async function injectDesignCheckpoint(exportedGame: ExportedGame, force: boolean): Promise<void> {
  const { gameId } = exportedGame.metadata;
  const { design } = exportedGame;
  
  // Check if already exists
  const exists = await checkpointExists(gameId, getConfig("design-graph-type"));
  if (exists && !force) {
    printWarning(`Design checkpoint for game ${gameId} already exists`);
    printInfo('Skipping import. Use --force to overwrite existing checkpoint');
    return;
  }
  
  if (exists && force) {
    printWarning(`Overwriting existing design checkpoint for game ${gameId}`);
  }
  
  printInfo(`Injecting design checkpoint for game ${gameId}...`);
  
  // Get saver for design workflow
  const saver = await getSaver(gameId, getConfig("design-graph-type"));
  const config = { configurable: { thread_id: gameId } };
  
  // Create checkpoint state that matches GameDesignState structure
  const checkpointState = {
    title: design.title,
    currentSpec: design.specification,
    specNarratives: design.specNarratives,
    pendingSpecChanges: design.pendingSpecChanges?.map(change => ({ changes: change })),
    consolidationThreshold: design.consolidationThreshold,
    consolidationCharLimit: design.consolidationCharLimit,
    specVersion: design.specification?.version ?? 0,
    
    // Initialize required fields
    messages: [] as Array<{ type: string; content: string }>,
    systemPromptVersion: "imported",
    specUpdateNeeded: false,
    metadataUpdateNeeded: false,
  };
  
  // Create checkpoint structure
  const checkpoint = {
    v: 1,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    channel_values: checkpointState,
    channel_versions: {
      __start__: 1,
    },
    versions_seen: {
      __start__: {
        __start__: 1,
      },
    },
    pending_sends: [],
  };
  
  await saver.put(config, checkpoint as any, { source: "input", step: -1, parents: {} } as any, {});
  
  printSuccess(`Design checkpoint injected successfully`);
  
  // Initialize conversation with welcome message if no messages exist
  if (!checkpointState.messages || checkpointState.messages.length === 0) {
    printInfo(`Adding welcome message to imported conversation...`);
    checkpointState.messages = [{
      type: 'ai',
      content: `Welcome! This game "${design.title}" was imported from a previous export. I'm ready to help you continue developing it.`
    }];
    
    // Update the checkpoint with the message
    const updatedCheckpoint = {
      ...checkpoint,
      channel_values: checkpointState
    };
    await saver.put(config, updatedCheckpoint as any, { source: "input", step: -1, parents: {} } as any, {});
    printSuccess(`Welcome message added to conversation`);
  }
}

/**
 * Inject artifacts checkpoint into local LangGraph storage
 */
async function injectArtifactsCheckpoint(exportedGame: ExportedGame, force: boolean): Promise<void> {
  const { gameId, version, hasArtifacts } = exportedGame.metadata;
  
  if (!hasArtifacts || !exportedGame.artifacts) {
    printInfo(`No artifacts to inject for game ${gameId}`);
    return;
  }
  
  const specKey = `${gameId}-v${version}`;
  
  // Check if already exists
  const exists = await checkpointExists(specKey, getConfig("simulation-graph-type"));
  if (exists && !force) {
    printWarning(`Artifacts checkpoint for ${specKey} already exists`);
    printInfo('Skipping import. Use --force to overwrite existing checkpoint');
    return;
  }
  
  if (exists && force) {
    printWarning(`Overwriting existing artifacts checkpoint for ${specKey}`);
  }
  
  printInfo(`Injecting artifacts checkpoint for ${specKey}...`);
  
  // Get saver for simulation workflow
  const saver = await getSaver(specKey, getConfig("simulation-graph-type"));
  const config = { configurable: { thread_id: specKey } };
  
  // Create checkpoint state that matches SpecProcessingState structure
  const checkpointState = {
    gameRules: exportedGame.artifacts.gameRules,
    stateSchema: exportedGame.artifacts.stateSchema,
    stateTransitions: exportedGame.artifacts.stateTransitions,
    playerPhaseInstructions: exportedGame.artifacts.playerPhaseInstructions,
    transitionInstructions: exportedGame.artifacts.transitionInstructions,
    specNarratives: exportedGame.artifacts.specNarratives,
    
    // Add validation flags to indicate artifacts are complete
    schemaValidationErrors: [],
    transitionsValidationErrors: [],
    instructionsValidationErrors: [],
  };
  
  // Create checkpoint structure
  const checkpoint = {
    v: 1,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    channel_values: checkpointState,
    channel_versions: {
      __start__: 1,
    },
    versions_seen: {
      __start__: {
        __start__: 1,
      },
    },
    pending_sends: [],
  };
  
  await saver.put(config, checkpoint as any, { source: "input", step: -1, parents: {} } as any, {});
  
  printSuccess(`Artifacts checkpoint injected successfully`);
}

/**
 * Validate that imported data can be loaded correctly
 */
async function validateImport(exportedGame: ExportedGame): Promise<void> {
  const { gameId, version, hasArtifacts } = exportedGame.metadata;
  
  printInfo(`Validating import for game ${gameId}...`);
  
  try {
    // Validate design checkpoint
    const design = await getCachedDesign(gameId);
    if (!design) {
      printWarning(`Could not validate design checkpoint - conversation may need time to be available`);
    } else {
      if (design.title !== exportedGame.design.title) {
        printWarning(`Title mismatch: expected "${exportedGame.design.title}", got "${design.title}"`);
      }
      
      if (design.specification?.version !== version) {
        printWarning(`Version mismatch: expected ${version}, got ${design.specification?.version}`);
      }
      
      printSuccess(`Design checkpoint validated`);
    }
    
    // Validate artifacts checkpoint if applicable
    if (hasArtifacts) {
      const specKey = `${gameId}-v${version}`;
      const artifacts = await getCachedSpecArtifacts(specKey);
      
      if (!artifacts) {
        printWarning(`Could not validate artifacts checkpoint - may need time to be available`);
      } else {
        printSuccess(`Artifacts checkpoint validated`);
      }
    }
    
  } catch (error) {
    printWarning(`Validation check encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    printInfo(`Checkpoints were injected successfully - validation is informational only`);
  }
  
  printSuccess(`Import completed`);
}

/**
 * Main import function
 */
async function importGame(filePath: string, force: boolean): Promise<void> {
  try {
    printInfo(`Reading export file: ${filePath}`);
    
    // Read and parse export file
    const fileContent = await readFile(filePath, 'utf-8');
    const exportedGame: ExportedGame = JSON.parse(fileContent);
    
    printInfo(`Game ID: ${exportedGame.metadata.gameId}`);
    printInfo(`Version: ${exportedGame.metadata.version}`);
    printInfo(`Title: ${exportedGame.design.title}`);
    printInfo(`Has Artifacts: ${exportedGame.metadata.hasArtifacts}`);
    console.log('');
    
    // Step 1: Inject design checkpoint
    await injectDesignCheckpoint(exportedGame, force);
    
    // Step 2: Inject artifacts checkpoint (if available)
    await injectArtifactsCheckpoint(exportedGame, force);
    
    console.log('');
    
    // Step 3: Validate import
    await validateImport(exportedGame);
    
    console.log('');
    printSuccess(`Game ${exportedGame.metadata.gameId} imported successfully!`);
    console.log('');
    printInfo('LangGraph checkpoints imported. To complete the setup:');
    printInfo('  1. Create Supabase games record (via orchestrator or Supabase Studio)');
    printInfo('  2. Test with: GET /design/conversation?conversationId=' + exportedGame.metadata.gameId);
    
  } catch (error) {
    console.log('');
    printError('Import failed');
    if (error instanceof Error) {
      console.error(error.message);
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
    }
    process.exit(1);
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(): { filePath: string; force: boolean } {
  const args = process.argv.slice(2);
  let filePath = '';
  let force = false;
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file':
        filePath = args[++i];
        break;
      case '--force':
        force = true;
        break;
      case '--help':
        console.log(`
Import Game Script (LangGraph Checkpoints)

Usage:
  ./internal-api.sh game-import --file <path> [--force]

Options:
  --file <path>       Path to exported game JSON file (required)
  --force             Overwrite existing checkpoints (default: skip if exists)
  --help              Show this help message

Examples:
  # Import latest version
  ./internal-api.sh game-import --file data/exports/abc123-latest.json

  # Import specific version
  ./internal-api.sh game-import --file data/exports/abc123-v2.json

  # Force overwrite existing checkpoint
  ./internal-api.sh game-import --file data/exports/abc123-v2.json --force

Environment Variables:
  CHECKPOINT_DB_TYPE              Database type (sqlite or postgres)
  CHAINCRAFT_DESIGN_GRAPH_TYPE    Design graph type
  CHAINCRAFT_SIMULATION_GRAPH_TYPE Simulation graph type

Note:
  This script only imports LangGraph checkpoints. To create the Supabase
  games record, use the orchestrator import script or Supabase Studio.
`);
        process.exit(0);
        break;
      default:
        printError(`Unknown option: ${args[i]}`);
        printInfo('Use --help for usage information');
        process.exit(1);
    }
  }
  
  if (!filePath) {
    printError('--file parameter is required');
    printInfo('Use --help for usage information');
    process.exit(1);
  }
  
  return { filePath, force };
}

// Main execution
const { filePath, force } = parseArgs();
await importGame(filePath, force);