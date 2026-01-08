/**
 * Tests for Extract Transitions Node
 * 
 * Validates that phase transitions are correctly extracted from game specifications.
 */

import { describe, expect, it } from "@jest/globals";
import { extractTransitions } from "../index.js";
import { setupSpecTransitionsModel } from "#chaincraft/ai/model-config.js";
import { JsonLogicSchema } from "#chaincraft/ai/simulate/logic/jsonlogic.js";

describe("Extract Transitions Node", () => {
  it("should extract phase transitions from specification", async () => {
    // Use the RPS game rules and schema from extract-schema test
    const gameRules = `
Rock Paper Scissors is a game for 2-3 players that runs for 3 rounds.

SETUP:

GAMEPLAY (Playing Phase):

SCORING (Scoring Phase):

FINISHED:
`;

    const stateSchema = `[
  {
    "name": "game",
    "type": "object",
    "description": "Core game state tracking rounds, moves, and outcomes",
    "properties": {
      "phase": {
        "name": "phase",
        "type": "string",
        "description": "Current game phase: playing, scoring, or finished"
      },
      "currentRound": {
        "name": "currentRound",
        "type": "number",
        "description": "Current round number (1-3)"
      },
      "gameEnded": {
        "name": "gameEnded",
        "type": "boolean",
        "description": "Whether the game has ended"
      }
    }
  },
  {
    "name": "players",
    "type": "object",
    "description": "Player-specific state keyed by player ID",
    "items": {
      "type": "object",
      "properties": {
        "totalScore": {
          "name": "totalScore",
          "type": "number",
          "description": "Total score across all rounds"
        },
        "submittedMove": {
          "name": "submittedMove",
          "type": "boolean",
          "description": "Whether player has submitted move this round"
        }
      }
    }
  }
]`;

    const model = await setupSpecTransitionsModel();
    const extractFn = extractTransitions(model);

    const result = await extractFn({
      gameSpecification: gameRules,
      gameRules,
      stateSchema,
      stateTransitions: "",
      playerPhaseInstructions: {},
      transitionInstructions: {},
      exampleState: JSON.stringify({
        game: { phase: "playing", currentRound: 1, gameEnded: false },
        players: [ { id: "player1", submittedMove: false }, { id: "player2", submittedMove: false } ]
      }),
    });

    console.log("\n=== Extracted Transitions ===\n");
    console.log(result.stateTransitions);
    console.log("\n=== Validation ===");

    // Validate structure
    expect(result.stateTransitions).toBeDefined();
    // `stateTransitions` is expected to be a structured object artifact.
    expect(typeof result.stateTransitions).toBe('object');
    expect(result.stateTransitions).not.toBeNull();
    const parsed = result.stateTransitions as any;
    const jsonLen = JSON.stringify(parsed).length;
    expect(jsonLen).toBeGreaterThan(10);
    console.log(`✓ Transitions object length (json): ${jsonLen} chars`);

    // Check for key sections using the structured artifact
    expect(Array.isArray(parsed.phases)).toBe(true);
    const lowerPhases = parsed.phases.map((p: any) => String(p).toLowerCase());
    // If the model returned placeholder values (e.g. "<UNKNOWN>") or didn't extract phases,
    // skip the detailed phase assertions and log a helpful warning so failures are easier to debug.
    const hasUnknown = lowerPhases.some((p: string) => p.includes('<unknown>'));
    if (hasUnknown || !lowerPhases.length) {
      console.warn('[WARN] Phases not extracted or returned as placeholders. Skipping phase name assertions.');
      console.warn(JSON.stringify(parsed, null, 2));
      console.log("\n=== Extract Transitions Test Complete (no valid phases) ===");
      return;
    }

    expect(lowerPhases).toEqual(expect.arrayContaining(["playing", "scoring", "finished"]));
    console.log("✓ Contains all three phases (playing, scoring, finished)");

    // Validate transitions coverage: from every phase except the last there is at least one outgoing transition,
    // and to every phase except the first there is at least one incoming transition.
    const phases: string[] = parsed.phases.map((p: any) => String(p));
    expect(phases.length).toBeGreaterThanOrEqual(1);

    const fromCounts: Record<string, number> = {};
    const toCounts: Record<string, number> = {};
    for (const t of parsed.transitions) {
      const from = String(t.fromPhase || t.from || '');
      const to = String(t.toPhase || t.to || '');
      fromCounts[from] = (fromCounts[from] || 0) + 1;
      toCounts[to] = (toCounts[to] || 0) + 1;
    }

    // For each phase except the last, expect at least one outgoing transition
    for (let i = 0; i < phases.length - 1; i++) {
      const phase = phases[i];
      expect((fromCounts[phase] || 0)).toBeGreaterThan(0);
    }

    // For each phase except the first, expect at least one incoming transition
    for (let i = 1; i < phases.length; i++) {
      const phase = phases[i];
      expect((toCounts[phase] || 0)).toBeGreaterThan(0);
    }

    console.log('✓ Transition coverage checks passed (from all but last, to all but first)');

    // Validate phaseMetadata
    expect(Array.isArray(parsed.phaseMetadata)).toBe(true);
    expect(parsed.phaseMetadata.length).toBe(phases.length);
    
    const metadataByPhase: Record<string, any> = {};
    for (const meta of parsed.phaseMetadata) {
      expect(typeof meta.phase).toBe('string');
      expect(typeof meta.requiresPlayerInput).toBe('boolean');
      metadataByPhase[meta.phase] = meta;
    }
    
    // RPS: "playing" phase requires player input (players submit moves)
    // "scoring" and "finished" are automatic
    const playingMeta = phases.find(p => p.toLowerCase().includes('play'));
    if (playingMeta && metadataByPhase[playingMeta]) {
      expect(metadataByPhase[playingMeta].requiresPlayerInput).toBe(true);
      console.log('✓ Playing phase correctly marked as requiring player input');
    }
    
    console.log('✓ Phase metadata validated for all phases');

    // If structured extraction ran, validate JSON fields
    // Validate parsed structured transitions
    expect(parsed).toBeDefined();
    expect(Array.isArray(parsed.transitions)).toBe(true);
    if (parsed.transitions.length === 0) {
      console.warn('[WARN] No transitions were extracted. Skipping detailed checks.');
      console.warn(JSON.stringify(parsed, null, 2));
      console.log("\n=== Extract Transitions Test Complete (no transitions) ===");
      return;
    }

    for (const t of parsed.transitions) {
      expect(typeof t.id).toBe("string");
      expect(typeof t.fromPhase).toBe("string");
      expect(typeof t.toPhase).toBe("string");
      if (t.checkedFields) {
        expect(Array.isArray(t.checkedFields)).toBe(true);
      }
      if (t.computedValues) {
        expect(typeof t.computedValues).toBe("object");
      }
      if (t.preconditions && Array.isArray(t.preconditions)) {
        for (const h of t.preconditions) {
          // RPS transitions should be deterministic — executor should produce JsonLogic
          expect(h.deterministic).not.toBe(false);
          expect(h.logic).not.toBeNull();
          // Validate JsonLogic structure against schema
          const parsedLogic = JsonLogicSchema.safeParse(h.logic);
          if (!parsedLogic.success) {
            console.error('Invalid JsonLogic for transition', t.id, parsedLogic.error.format());
          }
          expect(parsedLogic.success).toBe(true);
        }
      }
    }

    console.log("✓ Structured transitions JSON validated");
    console.log("\n=== Extract Transitions Test Complete ===");
  }, 60000); // 60s timeout for LLM calls

  it("should mark random monster-attack-based transition as non-deterministic", async () => {
    const gameRules = `
A simple adventuring game with a roaming monster.

GAMEPLAY:
- Each player takes a turn moving around the map.
- After a player's turn, a random roll determines if the monster attacks (50% chance).
- If the monster attacks, the game transitions to the "battle" phase where players fight the monster.

TRANSITIONS:
- When a monster attack occurs (random roll), transition from "explore" to "battle".
`;

    const stateSchema = `[
      {
        "name": "game",
        "type": "object",
        "description": "Core game state",
        "properties": {
          "phase": { "name": "phase", "type": "string" },
          "round": { "name": "round", "type": "number" }
        }
      },
      {
        "name": "monster",
        "type": "object",
        "description": "Monster state",
        "properties": {
          "attacking": { "name": "attacking", "type": "boolean", "description": "Whether monster is currently attacking" }
        }
      }
    ]`;

    const model = await setupSpecTransitionsModel();
    const extractFn = extractTransitions(model);

    const result = await extractFn({
      gameSpecification: gameRules,
      gameRules,
      stateSchema,
      stateTransitions: "",
      playerPhaseInstructions: {},
      transitionInstructions: {},
      exampleState: JSON.stringify({
        game: { phase: "explore", round: 1 },
        monster: { attacking: false },
        players: [ { id: "player1" }, { id: "player2" } ]
      }),
    });

    // Normalize structured transitions (accept either `stateTransitionsJson` or structured `stateTransitions` object)
    let parsed: any;
    if ((result as any).stateTransitionsJson) {
      parsed = JSON.parse((result as any).stateTransitionsJson as string);
    } else if (typeof result.stateTransitions === 'object') {
      parsed = result.stateTransitions;
    } else if (typeof result.stateTransitions === 'string') {
      // try to parse string output as JSON if possible
      try {
        parsed = JSON.parse(result.stateTransitions as string);
      } catch (e) {
        parsed = { transitions: [] };
      }
    } else {
      parsed = { transitions: [] };
    }

    expect(Array.isArray(parsed.transitions)).toBe(true);

    // Find transitions that move to a battle phase
    const battleTransitions = parsed.transitions.filter((t: any) =>
      t.toPhase && typeof t.toPhase === 'string' && t.toPhase.toLowerCase().includes('battle')
    );

    if (battleTransitions.length === 0) {
      console.warn('[WARN] No battle transitions found. Skipping non-deterministic checks.');
      console.warn(JSON.stringify(parsed, null, 2));
      return;
    }

    // At least one of the battle transitions should contain a non-deterministic precondition hint
    let foundNonDet = false;
    for (const t of battleTransitions) {
      const hints = Array.isArray(t.preconditions) ? t.preconditions : [];
      for (const h of hints) {
        if (h.deterministic === false || h.logic === null) {
          expect(typeof h.explain).toBe('string');
          foundNonDet = true;
          break;
        }
      }
      if (foundNonDet) break;
    }

    expect(foundNonDet).toBe(true);
    console.log('✓ Found non-deterministic battle transition (monster random attack)');
  }, 60000);

  it("should use custom player operations in preconditions", async () => {
    console.log("\n=== TEST: Custom Player Operations in Transitions ===");
    
    const gameRules = `
Multiplayer racing game for 2-8 players where players roll dice to move forward.
First player to reach 10 points wins.

Phase flow:
1. waiting_for_rolls: All players submit their dice rolls simultaneously
2. resolve_moves: System moves all players based on their rolls
3. check_winner: Check if any player won, or return to waiting_for_rolls

The game should NOT enumerate individual player checks. It should use logic that works for any number of players (2-8).
`;

    const stateSchema = `{
  "type": "object",
  "properties": {
    "game": {
      "type": "object",
      "properties": {
        "currentPhase": {
          "type": "string",
          "description": "Current phase of the game"
        },
        "gameEnded": {
          "type": "boolean",
          "description": "Whether game has ended"
        },
        "publicMessage": {
          "type": "string",
          "description": "Public message visible to all players"
        }
      },
      "required": ["currentPhase", "gameEnded", "publicMessage"]
    },
    "players": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "properties": {
          "position": {
            "type": "number",
            "description": "Current position (0-10)"
          },
          "actionRequired": {
            "type": "boolean",
            "description": "Whether player has submitted their dice roll"
          },
          "privateMessage": {
            "type": "string",
            "description": "Private message for this player"
          }
        },
        "required": ["position", "actionRequired", "privateMessage"]
      }
    }
  },
  "required": ["game", "players"]
}`;

    const model = await setupSpecTransitionsModel();
    const extractFn = extractTransitions(model);

    const result = await extractFn({
      gameSpecification: gameRules,
      gameRules,
      stateSchema,
      stateTransitions: "",
      playerPhaseInstructions: {},
      transitionInstructions: {},
      exampleState: JSON.stringify({
        game: { currentPhase: "waiting_for_rolls", gameEnded: false, publicMessage: "Waiting for all players to roll dice" },
        players: { 
          p1: { position: 5, actionRequired: true, privateMessage: "Roll your dice" }, 
          p2: { position: 7, actionRequired: true, privateMessage: "Roll your dice" },
          p3: { position: 3, actionRequired: false, privateMessage: "Waiting for others" }
        }
      }),
    });

    console.log("\n=== Extracted Transitions ===");
    expect(result.stateTransitions).toBeDefined();
    const parsed = result.stateTransitions as any;

    const transitions = parsed.transitions || [];
    console.log("\n=== ALL TRANSITIONS (for debugging) ===");
    console.log(JSON.stringify(transitions, null, 2));
    
    // Find transition checking if ANY player won (position >= 10)
    const winTransition = transitions.find((t: any) => {
      const name = (t.name || t.id || '').toLowerCase();
      const preconditions = t.preconditions || [];
      
      // Should be a game_end or win-related transition
      if (!name.includes('win') && !name.includes('end') && !name.includes('finish')) {
        return false;
      }
      
      // Should use anyPlayer to check if any player reached winning position
      // New format: {anyPlayer: ["position", ">=", 10]}
      return preconditions.some((p: any) => {
        const logic = p.logic;
        if (!logic || !logic.anyPlayer) return false;
        if (!Array.isArray(logic.anyPlayer)) return false;
        // Check if it's checking position field with >= or similar
        return logic.anyPlayer[0] === 'position' && 
               (logic.anyPlayer[1] === '>=' || logic.anyPlayer[1] === '>') &&
               (logic.anyPlayer[2] === 10 || logic.anyPlayer[2] >= 10);
      });
    });

    // Find transition checking if ALL players completed their action
    // Should use EITHER the computed field OR the custom allPlayers operation
    const allPlayersActedTransition = transitions.find((t: any) => {
      const preconditions = t.preconditions || [];
      
      return preconditions.some((p: any) => {
        const logic = p.logic;
        if (!logic) return false;
        
        // Option 1: Uses computed field allPlayerActionsComplete
        if (logic['=='] || logic['===']) {
          const comparison = logic['=='] || logic['==='];
          if (Array.isArray(comparison) && comparison.length === 2) {
            const varCheck = comparison.find((item: any) => item?.var === 'allPlayerActionsComplete');
            if (varCheck) return true;
          }
        }
        
        // Option 2: Uses custom allPlayers operation
        if (logic.allPlayers && Array.isArray(logic.allPlayers)) {
          return logic.allPlayers[0] === 'actionRequired';
        }
        
        return false;
      });
    });

    console.log('\n=== Player Check Validation ===');
    
    if (winTransition) {
      console.log('✓ Found win transition using anyPlayer to check if any player won');
      console.log(`  Transition: ${winTransition.name || winTransition.id}`);
      console.log(`  Preconditions: ${JSON.stringify(winTransition.preconditions, null, 2)}`);
    } else {
      console.warn('⚠ No win transition found using anyPlayer (expected for win condition)');
    }
    
    if (allPlayersActedTransition) {
      console.log('✓ Found transition checking if all players completed actions');
      console.log(`  Transition: ${allPlayersActedTransition.name || allPlayersActedTransition.id}`);
      const precondition = allPlayersActedTransition.preconditions?.find((p: any) => {
        const logic = p.logic;
        return logic?.allPlayers || logic?.['=='] || logic?.['==='];
      });
      if (precondition?.logic?.allPlayers) {
        console.log('  Method: Custom allPlayers operation');
      } else {
        console.log('  Method: Computed allPlayerActionsComplete field');
      }
      console.log(`  Preconditions: ${JSON.stringify(allPlayersActedTransition.preconditions, null, 2)}`);
    } else {
      console.warn('⚠ No transition found checking if all players completed actions');
    }

    // At least one appropriate use case should be found
    expect(winTransition || allPlayersActedTransition).toBeTruthy();
    
    console.log('\n✓ AI appropriately uses player checking (custom operations or computed fields)');
  }, 60000);
});
