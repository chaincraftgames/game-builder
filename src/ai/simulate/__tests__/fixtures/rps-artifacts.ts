/**
 * Mock artifacts for 3-Player Rock-Paper-Scissors
 * 
 * These fixtures match the output format of spec-processing-graph
 * and can be used to test runtime-graph without running spec processing.
 */

export const rpsGameRules = `
3-Player Rock-Paper-Scissors Tournament

OVERVIEW:
A tournament-style rock-paper-scissors game where 3 players compete over exactly 3 rounds.
Each round, all players simultaneously submit their choice (rock, paper, or scissors).
After all players submit, the round is scored and the next round begins.
After 3 rounds, the game ends and the player with the highest score wins.

GAME FLOW:
1. Game starts in "setup" phase with automatic initialization
2. Transitions to "playing" phase - players submit moves
3. When all 3 players have submitted, automatically transitions to "scoring" phase
4. In scoring phase, round winner(s) determined and scores updated
5. If currentRound < 3, automatically transitions back to "playing" for next round
6. If currentRound >= 3, automatically transitions to "finished" phase
7. Game ends in "finished" phase

RULES:
- Rock beats Scissors
- Scissors beats Paper
- Paper beats Rock
- If all three players choose different options, all three score a point
- If two players tie and one differs, the differing player scores
- If all three tie, no one scores

SCORING:
- Winner(s) of each round get +1 point
- Scores accumulate across all 3 rounds
- Highest total score after 3 rounds wins
`;

export const rpsStateSchema = JSON.stringify([
  {
    name: "game",
    type: "object",
    properties: {
      phase: { type: "string" },
      currentRound: { type: "number" },
      totalRounds: { type: "number" },
      currentRoundMoves: { type: "object" },
      lastRoundResults: { type: "string" }
    }
  },
  {
    name: "players",
    type: "object",
    patternProperties: {
      "^player[0-9]+$": {
        type: "object",
        properties: {
          score: { type: "number" },
          currentMove: { type: "string" }
        }
      }
    }
  }
]);

export const rpsStateTransitions = `
GAME PHASES:

1. SETUP: Initialize game state
   - Set up player records
   - Initialize round counter to 1
   - Set total rounds to 3
   - Prepare for first round

2. PLAYING: Players submit moves
   - Wait for all 3 players to submit rock/paper/scissors
   - Track submissions in game.currentRoundMoves
   - Once all players submitted, transition to SCORING

3. SCORING: Calculate round results
   - Determine winner(s) based on RPS rules
   - Update player scores
   - Record results in game.lastRoundResults
   - Clear currentRoundMoves for next round
   - Increment currentRound counter
   - Check if more rounds remain

4. FINISHED: Game complete
   - Display final scores
   - Declare winner
   - No further actions allowed

PHASE TRANSITIONS:

FROM: SETUP
TO: PLAYING
TRIGGER_TYPE: AUTOMATIC
TRIGGER: Game initialization complete
CONDITIONS: Game state initialized, players created, round counter set

FROM: PLAYING
TO: SCORING
TRIGGER_TYPE: PLAYER_ACTION
TRIGGER: All 3 players have submitted moves
CONDITIONS: game.currentRoundMoves has 3 entries (one per player)

FROM: SCORING
TO: PLAYING
TRIGGER_TYPE: AUTOMATIC
TRIGGER: More rounds remaining
CONDITIONS: game.currentRound < game.totalRounds (currently < 3)

FROM: SCORING
TO: FINISHED
TRIGGER_TYPE: AUTOMATIC
TRIGGER: All rounds completed
CONDITIONS: game.currentRound >= game.totalRounds (>= 3)
`;

export const rpsPhaseInstructions = {
  setup: `SETUP PHASE: Initialize the game

RESPONSIBILITIES:
- Create player records with score initialized to 0
- Set game.currentRound to 1
- Set game.totalRounds to 3
- Initialize game.currentRoundMoves to empty object {}
- Set game.phase to "setup"

PHASE TRANSITIONS:
- TO PLAYING: Automatically transition once setup is complete
`,

  playing: `PLAYING PHASE: Wait for all players to submit moves

RESPONSIBILITIES:
- Accept move submissions from players (rock, paper, or scissors)
- Store moves in game.currentRoundMoves as { playerId: move }
- Track which players have submitted
- Reject invalid moves (must be "rock", "paper", or "scissors")
- Provide feedback to players about submission status

VALIDATION:
- Only accept moves from valid player IDs
- Only accept "rock", "paper", or "scissors" (case-insensitive)
- Each player can only submit once per round
- Cannot modify move once submitted

PHASE TRANSITIONS:
- TO SCORING: When all 3 players have submitted moves (currentRoundMoves has 3 entries)

MESSAGES:
- On valid move: "[Player] submitted [move]. Waiting for X more players..."
- On all moves in: "All players submitted! Calculating results..."
- On invalid move: "Invalid move. Must be rock, paper, or scissors."
`,

  scoring: `SCORING PHASE: Calculate round results and award points

RESPONSIBILITIES:
- Apply rock-paper-scissors rules to determine winner(s)
- Update player scores (winner(s) get +1 point)
- Record results in game.lastRoundResults
- Clear game.currentRoundMoves for next round
- Clear player.currentMove fields
- Increment game.currentRound
- Determine if game should continue or end

ROCK-PAPER-SCISSORS RULES:
- Rock beats Scissors
- Scissors beats Paper
- Paper beats Rock
- All different: All three players score
- Two same, one different: Different player scores
- All same: No one scores

PHASE TRANSITIONS:
- TO PLAYING: If game.currentRound < game.totalRounds (more rounds to play)
- TO FINISHED: If game.currentRound >= game.totalRounds (all rounds complete, set gameEnded=true)

MESSAGES:
- Announce round results and updated scores
- If continuing: "Round [X] complete. Starting round [Y]..."
- If ending: "All rounds complete! Final scores: ..."
`,

  finished: `FINISHED PHASE: Game complete

RESPONSIBILITIES:
- Display final scores
- Declare winner (highest score)
- Handle ties if multiple players have same highest score
- Reject any further move submissions

RULES:
- No state changes allowed
- No phase transitions from this phase
- game.gameEnded should be true

MESSAGES:
- Display final standings
- Announce winner(s)
- Reject any action attempts with "Game is finished"
`
};
