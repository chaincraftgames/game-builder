import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { GameTest } from "../harness/types.js";
import { createPlayerIds } from "../harness/helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Generate player ID once for all scenarios
const [playerId] = createPlayerIds(1);

export const westwardPerilTest: GameTest = {
  name: "Westward Peril",
  spec: readFileSync(join(__dirname, "specs", "westward-peril-with-narratives.md"), "utf-8"),
  narrativesFile: "specs/westward-peril-narratives.json",
  
  scenarios: [
    {
      name: "Random playthrough #1 - selecting choices 0,1,2,3,0",
      description: "Tests game mechanics with first pattern of random choices. May end in death or victory depending on randomly assigned deadly options.",
      playerActions: [
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 0 } },
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 1 } },
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 2 } },
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 3 } },
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 0 } },
      ],
      expectedOutcome: {
        gameEnded: true,
      },
      assertions: [
        (state) => ({
          passed: state.game?.gameEnded === true,
          message: "Game should end (either by death or completing 5 turns)"
        }),
        (state) => ({
          passed: state.game?.publicMessage !== undefined && state.game.publicMessage.length > 0,
          message: "Game should have final public message"
        }),
        (state) => {
          const msg = state.game?.publicMessage?.toLowerCase() || '';
          const hasDeath = msg.includes('death') || msg.includes('died') || msg.includes('tragedy');
          const hasVictory = msg.includes('victory') || msg.includes('survived') || msg.includes('success');
          return {
            passed: hasDeath || hasVictory,
            message: "Final message should indicate death or victory outcome"
          };
        }
      ],
    },

    {
      name: "Random playthrough #2 - selecting choices 2,2,2,2,2",
      description: "Tests game mechanics with second pattern of random choices. May end early on death or complete all turns.",
      playerActions: [
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 2 } },
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 2 } },
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 2 } },
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 2 } },
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 2 } },
      ],
      expectedOutcome: {
        gameEnded: true,
      },
      assertions: [
        (state) => ({
          passed: state.game?.gameEnded === true,
          message: "Game should end (death or completion)"
        }),
        (state) => ({
          passed: Object.values(state.players).every(p => p.illegalActionCount === 0),
          message: "No illegal actions should occur"
        })
      ],
    },

    {
      name: "Random playthrough #3 - selecting choices 3,1,0,2,1",
      description: "Tests game mechanics with third pattern. Death possible at any turn depending on deadly option assignments.",
      playerActions: [
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 3 } },
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 1 } },
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 0 } },
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 2 } },
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 1 } },
      ],
      expectedOutcome: {
        gameEnded: true,
      },
      assertions: [
        (state) => ({
          passed: state.game?.gameEnded === true,
          message: "Game should end"
        }),
        (state) => ({
          passed: state.game?.publicMessage !== undefined,
          message: "Should have final message"
        })
      ],
    },

    {
      name: "Random playthrough #4 - selecting choices 1,3,1,3,1",
      description: "Tests game mechanics with fourth pattern. Validates that death mechanics work correctly across all turns.",
      playerActions: [
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 1 } },
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 3 } },
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 1 } },
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 3 } },
        { playerId, actionType: "selectChoice", actionData: { choiceIndex: 1 } },
      ],
      expectedOutcome: {
        gameEnded: true,
      },
      assertions: [
        (state) => ({
          passed: state.game?.gameEnded === true,
          message: "Game should end"
        })
      ],
    },
  ],
};
