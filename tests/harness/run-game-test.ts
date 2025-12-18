#!/usr/bin/env node
/**
 * CLI Script to run a specific game test
 * 
 * Usage:
 *   npm run test:game <game-name> [--gameId=<id>]
 * 
 * Examples:
 *   npm run test:game rps
 *   npm run test:game rps -- --gameId=rps-1734480000000-abc123
 *   npm run test:game space-odyssey
 */

import { executeGameTest } from "./executor.js";
import { getGameTest, listGameTestNames } from "../games/index.js";
import { createGameId } from "./helpers.js";
import { setConfig } from "#chaincraft/config.js";

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Game Test Runner

Usage:
  npm run test:game <game-name> [-- --gameId=<id>]

Arguments:
  game-name    Name of the game test to run (see available tests below)
  --gameId     (Optional) Specific game ID to reuse existing artifacts

Available Tests:
${listGameTestNames().map(name => `  - ${name}`).join('\n')}

Examples:
  # Generate fresh artifacts and run all scenarios
  npm run test:game rps
  
  # Reuse existing artifacts for faster iteration/debugging
  npm run test:game rps -- --gameId=rps-1734480000000-abc123
  
  # Run space odyssey test
  npm run test:game space-odyssey
`);
    process.exit(0);
  }
  
  const gameName = args[0];
  const gameIdArg = args.find(arg => arg.startsWith('--gameId='));
  const gameId = gameIdArg 
    ? gameIdArg.split('=')[1] 
    : createGameId(gameName.toLowerCase().replace(/\s+/g, '-'));
  
  const usingExistingArtifacts = !!gameIdArg;
  
  // Configure test simulation
  setConfig("simulation-graph-type", "test-game-simulation");
  
  try {
    // Get the test
    const test = getGameTest(gameName);
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`GAME TEST: ${test.name}`);
    console.log(`Game ID: ${gameId} ${usingExistingArtifacts ? '(reusing artifacts)' : '(fresh artifacts)'}`);
    console.log(`Scenarios: ${test.scenarios.length}`);
    console.log(`${'='.repeat(80)}\n`);
    
    const results = [];
    
    // Run all scenarios with the same game ID
    for (let i = 0; i < test.scenarios.length; i++) {
      const scenario = test.scenarios[i];
      
      console.log(`\n--- Scenario ${i + 1}/${test.scenarios.length}: ${scenario.name} ---`);
      console.log(`Description: ${scenario.description}\n`);
      
      const result = await executeGameTest(test, scenario, gameId);
      results.push(result);
      
      // Print result summary
      console.log(`\n${result.passed ? '✅ PASSED' : '❌ FAILED'} - ${result.duration}ms`);
      
      if (result.artifactErrors) {
        console.log('\nArtifact Errors:');
        result.artifactErrors.forEach(err => console.log(`  - ${err}`));
      }
      
      if (result.simulationError) {
        console.log(`\nSimulation Error: ${result.simulationError}`);
      }
      
      if (result.assertionResults.length > 0) {
        console.log('\nAssertions:');
        result.assertionResults.forEach(a => {
          console.log(`  ${a.passed ? '✓' : '✗'} ${a.message}`);
        });
      }
      
      // Stop on first failure unless --continue flag is set
      if (!result.passed && !args.includes('--continue')) {
        console.log('\n⚠️  Stopping on first failure (use --continue to run all scenarios)');
        break;
      }
    }
    
    // Final summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('TEST SUMMARY');
    console.log(`${'='.repeat(80)}`);
    
    const passed = results.filter(r => r.passed).length;
    const failed = results.length - passed;
    
    console.log(`Total Scenarios: ${results.length}`);
    console.log(`Passed: ${passed} ✅`);
    console.log(`Failed: ${failed} ❌`);
    console.log(`Success Rate: ${((passed / results.length) * 100).toFixed(1)}%`);
    
    if (usingExistingArtifacts) {
      console.log(`\nArtifacts reused from: ${gameId}`);
    } else {
      console.log(`\nArtifacts generated with ID: ${gameId}`);
      console.log(`To reuse these artifacts, run:`);
      console.log(`  npm run test:game ${gameName} -- --gameId=${gameId}`);
    }
    
    console.log(`${'='.repeat(80)}\n`);
    
    process.exit(failed > 0 ? 1 : 0);
    
  } catch (error) {
    console.error(`\n❌ Error running test: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
