/**
 * Wacky Weapons — Denormalization Test (Pattern 2, Transitions-Only Repair)
 *
 * Based on real production artifacts from the "Weapon Inventor Game" (wacky-weapons).
 * This is a 2-player best-of-3 RPS variant where players invent weapons,
 * the system secretly assigns RPS types, and then players choose weapons each round.
 *
 * Pipeline context: In the spec-processing-graph, transition validation runs
 * BEFORE instruction extraction. The non-deterministic precondition below
 * causes transition validation to fail, so instructions are never extracted.
 * The artifact editor is invoked via createRepairTransitionsNode() with
 * empty instructions ({}). After repair, the pipeline continues to extract
 * instructions against the fixed transitions + updated schema.
 *
 * True denormalization scenario (Pattern 2 from coordinator prompt):
 *
 * NON-DETERMINISTIC PRECONDITION: The `player_wins_match` transition has
 * `logic: null, deterministic: false` — the extractor couldn't express
 * "which specific player has 2 wins" as a deterministic JsonLogic
 * precondition. It punted and left the logic as null.
 *
 * The coordinator must diagnose this as a denormalization problem and:
 *   a) Add a new schema field (e.g. `game.matchWinnerId`) via schemaOps
 *   b) Rewrite the `player_wins_match` precondition to check the new field
 *      (e.g. `game.matchWinnerId != null`) — deterministic check on stored value
 *
 * Note: The coordinator CANNOT patch instructions (they're empty). The
 * instruction to SET the new field in a prior transition (e.g. resolve_round_outcome)
 * will be handled when instructions are extracted in the next pipeline step,
 * since the schema will now include the field.
 *
 * This exercises: schema addField → precondition rewrite (transitions-only)
 */

import type { CoordinatorInput } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/types.js';

// ─── Game Specification ───

export const WACKY_WEAPONS_SPEC = `# Weapon Inventor Game Rules

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
   - Same type results in a tie
4. After each round, the system generates a humorous narrative describing how the weapons clashed
5. The winner of each round earns 1 point (rounds won)

## Victory Conditions
- First player to win 2 rounds wins the match
- The game ends immediately when a player reaches 2 rounds won
- Maximum of 3 rounds can be played`;


// ─── State Schema (GameStateField[] format — does NOT include matchWinnerId or isGameWinner) ───

export const WACKY_WEAPONS_STATE_SCHEMA = JSON.stringify([
  { name: "currentPhase", type: "string", path: "game", source: "specification", purpose: "Current phase of the game" },
  { name: "gameEnded", type: "boolean", path: "game", source: "specification", purpose: "Whether the game has ended" },
  { name: "gameError", type: "object", path: "game", source: "specification", purpose: "Error state if game encountered a fatal error" },
  { name: "publicMessage", type: "string", path: "game", source: "specification", purpose: "Message visible to all players" },
  { name: "currentRound", type: "number", path: "game", source: "specification", purpose: "Track which round 1-3 is currently being played" },
  { name: "roundOutcome", type: "string", path: "game", source: "specification", purpose: "Narrative and outcome of completed round" },
  { name: "weaponMappings", type: "object", path: "game", source: "specification", purpose: "Secret RPS mappings for all 6 weapons in match (weapon name -> RPS type)" },
  { name: "ready", type: "boolean", path: "player", source: "specification", purpose: "Whether player is ready" },
  { name: "illegalActionCount", type: "number", path: "player", source: "specification", purpose: "Number of illegal actions taken by the player" },
  { name: "privateMessage", type: "string", path: "player", source: "specification", purpose: "Private message to the player" },
  { name: "actionsAllowed", type: "boolean", path: "player", source: "specification", purpose: "Whether the player is currently allowed to take actions" },
  { name: "actionRequired", type: "boolean", path: "player", source: "specification", purpose: "If true, game cannot proceed until this player acts" },
  { name: "weapons", type: "object", path: "player", source: "specification", purpose: "Player's 3 invented weapons, name -> description" },
  { name: "roundsWon", type: "number", path: "player", source: "specification", purpose: "Track rounds won by each player in current match" },
  { name: "selectedWeapon", type: "string", path: "player", source: "specification", purpose: "Player's weapon choice for current round" },
]);


// ─── Schema Fields Summary ───

export const WACKY_WEAPONS_SCHEMA_FIELDS = `game.currentPhase: string (Current phase of the game)
game.gameEnded: boolean (Whether the game has ended)
game.gameError: object (Error state if game encountered a fatal error)
game.publicMessage: string (Message visible to all players)
game.currentRound: number (Track which round 1-3 is currently being played)
game.roundOutcome: string (Narrative and outcome of completed round)
game.weaponMappings: object (Secret RPS mappings for all 6 weapons)
players.*.ready: boolean (Whether player is ready)
players.*.illegalActionCount: number
players.*.privateMessage: string
players.*.actionsAllowed: boolean|null (Whether the player is currently allowed to take actions)
players.*.actionRequired: boolean (If true, game cannot proceed until this player acts)
players.*.weapons: object (Player's 3 invented weapons, name -> description)
players.*.roundsWon: number (Track rounds won by each player in current match)
players.*.selectedWeapon: string (Player's weapon choice for current round)`;


// ─── State Transitions (MUTATED: player_wins_match has null/non-deterministic precondition) ───

export const WACKY_WEAPONS_TRANSITIONS = JSON.stringify({
  phases: ["init", "weapon_setup", "round_start", "weapon_selection", "round_resolution", "match_check", "finished"],
  phaseMetadata: [
    { phase: "init", requiresPlayerInput: false },
    { phase: "weapon_setup", requiresPlayerInput: true },
    { phase: "round_start", requiresPlayerInput: false },
    { phase: "weapon_selection", requiresPlayerInput: true },
    { phase: "round_resolution", requiresPlayerInput: false },
    { phase: "match_check", requiresPlayerInput: false },
    { phase: "finished", requiresPlayerInput: false },
  ],
  transitions: [
    {
      id: "initialize_game",
      fromPhase: "init",
      toPhase: "weapon_setup",
      checkedFields: ["game.currentPhase"],
      preconditions: [{
        id: "game_is_init",
        logic: { "==": [{ "var": "game.currentPhase" }, "init"] },
        deterministic: true,
        explain: "Check if game.currentPhase equals 'init'",
      }],
      humanSummary: "Initialize game state and transition to weapon setup phase",
    },
    {
      id: "both_weapons_ready",
      fromPhase: "weapon_setup",
      toPhase: "round_start",
      checkedFields: ["players[*].ready", "players[*].weapons"],
      preconditions: [
        { id: "all_players_ready", logic: { allPlayers: ["ready", "==", true] }, deterministic: true, explain: "Check that all players have ready set to true" },
        { id: "all_players_weapons_finalized", logic: { allPlayers: ["weapons", "!=", null] }, deterministic: true, explain: "Check that all players have weapons defined" },
      ],
      humanSummary: "Both players have finalized weapons; begin round 1",
    },
    {
      id: "begin_round",
      fromPhase: "round_start",
      toPhase: "weapon_selection",
      checkedFields: ["game.currentRound", "players[*].actionRequired"],
      preconditions: [
        { id: "round_is_valid", logic: { and: [{ ">=": [{ "var": "game.currentRound" }, 1] }, { "<=": [{ "var": "game.currentRound" }, 3] }] }, deterministic: true, explain: "Verify current round is between 1 and 3 inclusive" },
        { id: "action_required_set", logic: { allPlayers: ["actionRequired", "==", true] }, deterministic: true, explain: "Check that all players have actionRequired flag set to true" },
      ],
      humanSummary: "Round is ready; players must now select their weapons",
    },
    {
      id: "both_weapons_submitted",
      fromPhase: "weapon_selection",
      toPhase: "round_resolution",
      checkedFields: ["players[*].selectedWeapon", "players[*].actionRequired"],
      preconditions: [
        { id: "all_players_selected_weapon", logic: { allPlayers: ["selectedWeapon", "!=", null] }, deterministic: true, explain: "Check that all players have submitted a weapon selection" },
        { id: "no_action_required", logic: { allPlayers: ["actionRequired", "==", false] }, deterministic: true, explain: "Verify all players have completed their actions" },
      ],
      humanSummary: "Both weapon selections received; resolve round outcome",
    },
    {
      id: "resolve_round_outcome",
      fromPhase: "round_resolution",
      toPhase: "match_check",
      checkedFields: ["players[*].selectedWeapon", "game.weaponMappings"],
      preconditions: [
        { id: "both_weapons_valid", logic: { allPlayers: ["selectedWeapon", "!=", null] }, deterministic: true, explain: "Verify both players have valid weapon selections" },
        { id: "mappings_exist", logic: { "!=": [{ "var": "game.weaponMappings" }, null] }, deterministic: true, explain: "Check that weapon mappings exist in game state" },
      ],
      humanSummary: "Determine round winner via RPS mechanics and generate narrative",
    },
    // ─── MUTATED: precondition is non-deterministic (null logic) — extractor couldn't express it ───
    {
      id: "player_wins_match",
      fromPhase: "match_check",
      toPhase: "finished",
      checkedFields: ["players[*].roundsWon"],
      preconditions: [{
        id: "match_winner_exists",
        logic: null,
        deterministic: false,
        explain: "Determine which specific player has accumulated 2 round wins and is the match winner",
      }],
      humanSummary: "One player has won 2 rounds; match ends",
    },
    {
      id: "continue_to_next_round",
      fromPhase: "match_check",
      toPhase: "round_start",
      checkedFields: ["players[*].roundsWon", "game.currentRound"],
      preconditions: [
        { id: "no_player_has_two_wins", logic: { allPlayers: ["roundsWon", "<", 2] }, deterministic: true, explain: "Verify no player has reached 2 wins yet" },
        { id: "more_rounds_available", logic: { "<": [{ "var": "game.currentRound" }, 3] }, deterministic: true, explain: "Check that current round is less than 3" },
      ],
      humanSummary: "Match continues; advance to next round",
    },
  ],
}, null, 2);


// ─── Transition Instructions (EMPTY — pipeline failed at transition validation, never extracted) ───

export const WACKY_WEAPONS_TRANSITION_INSTRUCTIONS: Record<string, unknown> = {};


// ─── Player Phase Instructions (EMPTY — pipeline failed at transition validation, never extracted) ───

export const WACKY_WEAPONS_PLAYER_PHASE_INSTRUCTIONS: Record<string, unknown> = {};


// ─── Validation Errors (transition-level only — instruction validators haven't run) ───

export const WACKY_WEAPONS_VALIDATION_ERRORS = [
  // NON-DETERMINISTIC PRECONDITION — logic is null (caught by validateTransitions)
  'Transition "player_wins_match" precondition "match_winner_exists": logic cannot be null. Non-deterministic preconditions are not allowed. The precondition needs to check a condition that can be evaluated purely from schema fields. Consider adding a schema field to store a pre-calculated value (e.g., the ID of the match winner) and populating it in a prior transition.',
];


// ─── Assembled CoordinatorInput (stringified format for direct coordinator tests) ───

export const WACKY_WEAPONS_INPUT: CoordinatorInput = {
  gameSpecification: WACKY_WEAPONS_SPEC,
  validationErrors: WACKY_WEAPONS_VALIDATION_ERRORS,
  schemaFields: WACKY_WEAPONS_SCHEMA_FIELDS,
  stateTransitions: WACKY_WEAPONS_TRANSITIONS,
  playerPhaseInstructions: JSON.stringify(WACKY_WEAPONS_PLAYER_PHASE_INSTRUCTIONS),
  transitionInstructions: JSON.stringify(WACKY_WEAPONS_TRANSITION_INSTRUCTIONS),
};
