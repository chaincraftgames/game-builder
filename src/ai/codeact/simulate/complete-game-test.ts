#!/usr/bin/env node
/**
 * Complete game test for GameSession reliability.
 * 
 * This test plays complete RPS games multiple times to verify:
 * 1. Games can be played to completion
 * 2. Game rules are enforced correctly
 * 3. Winners are determined accurately
 * 4. The system handles edge cases reliably
 * 5. Performance is consistent across multiple games
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { GameSession } from './game-session.js';
import { setupSimulationModel } from '../model-config.js';
import { loadFunctions, functionsExist, loadGameMetadata } from '../file-storage.js';
import { initializeFunctionRegistry } from '../function-registry.js';

const program = new Command();

interface RoundAction {
  player: string;
  action: string;
  result: 'choice' | 'complete';
}

interface RoundResult {
  roundNumber: number;
  player1Choice: string;
  player2Choice: string;
  winner: string;
  actions: RoundAction[];
}

interface GameTestResult {
  gameNumber: number;
  success: boolean;
  winner: string | null;
  rounds: number;
  totalActions: number;
  duration: number;
  roundResults: RoundResult[];
  error?: string;
  finalState?: any;
}

interface TestSummary {
  totalGames: number;
  successfulGames: number;
  failedGames: number;
  averageDuration: number;
  averageRounds: number;
  averageActions: number;
  winnerDistribution: Record<string, number>;
  errors: string[];
}

program
  .name('complete-game-test')
  .description('Test complete RPS games with GameSession')
  .version('0.1.0');

/**
 * Play a single complete RPS game
 */
async function playCompleteGame(
  gameSession: GameSession,
  gameNumber: number,
  player1Id: string = 'Alice',
  player2Id: string = 'Bob'
): Promise<GameTestResult> {
  const startTime = Date.now();
  const actions = ['rock', 'paper', 'scissors'];
  let totalActions = 0;
  let rounds = 0;
  let roundResults: RoundResult[] = [];
  let currentRoundActions: RoundAction[] = [];
  
  try {
    console.log(chalk.blue(`\n=== Game ${gameNumber} ===`));
    
    // Initialize the game
    console.log(`Initializing game with players: ${player1Id}, ${player2Id}`);
    const initResult = await gameSession.initializeGame([player1Id, player2Id]);
    console.log(`Initial state phase: ${initResult.state.gamePhase}`);
    
    // Play until game is over
    while (initResult.state.gamePhase !== 'GAME_OVER' && rounds < 10) { // Safety limit
      rounds++;
      console.log(chalk.yellow(`\n--- Round ${rounds} ---`));
      currentRoundActions = [];
      
      // Player 1 makes a choice
      const p1Choice = actions[Math.floor(Math.random() * actions.length)];
      console.log(`${player1Id} chooses: ${p1Choice}`);
      const p1Result = await gameSession.processAction(player1Id, p1Choice);
      totalActions++;
      
      currentRoundActions.push({
        player: player1Id,
        action: p1Choice,
        result: 'choice'
      });
      
      console.log(`After ${player1Id}'s choice: phase=${p1Result.state.gamePhase}`);
      if (p1Result.messages.private[player1Id]) {
        const p1Messages = Array.isArray(p1Result.messages.private[player1Id]) 
          ? p1Result.messages.private[player1Id].join(' ')
          : p1Result.messages.private[player1Id];
        console.log(`${player1Id} message: ${p1Messages}`);
      }
      
      // Check if game ended early (shouldn't happen in RPS)
      if (p1Result.state.gamePhase === 'GAME_OVER') {
        break;
      }
      
      // Player 2 makes a choice
      const p2Choice = actions[Math.floor(Math.random() * actions.length)];
      console.log(`${player2Id} chooses: ${p2Choice}`);
      const p2Result = await gameSession.processAction(player2Id, p2Choice);
      totalActions++;
      
      currentRoundActions.push({
        player: player2Id,
        action: p2Choice,
        result: 'complete'
      });
      
      console.log(`After ${player2Id}'s choice: phase=${p2Result.state.gamePhase}`);
      if (p2Result.messages.private[player2Id]) {
        const p2Messages = Array.isArray(p2Result.messages.private[player2Id])
          ? p2Result.messages.private[player2Id].join(' ')
          : p2Result.messages.private[player2Id];
        console.log(`${player2Id} message: ${p2Messages}`);
      }
      
      // Show public messages (round results)
      if (p2Result.messages.public.length > 0) {
        console.log(chalk.green(`Public: ${p2Result.messages.public.join(' ')}`));
      }
      
      // Extract round result from the game state
      const gameState = p2Result.state;
      if (gameState.roundResults && gameState.roundResults.length > 0) {
        const latestRound = gameState.roundResults[gameState.roundResults.length - 1];
        roundResults.push({
          roundNumber: latestRound.roundNumber,
          player1Choice: latestRound.player1Choice,
          player2Choice: latestRound.player2Choice,
          winner: latestRound.winner,
          actions: [...currentRoundActions]
        });
      }
      
      // Show current scores
      if (p2Result.state.players) {
        const p1Score = p2Result.state.players.player1?.score || 0;
        const p2Score = p2Result.state.players.player2?.score || 0;
        console.log(`Scores - ${player1Id}: ${p1Score}, ${player2Id}: ${p2Score}`);
      }
      
      // Safety check for infinite loops
      if (totalActions > 20) {
        throw new Error('Too many actions - possible infinite loop');
      }
    }
    
    const finalState = gameSession.state;
    const duration = Date.now() - startTime;
    
    // Determine winner
    let winner: string | null = null;
    if (finalState.gameWinner === 'PLAYER1') {
      winner = player1Id;
    } else if (finalState.gameWinner === 'PLAYER2') {
      winner = player2Id;
    } else if (finalState.gameWinner === 'TIE') {
      winner = 'TIE';
    }
    
    console.log(chalk.green(`\nGame ${gameNumber} completed!`));
    console.log(`Winner: ${winner || 'Unknown'}`);
    console.log(`Rounds: ${rounds}, Actions: ${totalActions}, Duration: ${duration}ms`);
    console.log(`Final phase: ${finalState.gamePhase}`);
    
    return {
      gameNumber,
      success: true,
      winner,
      rounds,
      totalActions,
      duration,
      roundResults,
      finalState
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(chalk.red(`Game ${gameNumber} failed:`, error instanceof Error ? error.message : String(error)));
    
    return {
      gameNumber,
      success: false,
      winner: null,
      rounds,
      totalActions,
      duration,
      roundResults,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Run multiple complete games and analyze results
 */
program
  .command('run <gameId> [numGames]')
  .description('Run multiple complete RPS games')
  .action(async (gameId: string, numGames: string = '5') => {
    const gameCount = parseInt(numGames, 10);
    
    if (isNaN(gameCount) || gameCount < 1 || gameCount > 100) {
      console.error(chalk.red('Number of games must be between 1 and 100'));
      return;
    }
    
    try {
      console.log(chalk.blue(`Running ${gameCount} complete RPS games with GameSession...`));
      
      // Load game functions and metadata
      const exists = await functionsExist(gameId);
      if (!exists) {
        console.error(chalk.red(`Game ${gameId} not found.`));
        return;
      }
      
      const { functionCode } = await loadFunctions(gameId);
      const metadata = await loadGameMetadata(gameId);
      
      // Set up model and function registry
      const model = await setupSimulationModel();
      const functionRegistry = initializeFunctionRegistry(functionCode);
      
      const results: GameTestResult[] = [];
      const startTime = Date.now();
      
      // Run the games
      for (let i = 1; i <= gameCount; i++) {
        // Create a fresh game session for each game
        const gameSession = new GameSession({
          gameId: `${gameId}-test-${i}`,
          gameSpecification: metadata.gameSpecification,
          functionRegistry,
          model,
          initialState: {}
        });
        
        const result = await playCompleteGame(gameSession, i);
        results.push(result);
        
        // Small delay between games to avoid overwhelming the model
        if (i < gameCount) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      const totalTime = Date.now() - startTime;
      
      // Analyze results
      const summary = analyzeResults(results, totalTime);
      displayGameSummaries(results);
      displaySummary(summary);
      
    } catch (error) {
      console.error(chalk.red(`Test failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  });

/**
 * Analyze test results and generate summary
 */
function analyzeResults(results: GameTestResult[], totalTime: number): TestSummary {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  const winnerDistribution: Record<string, number> = {};
  let totalDuration = 0;
  let totalRounds = 0;
  let totalActions = 0;
  
  for (const result of successful) {
    const winner = result.winner || 'Unknown';
    winnerDistribution[winner] = (winnerDistribution[winner] || 0) + 1;
    totalDuration += result.duration;
    totalRounds += result.rounds;
    totalActions += result.totalActions;
  }
  
  const errors = failed.map(r => r.error || 'Unknown error');
  
  return {
    totalGames: results.length,
    successfulGames: successful.length,
    failedGames: failed.length,
    averageDuration: successful.length > 0 ? totalDuration / successful.length : 0,
    averageRounds: successful.length > 0 ? totalRounds / successful.length : 0,
    averageActions: successful.length > 0 ? totalActions / successful.length : 0,
    winnerDistribution,
    errors
  };
}

/**
 * Display test summary
 */
function displaySummary(summary: TestSummary): void {
  console.log(chalk.blue('\n=== TEST SUMMARY ==='));
  console.log(`Total games: ${summary.totalGames}`);
  console.log(chalk.green(`Successful: ${summary.successfulGames} (${(summary.successfulGames / summary.totalGames * 100).toFixed(1)}%)`));
  
  if (summary.failedGames > 0) {
    console.log(chalk.red(`Failed: ${summary.failedGames} (${(summary.failedGames / summary.totalGames * 100).toFixed(1)}%)`));
  }
  
  if (summary.successfulGames > 0) {
    console.log(chalk.yellow('\nPerformance:'));
    console.log(`Average duration: ${summary.averageDuration.toFixed(0)}ms`);
    console.log(`Average rounds per game: ${summary.averageRounds.toFixed(1)}`);
    console.log(`Average actions per game: ${summary.averageActions.toFixed(1)}`);
    
    console.log(chalk.yellow('\nWinner distribution:'));
    for (const [winner, count] of Object.entries(summary.winnerDistribution)) {
      const percentage = (count / summary.successfulGames * 100).toFixed(1);
      console.log(`  ${winner}: ${count} games (${percentage}%)`);
    }
  }
  
  if (summary.errors.length > 0) {
    console.log(chalk.red('\nErrors encountered:'));
    const errorCounts = summary.errors.reduce((acc, error) => {
      acc[error] = (acc[error] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    for (const [error, count] of Object.entries(errorCounts)) {
      console.log(`  ${error} (${count} times)`);
    }
  }
  
  // Overall assessment
  const successRate = summary.successfulGames / summary.totalGames;
  if (successRate >= 0.9) {
    console.log(chalk.green('\n✅ EXCELLENT: High reliability achieved'));
  } else if (successRate >= 0.7) {
    console.log(chalk.yellow('\n⚠️  GOOD: Mostly reliable with some issues'));
  } else {
    console.log(chalk.red('\n❌ POOR: Significant reliability issues detected'));
  }
}

/**
 * Display detailed game summaries
 */
function displayGameSummaries(results: GameTestResult[]): void {
  console.log(chalk.blue('\n=== DETAILED GAME SUMMARIES ==='));
  
  const successfulGames = results.filter(r => r.success);
  
  for (const game of successfulGames) {
    console.log(chalk.cyan(`\n--- Game ${game.gameNumber} Summary ---`));
    console.log(`Winner: ${game.winner} | Duration: ${(game.duration / 1000).toFixed(1)}s | Actions: ${game.totalActions}`);
    
    if (game.roundResults.length > 0) {
      console.log('Round-by-round breakdown:');
      
      for (const round of game.roundResults) {
        const winnerText = round.winner === 'TIE' ? 'TIE' 
          : round.winner === 'PLAYER1' ? 'Alice wins' 
          : 'Bob wins';
        
        console.log(`  Round ${round.roundNumber}: Alice=${round.player1Choice.toLowerCase()}, Bob=${round.player2Choice.toLowerCase()} → ${winnerText}`);
        
        // Show the action sequence
        const actionSeq = round.actions.map(a => `${a.player}:${a.action}`).join(' → ');
        console.log(`    Actions: ${actionSeq}`);
      }
    }
    
    // Show final score if available
    if (game.finalState && game.finalState.players) {
      const aliceScore = game.finalState.players.player1?.score || 0;
      const bobScore = game.finalState.players.player2?.score || 0;
      console.log(`  Final Score: Alice ${aliceScore} - ${bobScore} Bob`);
    }
  }
  
  // Show failed games if any
  const failedGames = results.filter(r => !r.success);
  if (failedGames.length > 0) {
    console.log(chalk.red('\n--- Failed Games ---'));
    for (const game of failedGames) {
      console.log(`Game ${game.gameNumber}: ${game.error}`);
    }
  }
}

program.parse(process.argv);

if (program.args.length === 0) {
  program.help();
}
