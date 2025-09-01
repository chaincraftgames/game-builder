// filepath: /Users/ericwood/dev/projects/ChainCraft/game-builder/src/ai/codeact/run-rps-example.ts
import { codeActGenerator, CodeActResult, ProgressCallback } from './discover/index.js';
import { setupModel } from './utils.js';
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";

/**
 * Run the Rock Paper Scissors example using the modular codeAct implementation
 */
const runRockPaperScissorsExample = async (): Promise<CodeActResult | { error: any }> => {
  console.log("====== Running Rock Paper Scissors Example with CodeAct ======");
  
  // Initialize the model
  const { model, MODEL_NAME } = await setupModel();
  console.log(`Using model: ${MODEL_NAME}\n`);
  
  // Setup tracer for debugging
  const chaincraftCodeactTracer = new LangChainTracer({
    projectName: "chaincraft-codeact-test",
  });
  
  // Define the Rock Paper Scissors game specification (same as in original file)
  const rockPaperScissorsSpec = `
    Game: Rock Paper Scissors
    
    Description:
    A classic two-player game where each player simultaneously chooses one of three options: rock, 
    paper, or scissors. The winner is determined by the rules: rock beats scissors, scissors beats 
    paper, and paper beats rock.
    
    Players: Exactly 2
    
    Game Flow:
    1. The game is played for exactly 3 rounds
    2. In each round, both players make a choice simultaneously
    3. The choices are compared to determine the round winner
    4. The player with more round wins at the end is the game winner
    5. If both players have the same number of round wins, the game is a tie
    
    Rules:
    - Rock beats Scissors
    - Scissors beats Paper
    - Paper beats Rock
    - If both players make the same choice, the round is a tie
    - Winning a round earns 1 point
    - Ties earn 0 points for both players
    
    Player Actions:
    - Choose Rock: Player selects rock as their move
    - Choose Paper: Player selects paper as their move
    - Choose Scissors: Player selects scissors as their move
    
    Game End Condition:
    - The game ends after exactly 3 rounds are completed
    
    Victory Condition:
    - The player with the most points after 3 rounds wins
    - If points are equal, the game is a tie
    
    Required Messages:
    - Players should be prompted to make a choice at the start of each round
    - After both players have made their choices, the round result should be announced
    - When the game ends, the final result should be announced
  `;
  
  // Progress reporting function
  const onProgress = ({ stage, message, isComplete }: ProgressCallback): void => {
    console.log(`[Stage ${stage}] ${message}`);
  };
  
  // Run the codeAct generator with the Rock Paper Scissors specification
  try {
    const results = await codeActGenerator({
      gameSpecification: rockPaperScissorsSpec,
      model,
      onProgress,
      debug: true, // Enable verbose logging
      output: {
        // Configure which sections to display in the output
        showAnalysis: true,
        showSchema: true,
        showRuntimePlan: true,
        showFunctionDesign: true,
        showImplementation: true,
        showTestResults: true,
        showPerformance: true
      }
    });
    
    return results;
  } catch (error) {
    console.error("Error running CodeAct generator:", error);
    return { error };
  }
};

// Run the example
runRockPaperScissorsExample().catch(console.error);