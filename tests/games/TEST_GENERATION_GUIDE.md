# Game Test File Generation Guide

## Purpose

This guide explains how to create test files for game specifications. These test files are used by the game test harness to validate that the simulation workflow correctly implements a game from its specification.

## Test File Structure

Each test file exports:
1. Player IDs generated once and used across all scenarios
2. A `GameTest` object containing spec and scenarios

```typescript
import { createPlayerIds } from "../harness/helpers.js";

// Generate player IDs once for all scenarios
const [player1Id, player2Id] = createPlayerIds(2);

export const gameTest: GameTest = {
  name: string;           // Game name
  spec: string;           // Full game specification (markdown)
  scenarios: Scenario[];  // Test scenarios to validate
};
```

**Important:** The test runner generates a fresh `gameId` for each test run to ensure clean artifact generation. When running multiple scenarios from the same test file, pass the same `gameId` to `executeGameTest()` to reuse artifacts across scenarios.

## Scenario Types

### 1. Happy Path Scenarios

Test that the game works correctly under normal conditions:
- Players follow expected gameplay flow
- Game reaches proper end states
- All phases execute in sequence

### 2. Edge Case Scenarios

Test boundary conditions:
- Maximum/minimum values
- First/last rounds
- Tie conditions
- All players taking same action

### 3. Error Handling Scenarios

Test that invalid actions are rejected:
- Out-of-turn actions
- Invalid inputs
- Repeated submissions

## Scenario Definition Format

```typescript
{
  name: string;              // Descriptive scenario name
  description: string;       // What this scenario tests
  playerActions: Action[];   // Sequence of player actions
  expectedOutcome: {
    gameEnded: boolean;
    winner?: string | null;  // Player ID or null for tie/no winner
    finalPhase?: string;     // Expected final phase
  };
  assertions: Assertion[];   // Custom checks on final state
}
```

## Player Actions

Actions represent player inputs during simulation:

```typescript
{
  playerId: string;         // Which player acts
  actionType: string;       // Type of action (game-specific)
  actionData: any;          // Action payload (game-specific)
  expectedPhase?: string;   // Phase where this should occur (optional validation)
}
```

### Examples:

**Rock Paper Scissors:**
```typescript
{ playerId: crypto.randomUUID(), actionType: "submitMove", actionData: { move: "rock" } }
```

**Space Odyssey:**
```typescript
{ playerId: crypto.randomUUID(), actionType: "selectOption", actionData: { optionIndex: 2 } }
```

**Coin Flip:**
```typescript
{ playerId: crypto.randomUUID(), actionType: "callSide", actionData: { call: "heads" } }
```

**Note:** Always use `crypto.randomUUID()` for player IDs to match production format.

## Assertions

Assertions are functions that validate final game state:

```typescript
type Assertion = (state: GameState) => {
  passed: boolean;
  message: string;
};
```

### Common Assertion Patterns:

**Check final values:**
```typescript
(state) => ({
  passed: state.game.currentRound === 3,
  message: "Game should end after round 3"
})
```

**Check player state:**
```typescript
(state) => ({
  passed: state.players.every(p => p.score >= 0),
  message: "All players should have non-negative scores"
})
```

**Check consistency:**
```typescript
(state) => ({
  passed: state.game.gameEnded === (state.game.currentPhase === "finished"),
  message: "gameEnded flag should match finished phase"
})
```

## How to Generate Test Scenarios from a Spec

### Step 1: Identify Game Flow

Read the spec and identify:
- How many players?
- What phases exist?
- How does game progress?
- What are win/loss conditions?
- What actions can players take?

### Step 2: Create Happy Path

Create 1-2 scenarios showing normal gameplay:
- Start → Player actions → Win condition reached
- Include all major phases
- Show typical player decisions

### Step 3: Create Edge Cases

Based on the spec, identify edge cases:
- What happens on first round?
- What happens on last round?
- What if all players tie?
- What if maximum/minimum values are reached?

### Step 4: Define Assertions

For each scenario, write assertions that:
- Validate win/loss conditions from spec
- Check invariants (things that should always be true)
- Verify state consistency

## Example: Space Odyssey

```typescript
export const spaceOdysseyTest: GameTest = {
  name: "Space Odyssey",
  spec: `# Space Odyssey: A Choice-Based Survival Game
  
  ... (full spec text) ...
  `,
  
  scenarios: [
    {
      name: "Player survives all 5 rounds",
      description: "Tests successful completion by avoiding deadly options",
      playerActions: [
        // We can't know which options are deadly ahead of time,
        // so we use a special action type that queries artifacts
        // Note: Use same UUID variable for all actions by the same player
        { playerId: crypto.randomUUID(), actionType: "selectSafeOption", actionData: { round: 1 } },
        { playerId: "<same-uuid>", actionType: "selectSafeOption", actionData: { round: 2 } },
        { playerId: "<same-uuid>", actionType: "selectSafeOption", actionData: { round: 3 } },
        { playerId: "<same-uuid>", actionType: "selectSafeOption", actionData: { round: 4 } },
        { playerId: "<same-uuid>", actionType: "selectSafeOption", actionData: { round: 5 } },
      ],
      expectedOutcome: {
        gameEnded: true,
        winner: "<same-uuid>",
        finalPhase: "finished"
      },
      assertions: [
        (state) => ({
          passed: state.game.currentRound === 5,
          message: "Should complete all 5 rounds"
        }),
        (state) => ({
          passed: state.players[0].isAlive === true,
          message: "Player should be alive after completing all rounds"
        })
      ]
    },
    
    {
      name: "Player dies on deadly option",
      description: "Tests that selecting deadly option ends game immediately",
      playerActions: [
        { playerId: crypto.randomUUID(), actionType: "selectSafeOption", actionData: { round: 1 } },
        { playerId: "<same-uuid>", actionType: "selectSafeOption", actionData: { round: 2 } },
        { playerId: "<same-uuid>", actionType: "selectDeadlyOption", actionData: { round: 3 } },
      ],
      expectedOutcome: {
        gameEnded: true,
        winner: null,
        finalPhase: "finished"
      },
      assertions: [
        (state) => ({
          passed: state.game.currentRound === 3,
          message: "Game should end on round 3 when deadly option selected"
        }),
        (state) => ({
          passed: state.players[0].isAlive === false,
          message: "Player should be dead after selecting deadly option"
        })
      ]
    }
  ]
};
```

**Important:** When the same player takes multiple actions, define the UUID once and reuse it:
```typescript
const player1Id = crypto.randomUUID();
const player2Id = crypto.randomUUID();

playerActions: [
  { playerId: player1Id, actionType: "move", actionData: { move: "rock" } },
  { playerId: player2Id, actionType: "move", actionData: { move: "paper" } },
  { playerIdcrypto.randomUUID(), actionType: "selectSafeOption", actionData: { round: 1 } }
```

### `submitWinningMove` / `submitLosingMove`

For games like RPS where outcome depends on opponent's move:

```typescript
const player1Id = crypto.randomUUID();
const player2Id = crypto.randomUUID();
{ playerId: player1Id, actionType: "submitWinningMove", actionData: { against: player2Id

The test harness will query the generated artifacts to determine which option is safe/deadly.

```typescript
{ playerId: "p1", actionType: "selectSafeOption", actionData: { round: 1 } }
```

### `submitWinningMove` / `submitLosingMove`

For games like RPS where outcome depends on opponent's move:

```typescript
{ playerId: "p1", actionType: "submitWinningMove", actionData: { against: "p2" } }
```

### `awaitAutomaticPhase`

For automatic transitions (no player input):

```typescript
{ playerId: null, actionType: "awaitAutomaticPhase", actionData: { phase: "scoring" } }
```

## Tips for Writing Good Tests

1. **Start simple**: One happy path scenario is better than none
2. **Read the spec carefully**: Test what the spec says, not what you assume
3. **Name scenarios clearly**: "Player wins by..." not "Test 1"
4. **Write minimal assertions**: Check key outcomes, not every field
5. **Use special actions for randomization**: Don't hardcode random outcomes
6. **Test one thing per scenario**: Don't combine multiple edge cases

## Common Pitfalls to Avoid

❌ **Don't ascrypto.randomUUID() artifact structure:**
```typescript
// BAD - assumes specific schema
assertion: (state) => state.game.round1DeadlyIndex === 2
```

✅ **Do test spec-defined outcomes:**
```typescript
// GOOD - tests win condition from spec
assertion: (state) => state.players[0].isAlive === true
```

❌ **Don't hardcode random outcomes:**
```typescript
// BAD - assumes specific coin flip
{ playerId: "p1", actionData: { call: "heads" }, expectedResult: "win" }
```

✅ **Do test mechanics work correctly:**
```typescript
// GOOD - tests both outcomes
scenarios: [
  { name: "Win on correct call", ... },
  { name: "Lose on incorrect call", ... }
]
```

## Checklist for Complete Test File

- [ ] Game name matches spec
- [ ] Full spec text included
- [ ] At least 1 happy path scenario
- [ ] At least 1 edge case scenario (if applicable)
- [ ] All player action types match game mechanics from spec
- [ ] Expected outcomes align with win/loss conditions from spec
- [ ] Assertions validate key invariants from spec
- [ ] Scenario names are descriptive
- [ ] No hardcoded artifact-specific values

## Template to Start From

```typescript
import { GameTest } from "../harness/types.js";
import { createPlayerIds } from "../harness/helpers.js";

// Generate player IDs once for all scenarios in this test file
const [player1Id, player2Id] = createPlayerIds(2);

export const myGameTest: GameTest = {
  name: "My Game Name",
  spec: `
# [Paste full game spec here]
  `,
  
  scenarios: [
    {
      name: "Happy path - Player wins",
      description: "Tests normal gameplay leading to victory",
      playerActions: [
        // Use the player IDs defined at the top of the file
        { playerId: player1Id, actionType: "...", actionData: {...} },
        { playerId: player2Id, actionType: "...", actionData: {...} },
        { playerId: player1Id, actionType: "...", actionData: {...} },
      ],
      expectedOutcome: {
        gameEnded: true,
        winner: player1Id, // Use same player ID variable
        finalPhase: "finished"
      },
      assertions: [
        (state) => ({
          passed: /* check condition */,
          message: "Description of what's being validated"
        })
      ]
    }
  ]
};
```

**Key Patterns:**

1. **Player IDs:** Generate once at file top with `createPlayerIds()`
2. **Game ID:** Generate once at file top with `createGameId()` and export it
3. **Artifact Reuse:** The test runner uses the exported `gameId` to ensure artifacts are generated once and shared across all scenarios in the test file
4. **State Access:** Player state is accessed by ID: `state.players[p - these stay consistent across all scenarios
2. **Game ID:** Generated by test runner using `createGameId()` - fresh for each test run to avoid artifact reuse
3. **Artifact Reuse:** Within a single test run, pass the same `gameId` to `executeGameTest()` for all scenarios to share artifacts
4. **State Access:** Player state is accessed by ID: `state.players[player1Id]` not by array index

**Test Runner Pattern:**
```typescript
// In your test file (e.g., run-tests.test.ts):
const gameId = process.env.GAME_ID || createGameId("my-game"); // Use env var or generate fresh
await executeGameTest(test, scenario1, gameId); // Generates artifacts
await executeGameTest(test, scenario2, gameId); // Reuses artifacts
```

**Running Tests:**

```bash
# Generate fresh artifacts and run all scenarios
npm run test:game rps

# Reuse existing artifacts for faster iteration/debugging
npm run test:game rps -- --gameId=rps-1734480000000-abc123

# Run with Jest (single scenario)
npm run test:harness

# Run with Jest and reuse artifacts
GAME_ID=rps-1734480000000-abc123 npm run test:harness
```
When asking Copilot to generate a test file:

1. Provide the full game specification
2. Reference this guide
3. Ask for specific scenario types if needed
4. Review generated tests for accuracy against spec

Example prompt:
```
Using the Game Test File Generation Guide, create a test file for this game spec:
[paste spec]

Include:
- 2 happy path scenarios
- 2 edge case scenarios
- Appropriate assertions for win/loss conditions
```
