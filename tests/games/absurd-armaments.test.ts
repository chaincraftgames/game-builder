/**
 * Absurd Armaments - Weapon Creation Bug Test
 * 
 * Tests the fix for the issue where second weapon creation was rejected
 * due to strict equality checking on actionRequired field.
 */

import type { GameTest } from "../harness/types.js";
import { createPlayerIds } from "../harness/helpers.js";

// Generate player IDs once for all scenarios
const [player1Id, player2Id] = createPlayerIds(2);

export const gameTest: GameTest = {
  name: "Absurd Armaments - Weapon Creation",
  spec: "Weapons of Mass Absurdity", // Minimal spec for reference
  artifactsFile: "../artifacts/absurd-armaments.json",
  scenarios: [
    {
      name: "Create three weapons successfully",
      description: "Test that player can create all 3 weapons without getting stuck after first weapon",
      playerActions: [
        { 
          playerId: player1Id, 
          actionType: "create-weapon", 
          actionData: { weaponDescription: "stale toast" } 
        },
        { 
          playerId: player1Id, 
          actionType: "create-weapon", 
          actionData: { weaponDescription: "angry spatula" } 
        },
        { 
          playerId: player1Id, 
          actionType: "create-weapon", 
          actionData: { weaponDescription: "quantum sock" } 
        }
      ],
      expectedOutcome: {
        gameEnded: false  // Game should not end during weapon creation
      },
      assertions: [
        // Check that all 3 weapons were created
        (state) => ({
          passed: state.players[player1Id]?.weapons?.length === 3,
          message: `Player should have 3 weapons created. Found: ${state.players[player1Id]?.weapons?.length || 0}`
        }),
        
        // Check no illegal actions occurred (base runtime field)
        (state) => ({
          passed: state.players[player1Id]?.illegalActionCount === 0,
          message: "No illegal actions should occur during weapon creation"
        }),
        
        // Check that weapons have the expected names
        (state) => {
          const weapons = state.players[player1Id]?.weapons || [];
          const hasAllWeapons = 
            weapons.includes("stale toast") &&
            weapons.includes("angry spatula") &&
            weapons.includes("quantum sock");
          return {
            passed: hasAllWeapons,
            message: `All weapons should be in player's arsenal. Found: ${weapons.join(", ")}`
          };
        }
      ]
    },
    
    {
      name: "Both players create weapons",
      description: "Test that both players can complete weapon creation phase",
      playerActions: [
        // Player 1 creates weapons
        { playerId: player1Id, actionType: "create-weapon", actionData: { weaponDescription: "rubber chicken" } },
        { playerId: player1Id, actionType: "create-weapon", actionData: { weaponDescription: "existential dread" } },
        { playerId: player1Id, actionType: "create-weapon", actionData: { weaponDescription: "sentient toaster" } },
        
        // Player 2 creates weapons
        { playerId: player2Id, actionType: "create-weapon", actionData: { weaponDescription: "disco ball of doom" } },
        { playerId: player2Id, actionType: "create-weapon", actionData: { weaponDescription: "philosophical hammer" } },
        { playerId: player2Id, actionType: "create-weapon", actionData: { weaponDescription: "cosmic banana" } }
      ],
      expectedOutcome: {
        gameEnded: false  // Game should not end, should be ready for opponent reveal
      },
      assertions: [
        // Both players should have 3 weapons
        (state) => ({
          passed: state.players[player1Id]?.weapons?.length === 3,
          message: `Player 1 should have 3 weapons. Found: ${state.players[player1Id]?.weapons?.length || 0}`
        }),
        (state) => ({
          passed: state.players[player2Id]?.weapons?.length === 3,
          message: `Player 2 should have 3 weapons. Found: ${state.players[player2Id]?.weapons?.length || 0}`
        }),
        
        // No illegal actions for either player (base runtime field)
        (state) => ({
          passed: Object.values(state.players).every((p: any) => p.illegalActionCount === 0),
          message: "No illegal actions should occur for any player"
        }),
        
        // Neither player should still need to act (phase should have progressed)
        (state) => ({
          passed: !state.players[player1Id]?.actionRequired && !state.players[player2Id]?.actionRequired,
          message: "Neither player should need to act after both complete weapon creation"
        })
      ]
    }
  ]
};
