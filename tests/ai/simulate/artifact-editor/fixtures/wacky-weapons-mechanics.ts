/**
 * Wacky Weapons — Mechanics Coordinator Test Fixtures
 *
 * Two scenarios testing the coordinator's ability to differentiate between:
 *
 * 1. CODE BUG (Pattern 11/12): The instructions are correct but the generated
 *    code has a type error — a field name typo. The coordinator should target
 *    mechanics only (patch the code).
 *
 * 2. INSTRUCTIONS GAP (Pattern 13): The mechanicsGuidance computation field
 *    is incomplete — it says "determine winner, increment winner's roundsWon"
 *    but never mentions tie handling. The generated code faithfully implements
 *    the computation (no tie path) and the error is a semantic failure at
 *    runtime. The coordinator should target instructions (fix the plan) and
 *    then mechanics (regenerate from corrected plan).
 */

import type { CoordinatorInput } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/types.js';

// ─── Shared Game Spec (Wacky Weapons — abbreviated) ───

const WACKY_WEAPONS_SPEC = `# Weapon Inventor Game Rules

## Overview
A creative twist on rock-paper-scissors where players invent their own weapons and compete in a best-of-3 match.

## Setup Phase
1. Each player must invent exactly 3 unique weapons with creative names
2. The system secretly assigns each weapon to one of the classic RPS types (rock, paper, or scissors)
3. Players cannot see which RPS type their weapons (or opponents' weapons) map to

## Match Phase
1. The match consists of up to 3 rounds (best-of-3 format)
2. Each round, both players simultaneously select one of their 3 invented weapons
3. The system resolves the round using standard rock-paper-scissors mechanics:
   - Rock beats Scissors
   - Scissors beats Paper
   - Paper beats Rock
   - Same type results in a tie (no points awarded)
4. After each round, the system generates a humorous narrative describing how the weapons clashed
5. The winner of each round earns 1 point (rounds won)

## Victory Conditions
- First player to win 2 rounds wins the match
- The game ends immediately when a player reaches 2 rounds won
- Maximum of 3 rounds can be played`;

// ─── Shared Schema Fields ───

const SCHEMA_FIELDS = `game.currentPhase: string (Current phase of the game)
game.gameEnded: boolean (Whether the game has ended)
game.publicMessage: string (Message visible to all players)
game.currentRound: number (Track which round 1-3 is currently being played)
game.roundOutcome: string (Narrative and outcome of completed round)
game.weaponMappings: record (Secret RPS mappings for all 6 weapons - weapon name to RPS type)
game.winningPlayers: array (Player IDs who have won the game)
players.*.roundsWon: number (Track rounds won by each player)
players.*.selectedWeapon: string (Player's weapon choice for current round)
players.*.weapons: record (Player's 3 invented weapons)
players.*.ready: boolean (Whether player is ready)
players.*.actionRequired: boolean (If true, game cannot proceed until player acts)
players.*.isGameWinner: boolean (Whether this player has won the game)`;

// ─── Shared Transitions ───

const TRANSITIONS = JSON.stringify({
  phases: ['init', 'weapon_setup', 'round_start', 'weapon_selection', 'round_resolution', 'match_check', 'finished'],
  transitions: [
    { id: 'initialize_game', fromPhase: 'init', toPhase: 'weapon_setup' },
    { id: 'both_weapons_ready', fromPhase: 'weapon_setup', toPhase: 'round_start' },
    { id: 'begin_round', fromPhase: 'round_start', toPhase: 'weapon_selection' },
    { id: 'both_weapons_submitted', fromPhase: 'weapon_selection', toPhase: 'round_resolution' },
    { id: 'resolve_round_outcome', fromPhase: 'round_resolution', toPhase: 'match_check' },
    { id: 'player_wins_match', fromPhase: 'match_check', toPhase: 'finished' },
    { id: 'continue_to_next_round', fromPhase: 'match_check', toPhase: 'round_start' },
  ],
});

// ─── Shared Transition Instructions ───

const TRANSITION_INSTRUCTIONS = {
  resolve_round_outcome: {
    id: 'resolve_round_outcome',
    transitionName: 'Resolve Round Outcome',
    description: 'Apply RPS mechanics to determine round winner, award points, generate humorous narrative.',
    mechanicsGuidance: {
      rules: [
        'Rock beats Scissors',
        'Scissors beats Paper',
        'Paper beats Rock',
        'If both weapons map to the same RPS option, result is a tie (no points awarded)',
        'Winning player receives 1 round point',
        'Generate narrative that mentions both weapon names, indicates winner or tie, humorously explains outcome, 1-2 sentences max',
      ],
      computation: 'Look up secret RPS mapping for each player\'s weapon from game.weaponMappings, apply RPS rules to determine winner or tie, generate humorous 1-2 sentence narrative, increment winner\'s roundsWon (if not tie)',
    },
  },
  both_weapons_ready: {
    id: 'both_weapons_ready',
    transitionName: 'Both Weapons Ready',
    description: 'Generate secret RPS mappings for all 6 weapons and advance to round 1.',
    mechanicsGuidance: {
      rules: [
        'Each weapon must map to exactly one of: rock, paper, or scissors',
        'Mappings are secret and never revealed to players',
        'Use a deterministic but non-obvious algorithm based on weapon name characteristics',
      ],
      computation: 'Map each of the 6 weapon names to rock, paper, or scissors using deterministic logic. Store mappings in game.weaponMappings.',
    },
  },
};

const PLAYER_PHASE_INSTRUCTIONS = {
  weapon_setup: {
    phase: 'weapon_setup',
    playerActions: [{
      id: 'finalize_weapons',
      actionName: 'Finalize Weapons',
      mechanicsGuidance: null,
    }],
  },
  weapon_selection: {
    phase: 'weapon_selection',
    playerActions: [{
      id: 'select_weapon',
      actionName: 'Select Weapon',
      mechanicsGuidance: null,
    }],
  },
};

// ─── State Interfaces (generated from schema) ───

const STATE_INTERFACES = `// Auto-generated from stateSchema — DO NOT EDIT
export interface GameState {
  currentPhase: string;
  gameEnded: boolean;
  publicMessage: string;
  currentRound: number;
  roundOutcome: string;
  weaponMappings: Record<string, "rock" | "paper" | "scissors">;
  winningPlayers: string[];
}

export interface PlayerState {
  roundsWon: number;
  selectedWeapon: string;
  weapons: Record<string, string>;
  ready: boolean;
  actionRequired: boolean;
  isGameWinner: boolean;
}

export interface MechanicState {
  game: GameState;
  [playerAlias: \`player\${number}\`]: PlayerState;
}

export type CallLLM = (prompt: string) => Promise<string>;

export interface MechanicResult {
  game?: Partial<GameState>;
  [playerAlias: \`player\${number}\`]: Partial<PlayerState>;
  publicMessage?: string;
  privateMessages?: Record<string, string>;
}`;


// ════════════════════════════════════════════════════════════════════════
// SCENARIO A: Code Bug — field name typo (TS2551)
//
// The instructions correctly say "increment winner's roundsWon".
// The generated code references `state.player1.roundWon` (missing 's').
// tsc catches this: TS2551 "Property 'roundWon' does not exist on type
// 'PlayerState'. Did you mean 'roundsWon'?"
//
// Expected: coordinator targets mechanics only, patch operation.
// ════════════════════════════════════════════════════════════════════════

export const CODE_BUG_MECHANIC_CODE: Record<string, string> = {
  resolve_round_outcome: `export async function resolve_round_outcome(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  const p1Weapon = state.player1.selectedWeapon;
  const p2Weapon = state.player2.selectedWeapon;
  const p1Type = state.game.weaponMappings[p1Weapon];
  const p2Type = state.game.weaponMappings[p2Weapon];

  let winner: string | null = null;
  if (p1Type === p2Type) {
    winner = null; // tie
  } else if (
    (p1Type === "rock" && p2Type === "scissors") ||
    (p1Type === "scissors" && p2Type === "paper") ||
    (p1Type === "paper" && p2Type === "rock")
  ) {
    winner = "player1";
  } else {
    winner = "player2";
  }

  const result: MechanicResult = { game: {} };

  if (winner === "player1") {
    result.player1 = { roundWon: state.player1.roundWon + 1 };
    result.player2 = { roundsWon: state.player2.roundsWon };
  } else if (winner === "player2") {
    result.player2 = { roundWon: state.player2.roundWon + 1 };
    result.player1 = { roundsWon: state.player1.roundsWon };
  }

  const narrative = await callLLM(
    "Generate a humorous 1-2 sentence narrative describing the clash between " +
    p1Weapon + " and " + p2Weapon + ". Winner: " + (winner ?? "tie") + "."
  );

  result.game = { roundOutcome: narrative };
  return result;
}`,
  both_weapons_ready: `export async function both_weapons_ready(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  const rpsTypes: Array<"rock" | "paper" | "scissors"> = ["rock", "paper", "scissors"];
  const weaponMappings: Record<string, "rock" | "paper" | "scissors"> = {};

  for (const name of Object.keys(state.player1.weapons)) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
    }
    weaponMappings[name] = rpsTypes[Math.abs(hash) % 3];
  }
  for (const name of Object.keys(state.player2.weapons)) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
    }
    weaponMappings[name] = rpsTypes[Math.abs(hash) % 3];
  }

  return {
    game: { weaponMappings, currentRound: 1 },
    player1: { actionRequired: true },
    player2: { actionRequired: true },
  };
}`,
};

export const CODE_BUG_ERRORS = [
  'TS2551 in resolve_round_outcome (line 25, col 27): Property \'roundWon\' does not exist on type \'PlayerState\'. Did you mean \'roundsWon\'?',
  'TS2551 in resolve_round_outcome (line 25, col 55): Property \'roundWon\' does not exist on type \'PlayerState\'. Did you mean \'roundsWon\'?',
  'TS2551 in resolve_round_outcome (line 28, col 27): Property \'roundWon\' does not exist on type \'PlayerState\'. Did you mean \'roundsWon\'?',
  'TS2551 in resolve_round_outcome (line 28, col 55): Property \'roundWon\' does not exist on type \'PlayerState\'. Did you mean \'roundsWon\'?',
];

export const CODE_BUG_INPUT: CoordinatorInput = {
  gameSpecification: WACKY_WEAPONS_SPEC,
  validationErrors: CODE_BUG_ERRORS,
  schemaFields: SCHEMA_FIELDS,
  stateTransitions: TRANSITIONS,
  playerPhaseInstructions: JSON.stringify(PLAYER_PHASE_INSTRUCTIONS),
  transitionInstructions: JSON.stringify(TRANSITION_INSTRUCTIONS),
  generatedMechanics: CODE_BUG_MECHANIC_CODE,
  stateInterfaces: STATE_INTERFACES,
};


// ════════════════════════════════════════════════════════════════════════
// SCENARIO B: Instructions Gap — incomplete plan (Pattern 13)
//
// The mechanicsGuidance `rules` array mentions ties ("same type results
// in a tie, no points awarded"), but the `computation` field says:
//   "determine winner, increment winner's roundsWon"
// without mentioning tie handling at all.
//
// The generated code faithfully follows the computation — it determines
// a winner and increments, but when both weapons are the same type it
// falls through to the else branch and incorrectly awards player2 the
// win (since "not player1 wins" → player2 wins by default).
//
// The error is a semantic/behavioral failure caught by simulation:
// the mechanic awards a point on ties instead of skipping.
//
// Expected: coordinator targets instructions FIRST (fix the computation
// to mention tie handling), then mechanics (regenerate from fixed plan).
// ════════════════════════════════════════════════════════════════════════

/** Modified instructions where computation omits tie handling */
const INCOMPLETE_TRANSITION_INSTRUCTIONS = {
  ...TRANSITION_INSTRUCTIONS,
  resolve_round_outcome: {
    ...TRANSITION_INSTRUCTIONS.resolve_round_outcome,
    mechanicsGuidance: {
      rules: [
        'Rock beats Scissors',
        'Scissors beats Paper',
        'Paper beats Rock',
        'If both weapons map to the same RPS option, result is a tie (no points awarded)',
        'Winning player receives 1 round point',
        'Generate narrative that mentions both weapon names, indicates winner or tie, humorously explains outcome, 1-2 sentences max',
      ],
      // NOTE: computation OMITS tie handling — only says "determine winner"
      computation: 'Look up secret RPS mapping for each player\'s weapon from game.weaponMappings, apply RPS rules to determine winner, generate humorous 1-2 sentence narrative, increment winner\'s roundsWon',
    },
  },
};

export const INSTRUCTIONS_GAP_MECHANIC_CODE: Record<string, string> = {
  resolve_round_outcome: `export async function resolve_round_outcome(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  const p1Weapon = state.player1.selectedWeapon;
  const p2Weapon = state.player2.selectedWeapon;
  const p1Type = state.game.weaponMappings[p1Weapon];
  const p2Type = state.game.weaponMappings[p2Weapon];

  // Determine winner — follows computation: "apply RPS rules to determine winner"
  let winner: string;
  if (
    (p1Type === "rock" && p2Type === "scissors") ||
    (p1Type === "scissors" && p2Type === "paper") ||
    (p1Type === "paper" && p2Type === "rock")
  ) {
    winner = "player1";
  } else {
    // BUG: No tie check! When p1Type === p2Type, this defaults to player2.
    // The computation said "determine winner" without mentioning ties.
    winner = "player2";
  }

  const narrative = await callLLM(
    "Generate a humorous 1-2 sentence narrative describing the clash between " +
    p1Weapon + " and " + p2Weapon + ". Winner: " + winner + "."
  );

  return {
    game: { roundOutcome: narrative },
    [winner]: { roundsWon: state[winner as \`player\${number}\`].roundsWon + 1 },
  };
}`,
  both_weapons_ready: CODE_BUG_MECHANIC_CODE.both_weapons_ready,
};

export const INSTRUCTIONS_GAP_ERRORS = [
  'Mechanic "resolve_round_outcome" incorrectly awards a point when both weapons map to the same RPS type (tie). The game specification states ties should award no points, but the mechanic always increments one player\'s roundsWon. The mechanicsGuidance computation says "determine winner, increment winner\'s roundsWon" without specifying tie handling, even though the rules mention ties.',
];

export const INSTRUCTIONS_GAP_INPUT: CoordinatorInput = {
  gameSpecification: WACKY_WEAPONS_SPEC,
  validationErrors: INSTRUCTIONS_GAP_ERRORS,
  schemaFields: SCHEMA_FIELDS,
  stateTransitions: TRANSITIONS,
  playerPhaseInstructions: JSON.stringify(PLAYER_PHASE_INSTRUCTIONS),
  transitionInstructions: JSON.stringify(INCOMPLETE_TRANSITION_INSTRUCTIONS),
  generatedMechanics: INSTRUCTIONS_GAP_MECHANIC_CODE,
  stateInterfaces: STATE_INTERFACES,
};


// ════════════════════════════════════════════════════════════════════════
// SCENARIO C: Ambiguous — hash collisions cause unbalanced mappings
//
// The mechanicsGuidance rules say:
//   "Distribute mappings reasonably across rock/paper/scissors options"
// But the computation says:
//   "Map each of the 6 weapon names to rock, paper, or scissors using
//    deterministic logic based on weapon name properties"
//
// The generated code uses hash % 3 — which is deterministic per the
// computation, but produces collisions (e.g., 4 weapons map to "rock",
// 2 to "scissors", 0 to "paper"). The rules say "distribute reasonably"
// but the computation doesn't operationalize any distribution constraint.
//
// The code faithfully implements the computation. The problem is the
// computation doesn't specify HOW to ensure balanced distribution.
// The coordinator should fix the instructions (make the computation
// explicit about distribution) rather than just patching the code,
// because an unguided regeneration could repeat the same pattern.
//
// Expected: coordinator targets instructions (tighten computation to
// specify distribution constraint), then mechanics (regenerate).
// ════════════════════════════════════════════════════════════════════════

export const HASH_COLLISION_MECHANIC_CODE: Record<string, string> = {
  both_weapons_ready: `export async function both_weapons_ready(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  const rpsTypes: Array<"rock" | "paper" | "scissors"> = ["rock", "paper", "scissors"];
  const weaponMappings: Record<string, "rock" | "paper" | "scissors"> = {};

  // Collect all weapons from both players
  const allWeapons: string[] = [];
  for (const name of Object.keys(state.player1.weapons)) {
    allWeapons.push(name);
  }
  for (const name of Object.keys(state.player2.weapons)) {
    allWeapons.push(name);
  }

  // Deterministic mapping using hash of weapon name
  for (const name of allWeapons) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
    }
    weaponMappings[name] = rpsTypes[Math.abs(hash) % 3];
  }

  const announcement = await callLLM(
    "Announce that both players have their weapons ready and the first round is about to begin. 1-2 sentences."
  );

  return {
    game: { weaponMappings, currentRound: 1, publicMessage: announcement },
    player1: { actionRequired: true },
    player2: { actionRequired: true },
  };
}`,
  resolve_round_outcome: CODE_BUG_MECHANIC_CODE.resolve_round_outcome.replaceAll('roundWon', 'roundsWon'),
};

export const HASH_COLLISION_ERRORS = [
  'Mechanic "both_weapons_ready" produces unbalanced weapon-to-RPS mappings. With weapons ["Banana Launcher", "Rubber Duck Shield", "Spaghetti Whip", "Pillow Cannon", "Glitter Bomb", "Tickle Ray"], the hash-based mapping assigns 4 weapons to "rock", 2 to "scissors", and 0 to "paper". The game specification requires each weapon to map to one of rock/paper/scissors, and the mechanicsGuidance rules say "Distribute mappings reasonably across rock/paper/scissors options", but the computation only says "deterministic logic based on weapon name properties" without specifying any distribution constraint. The hash modulo approach does not guarantee balanced distribution.',
];

export const HASH_COLLISION_INPUT: CoordinatorInput = {
  gameSpecification: WACKY_WEAPONS_SPEC,
  validationErrors: HASH_COLLISION_ERRORS,
  schemaFields: SCHEMA_FIELDS,
  stateTransitions: TRANSITIONS,
  playerPhaseInstructions: JSON.stringify(PLAYER_PHASE_INSTRUCTIONS),
  transitionInstructions: JSON.stringify(TRANSITION_INSTRUCTIONS),
  generatedMechanics: HASH_COLLISION_MECHANIC_CODE,
  stateInterfaces: STATE_INTERFACES,
};
