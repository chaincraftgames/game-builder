/**
 * File-based storage for game state and generated functions.
 * 
 * This module provides utilities for persisting game state and generated functions
 * between executions, allowing both discovery and simulation workflows to access
 * consistent data.
 */

import fs from 'fs/promises';
import path from 'path';

// Default storage location
const DEFAULT_STORAGE_DIR = 'game-data';
const GAMES_DIR = 'games';

// Types for function storage
export interface GameMetadata {
  gameId: string;
  gameSpecification: string;
  stateDefinition: string;
  createdAt: string;
  version?: string;
}

export interface LoadedFunctions {
  functionCode: string;
}

/**
 * Initialize the storage directory structure
 * @param basePath Optional base path for storage (defaults to 'game-data' in CWD)
 */
export async function initializeStorage(basePath?: string): Promise<void> {
  const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
  await ensureDirectoryExists(storagePath);
  await ensureDirectoryExists(getGamesPath(storagePath));
}

// ----------------------
// Game State Management
// ----------------------

/**
 * Store game state
 * @param gameId The ID of the game
 * @param state The state to store
 * @param basePath Optional base path for storage
 */
export async function storeGameState(
  gameId: string, 
  state: any, 
  basePath?: string
): Promise<void> {
  const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
  const gamePath = getGamePath(gameId, storagePath);
  await ensureDirectoryExists(gamePath);
  
  const statePath = path.join(gamePath, 'state.json');
  await fs.writeFile(
    statePath,
    JSON.stringify(state, null, 2),
    'utf8'
  );
}

/**
 * Store game history
 * @param gameId The ID of the game
 * @param history The history to store
 * @param basePath Optional base path for storage
 */
export async function storeGameHistory(
  gameId: string, 
  history: any[], 
  basePath?: string
): Promise<void> {
  const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
  const gamePath = getGamePath(gameId, storagePath);
  await ensureDirectoryExists(gamePath);
  
  const historyPath = path.join(gamePath, 'history.json');
  await fs.writeFile(
    historyPath,
    JSON.stringify(history, null, 2),
    'utf8'
  );
}

/**
 * Load game state
 * @param gameId The ID of the game
 * @param basePath Optional base path for storage
 * @returns The loaded state or undefined if not found
 */
export async function loadGameState(
  gameId: string, 
  basePath?: string
): Promise<any | undefined> {
  try {
    const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
    const statePath = path.join(getGamePath(gameId, storagePath), 'state.json');
    const stateData = await fs.readFile(statePath, 'utf8');
    return JSON.parse(stateData);
  } catch (error) {
    // Return undefined if file doesn't exist
    return undefined;
  }
}

/**
 * Load game history
 * @param gameId The ID of the game
 * @param basePath Optional base path for storage
 * @returns The loaded history or empty array if not found
 */
export async function loadGameHistory(
  gameId: string, 
  basePath?: string
): Promise<any[]> {
  try {
    const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
    const historyPath = path.join(getGamePath(gameId, storagePath), 'history.json');
    const historyData = await fs.readFile(historyPath, 'utf8');
    return JSON.parse(historyData);
  } catch (error) {
    // Return empty array if file doesn't exist
    return [];
  }
}

/**
 * Check if game state exists
 * @param gameId The ID of the game
 * @param basePath Optional base path for storage
 * @returns True if state exists, false otherwise
 */
export async function gameStateExists(
  gameId: string, 
  basePath?: string
): Promise<boolean> {
  try {
    const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
    const statePath = path.join(getGamePath(gameId, storagePath), 'state.json');
    await fs.access(statePath);
    return true;
  } catch (error) {
    return false;
  }
}

// ----------------------
// Metadata Management
// ----------------------

/**
 * Store game metadata (specification and state definition)
 * @param gameId The ID of the game
 * @param metadata The metadata to store
 * @param basePath Optional base path for storage
 */
export async function storeGameMetadata(
  gameId: string,
  metadata: {
    gameSpecification: string,
    stateDefinition: string,
    version?: string
  },
  basePath?: string
): Promise<void> {
  const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
  const gamePath = getGamePath(gameId, storagePath);
  await ensureDirectoryExists(gamePath);
  
  // Create the metadata object
  const gameMetadata: GameMetadata = {
    gameId,
    gameSpecification: metadata.gameSpecification,
    stateDefinition: metadata.stateDefinition,
    createdAt: new Date().toISOString(),
    version: metadata.version
  };
  
  // Save the metadata in the game folder
  await fs.writeFile(
    path.join(gamePath, 'metadata.json'),
    JSON.stringify(gameMetadata, null, 2),
    'utf8'
  );
  
  // Save the game specification separately for reference
  await fs.writeFile(
    path.join(gamePath, 'specification.txt'),
    metadata.gameSpecification,
    'utf8'
  );
}

/**
 * Load game metadata
 * @param gameId The ID of the game
 * @param basePath Optional base path for storage
 * @returns The game metadata
 */
export async function loadGameMetadata(
  gameId: string,
  basePath?: string
): Promise<GameMetadata> {
  const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
  const gamePath = getGamePath(gameId, storagePath);
  
  const metadataFile = path.join(gamePath, 'metadata.json');
  const metadataData = await fs.readFile(metadataFile, 'utf8');
  return JSON.parse(metadataData);
}

/**
 * Check if game metadata exists
 * @param gameId The ID of the game
 * @param basePath Optional base path for storage
 * @returns True if metadata exists, false otherwise
 */
export async function gameMetadataExists(
  gameId: string,
  basePath?: string
): Promise<boolean> {
  try {
    const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
    const gamePath = getGamePath(gameId, storagePath);
    const metadataFile = path.join(gamePath, 'metadata.json');
    await fs.access(metadataFile);
    return true;
  } catch (error) {
    return false;
  }
}

// ----------------------
// Function Management
// ----------------------

/**
 * Store generated game functions
 * @param gameId The ID of the game
 * @param functionCode The function code
 * @param basePath Optional base path for storage
 */
export async function storeFunctions(
  gameId: string, 
  functionCode: string,
  basePath?: string
): Promise<void> {
  const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
  const gamePath = getGamePath(gameId, storagePath);
  await ensureDirectoryExists(gamePath);
  
  // Save the function code
  await fs.writeFile(
    path.join(gamePath, 'functions.js'),
    functionCode,
    'utf8'
  );
}

/**
 * Backward compatibility method for storing both functions and metadata
 * @param gameId The ID of the game
 * @param functionCode The function code
 * @param gameSpecification The game specification
 * @param stateDefinition The state definition
 * @param basePath Optional base path for storage
 * @param version Optional version identifier
 */
export async function storeFunctionsWithMetadata(
  gameId: string, 
  functionCode: string,
  gameSpecification: string,
  stateDefinition: string,
  basePath?: string,
  version?: string
): Promise<void> {
  // Store functions and metadata separately
  await storeFunctions(gameId, functionCode, basePath);
  await storeGameMetadata(
    gameId, 
    { gameSpecification, stateDefinition, version },
    basePath
  );
}

/**
 * Check if functions exist for a game
 * @param gameId The ID of the game
 * @param basePath Optional base path for storage
 * @returns True if functions exist, false otherwise
 */
export async function functionsExist(
  gameId: string, 
  basePath?: string
): Promise<boolean> {
  try {
    const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
    const gamePath = getGamePath(gameId, storagePath);
    console.debug(`Checking for functions in: ${gamePath}`);

    // Check if the functions file exists
    await fs.access(path.join(gamePath, 'functions.js'));
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Load functions for a game
 * @param gameId The ID of the game
 * @param basePath Optional base path for storage
 * @returns Object containing the function code
 */
export async function loadFunctions(
  gameId: string, 
  basePath?: string
): Promise<LoadedFunctions> {
  const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
  const gamePath = getGamePath(gameId, storagePath);
  
  // Load function code
  const functionCode = await fs.readFile(
    path.join(gamePath, 'functions.js'),
    'utf8'
  );
  
  return {
    functionCode
  };
}

/**
 * Backward compatibility method for loading both functions and metadata
 * @param gameId The ID of the game
 * @param basePath Optional base path for storage
 * @returns Object containing the function code and metadata
 */
export async function loadFunctionsWithMetadata(
  gameId: string, 
  basePath?: string
): Promise<{
  functionCode: string;
  metadata: GameMetadata;
}> {
  // Load functions and metadata separately
  const functions = await loadFunctions(gameId, basePath);
  const metadata = await loadGameMetadata(gameId, basePath);
  
  return {
    functionCode: functions.functionCode,
    metadata
  };
}

/**
 * Get the raw function code string for a game
 * @param gameId The ID of the game
 * @param basePath Optional base path for storage
 * @returns The function code as a string
 */
export async function getFunctionCode(
  gameId: string,
  basePath?: string
): Promise<string> {
  const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
  const gamePath = getGamePath(gameId, storagePath);
  
  return await fs.readFile(
    path.join(gamePath, 'functions.js'),
    'utf8'
  );
}

/**
 * Get the function metadata for a game
 * @param gameId The ID of the game
 * @param basePath Optional base path for storage
 * @returns The function metadata
 */
export async function getFunctionMetadata(
  gameId: string,
  basePath?: string
): Promise<GameMetadata> {
  const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
  const gamePath = getGamePath(gameId, storagePath);
  
  const metadataFile = path.join(gamePath, 'metadata.json');
  const metadataData = await fs.readFile(metadataFile, 'utf8');
  return JSON.parse(metadataData);
}

/**
 * List all games with stored functions
 * @param basePath Optional base path for storage
 * @returns Array of game IDs that have functions
 */
export async function listGamesWithFunctions(basePath?: string): Promise<string[]> {
  try {
    const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
    const gamesPath = getGamesPath(storagePath);
    const gameIds = await fs.readdir(gamesPath);
    
    // Filter to only games that have functions.js
    const gamesWithFunctions: string[] = [];
    for (const gameId of gameIds) {
      if (await functionsExist(gameId, basePath)) {
        gamesWithFunctions.push(gameId);
      }
    }
    
    return gamesWithFunctions;
  } catch (error) {
    return [];
  }
}

// ----------------------
// General Game Management
// ----------------------

/**
 * List all games (with any stored data - state, functions, or history)
 * @param basePath Optional base path for storage
 * @returns Array of game IDs
 */
export async function listGames(basePath?: string): Promise<string[]> {
  try {
    const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
    return await fs.readdir(getGamesPath(storagePath));
  } catch (error) {
    return [];
  }
}

/**
 * Delete all data for a game (state, history, and functions)
 * @param gameId The ID of the game
 * @param basePath Optional base path for storage
 */
export async function deleteGameData(
  gameId: string, 
  basePath?: string
): Promise<void> {
  const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
  
  try {
    // Delete game directory with state, history, functions, and metadata
    const gamePath = getGamePath(gameId, storagePath);
    await fs.rm(gamePath, { recursive: true, force: true });
  } catch (error) {
    // Ignore errors if directories/files don't exist
  }
}

/**
 * Delete only the functions for a game
 * @param gameId The ID of the game
 * @param basePath Optional base path for storage
 */
export async function deleteGameFunctions(
  gameId: string,
  basePath?: string
): Promise<void> {
  const storagePath = basePath || path.join(process.cwd(), DEFAULT_STORAGE_DIR);
  
  try {
    const gamePath = getGamePath(gameId, storagePath);
    const functionsPath = path.join(gamePath, 'functions.js');
    await fs.unlink(functionsPath);
  } catch (error) {
    // Ignore errors if file doesn't exist
  }
}

// ----------------------
// Path Helper Functions
// ----------------------

function getGamesPath(basePath: string): string {
  return path.join(basePath, GAMES_DIR);
}

function getGamePath(gameId: string, basePath: string): string {
  return path.join(getGamesPath(basePath), gameId);
}

async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Directory already exists or can't be created
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}