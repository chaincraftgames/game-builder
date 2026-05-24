/**
 * Wacky Weapons Sandbox E2E Test
 *
 * End-to-end test of the generated-mechanics sandbox path.
 * Loads the wacky-weapons artifact fixture, augments it with pre-baked
 * generatedMechanics function bodies and sample specNarratives, then
 * runs a full game through the runtime graph workflow.
 *
 * This exercises:
 *   - createSimulation with preGeneratedArtifacts (including generatedMechanics)
 *   - initializeSimulation → init → weapon_setup
 *   - processAction for weapon finalization (both players)
 *   - Sandbox execution of both_weapons_ready (deterministic weapon→RPS mapping)
 *   - processAction for weapon selection (multiple rounds)
 *   - Sandbox execution of resolve_round_outcome (RPS resolution + narrative via callLLM)
 *   - Game completion (best-of-3 match)
 *
 * Uses REAL LLM calls for callLLM inside the sandbox (narrative generation).
 * Requires CHAINCRAFT_SIM_API_KEY or ANTHROPIC_API_KEY.
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { setConfig } from "#chaincraft/config.js";
import {
  createSimulation,
  initializeSimulation,
  processAction,
  getGameState,
} from "#chaincraft/ai/simulate/simulate-workflow.js";
import fixture from "../../artifacts/wacky-weapons.json";

// ─── Generated mechanic function bodies ───
// These match the generation contract: receive read-only (state, callLLM),
// return partial state for deep-merge. Uses aliased keys (player1, player2).

const BOTH_WEAPONS_READY_BODY = `
// Collect all weapon names (values) from both players
const allWeaponNames = [];
for (const weaponName of Object.values(state.player1.weapons)) {
  allWeaponNames.push(weaponName);
}
for (const weaponName of Object.values(state.player2.weapons)) {
  allWeaponNames.push(weaponName);
}

// Deterministic mapping: hash weapon name to RPS type
const rpsTypes = ["rock", "paper", "scissors"];
const weaponMappings = {};
for (const name of allWeaponNames) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  weaponMappings[name] = rpsTypes[Math.abs(hash) % 3];
}

// Generate announcement via callLLM
const announcement = await callLLM(
  "Announce that both players have their weapons ready and the first round of their absurd weapon battle is about to begin. " +
  "Keep it to 1-2 sentences. Return only the announcement text."
);

return {
  game: {
    weaponMappings: weaponMappings,
    currentRound: 1,
    publicMessage: announcement,
  },
  player1: {
    actionRequired: true,
  },
  player2: {
    actionRequired: true,
  },
};
`;

const RESOLVE_ROUND_OUTCOME_BODY = `
// Get selected weapons and their RPS types
const p1Weapon = state.player1.selectedWeapon;
const p2Weapon = state.player2.selectedWeapon;
const p1Type = state.game.weaponMappings[p1Weapon];
const p2Type = state.game.weaponMappings[p2Weapon];

// Apply RPS rules
let winner = null;
if (p1Type === p2Type) {
  winner = "tie";
} else if (
  (p1Type === "rock" && p2Type === "scissors") ||
  (p1Type === "scissors" && p2Type === "paper") ||
  (p1Type === "paper" && p2Type === "rock")
) {
  winner = "player1";
} else {
  winner = "player2";
}

// Build partial state
const result = { game: {}, player1: {}, player2: {} };

if (winner === "player1") {
  result.player1.roundsWon = state.player1.roundsWon + 1;
  result.player2.roundsWon = state.player2.roundsWon;
} else if (winner === "player2") {
  result.player2.roundsWon = state.player2.roundsWon + 1;
  result.player1.roundsWon = state.player1.roundsWon;
} else {
  // Tie: scores unchanged
  result.player1.roundsWon = state.player1.roundsWon;
  result.player2.roundsWon = state.player2.roundsWon;
}

// Generate humorous narrative via callLLM
const narrative = await callLLM(
  "Generate a humorous 1-2 sentence narrative describing the clash between " +
  p1Weapon + " (" + p1Type + ") and " + p2Weapon + " (" + p2Type + "). " +
  "The result is: " + (winner === "tie" ? "a tie — no points awarded" : winner + " wins and earns 1 point") + ". " +
  "Mention both weapon names. Be absurd and funny. Return only the narrative text."
);

result.game.roundOutcome = narrative;

return result;
`;

// ─── Sample narrative guidance ───
const SPEC_NARRATIVES: Record<string, string> = {
  BATTLE_TONE:
    "All combat narratives should be lighthearted, absurd, and comedic. " +
    "Emphasize the ridiculousness of the weapon matchups. " +
    "Think Saturday morning cartoon meets professional wrestling commentary.",
  WEAPON_REVEAL:
    "When announcing weapon selections, build suspense briefly then " +
    "describe the weapons with exaggerated dramatic flair, as if they are " +
    "legendary artifacts of immense (but silly) power.",
};

// ─── Test setup ───

const sessionId = `sandbox-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const player1Id = crypto.randomUUID();
const player2Id = crypto.randomUUID();

// Player weapon choices
const P1_WEAPONS = {
  weapon1: "Banana Launcher",
  weapon2: "Rubber Duck Shield",
  weapon3: "Spaghetti Whip",
};
const P2_WEAPONS = {
  weapon1: "Pillow Cannon",
  weapon2: "Glitter Bomb",
  weapon3: "Tickle Ray",
};

// Build augmented artifacts
function buildArtifacts() {
  return {
    gameRules: fixture.gameRules,
    stateSchema: fixture.stateSchema,
    stateTransitions: fixture.stateTransitions,
    playerPhaseInstructions: fixture.playerPhaseInstructions,
    transitionInstructions: fixture.transitionInstructions,
    generatedMechanics: {
      both_weapons_ready: BOTH_WEAPONS_READY_BODY,
      resolve_round_outcome: RESOLVE_ROUND_OUTCOME_BODY,
    },
    specNarratives: SPEC_NARRATIVES,
  };
}

describe("Wacky Weapons — Sandbox E2E", () => {
  beforeAll(() => {
    setConfig("simulation-graph-type", "test-game-simulation");
  });

  it("should play a full game using sandbox-executed mechanics", async () => {
    console.log("\n========== SANDBOX E2E TEST: START ==========");
    console.log(`Session: ${sessionId}`);
    console.log(`Player 1: ${player1Id}`);
    console.log(`Player 2: ${player2Id}`);

    // Step 1: Create simulation with augmented artifacts
    console.log("\n--- Step 1: Create simulation ---");
    const artifacts = buildArtifacts();
    const createResult = await createSimulation(sessionId, undefined, 1, {
      preGeneratedArtifacts: artifacts,
    });
    console.log("Game rules loaded:", createResult.gameRules.substring(0, 80) + "...");
    expect(createResult.gameRules).toBeTruthy();

    // Step 2: Initialize simulation (triggers init → weapon_setup)
    console.log("\n--- Step 2: Initialize simulation ---");
    const initResult = await initializeSimulation(sessionId, [player1Id, player2Id]);
    console.log("Init public message:", initResult.publicMessage);

    let gameState = await getGameState(sessionId);
    console.log("Phase after init:", gameState?.game?.currentPhase);
    expect(gameState?.game?.currentPhase).toBe("weapon_setup");

    // Step 3: Both players finalize weapons
    console.log("\n--- Step 3: Player 1 finalizes weapons ---");
    let response = await processAction(
      sessionId,
      player1Id,
      JSON.stringify(P1_WEAPONS),
    );
    console.log("P1 finalize response:", response.publicMessage || "(no public message)");
    console.log("P1 game ended:", response.gameEnded);

    console.log("\n--- Step 4: Player 2 finalizes weapons ---");
    response = await processAction(
      sessionId,
      player2Id,
      JSON.stringify(P2_WEAPONS),
    );
    console.log("P2 finalize response:", response.publicMessage || "(no public message)");
    console.log("P2 game ended:", response.gameEnded);

    // After both finalize:
    // auto-transition: both_weapons_ready (SANDBOX) → round_start
    // auto-transition: begin_round → weapon_selection
    gameState = await getGameState(sessionId);
    console.log("\nPhase after weapon finalization:", gameState?.game?.currentPhase);
    console.log("Weapon mappings:", JSON.stringify(gameState?.game?.weaponMappings));

    // Verify weapon mappings were generated by sandbox
    const mappings = gameState?.game?.weaponMappings || {};
    const mappingCount = Object.keys(mappings).length;
    console.log(`Weapon mappings count: ${mappingCount}`);
    expect(mappingCount).toBe(6);

    // Verify all mappings are valid RPS types
    const validTypes = new Set(["rock", "paper", "scissors"]);
    for (const [weapon, rpsType] of Object.entries(mappings)) {
      expect(validTypes.has(rpsType as string)).toBe(true);
      console.log(`  ${weapon} → ${rpsType}`);
    }

    // Should be in weapon_selection phase
    expect(gameState?.game?.currentPhase).toBe("weapon_selection");

    // Step 5-10: Play up to 3 rounds
    const roundWeapons = [
      { p1: P1_WEAPONS.weapon1, p2: P2_WEAPONS.weapon1 },
      { p1: P1_WEAPONS.weapon2, p2: P2_WEAPONS.weapon2 },
      { p1: P1_WEAPONS.weapon3, p2: P2_WEAPONS.weapon3 },
    ];

    let gameEnded = false;
    let roundsPlayed = 0;

    for (let round = 0; round < 3 && !gameEnded; round++) {
      const weapons = roundWeapons[round];
      roundsPlayed++;
      console.log(`\n--- Round ${round + 1}: ${weapons.p1} vs ${weapons.p2} ---`);

      // Player 1 selects weapon
      response = await processAction(
        sessionId,
        player1Id,
        JSON.stringify({ weaponName: weapons.p1 }),
      );
      console.log(`P1 selected ${weapons.p1}:`, response.publicMessage || "(waiting)");

      if (response.gameEnded) {
        gameEnded = true;
        break;
      }

      // Player 2 selects weapon
      response = await processAction(
        sessionId,
        player2Id,
        JSON.stringify({ weaponName: weapons.p2 }),
      );
      console.log(`P2 selected ${weapons.p2}:`, response.publicMessage || "(no message)");
      gameEnded = response.gameEnded;

      // Check state after round resolution
      gameState = await getGameState(sessionId);
      const p1Wins = gameState?.players?.[player1Id]?.roundsWon ?? 0;
      const p2Wins = gameState?.players?.[player2Id]?.roundsWon ?? 0;
      console.log(`Score after round ${round + 1}: P1=${p1Wins}, P2=${p2Wins}`);
      console.log(`Round outcome: ${gameState?.game?.roundOutcome || "(none)"}`);
      console.log(`Phase: ${gameState?.game?.currentPhase}`);
      console.log(`Game ended: ${gameState?.game?.gameEnded}`);

      if (gameState?.game?.gameEnded) {
        gameEnded = true;
      }
    }

    // Final state
    gameState = await getGameState(sessionId);
    console.log("\n========== FINAL STATE ==========");
    console.log("Phase:", gameState?.game?.currentPhase);
    console.log("Game ended:", gameState?.game?.gameEnded);

    const p1FinalWins = gameState?.players?.[player1Id]?.roundsWon ?? 0;
    const p2FinalWins = gameState?.players?.[player2Id]?.roundsWon ?? 0;
    console.log(`Final score: P1=${p1FinalWins}, P2=${p2FinalWins}`);
    console.log(`Rounds played: ${roundsPlayed}`);

    // Assertions
    expect(gameState?.game?.gameEnded).toBe(true);
    expect(gameState?.game?.currentPhase).toBe("finished");
    expect(Math.max(p1FinalWins, p2FinalWins)).toBeGreaterThanOrEqual(2);
    expect(roundsPlayed).toBeGreaterThanOrEqual(2);
    expect(roundsPlayed).toBeLessThanOrEqual(3);

    // Verify a winner exists (based on roundsWon)
    // Note: winningPlayers may be empty if the LLM-driven player_wins_match transition
    // didn't set isGameWinner: true. The roundsWon scores are the authoritative result
    // from the sandbox-executed resolve_round_outcome.
    const winnerByScore = p1FinalWins > p2FinalWins ? player1Id
      : p2FinalWins > p1FinalWins ? player2Id
      : null;
    console.log("Winner by score:", winnerByScore === player1Id ? "Player 1" : winnerByScore === player2Id ? "Player 2" : "None");
    expect(winnerByScore).not.toBeNull();

    // winningPlayers is populated by the LLM path for player_wins_match
    // (not sandbox-controlled), so just log it
    const winningPlayers = gameState?.game?.winningPlayers || [];
    console.log("winningPlayers array:", winningPlayers);

    console.log("\n========== SANDBOX E2E TEST: DONE ==========");
  }, 5 * 60 * 1000); // 5 min timeout for LLM calls
});
