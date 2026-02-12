#!/usr/bin/env node
/**
 * Import Game Script
 * 
 * Imports a game exported from production into local environment.
 * This includes:
 * 1. Injecting LangGraph checkpoints (design state and artifacts) into local SQLite
 * 2. Creating Supabase games table record for the imported game
 * 3. Validating the import was successful
 * 
 * Usage:
 *   npm run import-game -- --file data/exports/game-abc123-v2.json
 *   npm run import-game -- --file data/exports/game-abc123-latest.json --wallet local
 */

import "dotenv/config.js";
import { readFile } from "fs/promises";
import { createClient } from "@supabase/supabase-js";
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
 * Inject design checkpoint into local LangGraph storage
 */
async function injectDesignCheckpoint(exportedGame: ExportedGame): Promise<void> {
  const { gameId } = exportedGame.metadata;
  const { design } = exportedGame;
  
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
    messages: [],
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
  
  await saver.put(config, checkpoint as any, { source: "update", step: -1, writes: null }, {});
  
  printSuccess(`Design checkpoint injected successfully`);
}

/**
 * Inject artifacts checkpoint into local LangGraph storage
 */
async function injectArtifactsCheckpoint(exportedGame: ExportedGame): Promise<void> {
  const { gameId, version, hasArtifacts } = exportedGame.metadata;
  
  if (!hasArtifacts || !exportedGame.artifacts) {
    printInfo(`No artifacts to inject for game ${gameId}`);
    return;
  }
  
  const specKey = `${gameId}-v${version}`;
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
  
  await saver.put(config, checkpoint as any, { source: "update", step: -1, writes: null }, {});
  
  printSuccess(`Artifacts checkpoint injected successfully`);
}

/**
 * Create Supabase games table record
 */
async function createSupabaseRecord(
  exportedGame: ExportedGame,
  walletAddress: string
): Promise<void> {
  const { gameId, version } = exportedGame.metadata;
  const { design } = exportedGame;
  
  printInfo(`Creating Supabase games record for game ${gameId}...`);
  
  // Get Supabase connection details
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    printWarning('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured');
    printWarning('Skipping Supabase record creation');
    printInfo('To enable Supabase import, set these environment variables:');
    printInfo('  SUPABASE_URL=http://localhost:54321');
    printInfo('  SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>');
    return;
  }
  
  // Create Supabase client with service role key (bypasses RLS)
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  
  // Prepare games table record
  const gameRecord = {
    id: gameId,
    wallet_address: walletAddress,
    title: design.title,
    game_description: design.specification?.summary ?? "",
    status: 'designing' as const,
    spec_version: version,
    min_players: design.specification?.playerCount?.min,
    max_players: design.specification?.playerCount?.max,
    created_at: exportedGame.metadata.timestamp,
    updated_at: new Date().toISOString(),
  };
  
  // Insert or update the record
  const { data, error } = await supabase
    .from('games')
    .upsert(gameRecord, { onConflict: 'id' })
    .select();
  
  if (error) {
    throw new Error(`Failed to create Supabase record: ${error.message}`);
  }
  
  printSuccess(`Supabase games record created successfully`);
}

/**
 * Validate that imported data can be loaded correctly
 */
async function validateImport(exportedGame: ExportedGame): Promise<void> {
  const { gameId, version, hasArtifacts } = exportedGame.metadata;
  
  printInfo(`Validating import for game ${gameId}...`);
  
  // Validate design checkpoint
  const design = await getCachedDesign(gameId);
  if (!design) {
    throw new Error(`Failed to load design checkpoint after import`);
  }
  
  if (design.title !== exportedGame.design.title) {
    printWarning(`Title mismatch: expected "${exportedGame.design.title}", got "${design.title}"`);
  }
  
  if (design.specification?.version !== version) {
    printWarning(`Version mismatch: expected ${version}, got ${design.specification?.version}`);
  }
  
  printSuccess(`Design checkpoint validated`);
  
  // Validate artifacts checkpoint if applicable
  if (hasArtifacts) {
    const specKey = `${gameId}-v${version}`;
    const artifacts = await getCachedSpecArtifacts(specKey);
    
    if (!artifacts) {
      throw new Error(`Failed to load artifacts checkpoint after import`);
    }
    
    printSuccess(`Artifacts checkpoint validated`);
  }
  
  printSuccess(`Import validation completed successfully`);
}

/**
 * Main import function
 */
async function importGame(filePath: string, walletAddress: string): Promise<void> {
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
    await injectDesignCheckpoint(exportedGame);
    
    // Step 2: Inject artifacts checkpoint (if available)
    await injectArtifactsCheckpoint(exportedGame);
    
    // Step 3: Create Supabase record
    await createSupabaseRecord(exportedGame, walletAddress);
    
    console.log('');
    
    // Step 4: Validate import
    await validateImport(exportedGame);
    
    console.log('');
    printSuccess(`Game ${exportedGame.metadata.gameId} imported successfully!`);
    console.log('');
    printInfo('You can now:');
    printInfo(`  - View in Supabase Studio: http://127.0.0.1:54323`);
    printInfo(`  - Test with game-builder API: GET /design/conversation?conversationId=${exportedGame.metadata.gameId}`);
    printInfo(`  - Continue design conversation via orchestrator`);
    
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
function parseArgs(): { filePath: string; walletAddress: string } {
  const args = process.argv.slice(2);
  let filePath = '';
  let walletAddress = 'local'; // Default to 'local' for stub auth
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--file':
        filePath = args[++i];
        break;
      case '--wallet':
        walletAddress = args[++i];
        break;
      case '--help':
        console.log(`
Import Game Script

Usage:
  npm run import-game -- --file <path> [--wallet <address>]

Options:
  --file <path>       Path to exported game JSON file (required)
  --wallet <address>  Wallet address for game owner (default: "local")
  --help              Show this help message

Examples:
  # Import latest version
  npm run import-game -- --file data/exports/abc123-latest.json

  # Import specific version with custom wallet
  npm run import-game -- --file data/exports/abc123-v2.json --wallet 0x123...

Environment Variables:
  SUPABASE_URL                    Local Supabase URL (default: http://localhost:54321)
  SUPABASE_SERVICE_ROLE_KEY       Service role key for bypassing RLS
  CHECKPOINT_DB_TYPE              Database type (sqlite or postgres)
  CHAINCRAFT_DESIGN_GRAPH_TYPE    Design graph type
  CHAINCRAFT_SIMULATION_GRAPH_TYPE Simulation graph type
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
  
  return { filePath, walletAddress };
}

// Main execution
const { filePath, walletAddress } = parseArgs();
await importGame(filePath, walletAddress);
