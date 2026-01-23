/**
 * Wacky Weapons Router Bug Test
 * 
 * Reproduces router bug where game gets stuck in round_start phase.
 * 
 * Issue: After both players finalize weapons, game transitions to round_start
 * but fails to auto-transition to weapon_selection even though:
 * - round_start phase has requiresPlayerInput: false
 * - begin_round transition preconditions are satisfied
 * - Router reports transitionReady: false (incorrectly)
 */

import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { GameTest } from "../harness/types.js";
import { createPlayerIds } from "../harness/helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const [player1Id, player2Id] = createPlayerIds(2);

export const wackyWeaponsRouterBugTest: GameTest = {
  name: "Wacky Weapons - Router Stuck in round_start",
  spec: "", // Not used - using pre-generated artifacts
  artifactsFile: join(__dirname, "..", "artifacts", "wacky-weapons.json"),

  scenarios: [
    {
      name: "Reproduce round_start deadlock",
      description: "Both players finalize weapons, game should auto-transition to weapon_selection but gets stuck in round_start",
      playerActions: [
        // Both players finalize weapons
        {
          playerId: player1Id,
          actionType: "finalize_weapons",
          actionData: {
            weapon1: "A pool noodle",
            weapon2: "An hyper annoying alarm clock",
            weapon3: "The inescapable truth of Monday"
          }
        },
        {
          playerId: player2Id,
          actionType: "finalize_weapons",
          actionData: {
            weapon1: "A complaining squirrel",
            weapon2: "A broken toaster",
            weapon3: "A tap dancing cricket"
          }
        },
        // Game should auto-transition to weapon_selection here
        // but instead gets stuck in round_start
      ],
      expectedOutcome: {
        gameEnded: false,
        finalPhase: "weapon_selection"
      },
      assertions: [
        (state) => ({
          passed: state.game.currentPhase === "weapon_selection",
          message: `Expected phase 'weapon_selection' but got '${state.game.currentPhase}'. Router should have auto-transitioned from round_start.`
        }),
        (state) => ({
          passed: state.game.currentRound === 1,
          message: "Should be in round 1"
        }),
        (state) => ({
          passed: state.players[player1Id]?.actionRequired === true,
          message: "Player 1 should be required to select a weapon"
        }),
        (state) => ({
          passed: state.players[player2Id]?.actionRequired === true,
          message: "Player 2 should be required to select a weapon"
        }),
        (state) => ({
          passed: state.players[player1Id]?.selectedWeapon === null,
          message: "Player 1 should not have selected a weapon yet"
        }),
        (state) => ({
          passed: state.players[player2Id]?.selectedWeapon === null,
          message: "Player 2 should not have selected a weapon yet"
        }),
        (state) => ({
          passed: Object.keys(state.game.weaponMappings || {}).length === 6,
          message: "Weapon mappings should be generated for all 6 weapons"
        })
      ]
    }
  ]
};
