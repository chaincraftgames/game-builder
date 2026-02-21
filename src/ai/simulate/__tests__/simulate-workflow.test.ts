import { describe, expect, test } from "@jest/globals";
import {
  createSimulation,
  initializeSimulation,
  PlayerStates,
  processAction,
  produceToken,
  SpecArtifacts,
} from "#chaincraft/ai/simulate/simulate-workflow.js";
import { setConfig } from "#chaincraft/config.js";
import { fail } from "assert";

describe("Simulation Workflow", () => {
  setConfig("simulation-graph-type", "test-game-simulation");
  // Generate unique sessionId for each test run
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  
  // Use realistic UUID-style player IDs to test player mapping
  const player1Id = `player-${crypto.randomUUID()}`;
  const player2Id = `player-${crypto.randomUUID()}`;
  
  const initialGameSpec = `
    A game of rock-paper-scissors for 2 players. Each player's move is compared head-to-head.
    Players score 1 pt for a win, 0 pts for a tie, and -1 pt for a loss. The player with the 
    most points after 2 rounds wins the game. The winners are: rock beats scissors, scissors 
    beats paper, and paper beats rock.
  `;

  test("should create a simulation and return the player count", async () => {
    const { gameRules } = await createSimulation(
      sessionId,          // Unique session ID
      undefined,          // gameId not needed when passing spec directly
      undefined,          // version not needed when passing spec directly
      { overrideSpecification: initialGameSpec }
    );

    expect(gameRules).toBeDefined();
    expect(gameRules.length).toBeGreaterThan(0);
  }, 120000); // 120s timeout for spec processing + artifact storage

  test("Should initialize the state when the required number of players join", async () => {
    const { publicMessage, playerStates } = await initializeSimulation(sessionId, [
      player1Id,
      player2Id,
    ]);

    console.debug("publicMessage", publicMessage);
    console.debug("playerStates", playerStates);
    console.log("Session ID:", sessionId);
    console.log("Player IDs used:", { player1Id, player2Id });

    expect(publicMessage).toBeDefined();
    expect(playerStates.size).toBe(2);
    // Verify both players are present with their UUID keys
    expect(playerStates.has(player1Id)).toBe(true);
    expect(playerStates.has(player2Id)).toBe(true);
    // After initialization, players should have action flags set
    Array.from(playerStates.values()).forEach(ps => {
      // actionsAllowed is optional, defaults to actionRequired
      expect(ps.actionRequired).toBeDefined();
    });
  });

  test(
    "Should process player moves and complete game",
    async () => {
      const playerMoves = [
        ["rock", "paper"],      // Round 1
        ["scissors", "rock"],   // Round 2
      ];
      const playerIds = [player1Id, player2Id];
      
      for (let round = 1; round <= 2; round++) {
        for (let playerIndex = 0; playerIndex < 2; playerIndex++) {
          const playerId = playerIds[playerIndex];
          let { publicMessage, playerStates, gameEnded } = await processAction(
            sessionId,
            playerId,
            playerMoves[round - 1][playerIndex]
          ).catch((error) => {
            console.log("Received error in test %o.  Failing test.", error);
            fail(error.message);
          });
          validatePlayerStates(playerId, playerStates);
          expect(publicMessage).toBeDefined();
          expect(gameEnded).toEqual(round == 2 && playerIndex == 1);
        }
      }
    },
    4 * 60 * 1000  // 4 minutes for 2 players × 2 rounds
  );
});

function validatePlayerStates(playerId: string, playerStates: PlayerStates) {
  // Validate that the acting player has state returned
  const playerState = playerStates.get(playerId);
  expect(playerState).toBeDefined();
  // Private messages are optional - only set when game/instructions specify them
}

describe("Token Production", () => {
  setConfig("simulation-graph-type", "test-token-production");
  
  const tokenSessionId = `token-session-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const testGameId = "test-character-game";
  const testPlayerId = `player-${crypto.randomUUID()}`;

  // Pre-generated artifacts for a character-based game with token support
  const characterGameArtifacts: SpecArtifacts = {
    gameRules: "A character progression game where players create and develop characters.",
    stateSchema: JSON.stringify([
      { name: "turnNumber", path: "game", type: "number", purpose: "Current turn" },
      { name: "name", path: "player", type: "string", purpose: "Character name" },
      { name: "class", path: "player", type: "string", purpose: "Character class" },
      { name: "level", path: "player", type: "number", purpose: "Character level" },
      { name: "experience", path: "player", type: "number", purpose: "Experience points" },
      { name: "currentHealth", path: "player", type: "number", purpose: "Current health (ephemeral)" },
      { name: "ready", path: "player", type: "boolean", purpose: "Player ready status" },
    ]),
    stateTransitions: JSON.stringify({
      phases: ["init", "CHARACTER_CREATION"],
      phaseMetadata: [
        { phase: "init", requiresPlayerInput: false },
        { phase: "CHARACTER_CREATION", requiresPlayerInput: true },
      ],
      transitions: [
        {
          id: "initialize_game",
          fromPhase: "init",
          toPhase: "CHARACTER_CREATION",
          humanSummary: "Initialize game with players",
          preconditions: []
        }
      ]
    }),
    playerPhaseInstructions: {
      "CHARACTER_CREATION": "Players create their characters by providing name and class.",
    },
    transitionInstructions: {
      "initialize_game": JSON.stringify({
        stateDelta: [
          { op: "setForAllPlayers", field: "character", value: null },
          { op: "setForAllPlayers", field: "status", value: "awaiting_character_selection" },
          { op: "setForAllPlayers", field: "ready", value: false }
        ],
        publicMessage: "Game initialized. Create your character!",
        privateMessages: {},
        phaseKey: "CHARACTER_CREATION"
      })
    },
    producedTokensConfiguration: JSON.stringify({
      tokens: [{
        tokenType: "character",
        description: "Persistent player character with class, level, and progression",
        tokenSource: "player",
        fields: ["name", "class", "level", "experience"]
      }]
    }),
  };

  test("should create simulation with token configuration", async () => {
    const { gameRules } = await createSimulation(
      tokenSessionId,
      testGameId,
      1,
      {
        preGeneratedArtifacts: characterGameArtifacts,
      }
    );

    expect(gameRules).toBeDefined();
    expect(gameRules).toContain("character");
  }, 30000);

  test("should initialize and populate player state", async () => {
    const { playerStates } = await initializeSimulation(tokenSessionId, [testPlayerId]);

    expect(playerStates.size).toBe(1);
    expect(playerStates.has(testPlayerId)).toBe(true);
  }, 30000);

  test("should produce character token with correct data", async () => {
    // Directly inject character data into the state for testing token production
    // This bypasses the need for real LLM calls and focuses on testing produceToken()
    const saver = await import("#chaincraft/ai/memory/checkpoint-memory.js").then(m => m.getSaver(tokenSessionId, "test-token-production"));
    const config = { configurable: { thread_id: tokenSessionId } };
    const checkpoint = await saver.getTuple(config);
    const state = checkpoint?.checkpoint.channel_values as any;
    
    // Parse and update game state with character data
    const gameState = JSON.parse(state.gameState);
    const playerMapping = JSON.parse(state.playerMapping || "{}");
    const alias = Object.keys(playerMapping)[0]; // "player1"
    const uuid = playerMapping[alias]; // Get the UUID from the alias
    
    gameState.players[uuid] = {
      ...gameState.players[uuid],
      name: "Aria",
      class: "Warrior",
      level: 5,
      experience: 100,
      currentHealth: 100, // ephemeral - should not be in token
      ready: true // ephemeral - should not be in token
    };
    
    state.gameState = JSON.stringify(gameState);
    
    // Save updated state back
    await saver.put(config, checkpoint.checkpoint, checkpoint.metadata);

    // Now produce the token
    const token = await produceToken(
      tokenSessionId,
      "character",
      testPlayerId
    );

    // Validate token structure
    expect(token).toBeDefined();
    expect(token.metadata).toBeDefined();
    expect(token.data).toBeDefined();

    // Validate metadata
    expect(token.metadata.tokenType).toBe("character");
    expect(token.metadata.gameId).toBe(testGameId);
    expect(token.metadata.version).toBe("1");

    // Validate data contains only the specified fields (not ephemeral ones)
    expect(token.data.name).toBe("Aria");
    expect(token.data.class).toBe("Warrior");
    expect(token.data.level).toBe(5);
    expect(token.data.experience).toBe(100);
    
    // Should NOT include ephemeral fields
    expect(token.data.currentHealth).toBeUndefined();
    expect(token.data.ready).toBeUndefined();
  }, 30000);

  test("should reject token production for non-existent token type", async () => {
    await expect(
      produceToken(tokenSessionId, "invalid-token-type", testPlayerId)
    ).rejects.toThrow("Token type 'invalid-token-type' is not produced by this game");
  }, 30000);

  test("should reject token production for non-existent player", async () => {
    await expect(
      produceToken(tokenSessionId, "character", "non-existent-player")
    ).rejects.toThrow("Player 'non-existent-player' not found in game state");
  }, 30000);
});
