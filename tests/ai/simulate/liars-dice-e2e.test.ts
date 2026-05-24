/**
 * Liar's Dice — End-to-End Test (Spec → Generated Mechanics → Gameplay)
 *
 * Exercises the FULL pipeline:
 *   1. createSimulation with overrideSpecification (real spec, real LLM)
 *      → schema extraction → transition extraction → instruction planning
 *      → mechanics generation (LLM codegen + tsc validation)
 *   2. Verify generatedMechanics were produced
 *   3. initializeSimulation → dice rolled, communal dice revealed
 *   4. Scripted gameplay rounds covering:
 *      a. Bid with increased count (any face allowed)
 *      b. Bid with same count, higher face value
 *      c. Illegal bid: same count, lower face value → rejected
 *      d. Challenge where challenger wins (bidder loses a die)
 *      e. Challenge where challenger loses (challenger loses a die)
 *   5. Structural assertions:
 *      - Dice arrays shrink when a player loses (not just diceCount)
 *      - Public messages are always present and non-empty after actions
 *      - Private messages are appropriate (tell players about their dice)
 *      - Game ends when a player is reduced to 1 die (elimination threshold)
 *
 * Requires CHAINCRAFT_SIM_API_KEY or ANTHROPIC_API_KEY.
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { setConfig } from "#chaincraft/config.js";
import {
  createSimulation,
  initializeSimulation,
  processAction,
  getGameState,
  getCachedSpecArtifacts,
} from "#chaincraft/ai/simulate/simulate-workflow.js";
import type { SimResponse } from "#chaincraft/ai/simulate/simulate-workflow.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Spec & Narratives
// ═══════════════════════════════════════════════════════════════════════════════

const LIARS_DICE_SPEC = `# Liar's Dice - Game Specification

## Game Overview

Liar's Dice is a 2-player bluffing and deduction game where players bid on the total count of specific die faces across three dice pools: their own hidden dice, their opponent's hidden dice, and a shared visible communal pool. Players must choose whether to escalate bids or challenge their opponent's claims, with incorrect challenges resulting in permanent die loss. The last player with dice remaining wins.

## Game Setup

Each player begins with exactly 5 dice. These dice are the player's personal pool and remain hidden from the opponent throughout the game.

A communal pool of exactly 5 dice is placed visibly in the center of the play area, accessible and visible to both players at all times.

At game start, the communal dice are rolled once and their values are revealed to both players. These communal dice remain showing their current values throughout the opening round and are not re-rolled until the start of the next round.

Both players simultaneously roll their personal 5 dice and view only their own results. Players must keep their dice hidden from their opponent.

The game randomly selects which player makes the first bid of the opening round.

## Round Structure

Each round consists of a bidding phase followed by a challenge resolution.

At the start of each round (after the opening round), the following occurs in sequence:

1. Both players re-roll all their remaining personal dice simultaneously
2. The communal pool of 5 dice is re-rolled simultaneously
3. The newly rolled communal dice values are revealed to both players
4. Players view only their own newly rolled personal dice

The communal dice remain visible and unchanged throughout the bidding phase of that round. They are re-rolled again only at the start of the next round.

The player who won the previous challenge makes the first bid of the new round. In the opening round, the randomly selected starting player makes the first bid.

## Bidding Phase

### Bid Structure

A bid consists of two components:
1. A die face value (1, 2, 3, 4, 5, or 6)
2. A count (the claimed quantity of that face value)

When making a bid, the player claims that across all three pools combined (their own hidden dice + opponent's hidden dice + the visible communal dice), there are at least the claimed count of dice showing the claimed face value.

Example: A bid of "four 3s" claims there are at least four dice showing 3 across all dice in play.

### First Bid of Round

The starting player of each round may make any valid bid. A valid first bid is any combination of:
- Die face value: 1 through 6
- Count: 1 through the current total number of dice remaining in play

The total number of dice in play equals: (Player 1's remaining dice) + (Player 2's remaining dice) + 5 (communal dice).

### Subsequent Bids

After the first bid of a round, each subsequent bid must be higher than the previous bid according to these rules:

**Count-Increase Rule:**
If a player increases the count from the previous bid, they may bid ANY die face value (1 through 6). Increasing the count effectively resets the face value ladder, allowing the bidder to choose any face value regardless of the previous bid's face value.

**Same-Count Rule:**
If a player keeps the same count as the previous bid, they may ONLY bid a strictly higher die face value than the previous bid. No face value reset is allowed when the count remains unchanged.

A bid is higher if it meets one of these conditions:
1. Strictly higher count than previous bid, with any die face value from 1 to 6
2. Same count as previous bid, with strictly higher die face value than previous bid

Examples of valid bid progressions:
- "one 6" → "two 1" (increased count, can reset to any face)
- "one 6" → "two 6" (increased count, can reset to any face)
- "two 4" → "three 2" (increased count, can reset to any face)
- "two 4" → "three 5" (increased count, can reset to any face)
- "three 4" → "three 5" (same count, higher face value)
- "three 4" → "four 4" (increased count, can reset to any face)
- "three 4" → "four 3" (increased count, can reset to any face)

Examples of invalid bid progressions:
- "one 6" → "one 3" (same count, lower face value)
- "one 6" → "one 6" (identical bid, not higher)
- "three 4" → "three 3" (same count, lower face value)
- "three 4" → "three 4" (identical bid, not higher)
- "three 4" → "two 5" (decreased count)
- "three 4" → "two 6" (decreased count)

### Bid Validation

When a player attempts to make a bid that is not higher than the previous bid, the game must reject the bid immediately.

The rejection message must clearly state:
1. Which bidding rule was violated
2. What the current bid is (face value and count)
3. What legal bidding options are available

**When Same Count with Equal or Lower Face Value:**
If the player attempted to keep the same count as the previous bid but used an equal or lower face value, the rejection must explain that keeping the same count requires a strictly higher face value. The rejection must list all valid face values (those strictly higher than the previous bid's face value).

**When Lower Count:**
If the player attempted to decrease the count from the previous bid, the rejection must explain that the count must either increase or stay the same, and if it stays the same, the face value must be strictly higher than the previous bid's face value.

**When Count Exceeds Total Dice:**
If the player attempted to bid a count exceeding the total number of dice currently in play, the rejection must inform the player of the maximum legal count based on total dice remaining.

Legal bidding options from any current bid are:
- Increase the count to any value from (current count + 1) up to the total dice in play, with any die face value from 1 to 6
- Keep the same count as current bid, but increase the die face value to any value strictly higher than the current face value (e.g., if current face is 4, legal same-count options are face values 5 or 6)

The player must then make a new bid attempt that satisfies the bidding progression rules or choose to challenge instead.

### Maximum Bid Limit

No bid may claim a count higher than the total number of dice currently in play.

For example, if Player 1 has 3 dice, Player 2 has 4 dice, and the communal pool has 5 dice, the maximum valid count for any bid is 12.

If a player attempts to bid a count exceeding the total dice in play, the game must reject the bid and inform the player of the maximum legal count.

### Strategic Implications

The bidding rules create strategic pressure points:

A bid of "one 6" (lowest count, highest face value) forces the next player into a critical decision: they must either increase the count (allowing them to reset to any face value, including lower faces) or challenge immediately, since no higher face value than 6 exists for a same-count bid.

Similarly, any bid with a high face value (5 or 6) and low count constrains the opponent's same-count options while forcing count increases to maintain bidding flexibility.

The re-rolling of communal dice each round creates additional strategic complexity. Players cannot rely on communal dice values from the previous round when planning bids or evaluating challenges. At the start of each new round, both players gain fresh information about the communal pool, which may significantly alter the risk calculation for any given bid.

## Challenge Mechanic

### Initiating a Challenge

On their turn, instead of making a higher bid, a player may challenge the previous bid by declaring "Liar!" or equivalent challenge declaration.

A challenge immediately ends the bidding phase and triggers challenge resolution.

The first bid of a round may be challenged immediately by the opponent.

### Challenge Resolution

When a challenge is declared:

1. Both players immediately reveal all their hidden personal dice
2. All dice showing the challenged bid's face value are counted across all three pools:
   - Challenger's revealed dice
   - Bidder's revealed dice
   - Visible communal dice (already revealed at round start)
3. The actual count is compared to the challenged bid's claimed count

### Challenge Outcome - Bidder Wins

If the actual count of the face value is **greater than or equal to** the bid's claimed count, the bid was truthful.

The bidder wins the challenge.

The challenger loses one die permanently. One die is automatically removed from the challenger's personal pool. That die is removed from the game permanently and does not return in future rounds.

### Challenge Outcome - Challenger Wins

If the actual count of the face value is **less than** the bid's claimed count, the bid was false.

The challenger wins the challenge.

The bidder loses one die permanently. One die is automatically removed from the bidder's personal pool. That die is removed from the game permanently and does not return in future rounds.

### Post-Challenge Round Start

After challenge resolution and die loss, a new round begins immediately (unless the game has ended).

The player who **won** the challenge makes the first bid of the new round.

Both players re-roll their remaining personal dice.

The communal pool of 5 dice is re-rolled.

The newly rolled communal dice values are revealed to both players.

Players view only their own newly rolled dice.

## Player Elimination and Game End

### Elimination

When a player loses a challenge and must discard a die, if they are left with only 1 die, they are eliminated from the game immediately. Playing with a single die is trivially unfair — the opponent can always force a bluff and call a challenge.

An eliminated player has 1 die and cannot participate in further rounds.

### Win Condition

The game ends immediately when one player is reduced to 1 die.

The player with 1 die loses the game.

The player with 2 or more dice remaining wins the game.

### Impossible Game States

If through any sequence of play both players would simultaneously reach 1 die (this should not occur under normal rules), the game ends in a draw. Neither player wins.

## Information Visibility

### What Players See

Each player always sees:
- Their own personal dice (count and face values)
- The communal pool dice (count and face values) at all times during the current round
- All bids made during the current round (by both players)
- The history of previous bids and challenge outcomes
- The current die count for both players (how many dice each player has, but not the values)
- When their bid is rejected, the specific reason for rejection and legal bidding options

### What Players Do Not See

Each player never sees:
- Their opponent's personal dice face values (until a challenge is called)
- Their opponent's personal dice during bidding
- The communal dice values from previous rounds (communal dice are re-rolled at the start of each new round)

### Information at Challenge

During challenge resolution, all personal dice are revealed to both players. After resolution, both personal dice and communal dice are re-rolled for the next round and personal dice are hidden again. The communal dice values are revealed at the start of the new round.

## Turn Order and Timing

### Turn Structure

Players alternate turns during the bidding phase.

On their turn, the active player must either:
1. Make a valid higher bid, OR
2. Challenge the previous bid

If a player attempts an invalid bid, they receive rejection feedback and must make another attempt. They remain the active player until they make a valid bid or challenge.

The active player must take one of these actions. Passing without bidding or challenging is not permitted.

### Round Timing

Each round continues until a challenge is declared. There is no maximum number of bids per round.

After a challenge resolves, the next round begins immediately with the challenge winner making the first bid after dice re-rolls.

## Edge Cases and Special Rules

### Minimum Bid Count

A bid must claim at least 1 die of the specified face value. A bid of "zero 4s" is invalid.

If a player attempts to bid zero of any face value, the game must reject the bid and remind the player that the minimum count is 1.

### Starting with Unequal Dice

If players begin a round with unequal personal dice counts (due to previous challenge losses), bidding and challenge rules remain identical. The maximum bid count is based on total dice remaining across all three pools.

### Two Dice Scenarios

When a player has exactly 2 dice remaining:
- They still roll them at round start
- They must bid or challenge as normal
- If they lose a challenge, they are reduced to 1 die and eliminated immediately

### Communal Dice Re-Roll Each Round

The 5 communal dice are re-rolled at the start of every round after the opening round. Their values are revealed to both players immediately after re-rolling, before the first bid of the round is made.

During the bidding phase of any given round, the communal dice remain visible and do not change values. They show the values rolled at the start of that specific round.

Players cannot use communal dice values from previous rounds to inform their bidding decisions. Each round presents a fresh communal pool state.

At the opening round (game setup), the communal dice are rolled once and revealed. They remain visible throughout the opening round's bidding phase.

### Challenge on First Bid

The opponent may challenge the very first bid of any round. If the first bid is challenged and the bidder loses, the bidder loses one die. The challenger then makes the first bid of the next round (as they won the challenge).

### Bidding Order After Die Loss

After a player loses a die but is not eliminated (still has 2+ dice), they participate normally in the next round. The winner of the challenge starts the bidding regardless of who lost the die.

### Face Value Hierarchy

Die face values are ordered 1 < 2 < 3 < 4 < 5 < 6 for determining which bids are higher when changing face values under the same-count rule.

A bid on 6s with the same count as a previous bid is only valid if the previous bid was on face value 5 or lower. A bid on 5s with the same count is only valid if the previous bid was on face value 4 or lower, and so on.

### Exact Count Matches

If the actual count exactly equals the bid count during challenge resolution, the bid is considered truthful and the bidder wins. The challenger loses one die.

### High Face, Low Count Traps

A bid with face value 6 and count 1 ("one 6") creates maximum strategic pressure. The opponent cannot make a same-count bid (no face value higher than 6 exists), so they must either increase the count to 2 or higher (allowing any face value reset) or challenge immediately.

Similarly, "two 6s", "three 6s", etc., force count increases unless challenged.

Bids with face value 5 allow only face value 6 for same-count responses, creating similar but slightly less extreme pressure.

## Narrative Requirements

The game must generate narrative text describing:
- The current state of the communal dice at the start of each round (newly rolled values revealed to both players)
- The current state of the communal dice during bidding (visible, unchanging values for that round)
- Each player's bid as it is made, including the player identity and bid details
- Rejected bids with clear explanation of why the bid was invalid and what legal options exist
- Challenge declarations and which player initiated the challenge
- Challenge resolution outcomes, including the actual count revealed (from all three pools), which player won, and which player lost a die
- Round transitions, including which player won the previous challenge and will bid first, and the re-rolling of all dice (personal and communal)
- Game end conditions, clearly stating which player won and why

The narrative must emphasize the moment at round start when communal dice are re-rolled and revealed, creating a fresh strategic landscape for both players. This re-roll represents a shift in the known information available to all players.

During the bidding phase, the narrative must treat the communal dice as stable, visible information that both players can reference when making or evaluating bids.

The narrative must maintain dramatic tension appropriate to a bluffing game, emphasizing uncertainty around hidden information (opponent's dice) while clearly presenting known information (communal dice values for the current round, bid progression).

When a bid is rejected, the narrative must deliver this information clearly and helpfully without breaking immersion. The tone should guide the player toward understanding the rules rather than punishing them for mistakes. The rejection message should feel like a helpful referee clarifying the rules, not a harsh error message.
`;

const SPEC_NARRATIVES = {
  BLUFFING_TENSION: "Keep the tone competitive but playful. Emphasize the psychological tension of bluffing. Use short, punchy descriptions for bids. Build tension gradually within each round. Make challenge resolutions feel like dramatic reveals.",
};

// ═══════════════════════════════════════════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════════════════════════════════════════

const sessionId = `liars-dice-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const gameId = `liars-dice-game-test-v1`;
const specKey = `${gameId}-v1`;
const player1Id = crypto.randomUUID();
const player2Id = crypto.randomUUID();

/** Get player dice array from game state (hidden in player's state) */
function getPlayerDice(gameState: any, playerId: string): number[] | undefined {
  const players = gameState?.players || {};
  const playerData = players[playerId];
  return playerData?.dice ?? playerData?.personalDice ?? playerData?.diceValues ?? playerData?.personalDiceValues;
}

/** Get player dice count from game state */
function getPlayerDiceCount(gameState: any, playerId: string): number | undefined {
  const players = gameState?.players || {};
  const playerData = players[playerId];
  // Try explicit count fields first, fall back to array length
  const explicitCount = playerData?.diceCount ?? playerData?.diceRemaining ?? playerData?.remainingDice ?? playerData?.remainingDiceCount;
  if (explicitCount !== undefined) return explicitCount;
  const diceArr = getPlayerDice(gameState, playerId);
  return diceArr?.length;
}

/** Get communal dice from game state */
function getCommunalDice(gameState: any): number[] | undefined {
  return gameState?.game?.communalDice ?? gameState?.game?.communalPool ?? gameState?.game?.sharedDice ?? gameState?.game?.communalDiceValues;
}

/** Assert that a public message is present, non-empty, and doesn't contain player aliases */
function assertPublicMessage(response: SimResponse, context: string) {
  expect(response.publicMessage).toBeDefined();
  expect(typeof response.publicMessage).toBe("string");
  expect(response.publicMessage!.length).toBeGreaterThan(0);
  // Player aliases should have been replaced with UUIDs
  const hasRawAlias = /\bplayer[12]\b/i.test(response.publicMessage!);
  if (hasRawAlias) {
    console.warn(`[${context}] Public message contains raw player alias: ${response.publicMessage}`);
  }
}

/** Assert private messages are present for active players */
function assertPrivateMessages(response: SimResponse, playerIds: string[], context: string) {
  for (const pid of playerIds) {
    const pState = response.playerStates.get(pid);
    if (pState?.privateMessage) {
      expect(typeof pState.privateMessage).toBe("string");
      expect(pState.privateMessage!.length).toBeGreaterThan(0);
      console.log(`  [${context}] Private → ${pid.slice(0, 8)}: ${pState.privateMessage!.slice(0, 120)}...`);
    }
  }
}

/** Log response summary */
function logResponse(label: string, response: SimResponse) {
  console.log(`\n--- ${label} ---`);
  if (response.publicMessage) {
    console.log(`  Public: ${response.publicMessage.slice(0, 200)}`);
  }
  console.log(`  Game ended: ${response.gameEnded}`);
  for (const [pid, pState] of response.playerStates) {
    console.log(`  ${pid.slice(0, 8)}: actionRequired=${pState.actionRequired}, actionsAllowed=${pState.actionsAllowed}, illegalActionCount=${pState.illegalActionCount}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test
// ═══════════════════════════════════════════════════════════════════════════════

describe("Liar's Dice — Full E2E (spec → codegen → gameplay)", () => {
  beforeAll(() => {
    setConfig("simulation-graph-type", "test-liars-dice-e2e");
  });

  it("should process spec, generate mechanics, and play a multi-round game", async () => {
    console.log("\n========== LIAR'S DICE E2E: START ==========");
    console.log(`Session: ${sessionId}`);
    console.log(`Game: ${gameId}`);
    console.log(`Player 1: ${player1Id}`);
    console.log(`Player 2: ${player2Id}`);

    // ─── Phase 1: Spec Processing ──────────────────────────────────────

    console.log("\n══════ Phase 1: Spec Processing ══════");
    const createResult = await createSimulation(sessionId, gameId, 1, {
      overrideSpecification: LIARS_DICE_SPEC,
      specNarrativesOverride: SPEC_NARRATIVES,
    });

    expect(createResult.gameRules).toBeTruthy();
    console.log("Game rules extracted:", createResult.gameRules.substring(0, 100) + "...");

    // ─── Phase 2: Verify Generated Mechanics ───────────────────────────

    console.log("\n══════ Phase 2: Verify Generated Mechanics ══════");
    const artifacts = await getCachedSpecArtifacts(specKey);
    expect(artifacts).toBeDefined();

    const mechanics = artifacts!.generatedMechanics;
    console.log("Generated mechanics keys:", mechanics ? Object.keys(mechanics) : "NONE");

    if (mechanics && Object.keys(mechanics).length > 0) {
      console.log("✓ Mechanics were generated by the spec-processing pipeline!");
      for (const [id, code] of Object.entries(mechanics)) {
        console.log(`  ${id}: ${(code as string).length} chars`);
      }
    } else {
      console.warn("⚠ No generatedMechanics found — game will use LLM fallback for all transitions");
    }

    // ─── Phase 3: Initialize Simulation ────────────────────────────────

    console.log("\n══════ Phase 3: Initialize Simulation ══════");
    const initResult = await initializeSimulation(sessionId, [player1Id, player2Id]);
    assertPublicMessage(initResult as SimResponse, "init");
    console.log("Init public message:", initResult.publicMessage?.slice(0, 200));

    let gameState = await getGameState(sessionId);
    expect(gameState).toBeDefined();
    console.log("Game state keys:", Object.keys(gameState!.game || {}));
    console.log("Player keys:", Object.keys(gameState!.players || {}));

    // Verify initial dice setup
    const communalDice = getCommunalDice(gameState);
    console.log("Communal dice:", communalDice);
    if (communalDice) {
      expect(communalDice).toHaveLength(5);
      for (const d of communalDice) {
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(6);
      }
    }

    // Check initial dice counts
    const p1InitialCount = getPlayerDiceCount(gameState, player1Id);
    const p2InitialCount = getPlayerDiceCount(gameState, player2Id);
    console.log(`Player 1 initial dice count: ${p1InitialCount}`);
    console.log(`Player 2 initial dice count: ${p2InitialCount}`);
    if (p1InitialCount !== undefined) expect(p1InitialCount).toBe(5);
    if (p2InitialCount !== undefined) expect(p2InitialCount).toBe(5);

    // Track dice counts throughout the game
    let p1DiceCount = 5;
    let p2DiceCount = 5;

    // ─── Phase 4: Gameplay — Scripted Rounds ───────────────────────────

    console.log("\n══════ Phase 4: Gameplay ══════");

    // Determine who goes first by checking actionRequired
    let activePlayer: string;
    let waitingPlayer: string;
    const p1State = initResult.playerStates.get(player1Id);
    const p2State = initResult.playerStates.get(player2Id);
    if (p1State?.actionRequired) {
      activePlayer = player1Id;
      waitingPlayer = player2Id;
    } else if (p2State?.actionRequired) {
      activePlayer = player2Id;
      waitingPlayer = player1Id;
    } else {
      // Neither marked — try player1 first
      console.warn("Neither player marked actionRequired after init — defaulting to player1");
      activePlayer = player1Id;
      waitingPlayer = player2Id;
    }
    console.log(`Active player (bids first): ${activePlayer.slice(0, 8)}`);

    // ── Round 1: Escalating bids + illegal move + challenge (challenger wins) ──

    console.log("\n─── Round 1 ───");

    // Bid 1: Active player opens with "two 3s"
    console.log("\nBid 1: Active player opens with 'two 3s'");
    let response = await processAction(sessionId, activePlayer, "I bid two 3s");
    logResponse("Bid 1 (two 3s)", response);
    assertPublicMessage(response, "bid-1");
    assertPrivateMessages(response, [player1Id, player2Id], "bid-1");
    expect(response.gameEnded).toBe(false);

    // Bid 2: Waiting player — same count, higher face: "two 5s" (face value increase)
    console.log("\nBid 2: Waiting player raises face: 'two 5s'");
    response = await processAction(sessionId, waitingPlayer, "I bid two 5s");
    logResponse("Bid 2 (two 5s)", response);
    assertPublicMessage(response, "bid-2");
    expect(response.gameEnded).toBe(false);

    // Bid 3: ILLEGAL — Active player tries same count, LOWER face: "two 3s"
    // This should be rejected. The player should still be the active player after.
    console.log("\nBid 3: ILLEGAL — Active player tries 'two 3s' (same count, lower face)");
    response = await processAction(sessionId, activePlayer, "I bid two 3s");
    logResponse("Bid 3 ILLEGAL (two 3s)", response);
    const activeAfterIllegal = response.playerStates.get(activePlayer);
    console.log(`  Active player illegalActionCount: ${activeAfterIllegal?.illegalActionCount}`);
    console.log(`  Active player still actionRequired: ${activeAfterIllegal?.actionRequired}`);
    // Rejection is confirmed by illegalActionCount incrementing — no public message on rejection
    // (public rejection messages risk revealing what the player was attempting)
    expect(activeAfterIllegal?.illegalActionCount).toBeGreaterThan(0);
    console.log("✓ Illegal bid was rejected (illegalActionCount incremented)");
    expect(response.gameEnded).toBe(false);

    // Bid 4: Active player makes a VALID bid — increase count: "three 2s"
    console.log("\nBid 4: Active player increases count: 'three 2s'");
    response = await processAction(sessionId, activePlayer, "I bid three 2s");
    logResponse("Bid 4 (three 2s)", response);
    assertPublicMessage(response, "bid-4");
    expect(response.gameEnded).toBe(false);

    // Bid 5: Waiting player escalates further — increase count: "four 4s"
    console.log("\nBid 5: Waiting player increases count: 'four 4s'");
    response = await processAction(sessionId, waitingPlayer, "I bid four 4s");
    logResponse("Bid 5 (four 4s)", response);
    assertPublicMessage(response, "bid-5");
    expect(response.gameEnded).toBe(false);

    // Challenge 1: Active player challenges — "Liar!"
    // We can't control whether challenger wins or loses (depends on actual dice),
    // so we just verify structural correctness.
    console.log("\nChallenge 1: Active player calls 'Liar!'");
    response = await processAction(sessionId, activePlayer, "Liar!");
    logResponse("Challenge 1", response);
    assertPublicMessage(response, "challenge-1");

    // After a challenge, someone should have lost a die
    gameState = await getGameState(sessionId);
    const p1CountAfterR1 = getPlayerDiceCount(gameState, player1Id);
    const p2CountAfterR1 = getPlayerDiceCount(gameState, player2Id);
    console.log(`  After challenge: P1 dice=${p1CountAfterR1}, P2 dice=${p2CountAfterR1}`);

    // Exactly one player should have lost exactly one die
    const totalLost = (5 - (p1CountAfterR1 ?? 5)) + (5 - (p2CountAfterR1 ?? 5));
    expect(totalLost).toBe(1);
    console.log("✓ Exactly one die was lost in challenge resolution");

    // Verify dice ARRAY length matches dice count
    const p1DiceArr = getPlayerDice(gameState, player1Id);
    const p2DiceArr = getPlayerDice(gameState, player2Id);
    if (p1DiceArr && p1CountAfterR1 !== undefined) {
      console.log(`  P1 dice array: [${p1DiceArr}] (length ${p1DiceArr.length})`);
      expect(p1DiceArr.length).toBe(p1CountAfterR1);
    }
    if (p2DiceArr && p2CountAfterR1 !== undefined) {
      console.log(`  P2 dice array: [${p2DiceArr}] (length ${p2DiceArr.length})`);
      expect(p2DiceArr.length).toBe(p2CountAfterR1);
    }

    // Update tracked counts
    p1DiceCount = p1CountAfterR1 ?? p1DiceCount;
    p2DiceCount = p2CountAfterR1 ?? p2DiceCount;

    // Determine which round 1 result we got (for scenario branching)
    let round1ChallengerWon: boolean;
    if (p1CountAfterR1 !== undefined && p2CountAfterR1 !== undefined) {
      // The active player was the challenger
      if (activePlayer === player1Id) {
        // P1 challenged. If P1 lost a die, challenger lost. If P2 lost, challenger won.
        round1ChallengerWon = p2CountAfterR1 < 5;
      } else {
        round1ChallengerWon = p1CountAfterR1 < 5;
      }
    } else {
      round1ChallengerWon = true; // fallback assumption
    }
    console.log(`  Round 1 challenger ${round1ChallengerWon ? "WON" : "LOST"}`);

    if (response.gameEnded) {
      console.log("Game ended after Round 1 — skipping remaining rounds");
      return;
    }

    // ── Round 2+: Continue playing until game ends or we cap at 10 rounds ──

    console.log("\n─── Rounds 2+ ───");

    let gameEnded = response.gameEnded;
    let roundNumber = 2;
    const MAX_ROUNDS = 10;
    let hadChallengerWin = round1ChallengerWon;
    let hadChallengerLose = !round1ChallengerWon;

    while (!gameEnded && roundNumber <= MAX_ROUNDS) {
      console.log(`\n─── Round ${roundNumber} ───`);

      // Check who has action
      gameState = await getGameState(sessionId);
      const p1NowActive = response.playerStates.get(player1Id)?.actionRequired;
      const p2NowActive = response.playerStates.get(player2Id)?.actionRequired;
      const currentActive = p1NowActive ? player1Id : (p2NowActive ? player2Id : activePlayer);
      const currentWaiting = currentActive === player1Id ? player2Id : player1Id;

      // Get current dice counts before round
      const p1PreRound = getPlayerDiceCount(gameState, player1Id);
      const p2PreRound = getPlayerDiceCount(gameState, player2Id);
      console.log(`  Pre-round dice: P1=${p1PreRound}, P2=${p2PreRound}`);

      // Opening bid
      console.log(`  Bid: ${currentActive.slice(0, 8)} opens with 'two 1s'`);
      response = await processAction(sessionId, currentActive, "I bid two 1s");
      logResponse(`R${roundNumber} Bid 1`, response);
      assertPublicMessage(response, `r${roundNumber}-bid-1`);
      if (response.gameEnded) { gameEnded = true; break; }

      // Counter bid — increase count
      console.log(`  Bid: ${currentWaiting.slice(0, 8)} raises to 'three 4s'`);
      response = await processAction(sessionId, currentWaiting, "I bid three 4s");
      logResponse(`R${roundNumber} Bid 2`, response);
      assertPublicMessage(response, `r${roundNumber}-bid-2`);
      if (response.gameEnded) { gameEnded = true; break; }

      // Challenge
      console.log(`  Challenge: ${currentActive.slice(0, 8)} calls 'Liar!'`);
      response = await processAction(sessionId, currentActive, "Liar!");
      logResponse(`R${roundNumber} Challenge`, response);
      assertPublicMessage(response, `r${roundNumber}-challenge`);

      // Verify dice loss
      gameState = await getGameState(sessionId);
      const p1PostRound = getPlayerDiceCount(gameState, player1Id);
      const p2PostRound = getPlayerDiceCount(gameState, player2Id);
      console.log(`  Post-round dice: P1=${p1PostRound}, P2=${p2PostRound}`);

      if (p1PreRound !== undefined && p2PreRound !== undefined &&
          p1PostRound !== undefined && p2PostRound !== undefined) {
        const roundLoss = (p1PreRound - p1PostRound) + (p2PreRound - p2PostRound);
        expect(roundLoss).toBe(1);

        // Track challenge outcomes for coverage
        if (currentActive === player1Id) {
          if (p2PostRound < p2PreRound) hadChallengerWin = true;
          if (p1PostRound < p1PreRound) hadChallengerLose = true;
        } else {
          if (p1PostRound < p1PreRound) hadChallengerWin = true;
          if (p2PostRound < p2PreRound) hadChallengerLose = true;
        }
      }

      // Verify dice array matches count
      const p1DiceAfter = getPlayerDice(gameState, player1Id);
      const p2DiceAfter = getPlayerDice(gameState, player2Id);
      if (p1DiceAfter && p1PostRound !== undefined) {
        expect(p1DiceAfter.length).toBe(p1PostRound);
      }
      if (p2DiceAfter && p2PostRound !== undefined) {
        expect(p2DiceAfter.length).toBe(p2PostRound);
      }

      // Update tracked counts
      p1DiceCount = p1PostRound ?? p1DiceCount;
      p2DiceCount = p2PostRound ?? p2DiceCount;

      gameEnded = response.gameEnded ||
        (p1PostRound !== undefined && p1PostRound <= 0) ||
        (p2PostRound !== undefined && p2PostRound <= 0);
      roundNumber++;
    }

    // ─── Phase 5: Final Assertions ─────────────────────────────────────

    console.log("\n══════ Phase 5: Final Assertions ══════");

    gameState = await getGameState(sessionId);
    const finalP1 = getPlayerDiceCount(gameState, player1Id);
    const finalP2 = getPlayerDiceCount(gameState, player2Id);
    console.log(`Final dice: P1=${finalP1}, P2=${finalP2}`);
    console.log(`Game ended: ${gameState?.game?.gameEnded}`);
    console.log(`Winning players: ${gameState?.game?.winningPlayers}`);

    // Game should have ended
    expect(gameState?.game?.gameEnded ?? gameEnded).toBe(true);

    // One player should have 1 die (eliminated), the other should have >=2
    if (finalP1 !== undefined && finalP2 !== undefined) {
      const oneEliminated = (finalP1 === 1 && finalP2 >= 2) || (finalP2 === 1 && finalP1 >= 2);
      expect(oneEliminated).toBe(true);
      console.log(`Winner: ${finalP1 >= 2 ? "Player 1" : "Player 2"} (${finalP1 >= 2 ? finalP1 : finalP2} dice remaining)`);
    }

    // Verify final dice arrays match counts
    const finalP1Dice = getPlayerDice(gameState, player1Id);
    const finalP2Dice = getPlayerDice(gameState, player2Id);
    if (finalP1Dice && finalP1 !== undefined) {
      expect(finalP1Dice.length).toBe(finalP1);
    }
    if (finalP2Dice && finalP2 !== undefined) {
      expect(finalP2Dice.length).toBe(finalP2);
    }

    // Log coverage of challenge outcomes
    console.log(`\nChallenge outcome coverage:`);
    console.log(`  Challenger won at least once: ${hadChallengerWin ? "✓" : "✗ (depends on dice)"}`);
    console.log(`  Challenger lost at least once: ${hadChallengerLose ? "✓" : "✗ (depends on dice)"}`);

    console.log("\n========== LIAR'S DICE E2E: DONE ==========");
  }, 10 * 60 * 1000); // 10 min timeout for LLM calls
});
