#!/usr/bin/env node
/**
 * Simple CLI to test the GameSession abstraction with the existing RPS game
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import { setupSimulationModel } from '../model-config.js';
import { 
  loadFunctions, 
  functionsExist, 
  storeGameState,
  loadGameState,
  gameStateExists,
  loadGameMetadata
} from '../file-storage.js';
import { 
  initializeFunctionRegistry,  
} from '../function-registry.js';
import { GameSession, GameSessionOptions } from './game-session.js';

// Create the command-line interface
const program = new Command();

program
  .name('game-session-test')
  .description('Test the simplified GameSession approach')
  .version('0.1.0');

// Create a readline interface for interactive input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper function to prompt for input
function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Command to initialize a game using GameSession
 */
program
  .command('init <gameId>')
  .description('Initialize a game using the GameSession approach')
  .action(async (gameId: string) => {
    try {
      console.log(chalk.blue(`Initializing game ${gameId} with GameSession...`));
      
      // Check if functions exist
      const exists = await functionsExist(gameId);
      if (!exists) {
        console.error(chalk.red(`Game ${gameId} not found. Create it first.`));
        rl.close();
        return;
      }
      
      // Load the functions and metadata
      const { functionCode } = await loadFunctions(gameId);
      const metadata = await loadGameMetadata(gameId);
      
      // Validate function code
      console.log(chalk.blue('Validating loaded functions...'));
      try {
        new Function(functionCode);
        console.log(chalk.green('✅ Function syntax validation passed'));
      } catch (error) {
        console.error(chalk.red(`❌ Function syntax validation failed: ${error instanceof Error ? error.message : String(error)}`));
      }
      
      // Get player IDs
      const playerIdsInput = await question(chalk.yellow('Enter player IDs (comma-separated): '));
      const playerIds = playerIdsInput.split(',').map(id => id.trim());
      
      if (playerIds.length === 0) {
        console.error(chalk.red('At least one player is required.'));
        rl.close();
        return;
      }
      
      // Set up the model
      console.log(chalk.blue('Setting up the model...'));
      const model = await setupSimulationModel();
      
      // Create function registry
      const functionRegistry = initializeFunctionRegistry(functionCode);
      
      // Create GameSession
      const sessionOptions: GameSessionOptions = {
        gameId,
        gameSpecification: metadata.gameSpecification,
        functionRegistry,
        model,
        initialState: {}
      };
      
      const gameSession = new GameSession(sessionOptions);
      
      // Initialize the game
      console.log(chalk.blue('Initializing the game...'));
      const result = await gameSession.initializeGame(playerIds);
      
      // Store the game session state (we'll use the same storage format for now)
      const gameState = {
        currentState: gameSession.state,
        gameSpecification: metadata.gameSpecification,
        history: [],
        codeHistory: [],
        codeImplementations: { initializeGame: '', processAction: '' },
        playerIds
      };
      
      await storeGameState(gameId, gameState);
      
      // Display results
      console.log(chalk.green('Game initialized successfully with GameSession!'));
      if (result.messages.public.length > 0) {
        console.log(chalk.yellow('Public messages:'));
        result.messages.public.forEach(msg => console.log(`  ${msg}`));
      }
      
      for (const [playerId, messages] of Object.entries(result.messages.private)) {
        if (messages.length > 0) {
          console.log(chalk.yellow(`Private messages for ${playerId}:`));
          messages.forEach(msg => console.log(`  ${msg}`));
        }
      }
      
      console.log(chalk.yellow('Initial game state:'));
      console.log(JSON.stringify(gameSession.state, null, 2));
      
      console.log(chalk.green(`To take an action, run: game-session-test action ${gameId} <playerId> "<action>"`));
      
    } catch (error) {
      console.error(chalk.red(`Error initializing game: ${error instanceof Error ? error.message : 'Unknown error'}`));
    } finally {
      rl.close();
    }
  });

/**
 * Command to process an action using GameSession
 */
program
  .command('action <gameId> <playerId> <action>')
  .description('Process an action using the GameSession approach')
  .action(async (gameId: string, playerId: string, action: string) => {
    try {
      console.log(chalk.blue(`Processing action for game ${gameId}, player ${playerId}: ${action}`));
      
      // Check if game state exists
      if (!await gameStateExists(gameId)) {
        console.error(chalk.red(`Game state for ${gameId} not found. Initialize it first.`));
        rl.close();
        return;
      }
      
      // Load existing game state and functions
      const gameState = await loadGameState(gameId);
      const { functionCode } = await loadFunctions(gameId);
      const metadata = await loadGameMetadata(gameId);
      
      // Set up the model
      console.log(chalk.blue('Setting up the model...'));
      const model = await setupSimulationModel();
      
      // Create function registry
      const functionRegistry = initializeFunctionRegistry(functionCode);
      
      // Create GameSession with existing state
      const sessionOptions: GameSessionOptions = {
        gameId,
        gameSpecification: metadata.gameSpecification,
        functionRegistry,
        model,
        initialState: gameState.currentState
      };
      
      const gameSession = new GameSession(sessionOptions);
      
      // Process the action
      console.log(chalk.blue('Processing the action...'));
      const result = await gameSession.processAction(playerId, action);
      
      // Update stored game state
      gameState.currentState = gameSession.state;
      gameState.history.push({
        action,
        playerId,
        timestamp: new Date().toISOString(),
        publicMessage: result.messages.public[0] || '',
        privateMessages: Object.fromEntries(
          Object.entries(result.messages.private).map(([id, msgs]) => [id, msgs[0] || ''])
        ),
        stateAfter: { ...gameSession.state }
      });
      
      await storeGameState(gameId, gameState);
      
      // Display results
      console.log(chalk.green('Action processed successfully with GameSession!'));
      if (result.messages.public.length > 0) {
        console.log(chalk.yellow('Public messages:'));
        result.messages.public.forEach(msg => console.log(`  ${msg}`));
      }
      
      for (const [playerIdKey, messages] of Object.entries(result.messages.private)) {
        if (Array.isArray(messages) && messages.length > 0) {
          console.log(chalk.yellow(`Private messages for ${playerIdKey}:`));
          messages.forEach(msg => console.log(`  ${msg}`));
        }
      }
      
      console.log(chalk.yellow('Updated game state:'));
      console.log(JSON.stringify(gameSession.state, null, 2));
      
      // Clean up
      await gameSession.dispose();
      
    } catch (error) {
      console.error(chalk.red(`Error processing action: ${error instanceof Error ? error.message : 'Unknown error'}`));
    } finally {
      rl.close();
    }
  });

// Parse CLI arguments
program.parse(process.argv);

// If no arguments, show help
if (program.args.length === 0) {
  program.help();
}
