/**
 * Router Node - Deterministic Phase Transition Routing
 * 
 * The Router is a pure deterministic function that:
 * 1. Checks if player input is present and required
 * 2. Evaluates automatic transitions from current phase
 * 3. Routes to appropriate next step or detects deadlock
 * 
 * Key Responsibilities:
 * - Parse transitions artifact
 * - Evaluate JsonLogic preconditions
 * - Determine which transition fires (if any)
 * - Detect deadlock conditions
 * - Select appropriate instructions for next step
 * 
 * No LLM calls - fully deterministic based on:
 * - Current game state
 * - Transitions artifact
 * - JsonLogic evaluation
 */

import { getActionsAllowed } from '#chaincraft/ai/simulate/simulate-workflow.js';

import type { RuntimeStateType } from '../../runtime-state.js';
import { buildRouterContext, jsonLogic } from '#chaincraft/ai/simulate/logic/jsonlogic.js';
import type { 
  BaseRuntimeState,
  Transition,
  TransitionsArtifact
} from '#chaincraft/ai/simulate/schema.js';
import { RuntimePlayerState } from '#chaincraft/ai/simulate/schema.js';
import { processRngInstructions } from './rng-utils.js';
import { createPlayerMapping, serializePlayerMapping } from '#chaincraft/ai/simulate/player-mapping.js';

/**
 * Router result
 */
interface RouterResult {
  // Routing decision
  hasPlayerInput: boolean;
  transitionTriggered: boolean;
  transitionId?: string;
  transitionName?: string;
  nextPhase?: string;
  
  // Instructions for next step
  selectedInstructions: string;
  
  // Error handling
  hasError: boolean;
  errorType?: 'deadlock' | 'invalid_state' | 'rule_violation' | 'transition_failed';
  errorMessage?: string;
  errorContext?: any;
}

/**
 * Router node function
 */
export function router() {
  return async (state: RuntimeStateType): Promise<Partial<RuntimeStateType>> => {
    console.log('[router] Starting routing decision...');
    
    try {
      // Parse artifacts - handle both string and object forms from checkpoint
      // Empty gameState means this is initialization, use defaults
      const gameState: BaseRuntimeState = typeof state.gameState === 'string' 
        ? (state.gameState ? JSON.parse(state.gameState) : { game: { gameEnded: false }, players: {} })
        : state.gameState as any;
      const transitions: TransitionsArtifact = typeof state.stateTransitions === 'string'
        ? JSON.parse(state.stateTransitions)
        : state.stateTransitions as any;
      
      // Check for existing error
      if (gameState.game?.gameError) {
        console.log('[router] Game already in error state, passing through');
        return {
          requiresPlayerInput: false,
          transitionReady: false,
        };
      }
      
      // Check if game has already ended - prevents infinite loops on finished phase
      if (gameState.game?.gameEnded) {
        console.log('[router] Game already ended, no more transitions to process');
        return {
          requiresPlayerInput: false,
          transitionReady: false,
        };
      }
      
      // Handle initialization - find initialize_game transition from init phase
      if (!state.isInitialized) {
        console.log('[router] Game not initialized, looking for initialize_game transition');
        const firstPhase = transitions.phases[0];
        
        // Create player mapping if not already present
        let playerMapping = state.playerMapping;
        if (!playerMapping || playerMapping === "{}") {
          console.log('[router] Creating player mapping for initialization');
          const mapping = createPlayerMapping(state.players || []);
          playerMapping = serializePlayerMapping(mapping);
          console.log('[router] Player mapping created:', playerMapping);
        }
        
        // Find the initialize_game transition (should be from init -> first gameplay phase)
        const initTransition = transitions.transitions.find(
          t => t.id === 'initialize_game'
        ) || transitions.transitions.find(
          t => t.fromPhase === 'init' 
        );
        
        if (!initTransition) {
          return handleError(
            gameState,
            'invalid_state',
            'Initialize transition not found from init phase',
            { firstPhase, availableTransitions: transitions.transitions.map(t => t.id) }
          );
        }
        
        const instructions = state.transitionInstructions[initTransition.id];
        if (!instructions) {
          return handleError(
            gameState,
            'invalid_state',
            `Initialize transition instructions not found: ${initTransition.id}`,
            { transitionId: initTransition.id, availableTransitions: Object.keys(state.transitionInstructions) }
          );
        }
        
        console.log(`[router] Routing to initialize via transition: ${initTransition.id} (${firstPhase} -> ${initTransition.toPhase})`);
        return {
          currentPhase: firstPhase,
          nextPhase: initTransition.toPhase,
          selectedInstructions: instructions,
          playerMapping, // Store the mapping in state
          requiresPlayerInput: false,
          transitionReady: true, // Ready to execute initialization transition
        };
      }
      
      // Get current phase directly from game state (required field)
      const currentPhase = gameState.game.currentPhase;
      console.log(`[router] Current phase: ${currentPhase}`);

      const phaseMetadata = transitions.phaseMetadata.find(p => p.phase === currentPhase);
      
      // Check if we have player input
      const hasPlayerInput = 
        !!state.playerAction && 
        state.playerAction.playerId.trim().length > 0 &&
        state.playerAction.playerAction.trim().length > 0;
      console.log(`[router] Has player input: ${hasPlayerInput}`);
      
      // Validate player exists in state before checking input
      const actingPlayer = hasPlayerInput ? gameState.players[state.playerAction!.playerId] : undefined;
      
      if (
        phaseMetadata?.requiresPlayerInput &&
        hasPlayerInput && 
        actingPlayer &&
        playerInputIsValid(
            state.playerAction!.playerAction, 
            actingPlayer
        )
      ) {
        const instructions = state.playerPhaseInstructions[currentPhase];
        if (!instructions) {
          return handleError(
            gameState,
            'invalid_state',
            `Player phase instructions not found: ${currentPhase}`,
            { currentPhase, availablePhases: Object.keys(state.playerPhaseInstructions) }
          );
        }
        
        console.log(`[router] Routing to change agent with player action instructions: ${currentPhase}`);
        
        // Resolve any RNG templates in instructions before passing to execute-changes
        const resolvedInstructions = processRngInstructions(instructions);
        
        return {
          currentPhase,
          selectedInstructions: resolvedInstructions,
          requiresPlayerInput: false,
          transitionReady: true, // Instructions selected and ready to execute
        };
      }
      
      // No player input - check if player input is required
      const playerInputRequired = gameState.players && typeof gameState.players === 'object'
        ? Object.values(gameState.players).some(
            ({actionRequired}) => actionRequired
          )
        : false;
      
      if (playerInputRequired) {
        console.log('[router] Waiting for player input');
        return {
          currentPhase,
          gameState: JSON.stringify(gameState),
          requiresPlayerInput: true,
          transitionReady: false,
        };
      }
      
      // No player input required - check automatic transitions
      const transition = findTriggeredTransition(
        currentPhase,
        gameState,
        transitions
      );
      
      if (transition) {
        // Transition found - use transition instructions to execute it
        const instructions = state.transitionInstructions[transition.id];
        
        if (!instructions) {
          return handleError(
            gameState,
            'invalid_state',
            `Transition instructions not found: ${transition.id}`,
            { transitionId: transition.id, availableTransitions: Object.keys(state.transitionInstructions) }
          );
        }
        
        console.log(`[router] Transition triggered: ${transition.id}`);
        console.log(`[router] Next phase: ${transition.toPhase}`);
        
        // Resolve any RNG templates in instructions before passing to execute-changes
        const resolvedInstructions = processRngInstructions(instructions);
        
        return {
          currentPhase,
          selectedInstructions: resolvedInstructions,
          requiresPlayerInput: false,
          transitionReady: true,
          nextPhase: transition.toPhase,
        };
      }
      
      // No transition found and no player input required - DEADLOCK
      if (!gameState.game.gameEnded) {
        console.error('[router] DEADLOCK: No player input required and no transitions can fire');
        return handleError(
          gameState,
          'deadlock',
          `Game deadlocked in phase: ${currentPhase}. No player input required and no automatic transitions can fire.`,
          { 
            currentPhase,
            availableTransitions: transitions.transitions
              .filter(t => t.fromPhase === currentPhase)
              .map(t => ({ id: t.id, fromPhase: t.fromPhase, toPhase: t.toPhase }))
          }
        );
      }
      
      // Game ended - no error, just waiting
      console.log('[router] Game ended, no further routing');
      return {
        currentPhase,
        requiresPlayerInput: false,
        transitionReady: false,
      };
      
    } catch (error) {
      console.error('[router] Error during routing:', error);
      return handleError(
        JSON.parse(state.gameState || '{"game":{"gameEnded":false},"players":{}}'),
        'invalid_state',
        `Router error: ${error instanceof Error ? error.message : String(error)}`,
        { error: String(error) }
      );
    }
  };
}

function playerInputIsValid(
  playerAction: string, 
  playerState: RuntimePlayerState
): boolean {
  // Basic validation: player is allowed to act
  // Uses helper to get effective actionsAllowed value (defaults to actionRequired if not set)
  return getActionsAllowed(playerState) === true;
}

/**
 * Find automatic transition that can fire from current phase
 * 
 * Evaluates transitions in artifact order and returns first match.
 * This ensures deterministic priority when multiple transitions could fire.
 */
function findTriggeredTransition(
  currentPhase: string,
  gameState: BaseRuntimeState,
  transitions: TransitionsArtifact
): Transition | null {
  // Filter to automatic transitions from current phase
  const candidates = transitions.transitions.filter(
    t => t.fromPhase === currentPhase
  );
  
  if (candidates.length === 0) {
    return null;
  }
  
  // Build context for JsonLogic evaluation: full game state + computed context
  const routerContext = buildRouterContext(gameState);
  const context = {
    ...gameState,
    ...routerContext,
  };
  
  // Evaluate each candidate in order
  for (const transition of candidates) {
    console.log(`[router] Evaluating transition: ${transition.id}`);
    
    // Check all preconditions
    let allPreconditionsMet = true;
    
    for (const precondition of transition.preconditions) {
      if (!precondition.deterministic) {
        console.warn(`[router] Skipping non-deterministic precondition: ${precondition.id}`);
        continue;
      }
      
      try {
        const result = jsonLogic.apply(precondition.logic, context);
        console.log(`[router]   Precondition ${precondition.id}: ${result}`);
        
        if (!result) {
          allPreconditionsMet = false;
          break;
        }
      } catch (error) {
        console.error(`[router] Error evaluating precondition ${precondition.id}:`, error);
        allPreconditionsMet = false;
        break;
      }
    }
    
    if (allPreconditionsMet) {
      console.log(`[router] ✅ Transition ${transition.id} triggered`);
      return transition;
    }
  }
  
  console.log('[router] No automatic transitions triggered');
  return null;
}

/**
 * Handle error by setting error state in game state
 */
function handleError(
  gameState: BaseRuntimeState,
  errorType: 'deadlock' | 'invalid_state' | 'rule_violation' | 'transition_failed',
  errorMessage: string,
  errorContext?: any
): Partial<RuntimeStateType> {
  // Set error in game state
  gameState.game.gameError = {
    errorType,
    errorMessage,
    errorContext,
    timestamp: new Date().toISOString(),
  };
  
  // Set public message to inform players
  gameState.game.publicMessage = `Game Error: ${errorMessage}`;
  
  console.error(`[router] ERROR: ${errorType} - ${errorMessage}`, errorContext);
  
  return {
    gameState: JSON.stringify(gameState),
    requiresPlayerInput: false,
    transitionReady: false,
  };
}
