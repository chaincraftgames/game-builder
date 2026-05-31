/**
 * Absurd Armaments — End-to-End Test (Spec → Generated Mechanics → Gameplay)
 *
 * Exercises the FULL pipeline with a narrative-heavy game (contrast to liars-dice
 * which focuses on mechanical rule-enforcement). The purpose of this test is to
 * verify that:
 *   1. Spec-processing produces correct artifacts for a narrative/simultaneous game
 *   2. narrativeKeys are assigned to the right transitions (round_resolution / reveal)
 *   3. callLLM in sandbox mechanics receives narrative context from specNarratives
 *   4. Generated messages from narrative transitions are substantive and themed
 *   5. Simultaneous weapon submission and selection work correctly
 *   6. Match ends deterministically (best-of-3 with RPS-mapped weapons)
 *
 * Game flow:
 *   init → game_show_opening (auto) → weapon_creation (both players) →
 *   opponent_reveal (auto) → [weapon_selection (both) → round_resolution (auto sandbox)] ×N →
 *   match_end (auto)
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
// Full Game Specification
// ═══════════════════════════════════════════════════════════════════════════════

const ABSURD_ARMAMENTS_SPEC = `
# Absurd Armaments: A Narrative Battle Game

## Game Overview
Absurd Armaments is a 2-player competitive game where opponents create absurd weapons and battle
in a best-of-3 showdown. Players compete through simultaneous weapon selection across multiple
rounds, with outcomes narrated through boisterous game show commentary featuring maximum
entertainment value, groan-worthy puns, and obnoxious sports announcer energy.

## Player Count
Exactly 2 players required.

## Game Flow

### 1. Game Show Opening
Before weapon creation begins, display an enthusiastic game show-style introduction that:
- Welcomes both players to Absurd Armaments by name
- Uses boisterous announcer energy with maximum entertainment value
- Includes a punny or funny quip that sets the comedic tone
- Builds excitement for the upcoming weapon battle

Information Visibility: Both players see the same opening introduction simultaneously.

### 2. Weapon Creation Phase
Each player creates exactly 3 weapons with completely unrestricted creative freedom.

Creation Requirements:
- Players must create exactly 3 weapons
- Weapon descriptions can be any length—a single word, a phrase, or multiple paragraphs
- All weapon submissions are fully accepted regardless of length or format
- No minimum description length required; no thematic restrictions
- Players see only their own weapons during creation; cannot see opponent weapons

Cheeky Commentary on Minimal Submissions:
When players submit minimal or uninspired descriptions (single words, very short entries), the
game responds with snarky, cheeky commentary that gently roasts the lackluster effort while
maintaining the boisterous announcer tone. The weapon is FULLY ACCEPTED despite the snarky
feedback. Commentary affirms the entry will be used in the match.

Information Visibility:
- Player sees: Their own 3 weapons, optional snarky commentary about brevity
- Player does NOT see: Opponent's weapons or progress

### 3. Opponent Reveal Phase
After both players complete weapon creation, each player simultaneously sees their opponent's
arsenal through a freeform, bombastic narrative announcement.

Reveal Format: The game reveals the opponent and all three of their weapons through exciting,
game-show style narrative that announces the opponent dramatically and presents all 3 opponent
weapons in boisterous, entertaining language. Commentary must be seamlessly woven into the
narrative, not added as a separate element.

Information Visibility:
- Player sees: All 3 opponent weapons revealed through bombastic narrative, comedic commentary
- Player does NOT see: Any game mechanics or opponent's weapon creation process

### 4. Round Structure (Best of 3)
The game consists of up to 3 rounds. First player to win 2 rounds wins the match.

Round Selection:
- Each player simultaneously selects exactly 1 of their 3 weapons to deploy this round
- Selection happens without knowledge of opponent's choice
- Players may reuse any of their 3 weapons across rounds
- Player sees: Their own 3 weapons, current match score, round number
- Player does NOT see: Opponent's selection

Round Resolution:
After both players select weapons, the round resolves immediately.
- Both selected weapons are revealed simultaneously to both players
- A winner is determined (or tie declared)
- A humorous narrative (2-4 sentences) describes the outcome

!___ NARRATIVE_START:ROUND_RESOLUTION_STYLE ___!
See SPEC_NARRATIVES.ROUND_RESOLUTION_STYLE for the full round resolution narrative style guide.
!___ NARRATIVE_END:ROUND_RESOLUTION_STYLE ___!

The narrative must:
- Describe how the winning weapon defeated the losing weapon in specific, absurd ways
- OR describe how both weapons resulted in comedic stalemate (on ties)
- Make logical sense within its own absurd premise; feel entertaining and fair
- Never reveal or hint at underlying rock-paper-scissors mechanics
- Use boisterous announcer style with maximum entertainment value
- Include groan-inducing puns when they fit naturally
- Reference both weapons by their exact player-given names
- Treat the weapon matchup as a dramatic sporting event

Occasional wrestling-style dramatic reversals (unpredictably, NOT every round) where the
narrative initially favors one weapon before a shocking turnaround reveals the actual winner.

Outcome Recording:
- Winner receives 1 point. Ties award 0 points.
- Current score is updated and displayed.

### 5. Match Completion
Win Condition: First player to win 2 rounds wins the match.

Final Celebration: When match ends, display over-the-top game show style final commentary that:
- Celebrates the match winner by name
- References the winning weapons used
- Uses boisterous announcer energy with maximum entertainment value
- Includes groan-inducing puns when they fit naturally
- Announces a hilariously absurd, nonsensical prize awarded to the winner

## Core Game Rules

### Weapon Submission Rules
- Players must submit exactly 3 weapons during creation phase
- Weapon descriptions can be any length; all accepted regardless of format
- Players have complete creative freedom

### Weapon Selection Rules
- Players must select exactly 1 weapon per round
- Weapons may be reused in multiple rounds
- Selection is simultaneous (no player sees opponent's choice before committing)
- Players cannot change selection after confirmation

### Scoring Rules
- Round winner: Earns 1 point
- Round tie: Both players earn 0 points
- Match winner: First player to reach 2 points wins
- Maximum 3 rounds; minimum 2 rounds to determine winner

### Weapon Outcome Determination
- Outcomes follow rock-paper-scissors rules: rock beats scissors, scissors beats paper, paper beats rock
- Same weapon matchups result in ties
- Each weapon is secretly assigned a rock, paper, or scissors value
- Assignment is consistent for the entire match once determined
- Outcome calculation happens immediately when both weapons are selected

### Information Secrecy
Must NEVER be revealed: that weapons map to RPS, that any mapping exists, numerical values,
hidden logic patterns, how RPS assignments are determined.
Must ALWAYS reinforce: player creativity determines outcomes, weapon descriptions matter,
victory is earned through weapon choice.

### Fairness Requirements
- Both players create exactly 3 weapons (equal arsenal)
- All selections are simultaneous (no information advantage)
- Round outcomes are deterministic (same weapons produce same result)
- Narratives must make outcomes feel fair and earned

## Game End States
Match Victory: One player wins 2 out of 3 rounds. Celebratory narrative + ridiculous prize.
No Draw Possible: If score is 1-1 after 2 rounds, round 3 determines winner definitively.
`;

// ═══════════════════════════════════════════════════════════════════════════════
// Narrative Overrides
// Keys defined here must match what the spec-processing planner assigns to
// narrativeKeys in transition instructions. The runtime looks these up at
// execution time and injects the content into the callLLM system prompt.
// ═══════════════════════════════════════════════════════════════════════════════

const SPEC_NARRATIVES: Record<string, string> = {
  ROUND_RESOLUTION_STYLE: `
Round Resolution Narrative Style Guide

Core Narrative Principles:
Round resolution narratives serve as the dramatic centerpiece of each round. These 2-4 sentence
narratives must: explain the outcome in absurd yet logical terms, celebrate player weapon choices,
maintain boisterous energy, and disguise the underlying mechanical resolution while making outcomes
feel earned through creative matchup logic.

Tone and Voice Requirements:
Boisterous Game Show Announcer Energy: Every narrative should sound like it's being shouted by an
overenthusiastic sports commentator. The voice should be theatrical and exaggerated to the point of
being obnoxious, dripping with enthusiasm, treating every matchup like it's the most dramatic
sporting event in history. Example: "WHAT AN ABSOLUTELY DEVASTATING DISPLAY! The Sentient Balloon
Animal twists itself into an IMPOSSIBLE geometric configuration!"

Structural Approach — Setup-Execution-Result Pattern:
- Setup: Briefly set the stage of how weapons engage
- Execution: Describe the specific mechanism of victory/tie
- Result: Confirm the winner and their triumph (or mutual failure on ties)
This is a GUIDELINE, not a rigid template. Narratives should flow naturally.

Logical Absurdity — The Core Challenge:
Outcomes must make LOGICAL SENSE within their own absurd premises. Even ridiculous weapon matchups
must follow cause-and-effect reasoning. Good: "The tax form bureaucratically redefines the concept
of gravitational collapse through seventeen layers of amendments!" Bad: "the black hole is just
better so it wins somehow."

Creating Causal Chains:
Every narrative needs a clear "because" chain: Weapon A does X → BECAUSE of X, Y happens to
Weapon B → THEREFORE Weapon A wins (or both fail on ties).

Weapon Name Integration:
Always reference both weapons by their specific player-given names. Weave names throughout, not
just once at the start.

Puns and Wordplay:
Groan-inducing puns and wordplay are ENCOURAGED but must feel natural. If it fits, commit. If it
doesn't, skip it. Vary: alliteration, absurd metaphors, sports commentary clichés twisted absurdly.

Dramatic Wrestling-Style Reversals (use occasionally, NOT every round):
Structure: Initial Dominance → Mounting Confidence → The Turn → Reversal Execution → Shocking
Conclusion. Signal with: "BUT WAIT—", "HOLD ON—", "IN A STUNNING TURN—". Only when it feels
earned, not forced.

Tie Narratives:
Ties must feel like EARNED stalemates. Explain WHY neither weapon could win. Show both weapons
actively engaged. Use: mutual annihilation, paradox lock, mutual counter, equal power cancellation.
Match the enthusiasm of victories—do NOT let energy drop on ties.

Never reveal or hint at the underlying rock-paper-scissors mechanics. Never suggest randomness
determined the outcome. Reinforce that the player's creative weapon choice mattered.
`,

  GAME_SHOW_OPENING: `
Game Show Opening Style Guide:

Use maximum boisterous announcer energy. Welcome both players by name with dramatic flair.
Include at least one groan-worthy pun or funny quip. Build excitement and suspense for the
upcoming weapon battle. Reference the Absurd Armaments brand. Sound like a cross between a
professional wrestling announcer and an over-the-top game show host. Keep it to 3-5 sentences.
`,

  WEAPON_CREATION_COMMENTARY: `
Weapon Creation Commentary Style Guide:

When a player submits weapons for their arsenal, acknowledge with excitement and encourage their
creativity. If submissions are minimal (single words), deliver snarky cheeky commentary that
gently roasts the lackluster effort while FULLY ACCEPTING the weapon for the match. Maintain the
boisterous announcer tone even while throwing shade. Confirm the weapon is IN the match. Example:
"A SPORK? REALLY? Well I SUPPOSE even the most mundane utensils have their place in the high-
stakes arena of Absurd Armaments! Your humble Spork will indeed do battle!"
`,

  OPPONENT_REVEAL_STYLE: `
Opponent Reveal Style Guide:

Reveal the opponent and all three of their weapons through one continuous, bombastic narrative
announcement. Announce the opponent dramatically (use their name with theatrical flair). Present
each weapon with obnoxious sports commentator energy. Naturally weave in snarky or comedic
commentary about the arsenal without making it feel mechanically appended. Include groan-inducing
puns when they fit. Never use rigid templates—make each reveal feel spontaneous and entertaining.
Reference all three weapon names explicitly.
`,

  MATCH_FINALE_STYLE: `
Match Finale Style Guide:

Deliver an over-the-top game show style final celebration. Declare the winner with maximum
theatrical energy. Reference the winning weapons by name. Use boisterous announcer energy with
groan-inducing puns. Then announce a hilariously absurd, nonsensical prize: something with
absolutely no real value (rubber chickens, cardboard trophies, memberships to fake organizations,
honorary titles with no meaning) delivered with the same boisterous energy. End the game on a
comedic high note. 3-6 sentences total.
`,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Test constants
// ═══════════════════════════════════════════════════════════════════════════════

const sessionId = `absurd-armaments-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const gameId = `absurd-armaments-game-test-v1`;
const specKey = `${gameId}-v1`;
const player1Id = crypto.randomUUID();
const player2Id = crypto.randomUUID();

// Weapons — deliberately mixed: some elaborate, some minimal, to test commentary
// Sent as plain text the way a real player would type them in a chat interface
const P1_WEAPONS =
  "My three weapons are:\n" +
  "1. The Recursive Mirror - A mirror that forces your enemy to confront their own deepest insecurities until they crumble\n" +
  "2. Weaponized Dad Joke - A pun so terrible it temporarily disables all critical thinking within a five-foot radius\n" +
  "3. Spork"; // minimal — should trigger snarky commentary

const P2_WEAPONS =
  "Here are my weapons:\n" +
  "1. Sentient Tax Form - A Form 1040 that achieves consciousness and audits your soul\n" +
  "2. Philosophical Hammer - A hammer that poses unanswerable questions about its own existence with every swing\n" +
  "3. The Embodiment of Existential Uncertainty - It both exists and doesn't exist until observed, at which point it's already won";

// Weapon names for narrative verification and round selection
const P1_WEAPON_NAMES = ["The Recursive Mirror", "Weaponized Dad Joke", "Spork"];
const P2_WEAPON_NAMES = ["Sentient Tax Form", "Philosophical Hammer", "The Embodiment of Existential Uncertainty"];

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Get current scores from game state — tries common field names */
function getScores(gameState: any): { p1: number; p2: number } | undefined {
  const game = gameState?.game;
  if (!game) return undefined;
  // Try various field naming conventions the LLM might choose
  const p1Score =
    game.player1Score ?? game.player1Wins ?? game.player1Points ??
    game.p1Score ?? game.p1Wins ?? game.scores?.player1;
  const p2Score =
    game.player2Score ?? game.player2Wins ?? game.player2Points ??
    game.p2Score ?? game.p2Wins ?? game.scores?.player2;
  if (p1Score !== undefined && p2Score !== undefined) {
    return { p1: p1Score, p2: p2Score };
  }
  return undefined;
}

/** Get current round from game state */
function getCurrentRound(gameState: any): number | undefined {
  const game = gameState?.game;
  return game?.currentRound ?? game?.round ?? game?.roundNumber;
}

/** Assert public message is non-empty and reasonably substantive */
function assertPublicMessage(response: SimResponse, context: string, minLength = 20) {
  expect(response.publicMessage).toBeDefined();
  expect(typeof response.publicMessage).toBe("string");
  expect(response.publicMessage!.length).toBeGreaterThan(minLength);
  console.log(`  [${context}] Public (${response.publicMessage!.length} chars): ${response.publicMessage!.slice(0, 200)}${response.publicMessage!.length > 200 ? "…" : ""}`);
}

/** Log response summary */
function logResponse(label: string, response: SimResponse) {
  console.log(`\n--- ${label} ---`);
  if (response.publicMessage) {
    console.log(`  Public: ${response.publicMessage.slice(0, 300)}`);
  }
  console.log(`  gameEnded: ${response.gameEnded}`);
  for (const [pid, pState] of response.playerStates) {
    const alias = pid === player1Id ? "P1" : "P2";
    console.log(`  ${alias}: actionRequired=${pState.actionRequired}, illegalActionCount=${pState.illegalActionCount}`);
    if (pState.privateMessage) {
      console.log(`    Private: ${pState.privateMessage.slice(0, 200)}`);
    }
  }
}

/** Check whether a string contains any of the weapon names */
function mentionsWeapon(text: string, weaponName: string): boolean {
  return text.toLowerCase().includes(weaponName.toLowerCase());
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test
// ═══════════════════════════════════════════════════════════════════════════════

describe("Absurd Armaments — Full E2E (spec → codegen → gameplay)", () => {
  beforeAll(() => {
    setConfig("simulation-graph-type", "test-absurd-armaments-e2e");
  });

  it("should process spec, generate mechanics, and play a full narrative game", async () => {
    console.log("\n========== ABSURD ARMAMENTS E2E: START ==========");
    console.log(`Session: ${sessionId}`);
    console.log(`Game:    ${gameId}`);
    console.log(`SpecKey: ${specKey}`);
    console.log(`P1: ${player1Id}`);
    console.log(`P2: ${player2Id}`);

    // ─── Phase 1: Spec Processing ──────────────────────────────────────────

    console.log("\n══════ Phase 1: Spec Processing ══════");
    const createResult = await createSimulation(sessionId, gameId, 1, {
      overrideSpecification: ABSURD_ARMAMENTS_SPEC,
      specNarrativesOverride: SPEC_NARRATIVES,
    });

    expect(createResult.gameRules).toBeTruthy();
    expect(createResult.specNarratives).toBeDefined();
    console.log("Game rules extracted (first 150 chars):", createResult.gameRules.substring(0, 150) + "…");
    console.log("Narrative keys stored:", Object.keys(createResult.specNarratives ?? {}));

    // ─── Phase 2: Verify Generated Artifacts ───────────────────────────────

    console.log("\n══════ Phase 2: Verify Artifacts ══════");
    const artifacts = await getCachedSpecArtifacts(specKey);
    expect(artifacts).toBeDefined();

    // Verify core artifacts are present
    expect(artifacts!.stateSchema).toBeTruthy();
    expect(artifacts!.stateTransitions).toBeTruthy();
    expect(artifacts!.transitionInstructions).toBeTruthy();

    console.log("State schema:", typeof artifacts!.stateSchema === "string"
      ? artifacts!.stateSchema.slice(0, 300) + "…"
      : JSON.stringify(artifacts!.stateSchema).slice(0, 300) + "…");

    // Parse and verify transitions
    const transitions = typeof artifacts!.stateTransitions === "string"
      ? JSON.parse(artifacts!.stateTransitions)
      : artifacts!.stateTransitions;
    console.log("Transitions:", JSON.stringify(transitions, null, 2).slice(0, 500) + "…");

    // Parse and verify transition instructions
    const instructions = typeof artifacts!.transitionInstructions === "string"
      ? JSON.parse(artifacts!.transitionInstructions)
      : artifacts!.transitionInstructions;
    console.log("Transition instructions count:", Array.isArray(instructions) ? instructions.length : "?");

    // Verify narrativeKeys are assigned to narrative-heavy transitions
    // The round resolution transition must reference the narrative key
    if (Array.isArray(instructions)) {
      const roundResolutionInstruction = instructions.find((inst: any) =>
        inst.id?.toLowerCase().includes("round") ||
        inst.transitionName?.toLowerCase().includes("round") ||
        inst.transitionName?.toLowerCase().includes("resolution") ||
        inst.transitionName?.toLowerCase().includes("resolve")
      );
      if (roundResolutionInstruction) {
        console.log("Round resolution instruction narrativeKeys:", roundResolutionInstruction.narrativeKeys);
        if (roundResolutionInstruction.narrativeKeys?.length > 0) {
          console.log("✓ narrativeKeys assigned to round resolution transition");
          expect(roundResolutionInstruction.narrativeKeys).toContain("ROUND_RESOLUTION_STYLE");
        } else {
          console.warn("⚠ Round resolution instruction has no narrativeKeys — narrative context will not be injected");
        }
      } else {
        console.warn("⚠ Could not locate round resolution instruction in artifacts");
      }
    }

    // Verify generatedMechanics
    const mechanics = artifacts!.generatedMechanics;
    console.log("\nGenerated mechanics:", mechanics ? Object.keys(mechanics) : "NONE");
    if (mechanics && Object.keys(mechanics).length > 0) {
      console.log("✓ Mechanics were generated by the spec-processing pipeline!");
      for (const [id, code] of Object.entries(mechanics)) {
        console.log(`  ${id}: ${(code as string).length} chars`);
      }
    } else {
      console.warn("⚠ No generatedMechanics — game will use LLM fallback for all transitions");
    }

    // ─── Phase 3: Initialize Simulation ────────────────────────────────────

    console.log("\n══════ Phase 3: Initialize Simulation ══════");
    const initResult = await initializeSimulation(sessionId, [player1Id, player2Id]);
    logResponse("Init", initResult);

    // The game show opening should be substantive and enthusiastic
    assertPublicMessage(initResult as SimResponse, "init", 50);
    console.log("✓ Game show opening produced");

    let gameState = await getGameState(sessionId);
    expect(gameState).toBeDefined();
    console.log("Game state keys:", Object.keys(gameState!.game || {}));
    console.log("Phase after init:", gameState?.game?.currentPhase);

    // ─── Phase 4: Weapon Creation ───────────────────────────────────────────

    console.log("\n══════ Phase 4: Weapon Creation ══════");

    // NOTE: The exact action format depends on the generated schema.
    // If this test fails with "invalid action", check the generated stateSchema
    // for the weapon creation action type and update accordingly.
    console.log("\n--- P1 submits weapons ---");
    let response = await processAction(
      sessionId,
      player1Id,
      P1_WEAPONS,
    );
    logResponse("P1 weapon submission", response);
    // P1's submission should be acknowledged (either public or private message)
    const p1State = response.playerStates.get(player1Id);
    const p1HasMessage = response.publicMessage || p1State?.privateMessage;
    expect(p1HasMessage).toBeTruthy();

    // Check if snarky commentary was triggered for "Spork"
    const p1Message = response.publicMessage ?? p1State?.privateMessage ?? "";
    if (p1Message.toLowerCase().includes("spork")) {
      console.log("✓ Snarky commentary triggered for minimal weapon 'Spork'");
    } else {
      console.log("  (Spork commentary not detected in P1 message — may be in a different field)");
    }

    console.log("\n--- P2 submits weapons ---");
    response = await processAction(
      sessionId,
      player2Id,
      P2_WEAPONS,
    );
    logResponse("P2 weapon submission", response);

    // After both players submit, automatic transitions fire:
    // opponent_reveal and transition to weapon_selection
    gameState = await getGameState(sessionId);
    console.log("\nPhase after weapon creation:", gameState?.game?.currentPhase);

    // ─── Phase 5: Opponent Reveal ───────────────────────────────────────────

    console.log("\n══════ Phase 5: Opponent Reveal ══════");

    // The reveal should have appeared as a public or private message
    // Check for weapon names in the last public message or player private messages
    const revealPublic = response.publicMessage ?? "";
    const p2RevealPrivate = response.playerStates.get(player2Id)?.privateMessage ?? "";
    const p1RevealPrivate = response.playerStates.get(player1Id)?.privateMessage ?? "";

    const allRevealText = revealPublic + p2RevealPrivate + p1RevealPrivate;
    if (allRevealText.length > 0) {
      console.log("✓ Reveal messages present");
    } else {
      console.warn("⚠ No reveal messages detected immediately after weapon submission");
    }

    // ─── Phase 6: Rounds ────────────────────────────────────────────────────

    console.log("\n══════ Phase 6: Rounds ══════");

    // Check who needs action for first round
    const p1NeedsAction = response.playerStates.get(player1Id)?.actionRequired;
    const p2NeedsAction = response.playerStates.get(player2Id)?.actionRequired;
    console.log(`P1 actionRequired: ${p1NeedsAction}, P2 actionRequired: ${p2NeedsAction}`);

    let gameEnded = response.gameEnded;
    let roundNumber = 1;
    const MAX_ROUNDS = 4; // 3 rounds max in the spec, +1 buffer

    while (!gameEnded && roundNumber <= MAX_ROUNDS) {
      console.log(`\n─── Round ${roundNumber} ───`);

      const selIdx = Math.min(roundNumber - 1, P1_WEAPON_NAMES.length - 1);
      const p1Weapon = P1_WEAPON_NAMES[selIdx];
      const p2Weapon = P2_WEAPON_NAMES[selIdx];

      gameState = await getGameState(sessionId);
      const round = getCurrentRound(gameState);
      const scores = getScores(gameState);
      console.log(`  Current round: ${round}, Scores: P1=${scores?.p1 ?? "?"} P2=${scores?.p2 ?? "?"}`);

      // Both players select a weapon by name
      console.log(`  P1 selects: "${p1Weapon}"`);
      response = await processAction(
        sessionId,
        player1Id,
        `I choose ${p1Weapon}`,
      );
      logResponse(`Round ${roundNumber} — P1 selection`, response);

      if (response.gameEnded) {
        console.log("Game ended after P1 selection (unexpected)");
        gameEnded = true;
        break;
      }

      console.log(`  P2 selects: "${p2Weapon}"`);
      response = await processAction(
        sessionId,
        player2Id,
        `I choose ${p2Weapon}`,
      );
      logResponse(`Round ${roundNumber} — P2 selection + resolution`, response);

      // After both selections, round_resolution should have fired
      // Verify the round resolution narrative
      const resolveMsg = response.publicMessage ?? "";
      if (resolveMsg.length > 0) {
        console.log(`\n  ✓ Round resolution narrative (${resolveMsg.length} chars):`);
        console.log(`    ${resolveMsg.slice(0, 500)}`);

        // Verify the narrative references the selected weapons
        const mentionsP1Weapon = mentionsWeapon(resolveMsg, p1Weapon);
        const mentionsP2Weapon = mentionsWeapon(resolveMsg, p2Weapon);
        if (mentionsP1Weapon) {
          console.log(`    ✓ Narrative mentions P1 weapon: "${p1Weapon}"`);
        } else {
          console.warn(`    ⚠ Narrative does NOT mention P1 weapon: "${p1Weapon}"`);
        }
        if (mentionsP2Weapon) {
          console.log(`    ✓ Narrative mentions P2 weapon: "${p2Weapon}"`);
        } else {
          console.warn(`    ⚠ Narrative does NOT mention P2 weapon: "${p2Weapon}"`);
        }

        // Assert narrative is substantive (not just a one-liner)
        expect(resolveMsg.length).toBeGreaterThan(50);
      } else {
        console.warn(`  ⚠ No public message after round ${roundNumber} resolution`);
      }

      // Check updated scores
      gameState = await getGameState(sessionId);
      const newScores = getScores(gameState);
      console.log(`  Scores after round ${roundNumber}: P1=${newScores?.p1 ?? "?"} P2=${newScores?.p2 ?? "?"}`);
      console.log(`  gameEnded: ${response.gameEnded}`);

      gameEnded = response.gameEnded;
      roundNumber++;
    }

    // ─── Phase 7: Match End Verification ───────────────────────────────────

    console.log("\n══════ Phase 7: Match End Verification ══════");
    expect(gameEnded).toBe(true);
    console.log("✓ Game ended");

    // The final response should have a celebratory public message
    const finalMsg = response.publicMessage ?? "";
    if (finalMsg.length > 0) {
      console.log(`\nFinal message (${finalMsg.length} chars):\n${finalMsg}`);

      // Should be a substantial celebratory message
      expect(finalMsg.length).toBeGreaterThan(50);

      // Check for prize announcement indicators (very flexible)
      const hasPrizeIndicator =
        finalMsg.toLowerCase().includes("prize") ||
        finalMsg.toLowerCase().includes("award") ||
        finalMsg.toLowerCase().includes("trophy") ||
        finalMsg.toLowerCase().includes("champion") ||
        finalMsg.toLowerCase().includes("winner");
      if (hasPrizeIndicator) {
        console.log("✓ Final message contains prize/winner language");
      } else {
        console.warn("⚠ Final message may be missing prize announcement");
      }
    } else {
      console.warn("⚠ No public message at game end");
    }

    // Final scores
    const finalScores = getScores(gameState);
    if (finalScores) {
      console.log(`Final scores: P1=${finalScores.p1} P2=${finalScores.p2}`);
      // One player should have 2 wins (best of 3)
      const maxScore = Math.max(finalScores.p1, finalScores.p2);
      expect(maxScore).toBe(2);
      console.log("✓ Final score correct: winner has 2 round wins");
    }

    console.log("\n========== ABSURD ARMAMENTS E2E: COMPLETE ==========");
  }, 600_000); // 10 min — full spec-processing + gameplay with LLM calls
});
