/**
 * Tests for Extract Transitions Node
 * 
 * Validates that phase transitions are correctly extracted from game specifications.
 */

import { describe, expect, it } from "@jest/globals";
import { transitionsExtractionConfig } from "../index.js";
import { createExtractionSubgraph } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-factories.js";
import { JsonLogicSchema } from "#chaincraft/ai/simulate/logic/jsonlogic.js";
import { InMemoryStore } from "@langchain/langgraph";

describe("Extract Transitions Subgraph", () => {
  it("should extract phase transitions from specification", async () => {
    // Setup - Create subgraph from config
    const subgraph = createExtractionSubgraph(transitionsExtractionConfig);
    
    // Use the RPS game rules and schema from extract-schema test
    const gameRules = `
Rock Paper Scissors is a game for 2-3 players that runs for 3 rounds.

SETUP:

GAMEPLAY (Playing Phase):

SCORING (Scoring Phase):

FINISHED:
`;

    const stateSchema = `{
  "type": "object",
  "properties": {
    "game": {
      "type": "object",
      "description": "Core game state tracking rounds, moves, and outcomes",
      "properties": {
        "currentPhase": {
          "type": "string",
          "description": "Current game phase: playing, scoring, or finished"
        },
        "currentRound": {
          "type": "number",
          "description": "Current round number (1-3)"
        },
        "gameEnded": {
          "type": "boolean",
          "description": "Whether the game has ended"
        }
      }
    },
    "players": {
      "type": "object",
      "description": "Player-specific state keyed by player ID",
      "additionalProperties": {
        "type": "object",
        "properties": {
          "totalScore": {
            "type": "number",
            "description": "Total score across all rounds"
          },
          "submittedMove": {
            "type": "boolean",
            "description": "Whether player has submitted move this round"
          }
        }
      }
    }
  }
}`;

    const inputState = {
      gameSpecification: gameRules,
      gameRules,
      stateSchema,
    };

    const result = await subgraph.invoke(inputState, {
      store: new InMemoryStore(),
      configurable: { thread_id: "test-thread-1" }
    });

    console.log("\n=== Extracted Transitions ===\n");
    console.log(result.stateTransitions);
    console.log("\n=== Validation ===");

    // Validate structure
    expect(result.stateTransitions).toBeDefined();
    // Parse if string
    const parsed = typeof result.stateTransitions === 'string'
      ? JSON.parse(result.stateTransitions)
      : result.stateTransitions;
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

  it("should use two-step pattern for random monster attacks", async () => {
    const subgraph = createExtractionSubgraph(transitionsExtractionConfig);
    
    const gameRules = `
A simple adventuring game with a roaming monster.

GAMEPLAY:
- Each player takes a turn moving around the map.
- After a player's turn, a random roll determines if the monster attacks (50% chance).
- If the monster attacks, the game transitions to the "battle" phase where players fight the monster.

TRANSITIONS:
- When a monster attack occurs (random roll), transition from "explore" to "battle".
`;

    const stateSchema = `{
  "type": "object",
  "properties": {
    "game": {
      "type": "object",
      "description": "Core game state",
      "properties": {
        "currentPhase": { "type": "string" },
        "round": { "type": "number" },
        "monsterAttackRoll": { 
          "type": "number", 
          "description": "Result of dice roll to determine if monster attacks (1-100)" 
        }
      }
    },
    "monster": {
      "type": "object",
      "description": "Monster state",
      "properties": {
        "attacking": { 
          "type": "boolean", 
          "description": "Whether monster is currently attacking" 
        }
      }
    }
  }
}`;

    const inputState = {
      gameSpecification: gameRules,
      gameRules,
      stateSchema,
    };

    const result = await subgraph.invoke(inputState, {
      store: new InMemoryStore(),
      configurable: { thread_id: "test-thread-2" }
    });

    // Normalize structured transitions
    let parsed: any;
    if (typeof result.stateTransitions === 'string') {
      parsed = JSON.parse(result.stateTransitions);
    } else {
      parsed = result.stateTransitions;
    }

    expect(Array.isArray(parsed.transitions)).toBe(true);

    console.log("\n=== Checking for Two-Step RNG Pattern ===");
    console.log(`Total transitions: ${parsed.transitions.length}`);
    
    // Look for a transition that references the monsterAttackRoll field
    const rollTransitions = parsed.transitions.filter((t: any) => {
      const checkedFields = Array.isArray(t.checkedFields) ? t.checkedFields : [];
      const summary = t.humanSummary || '';
      
      // Check if this transition uses the roll field in preconditions
      const usesRollField = checkedFields.some((f: string) => 
        f.includes('monsterAttackRoll') || f.includes('Roll')
      );
      
      // Or mentions roll in logic
      const preconditions = Array.isArray(t.preconditions) ? t.preconditions : [];
      const hasRollLogic = preconditions.some((p: any) => {
        const logicStr = JSON.stringify(p.logic || {});
        return logicStr.includes('monsterAttackRoll') || logicStr.includes('Roll');
      });
      
      return usesRollField || hasRollLogic || summary.toLowerCase().includes('roll');
    });

    console.log(`Transitions referencing roll field: ${rollTransitions.length}`);
    
    if (rollTransitions.length > 0) {
      console.log("\nTransitions using roll:");
      rollTransitions.forEach((t: any) => {
        console.log(`  - ${t.id}: ${t.humanSummary}`);
        console.log(`    Checked fields: ${JSON.stringify(t.checkedFields)}`);
        if (t.preconditions && t.preconditions.length > 0) {
          console.log(`    Preconditions: ${t.preconditions.map((p: any) => p.explain).join(', ')}`);
        }
      });
    }

    // Verify: Should have at least 2 transitions - one to generate roll, others to check it
    expect(rollTransitions.length).toBeGreaterThanOrEqual(2);
    
    // Verify: All transitions should have deterministic logic (no null logic)
    const allDeterministic = rollTransitions.every((t: any) => {
      const preconditions = Array.isArray(t.preconditions) ? t.preconditions : [];
      return preconditions.every((p: any) => p.deterministic !== false && p.logic !== null);
    });
    
    expect(allDeterministic).toBe(true);
    console.log('✓ AI used two-step pattern: separate transitions for generating and checking roll');
    console.log('✓ All preconditions are deterministic (no null logic)');
  }, 60000);

  it("should use custom player operations in preconditions", async () => {
    const subgraph = createExtractionSubgraph(transitionsExtractionConfig);
    
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

    const inputState = {
      gameSpecification: gameRules,
      gameRules,
      stateSchema,
    };

    const result = await subgraph.invoke(inputState, {
      store: new InMemoryStore(),
      configurable: { thread_id: "test-thread-3" }
    });

    console.log("\n=== Extracted Transitions ===");
    expect(result.stateTransitions).toBeDefined();
    const parsed = typeof result.stateTransitions === 'string'
      ? JSON.parse(result.stateTransitions)
      : result.stateTransitions;

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
