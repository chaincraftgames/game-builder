// filepath: /Users/ericwood/dev/projects/ChainCraft/game-builder/src/ai/codeact/runtime-planner.ts
import { invokeModel } from '../utils.js';
import { GameAnalysis } from '../analyzer.js';
import { StateSchemaResult } from './schema-designer.js';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * Runtime plan interface
 */
export interface RuntimePlan {
  fullText: string;
}

/**
 * Runtime planning result interface
 */
export interface RuntimePlanningResult {
  runtimePlan: RuntimePlan;
  runtimePlanTime: number;
}

/**
 * Runtime planning options interface
 */
export interface RuntimePlanningOptions {
  gameSpecification: string;
  analysis: {
    fullText: string;
    [key: string]: any;
  };
  stateSchema: StateSchemaResult;
}

/**
 * Stage 3: Runtime interaction planning
 * @param {BaseChatModel} model - The language model to use
 * @param {RuntimePlanningOptions} options - Options object
 * @returns {Promise<RuntimePlanningResult>} Runtime plan and timing information
 */
export const createRuntimePlan = async (
  model: BaseChatModel, 
  { gameSpecification, analysis, stateSchema }: RuntimePlanningOptions
): Promise<RuntimePlanningResult> => {
  console.log("🎮 Stage 3: Planning runtime interactions...");
  const startTime = Date.now();
  
  const prompt = `
    You are an AI game master running a ${gameSpecification} game.
    
    Game Analysis:
    ${analysis.fullText}
    
    Game State Schema:
    ${stateSchema.schema}
    
    Imagine you are running this game with players in real-time.
    Create a detailed outline of how you would:
    
    1. Initialize the game
    2. Interact with players throughout gameplay
    3. Process player inputs
    4. Update game state
    5. Communicate game state to players
    6. Handle game progression
    7. Determine and announce results
    
    For each step, describe:
    - What information you need from the state
    - What decisions you need to make
    - What messages you need to send to players
    - What state updates you need to make
    
    Write this as a pseudocode walkthrough of how you would run the game,
    including examples of player interactions and your responses.
    
    Focus on what YOU as the AI would need to do at runtime,
    not on the implementation details of functions.
    
    Format your response using markdown with clear sections for:
    - Initialization process
    - Player interactions and triggers
    - Game flow description
    - Example dialog
  `;
  
  const response = await invokeModel(model, prompt);
  
  const runtimePlanTime = Date.now() - startTime;
  console.log(`✅ Runtime interaction planning completed in ${runtimePlanTime}ms`);
  
  // Extract any specific structured data needed for the next stage
  const runtimePlan: RuntimePlan = {
    fullText: response.content
  };
  
  return { 
    runtimePlan,
    runtimePlanTime
  };
};