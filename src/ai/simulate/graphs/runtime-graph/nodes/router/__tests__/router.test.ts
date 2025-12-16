/**
 * Router Node Tests
 * 
 * Tests deterministic routing logic using RPS fixture with mapping system
 */

import { router } from '../index.js';
import { loadGameFixture } from '#chaincraft/ai/simulate/test/fixtures/fixture-loader.js';
import { FixtureHelper } from '#chaincraft/ai/simulate/test/fixtures/fixture-helper.js';
import { rpsMapping } from '#chaincraft/ai/simulate/test/fixtures/fixture-mappings.js';
import type { RuntimeStateType } from '../../../runtime-state.js';

describe('Router Node', () => {
  let rpsFixture: any;
  let helper: FixtureHelper;
  
  beforeAll(async () => {
    rpsFixture = await loadGameFixture('rps');
    helper = new FixtureHelper(rpsFixture, rpsMapping);
  });
  
  describe('Initialization', () => {
    it('should handle init phase and find initialize_game transition', async () => {
      const routerNode = router();
      
      // Game not initialized - should route to init phase
      const gameState = helper.createGameState({ phase: helper.getInitPhase() });
      const initialState: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(gameState),
        stateTransitions: JSON.stringify(rpsFixture.transitions),
        playerPhaseInstructions: rpsFixture.instructions.playerPhases || {},
        transitionInstructions: rpsFixture.instructions.transitions || {},
        isInitialized: false,
        playerAction: undefined
      };
      
      const result = await routerNode(initialState as RuntimeStateType);
      
      // Should route to init phase with initialize_game transition ready
      expect(result.currentPhase).toBe(helper.getInitPhase());
      expect(result.transitionReady).toBe(true);
      expect(result.nextPhase).toBe(helper.getFirstActivePhase());
      expect(result.requiresPlayerInput).toBe(false);
      expect(result.selectedInstructions).toBeDefined();
    });
  });
  
  describe('Player Input Routing', () => {
    it('should route to change agent when player input is present', async () => {
      const routerNode = router();
      
      // Create initialized state with player input
      const gameState = helper.createGameState({ 
        phase: helper.getFirstActivePhase(),
        publicMessage: 'Choose your move'
      });
      gameState.players = {
        player1: helper.createPlayerState({ 
          actionsAllowed: ['rock', 'paper', 'scissors'],
          actionRequired: true
        }),
        player2: helper.createPlayerState({ 
          actionsAllowed: ['rock', 'paper', 'scissors'],
          actionRequired: true
        })
      };
      
      const initialState: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(gameState),
        stateTransitions: JSON.stringify(rpsFixture.transitions),
        playerPhaseInstructions: rpsFixture.instructions.playerPhases || {},
        transitionInstructions: rpsFixture.instructions.transitions || {},
        isInitialized: true,
        playerAction: {
          playerId: 'player1',
          playerAction: 'rock'
        }
      };
      
      const result = await routerNode(initialState as RuntimeStateType);
      
      // Should route to change agent with player action instructions
      expect(result.requiresPlayerInput).toBe(false);
      expect(result.transitionReady).toBe(false);
      expect(result.selectedInstructions).toBeDefined();
      expect(result.currentPhase).toBe(helper.getFirstActivePhase());
    });
    
    it('should wait for player input when required', async () => {
      const routerNode = router();
      
      const gameState = helper.createGameState({ 
        phase: helper.getFirstActivePhase(),
        publicMessage: 'Choose your move'
      });
      gameState.players = {
        player1: helper.createPlayerState({ 
          actionsAllowed: ['rock', 'paper', 'scissors'],
          actionRequired: true
        }),
        player2: helper.createPlayerState({ 
          actionsAllowed: ['rock', 'paper', 'scissors'],
          actionRequired: false
        })
      };
      
      const initialState: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(gameState),
        stateTransitions: JSON.stringify(rpsFixture.transitions),
        playerPhaseInstructions: rpsFixture.instructions.playerPhases || {},
        transitionInstructions: rpsFixture.instructions.transitions || {},
        isInitialized: true,
        playerAction: undefined
      };
      
      const result = await routerNode(initialState as RuntimeStateType);
      
      // Should wait for player input
      expect(result.requiresPlayerInput).toBe(true);
      expect(result.transitionReady).toBe(false);
    });
  });
  
  describe('Automatic Transition Routing', () => {
    it('should trigger automatic transition when preconditions met', async () => {
      const routerNode = router();
      
      // State in reveal phase with scores below winning threshold
      // Should automatically trigger continue_next_round transition
      const gameState = helper.createGameState({
        phase: helper.getResolvePhase()!,
      });
      helper.setGameField(gameState.game, "round", 1);
      gameState.players = {
        player1: helper.createPlayerState({ 
          score: 1,
          choice: "rock",
          actionsAllowed: [],
          actionRequired: false
        }),
        player2: helper.createPlayerState({ 
          score: 0,
          choice: "scissors",
          actionsAllowed: [],
          actionRequired: false
        }),
      };
      
      const initialState: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(gameState),
        stateTransitions: JSON.stringify(rpsFixture.transitions),
        playerPhaseInstructions: rpsFixture.instructions.playerPhases || {},
        transitionInstructions: rpsFixture.instructions.transitions || {},
        isInitialized: true,
        playerAction: undefined
      };
      
      const result = await routerNode(initialState as RuntimeStateType);
      
      // Should trigger automatic transition (resolve_round)
      expect(result.transitionReady).toBe(true);
      expect(result.nextPhase).toBe(helper.getFirstActivePhase()); // Should go back to choice_submission
      expect(result.selectedInstructions).toBeDefined();
      expect(result.requiresPlayerInput).toBe(false);
    });
    
    it('should trigger game_won transition when winning score reached', async () => {
      const routerNode = router();
      
      // State in resolve phase with player1 at winning score (3)
      // continue_next_round requires all scores < 3 (not satisfied)
      // winner_reached_three checks for score >= 3 (satisfied)
      const gameState = helper.createGameState({
        phase: helper.getResolvePhase()!,
      });
      helper.setGameField(gameState.game, "round", 3);
      gameState.players = {
        player1: helper.createPlayerState({ 
          score: 3, // Winning score
          choice: "rock",
          actionsAllowed: [],
          actionRequired: false
        }),
        player2: helper.createPlayerState({ 
          score: 1,
          choice: "scissors",
          actionsAllowed: [],
          actionRequired: false
        }),
      };
      
      const initialState: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(gameState),
        stateTransitions: JSON.stringify(rpsFixture.transitions),
        playerPhaseInstructions: rpsFixture.instructions.playerPhases || {},
        transitionInstructions: rpsFixture.instructions.transitions || {},
        isInitialized: true,
        playerAction: undefined
      };
      
      const result = await routerNode(initialState as RuntimeStateType);
      
      // Should trigger game_won transition
      expect(result.transitionReady).toBe(true);
      expect(result.nextPhase).toBe(helper.getFinalPhase()); // Should go to game_finished
      expect(result.selectedInstructions).toBeDefined();
      expect(result.requiresPlayerInput).toBe(false);
    });
  });
  
  describe('Error Handling', () => {
    it('should detect deadlock when no transitions can fire', async () => {
      const routerNode = router();
      
      // Create impossible state - no player input required, no transitions can fire
      const initialState: Partial<RuntimeStateType> = {
        gameState: JSON.stringify({
          game: {
            gameEnded: false,
            currentPhase: 'impossible_phase',
            publicMessage: 'Stuck'
          },
          players: {
            player1: {
              illegalActionCount: 0,
              actionsAllowed: [],
              actionRequired: false
            }
          }
        }),
        stateTransitions: JSON.stringify(rpsFixture.transitions),
        playerPhaseInstructions: rpsFixture.instructions.playerPhases || {},
        transitionInstructions: rpsFixture.instructions.transitions || {},
        isInitialized: true,
        playerAction: undefined
      };
      
      const result = await routerNode(initialState as RuntimeStateType);
      
      // Router should return gameState when error occurs
      expect(result.gameState).toBeDefined();
      if (result.gameState) {
        const gameState = JSON.parse(result.gameState);
        expect(gameState.game.gameError).toBeDefined();
        expect(gameState.game.gameError.errorType).toBe('deadlock');
      }
    });
    
    it('should handle missing instructions gracefully', async () => {
      const routerNode = router();
      
      const gameState = helper.createGameState({
        phase: helper.getFirstActivePhase(),
        publicMessage: 'Choose'
      });
      gameState.players = {
        player1: helper.createPlayerState({
          actionsAllowed: ['rock'],
          actionRequired: true
        })
      };
      
      const initialState: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(gameState),
        stateTransitions: JSON.stringify(rpsFixture.transitions),
        playerPhaseInstructions: {}, // Empty - missing instructions
        transitionInstructions: {},
        isInitialized: true,
        playerAction: {
          playerId: 'player1',
          playerAction: 'rock'
        }
      };
      
      const result = await routerNode(initialState as RuntimeStateType);
      
      // Should handle missing instructions
      expect(result.gameState).toBeDefined();
      if (result.gameState) {
        const resultGameState = JSON.parse(result.gameState);
        expect(resultGameState.game.gameError).toBeDefined();
      }
    });
    
    it('should pass through if game already has error', async () => {
      const routerNode = router();
      
      const initialState: Partial<RuntimeStateType> = {
        gameState: JSON.stringify({
          game: {
            gameEnded: false,
            gameError: {
              errorType: 'deadlock',
              errorMessage: 'Previous error',
              timestamp: new Date().toISOString()
            },
            currentPhase: 'error_state'
          },
          players: {}
        }),
        stateTransitions: JSON.stringify(rpsFixture.transitions),
        playerPhaseInstructions: rpsFixture.instructions.playerPhases || {},
        transitionInstructions: rpsFixture.instructions.transitions || {},
        isInitialized: true
      };
      
      const result = await routerNode(initialState as RuntimeStateType);
      
      // Should pass through without further routing
      expect(result.requiresPlayerInput).toBe(false);
      expect(result.transitionReady).toBe(false);
    });
  });
  
  describe('Game End State', () => {
    it('should handle game ended state gracefully', async () => {
      const routerNode = router();
      
      const gameState = helper.createGameState({ 
        phase: helper.getFinalPhase(),
        gameEnded: true,
        publicMessage: 'Game Over'
      });
      gameState.players = {
        player1: helper.createPlayerState({ 
          actionsAllowed: [],
          actionRequired: false
        })
      };
      
      const initialState: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(gameState),
        stateTransitions: JSON.stringify(rpsFixture.transitions),
        playerPhaseInstructions: rpsFixture.instructions.playerPhases || {},
        transitionInstructions: rpsFixture.instructions.transitions || {},
        isInitialized: true,
        playerAction: undefined
      };
      
      const result = await routerNode(initialState as RuntimeStateType);
      
      // Should not error or deadlock
      expect(result.requiresPlayerInput).toBe(false);
      expect(result.transitionReady).toBe(false);
      
      const resultGameState = JSON.parse(result.gameState || initialState.gameState!);
      expect(resultGameState.game.gameError).toBeUndefined();
    });
  });
});
