/**
 * Simplified GameSession abstraction that replaces the complex ModelExecutor approach.
 * 
 * This maintains the sandbox safety while eliminating unnecessary orchestration layers.
 * Safe functions (pre-loaded modules) vs unsafe functions (AI-generated via Function constructor)
 * distinction is preserved for the future ECS architecture.
 */

import { ModelWithOptions, invokeModel } from "../model-config.js";
import { GameCodeSandbox } from "../sandbox/sandbox.js";
import { FunctionRegistry } from "../function-registry.js";

export interface GameSessionResult {
  state: any;
  messages: {
    public: string[];
    private: Record<string, string[]>;
  };
}

export interface GameSessionOptions {
  gameId: string;
  gameSpecification: string;
  functionRegistry: FunctionRegistry;
  model: ModelWithOptions;
  initialState?: any;
}

/**
 * Simplified game session that handles CodeAct execution with proper sandboxing
 * but eliminates complex state tracking and execution contexts.
 */
export class GameSession {
  private gameId: string;
  private gameSpecification: string;
  private sandbox: GameCodeSandbox;
  private model: ModelWithOptions;
  private functionRegistry: FunctionRegistry;
  
  public state: any;

  constructor(options: GameSessionOptions) {
    this.gameId = options.gameId;
    this.gameSpecification = options.gameSpecification;
    this.model = options.model;
    this.functionRegistry = options.functionRegistry;
    this.state = options.initialState || {};
    
    // Initialize sandbox with function registry
    this.sandbox = new GameCodeSandbox({ debugMode: true });
    this.initializeSandbox();
  }

  /**
   * Initialize the sandbox with unsafe functions from the registry
   */
  private async initializeSandbox(): Promise<void> {
    const unsafeFunctions = this.functionRegistry.getAllFunctions();
    
    for (const funcDef of unsafeFunctions) {
      await this.sandbox.registerUnsafeFunction(funcDef);
    }
  }

  /**
   * Initialize a new game with the given players
   */
  async initializeGame(playerIds: string[]): Promise<GameSessionResult> {
    console.log(`[GameSession] Initializing game ${this.gameId} with players:`, playerIds);
    
    const functionDocs = this.getFunctionDocumentation();
    const prompt = this.createInitPrompt(playerIds, functionDocs);
    
    try {
      const response = await invokeModel(this.model, prompt);
      const code = this.extractCodeFromResponse(response.content as string, 'initializeGame');
      
      if (!code) {
        throw new Error('Failed to extract initialization code from model response');
      }

      const result = await this.sandbox.execute(
        this.wrapInitCode(code),
        { playerIds, gameSpec: this.gameSpecification },
        { timeoutMs: 10000 }
      );

      if (result.error) {
        throw new Error(`Initialization failed: ${result.error}`);
      }

      const gameResult = this.validateGameResult(result.result);
      this.state = gameResult.state;
      
      console.log(`[GameSession] Game initialized successfully`);
      return gameResult;

    } catch (error) {
      console.error(`[GameSession] Failed to initialize game:`, error);
      throw error;
    }
  }

  /**
   * Process a player action
   */
  async processAction(playerId: string, action: string): Promise<GameSessionResult> {
    console.log(`[GameSession] Processing action for player ${playerId}: ${action}`);
    
    const functionDocs = this.getFunctionDocumentation();
    const prompt = this.createActionPrompt(playerId, action, functionDocs);
    
    try {
      const response = await invokeModel(this.model, prompt);
      const code = this.extractCodeFromResponse(response.content as string, 'processAction');
      
      if (!code) {
        throw new Error('Failed to extract action processing code from model response');
      }

      const result = await this.sandbox.execute(
        this.wrapActionCode(code),
        { 
          playerId, 
          action, 
          currentState: { ...this.state },
          gameSpec: this.gameSpecification 
        },
        { timeoutMs: 5000 }
      );

      if (result.error) {
        // Simple retry with error context
        console.warn(`[GameSession] Action failed, retrying with error context:`, result.error);
        return this.retryActionWithError(playerId, action, result.error, functionDocs);
      }

      const gameResult = this.validateGameResult(result.result);
      this.state = gameResult.state;
      
      console.log(`[GameSession] Action processed successfully`);
      return gameResult;

    } catch (error) {
      console.error(`[GameSession] Failed to process action:`, error);
      throw error;
    }
  }

  /**
   * Retry failed action with error context
   */
  private async retryActionWithError(
    playerId: string, 
    action: string, 
    errorMessage: string, 
    functionDocs: string
  ): Promise<GameSessionResult> {
    const retryPrompt = this.createErrorRecoveryPrompt(playerId, action, errorMessage, functionDocs);
    
    const response = await invokeModel(this.model, retryPrompt);
    const code = this.extractCodeFromResponse(response.content as string, 'processAction');
    
    if (!code) {
      throw new Error('Failed to extract retry code from model response');
    }

    const result = await this.sandbox.execute(
      this.wrapActionCode(code),
      { 
        playerId, 
        action, 
        currentState: { ...this.state },
        gameSpec: this.gameSpecification 
      },
      { timeoutMs: 10000 }
    );

    if (result.error) {
      throw new Error(`Action retry failed: ${result.error}`);
    }

    const gameResult = this.validateGameResult(result.result);
    this.state = gameResult.state;
    return gameResult;
  }

  /**
   * Get function documentation for prompts
   */
  private getFunctionDocumentation(): string {
    const functions = this.functionRegistry.getAllFunctions();
    return functions.map(fn => {
      return `${fn.name}: ${fn.description}`;
    }).join('\n\n');
  }

  /**
   * Create initialization prompt
   */
  private createInitPrompt(playerIds: string[], functionDocs: string): string {
    return `You are a game master AI that initializes games using available functions.

Game Specification:
${this.gameSpecification}

Available Functions:
${functionDocs}

Task: Initialize a new game for players: ${playerIds.join(', ')}

Write a function that initializes the game and returns:
{ state: gameState, messages: { public: string[], private: { playerId: string[] } } }

Implement this function:
\`\`\`javascript
function ai_initializeGame(playerIds, gameSpec) {
  // Your implementation here using available functions
  // Return { state: newState, messages: { public: [], private: {} } }
}
\`\`\``;
  }

  /**
   * Create action processing prompt
   */
  private createActionPrompt(playerId: string, action: string, functionDocs: string): string {
    return `You are a game master AI that processes player actions using available functions.

Game Specification:
${this.gameSpecification}

Available Functions:
${functionDocs}

Current State:
${JSON.stringify(this.state, null, 2)}

Task: Process action "${action}" from player "${playerId}"

Write a function that processes the action and returns the updated state:
\`\`\`javascript
function ai_processAction(playerId, action, currentState, gameSpec) {
  // Your implementation here using available functions
  // Return { state: updatedState, messages: { public: [], private: {} } }
}
\`\`\``;
  }

  /**
   * Create error recovery prompt
   */
  private createErrorRecoveryPrompt(
    playerId: string, 
    action: string, 
    errorMessage: string, 
    functionDocs: string
  ): string {
    return `You are a game master AI fixing a failed action processing attempt.

Game Specification:
${this.gameSpecification}

Available Functions:
${functionDocs}

Current State:
${JSON.stringify(this.state, null, 2)}

Previous Error: ${errorMessage}

Task: Fix the error and process action "${action}" from player "${playerId}"

Write a corrected function:
\`\`\`javascript
function ai_processAction(playerId, action, currentState, gameSpec) {
  // Your corrected implementation here
  // Address the previous error: ${errorMessage}
  // Return { state: updatedState, messages: { public: [], private: {} } }
}
\`\`\``;
  }

  /**
   * Extract code from model response
   */
  private extractCodeFromResponse(response: string, functionName: string): string | null {
    const codeBlockRegex = /```(?:javascript|js)?\s*([\s\S]*?)\s*```/;
    const match = response.match(codeBlockRegex);
    
    if (!match || !match[1]) {
      console.warn(`[GameSession] No code block found in response for ${functionName}`);
      return null;
    }
    
    return match[1].trim();
  }

  /**
   * Wrap initialization code for execution
   */
  private wrapInitCode(code: string): string {
    return `
      ${code}
      return ai_initializeGame(playerIds, gameSpec);
    `;
  }

  /**
   * Wrap action processing code for execution
   */
  private wrapActionCode(code: string): string {
    return `
      ${code}
      return ai_processAction(playerId, action, currentState, gameSpec);
    `;
  }

  /**
   * Validate and format game result
   */
  private validateGameResult(result: any): GameSessionResult {
    if (!result || typeof result !== 'object') {
      throw new Error('Game result must be an object');
    }

    if (!result.state) {
      throw new Error('Game result must include state');
    }

    // Ensure messages have the correct structure
    const messages = {
      public: Array.isArray(result.messages?.public) ? result.messages.public : [],
      private: result.messages?.private && typeof result.messages.private === 'object' 
        ? result.messages.private 
        : {}
    };

    return {
      state: result.state,
      messages
    };
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    await this.sandbox.dispose();
  }
}
