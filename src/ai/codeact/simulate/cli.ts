#!/usr/bin/env node
/**
 * CLI interface for the model-driven simulation system.
 * 
 * This module provides a command-line interface for initializing and
 * interacting with simulations that use the CodeAct-generated functions.
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
  listGames,
  deleteGameData, 
  loadGameMetadata
} from '../file-storage.js';
import { 
  initializeFunctionRegistry,  
} from '../function-registry.js';
import { 
  createExecutionContext, 
  initializeGame, 
  processAction, 
  getCodeHistory
} from './model-executor.js';

// Create the command-line interface
const program = new Command();

program
  .name('codeact-simulate')
  .description('CodeAct simulation system CLI')
  .version('0.1.0');

// Create a readline interface for interactive input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper function to ask questions interactively
function question(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, (answer) => resolve(answer));
  });
}

/**
 * Command to create a new game
 */
// program
//   .command('create')
//   .description('Create a new game simulation')
//   .action(async () => {
//     try {
//       console.log(chalk.blue('Creating a new game simulation...'));
      
//       // Generate a game ID
//       const gameId = `game-${uuidv4().slice(0, 8)}`;
//       console.log(chalk.green(`Generated game ID: ${gameId}`));
      
//       // Get game specification from user
//       const gameSpecification = await question(chalk.yellow('Enter the game specification: '));
      
//       // Create a function registry to generate the state definition
//       console.log(chalk.blue('Generating initial state definition...'));
//       const initialRegistry = initializeFunctionRegistry('', gameSpecification, '');
//       const stateDefinition = initialRegistry.stateDefinition;
      
//       // Ask for the function implementation code
//       console.log(chalk.yellow('Enter the function implementation code (end with a line containing only "END"):'));
//       let functionCode = '';
//       let line;
      
//       while ((line = await question('')) !== 'END') {
//         functionCode += line + '\n';
//       }
      
//       // Store the functions
//       await storeFunctions(gameId, functionCode, gameSpecification, stateDefinition);
      
//       console.log(chalk.green(`Game created successfully with ID: ${gameId}`));
//       console.log(chalk.yellow(`To initialize the game, run: codeact-simulate init ${gameId}`));
//     } catch (error) {
//       console.error(chalk.red(`Error creating game: ${error instanceof Error ? error.message : 'Unknown error'}`));
//     } finally {
//       rl.close();
//     }
//   });

/**
 * Command to initialize a game with players
 */
program
  .command('init <gameId>')
  .description('Initialize a game with players')
  .action(async (gameId: string) => {
    try {
      console.log(chalk.blue(`Initializing game ${gameId}...`));
      
      // Check if functions exist
      const exists = await functionsExist(gameId);
      if (!exists) {
        console.error(chalk.red(`Game ${gameId} not found. Create it first with 'create' command.`));
        rl.close();
        return;
      }
      
      // Load the functions
      const { functionCode } = await loadFunctions(gameId);
      const metadata = await loadGameMetadata(gameId);
      
      // Validate function code before proceeding
      console.log(chalk.blue('Validating loaded functions...'));
      try {
        new Function(functionCode);
        console.log(chalk.green('✅ Function syntax validation passed'));
      } catch (error) {
        console.error(chalk.red(`❌ Function syntax validation failed: ${error instanceof Error ? error.message : String(error)}`));
        console.error(chalk.red('The loaded functions contain syntax errors. This may cause initialization to fail.'));
        console.error(chalk.yellow('Consider regenerating the functions or manually fixing the syntax errors.'));
      }
      
      // Get player IDs from user
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
      const functionRegistry = initializeFunctionRegistry(
        functionCode
      );
      
      // Create execution context
      const options = {
        model,
        functionCode,
        gameSpecification: metadata.gameSpecification,
        functionRegistry,
        initialState: {}
      };
      
      const context = createExecutionContext(options);
      context.playerIds = playerIds;
      
      // Initialize the game
      console.log(chalk.blue('Initializing the game...'));
      const result = await initializeGame(context, options, gameId);
      
      // Store the game state
      await storeGameState(gameId, context);
      
      // Display results
      console.log(chalk.green('Game initialized successfully!'));
      if (result.messages.public.length > 0) {
        console.log(chalk.yellow('Public message:'));
        console.log(result.messages.public.join('\n'));
      }
      
      for (const [playerId, messages] of Object.entries(result.messages.private)) {
        console.log(chalk.yellow(`Private message for ${playerId}:`));
        console.log(messages.join('\n'));
      }
      
      console.log(chalk.yellow('Initial game state:'));
      console.log(JSON.stringify(result.state, null, 2));
      
      console.log(chalk.green(`To take an action, run: codeact-simulate action ${gameId} <playerId> "<action>"`));
    } catch (error) {
      console.error(chalk.red(`Error initializing game: ${error instanceof Error ? error.message : 'Unknown error'}`));
    } finally {
      rl.close();
    }
  });

/**
 * Command to take an action in a game
 */
program
  .command('action <gameId> <playerId> <action>')
  .description('Take a player action in the game')
  .action(async (gameId: string, playerId: string, action: string) => {
    try {
      console.log(chalk.blue(`Processing action for player ${playerId} in game ${gameId}...`));
      
      // Check if functions and state exist
      if (!await functionsExist(gameId)) {
        console.error(chalk.red(`Game ${gameId} not found. Create it first with 'create' command.`));
        rl.close();
        return;
      }
      
      if (!await gameStateExists(gameId)) {
        console.error(chalk.red(`Game ${gameId} not initialized. Initialize it with 'init' command.`));
        rl.close();
        return;
      }
      
      // Load the functions and state
      const metadata = await loadGameMetadata(gameId);
      const { functionCode } = await loadFunctions(gameId);
      const context = await loadGameState(gameId);
      
      // Validate function code before proceeding
      console.log(chalk.blue('Validating loaded functions...'));
      try {
        new Function(functionCode);
        console.log(chalk.green('✅ Function syntax validation passed'));
      } catch (error) {
        console.error(chalk.red(`❌ Function syntax validation failed: ${error instanceof Error ? error.message : String(error)}`));
        console.error(chalk.red('The loaded functions contain syntax errors. This may cause action processing to fail.'));
        console.error(chalk.yellow('Consider regenerating the functions or manually fixing the syntax errors.'));
      }
      
      // Set up the model
      console.log(chalk.blue('Setting up the model...'));
      const model = await setupSimulationModel();
      
      // Create function registry
      const functionRegistry = initializeFunctionRegistry(
        functionCode
      );
      
      // Set up options for processing
      const options = {
        model,
        gameSpecification: metadata.gameSpecification,
        functionCode,
        functionRegistry,
        initialState: context.currentState
      };
      
      // Process the action
      console.log(chalk.blue(`Processing action: ${action}`));
      const result = await processAction(context, options, playerId, action, gameId);
      
      // Store the updated game state
      await storeGameState(gameId, context);
      
      // Display results
      console.log(chalk.green('Action processed successfully!'));
      if (result.messages.public.length > 0) {
        console.log(chalk.yellow('Public message:'));
        console.log(result.messages.public.join('\n'));
      }
      
      // Show private message for acting player
      if (result.messages.private[playerId]?.length > 0) {
        console.log(chalk.yellow(`Private message for ${playerId}:`));
        console.log(result.messages.private[playerId].join('\n'));
      }
      
      // Show private messages for other players
      for (const [pid, messages] of Object.entries(result.messages.private)) {
        if (pid !== playerId && messages.length > 0) {
          console.log(chalk.yellow(`Private message for ${pid}:`));
          console.log(messages.join('\n'));
        }
      }
      
      console.log(chalk.yellow('Updated game state:'));
      console.log(JSON.stringify(result.state, null, 2));
      
      // Check if game has ended
      const gameEnded = result.state?.game?.gameStatus === 'COMPLETED' || 
                       result.state?.game?.gameEnded === true;
      
      if (gameEnded) {
        console.log(chalk.green('GAME OVER!'));
      }
    } catch (error) {
      console.error(chalk.red(`Error processing action: ${error instanceof Error ? error.message : 'Unknown error'}`));
    } finally {
      rl.close();
    }
  });

/**
 * Command to list all games
 */
program
  .command('list')
  .description('List all available games')
  .action(async () => {
    try {
      const games = await listGames();
      
      if (games.length === 0) {
        console.log(chalk.yellow('No games found.'));
      } else {
        console.log(chalk.green('Available games:'));
        for (const gameId of games) {
          console.log(`- ${gameId}`);
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error listing games: ${error instanceof Error ? error.message : 'Unknown error'}`));
    } finally {
      rl.close();
    }
  });

/**
 * Command to delete a game
 */
program
  .command('delete <gameId>')
  .description('Delete a game and all its data')
  .action(async (gameId: string) => {
    try {
      console.log(chalk.blue(`Deleting game ${gameId}...`));
      
      // Check if game exists
      if (!await functionsExist(gameId)) {
        console.error(chalk.red(`Game ${gameId} not found.`));
        rl.close();
        return;
      }
      
      const confirmation = await question(chalk.yellow(`Are you sure you want to delete game ${gameId}? (y/n): `));
      
      if (confirmation.toLowerCase() === 'y') {
        await deleteGameData(gameId);
        console.log(chalk.green(`Game ${gameId} deleted successfully.`));
      } else {
        console.log(chalk.yellow('Deletion cancelled.'));
      }
    } catch (error) {
      console.error(chalk.red(`Error deleting game: ${error instanceof Error ? error.message : 'Unknown error'}`));
    } finally {
      rl.close();
    }
  });

/**
 * Command to get the state of a game
 */
program
  .command('state <gameId>')
  .description('Get the current state of a game')
  .action(async (gameId: string) => {
    try {
      console.log(chalk.blue(`Getting state for game ${gameId}...`));
      
      // Check if game exists
      if (!await gameStateExists(gameId)) {
        console.error(chalk.red(`Game state for ${gameId} not found.`));
        rl.close();
        return;
      }
      
      // Load the game state
      const context = await loadGameState(gameId);
      
      console.log(chalk.green('Current game state:'));
      console.log(JSON.stringify(context.currentState, null, 2));
    } catch (error) {
      console.error(chalk.red(`Error getting game state: ${error instanceof Error ? error.message : 'Unknown error'}`));
    } finally {
      rl.close();
    }
  });

/**
 * Command to view generated code history
 */
program
  .command('viewcode <gameId>')
  .option('-l, --last', 'Show only the most recent generated code')
  .option('-o, --operation <type>', 'Filter by operation type (initialize, process, recover)')
  .description('View the AI-generated code for a game')
  .action(async (gameId: string, options: { last?: boolean; operation?: string }) => {
    try {
      console.log(chalk.blue(`Fetching generated code for game ${gameId}...`));
      
      // Check if game state exists
      if (!await gameStateExists(gameId)) {
        console.error(chalk.red(`Game state for ${gameId} not found.`));
        rl.close();
        return;
      }
      
      // Load the game state
      const context = await loadGameState(gameId);
      
      // Get code history
      const codeHistory = getCodeHistory(context);
      
      if (codeHistory.length === 0) {
        console.log(chalk.yellow('No code history found for this game.'));
        rl.close();
        return;
      }
      
      // Filter by operation if specified
      let filteredHistory = codeHistory;
      if (options.operation) {
        const validOperations = ['initialize', 'process', 'recover'];
        if (!validOperations.includes(options.operation)) {
          console.error(chalk.red(`Invalid operation type. Valid options are: ${validOperations.join(', ')}`));
          rl.close();
          return;
        }
        
        filteredHistory = codeHistory.filter(entry => 
          entry.operation === options.operation as 'initialize' | 'process' | 'recover'
        );
        
        if (filteredHistory.length === 0) {
          console.log(chalk.yellow(`No code entries found for operation: ${options.operation}`));
          rl.close();
          return;
        }
      }
      
      // Show only the last entry if requested
      if (options.last) {
        const lastEntry = filteredHistory[filteredHistory.length - 1];
        console.log(chalk.green(`Latest code (${lastEntry.operation}) generated at ${lastEntry.timestamp}:`));
        console.log(chalk.yellow('Execution result:'), 
          lastEntry.executionResult.success 
            ? chalk.green('Success') 
            : chalk.red(`Failed: ${lastEntry.executionResult.error}`)
        );
        console.log(chalk.yellow('Execution time:'), `${lastEntry.executionResult.executionTime}ms`);
        console.log(chalk.cyan('\n--- Generated Code ---'));
        console.log(lastEntry.code);
        console.log(chalk.cyan('--- End of Code ---\n'));
      } else {
        // Show all entries
        console.log(chalk.green(`Found ${filteredHistory.length} code entries:`));
        
        for (let i = 0; i < filteredHistory.length; i++) {
          const entry = filteredHistory[i];
          console.log(chalk.green(`\n[${i + 1}/${filteredHistory.length}] Code (${entry.operation}) generated at ${entry.timestamp}:`));
          console.log(chalk.yellow('Execution result:'), 
            entry.executionResult.success 
              ? chalk.green('Success') 
              : chalk.red(`Failed: ${entry.executionResult.error}`)
          );
          console.log(chalk.yellow('Execution time:'), `${entry.executionResult.executionTime}ms`);
          console.log(chalk.cyan('\n--- Generated Code ---'));
          console.log(entry.code);
          console.log(chalk.cyan('--- End of Code ---\n'));
          
          // If not the last entry, ask if user wants to continue
          if (i < filteredHistory.length - 1) {
            const answer = await question(chalk.yellow('Press Enter to see next entry or type "q" to quit: '));
            if (answer.toLowerCase() === 'q') {
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error viewing code history: ${error instanceof Error ? error.message : 'Unknown error'}`));
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