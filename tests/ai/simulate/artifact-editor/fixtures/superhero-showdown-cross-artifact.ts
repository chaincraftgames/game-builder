/**
 * Superhero Showdown v2 - Cross-Artifact Validation Issues
 *
 * Real production data from a successful extraction run where all individual
 * artifact validators returned null (no errors), but inspection reveals
 * cross-artifact issues that would cause runtime deadlocks.
 *
 * Key cross-artifact issues:
 *
 * 1. DEADLOCK: `results_displayed` transition requires `anyPlayer isGameWinner==true`
 *    as a precondition (`winner_marked`), but `isGameWinner` is only set in
 *    `results_displayed`'s OWN instructions. The transition can never fire because
 *    its precondition depends on its own effects.
 *
 * 2. UNKNOWN FIELD: `both_characters_submitted` precondition `no_actions_required`
 *    references `allPlayersCompletedActions` via `var` accessor, but this field
 *    does not exist in the schema. Should use `allPlayers` operator on per-player
 *    `actionRequired` field instead.
 *
 * Note: `players.player1` / `players.player2` paths in instructions are FINE —
 * the runtime maps real player IDs to canonical player1/player2 names.
 *
 * Game: 2-player narrative battle where AI generates a humorous battle story and
 * determines a winner. The spec explicitly requires exactly one winner, no draws.
 */

import type { CoordinatorInput } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/types.js';

// ─── Game Specification (from production export) ───

export const SUPERHERO_SHOWDOWN_V2_SPEC = `# Superhero Showdown

## Overview

Superhero Showdown is a two-player game where players create superhero characters and watch them battle in an epic, humorous confrontation. Players provide character descriptions with as much or as little detail as they want, and the game generates a concise, over-the-top battle narrative that explains why one hero defeated the other.

## Player Count

Exactly 2 players per game.

## Game Setup

At the start of a new game:

- The game creates a new match instance for exactly 2 players
- Each player receives a character creation prompt
- No pre-game configuration is required

## Player Actions

### Character Creation

During character creation, each player must:

- Submit a superhero character description
- Players may include any combination of the following details:
  - Character name
  - Superpowers and abilities
  - Personality traits
  - Physical appearance
  - Weaknesses or vulnerabilities
  - Backstory elements
  - Combat style or preferences
- Players may provide extensive detail (multiple paragraphs) or minimal information (a single sentence or even just a name)
- Players may omit any or all details—the game will fill in missing information
- Character submissions have no minimum length requirement
- Character submissions have a maximum length of 2000 characters

### Submission Timing

- Both players submit their character descriptions simultaneously
- Players have unlimited time to complete their character submission

## Game Progression

### Stage 1: Character Collection

- The game waits for both players to submit their character descriptions
- Once both submissions are received, the game proceeds to Stage 2
- Players cannot modify their submissions after submitting

### Stage 2: Character Completion

- The game reviews each submitted character description
- For any missing character details, the game generates creative, humorous additions
- The game creates two complete, fully-detailed character profiles

### Stage 3: Winner Determination and Battle Narrative Generation

#### Winner Selection

- The game selects which character wins the battle BEFORE writing any narrative
- The winner is chosen using the game's creative discretion with no constraints
- Neither character has inherent advantages in winner selection

#### Battle Narrative Writing

After determining the winner, the game generates a battle narrative that:
- Is written specifically to justify and explain why the predetermined winner prevailed
- Is 2-4 paragraphs in total length
- Is written in a humorous, over-the-top style
- Explicitly declares the predetermined winner in the final paragraph

### Stage 4: Results Display

- The game displays the complete battle narrative to both players simultaneously
- The narrative clearly identifies the winner at the conclusion
- Players see both complete character profiles

## Victory Determination

- Victory is determined solely by narrative outcome
- Winner selection is based on the game's creative discretion
- There are no draws—every game must have exactly one winner

## Game End

The game ends immediately after displaying the battle narrative and results.

## Win Condition

The player whose character is declared victorious in the battle narrative wins the game.

!___ NARRATIVE:BATTLE_STYLE ___!

!___ NARRATIVE:CHARACTER_GENERATION_GUIDE ___!

!___ NARRATIVE:BATTLE_STRUCTURE ___!

## Fairness Rules

- Both players have equal opportunity to provide character details
- Character descriptions are collected simultaneously (no turn order advantage)
- Neither character receives inherent advantages from game-generated details
- Winner selection is unconstrained and based on entertainment value`;


// ─── State Schema (GameStateField[] format) ───

export const SUPERHERO_SHOWDOWN_V2_STATE_SCHEMA = JSON.stringify([
  { name: "currentPhase", type: "string", path: "game", source: "specification", purpose: "Current phase of the game, must match a phase from transitions" },
  { name: "gameEnded", type: "boolean", path: "game", source: "specification", purpose: "Whether the game has ended" },
  { name: "gameError", type: "object", path: "game", source: "specification", purpose: "Error state if game encountered a fatal error" },
  { name: "publicMessage", type: "string", path: "game", source: "specification", purpose: "Public game state, instructions to all players" },
  { name: "winningPlayers", type: "array", path: "game", source: "specification", purpose: "Player IDs who have won the game" },
  { name: "battleNarrative", type: "string", path: "game", source: "specification", purpose: "Generated 2-4 paragraph battle story explaining winner" },
  { name: "narrativeGenerated", type: "boolean", path: "game", source: "specification", purpose: "Track whether battle narrative generation is complete" },
  { name: "battleWinnerId", type: "string", path: "game", source: "specification", purpose: "ID of player whose character won the battle" },
  { name: "illegalActionCount", type: "number", path: "player", source: "specification", purpose: "Number of illegal actions taken by the player" },
  { name: "privateMessage", type: "string", path: "player", source: "specification", purpose: "Private message to the player" },
  { name: "actionsAllowed", type: "boolean", path: "player", source: "specification", purpose: "Whether the player is currently allowed to take actions" },
  { name: "actionRequired", type: "boolean", path: "player", source: "specification", purpose: "If true, game cannot proceed until this player acts" },
  { name: "isGameWinner", type: "boolean", path: "player", source: "specification", purpose: "Whether this player has won the game" },
  { name: "characterDescription", type: "string", path: "player", source: "specification", purpose: "Player's submitted superhero character description" },
  { name: "completeCharacterProfile", type: "string", path: "player", source: "specification", purpose: "Full character profile after game fills missing details" },
]);


// ─── Schema Fields (from stateSchema array) ───

export const SUPERHERO_SHOWDOWN_V2_SCHEMA_FIELDS = `game.currentPhase: string (Current phase of the game, must match a phase from transitions)
game.gameEnded: boolean (Whether the game has ended)
game.gameError: object (Error state if game encountered a fatal error)
game.publicMessage: string (Public game state, instructions to all players)
game.winningPlayers: array of strings (Player IDs who have won the game)
game.battleNarrative: string (Generated 2-4 paragraph battle story explaining winner)
game.battleWinnerId: string (ID of player whose character won the battle)
players.*.illegalActionCount: number
players.*.privateMessage: string
players.*.actionsAllowed: boolean|null (Whether the player is allowed to take actions)
players.*.actionRequired: boolean (If true, game cannot proceed until this player acts)
players.*.isGameWinner: boolean (Whether this player has won the game)
players.*.characterDescription: string (Player's submitted superhero character description, maxLength:2000)
players.*.completeCharacterProfile: string (Full character profile after game fills missing details)`;


// ─── State Transitions (from production export) ───

export const SUPERHERO_SHOWDOWN_V2_TRANSITIONS = JSON.stringify({
  phases: ["init", "character_creation", "battle_generation", "results_display", "finished"],
  phaseMetadata: [
    { phase: "init", requiresPlayerInput: false },
    { phase: "character_creation", requiresPlayerInput: true },
    { phase: "battle_generation", requiresPlayerInput: false },
    { phase: "results_display", requiresPlayerInput: false },
    { phase: "finished", requiresPlayerInput: false },
  ],
  transitions: [
    {
      id: "initialize_game",
      fromPhase: "init",
      toPhase: "character_creation",
      checkedFields: ["game.currentPhase"],
      preconditions: [{
        id: "game_not_initialized",
        logic: { "or": [{ "==": [{ "var": "game.currentPhase" }, "init"] }, { "==": [{ "var": "game.currentPhase" }, null] }] },
        deterministic: true,
        explain: "game.currentPhase == 'init' OR game.currentPhase == undefined",
      }],
      humanSummary: "Initialize game state with 2 players, set actionRequired=true for both players, and transition to character_creation phase",
    },
    {
      id: "both_characters_submitted",
      fromPhase: "character_creation",
      toPhase: "battle_generation",
      checkedFields: ["game.currentPhase", "players[*].characterDescription", "players[*].actionRequired"],
      preconditions: [
        {
          id: "in_character_creation",
          logic: { "==": [{ "var": "game.currentPhase" }, "character_creation"] },
          deterministic: true,
          explain: "game.currentPhase == 'character_creation'",
        },
        {
          id: "all_descriptions_submitted",
          logic: {
            "and": [
              { "allPlayers": ["characterDescription", "!=", null] },
              { "allPlayers": ["characterDescription", "!=", ""] },
            ],
          },
          deterministic: true,
          explain: "All players have submitted non-empty character descriptions",
        },
        {
          // BUG: References a field that DOES NOT EXIST in the schema.
          // Should use: { "allPlayers": ["actionRequired", "==", false] }
          id: "no_actions_required",
          logic: { "==": [{ "var": "allPlayersCompletedActions" }, true] },
          deterministic: true,
          explain: "allPlayersCompletedActions == true",
        },
      ],
      humanSummary: "When both players have submitted character descriptions, proceed to generate complete character profiles, determine winner, and create battle narrative",
    },
    {
      id: "battle_generated",
      fromPhase: "battle_generation",
      toPhase: "results_display",
      checkedFields: ["game.currentPhase", "game.battleNarrative", "game.battleWinnerId", "players[*].completeCharacterProfile"],
      preconditions: [
        {
          id: "in_battle_generation",
          logic: { "==": [{ "var": "game.currentPhase" }, "battle_generation"] },
          deterministic: true,
          explain: "game.currentPhase == 'battle_generation'",
        },
        {
          id: "narrative_exists",
          logic: { "and": [{ "!=": [{ "var": "game.battleNarrative" }, null] }, { "!=": [{ "var": "game.battleNarrative" }, ""] }] },
          deterministic: true,
          explain: "game.battleNarrative != undefined AND game.battleNarrative != ''",
        },
        {
          id: "winner_determined",
          logic: { "!=": [{ "var": "game.battleWinnerId" }, null] },
          deterministic: true,
          explain: "game.battleWinnerId != undefined",
        },
        {
          id: "profiles_complete",
          logic: {
            "and": [
              { "allPlayers": ["completeCharacterProfile", "!=", null] },
              { "allPlayers": ["completeCharacterProfile", "!=", ""] },
            ],
          },
          deterministic: true,
          explain: "All players have complete character profiles generated",
        },
      ],
      humanSummary: "Display complete battle narrative and character profiles to both players",
    },
    {
      id: "results_displayed",
      fromPhase: "results_display",
      toPhase: "finished",
      checkedFields: ["game.currentPhase", "game.publicMessage", "players[*].isGameWinner"],
      preconditions: [
        {
          id: "in_results_display",
          logic: { "==": [{ "var": "game.currentPhase" }, "results_display"] },
          deterministic: true,
          explain: "game.currentPhase == 'results_display'",
        },
        {
          id: "public_message_set",
          logic: { "and": [{ "!=": [{ "var": "game.publicMessage" }, null] }, { "!=": [{ "var": "game.publicMessage" }, ""] }] },
          deterministic: true,
          explain: "game.publicMessage != undefined AND game.publicMessage != ''",
        },
        {
          // BUG: DEADLOCK — requires isGameWinner==true, but isGameWinner is only
          // set in THIS transition's own instructions. Can never fire.
          id: "winner_marked",
          logic: { "anyPlayer": ["isGameWinner", "==", true] },
          deterministic: true,
          explain: "At least one player is marked as winner",
        },
      ],
      humanSummary: "Mark game as finished, set gameEnded=true, and record winning player",
    },
  ],
}, null, 2);


// ─── Transition Instructions (from production extraction) ───

export const SUPERHERO_SHOWDOWN_V2_TRANSITION_INSTRUCTIONS = {
  initialize_game: {
    id: "initialize_game",
    transitionName: "Initialize Game",
    mechanicsGuidance: null,
    rngConfig: null,
    stateDelta: [
      { op: "set", path: "game.currentPhase", value: "character_creation" },
      { op: "setForAllPlayers", field: "actionRequired", value: true },
      { op: "setForAllPlayers", field: "illegalActionCount", value: 0 },
      { op: "set", path: "game.publicMessage", value: "Welcome to Superhero Showdown! Create your superhero character." },
    ],
    messages: {
      private: [
        { to: "p1", template: "Describe your superhero character! Include as much or as little detail as you want. Maximum 2000 characters." },
        { to: "p2", template: "Describe your superhero character! Include as much or as little detail as you want. Maximum 2000 characters." },
      ],
      public: { template: "Welcome to Superhero Showdown! Both players, create your superhero characters." },
    },
  },
  both_characters_submitted: {
    id: "both_characters_submitted",
    transitionName: "Generate Complete Characters and Battle",
    mechanicsGuidance: {
      rules: [
        "Review each character's submitted description and identify missing details",
        "Generate creative, humorous additions for ALL missing details",
        "Create interesting contrasts between the two characters",
        "BEFORE writing battle narrative: Determine battle winner using creative discretion",
        "Generate 2-4 paragraph humorous, over-the-top battle narrative justifying the predetermined winner",
        "Final paragraph must explicitly declare the predetermined winner",
      ],
      computation: "Use LLM to: 1) Fill missing character details, 2) Choose battle winner, 3) Generate battle narrative",
    },
    rngConfig: null,
    // NOTE: players.player1 / players.player2 are FINE — runtime maps real IDs
    //        to canonical player1/player2 names. Only problematic when the specific
    //        player can't be known at extraction time (e.g., winner determination).
    stateDelta: [
      { op: "set", path: "game.currentPhase", value: "battle_generation" },
      { op: "set", path: "players.player1.completeCharacterProfile", value: "{{p1CompleteProfile}}" },
      { op: "set", path: "players.player2.completeCharacterProfile", value: "{{p2CompleteProfile}}" },
      { op: "set", path: "game.battleWinnerId", value: "{{battleWinnerId}}" },
      { op: "set", path: "game.battleNarrative", value: "{{battleNarrative}}" },
    ],
    messages: {
      public: { template: "Both superheroes are ready! The battle begins..." },
    },
  },
  battle_generated: {
    id: "battle_generated",
    transitionName: "Display Battle Results",
    mechanicsGuidance: null,
    rngConfig: null,
    // Only sets currentPhase — does NOT set isGameWinner here (should it?)
    stateDelta: [
      { op: "set", path: "game.currentPhase", value: "results_display" },
    ],
    messages: {
      public: {
        template: "🦸 SUPERHERO SHOWDOWN RESULTS 🦸\n\n📋 COMPLETE CHARACTER PROFILES:\n\nPlayer 1's Hero:\n{{p1CompleteProfile}}\n\nPlayer 2's Hero:\n{{p2CompleteProfile}}\n\n⚔️ THE BATTLE:\n\n{{battleNarrative}}\n\n🏆 WINNER: {{battleWinnerName}}'s character!",
      },
    },
  },
  results_displayed: {
    id: "results_displayed",
    transitionName: "Finalize Game",
    mechanicsGuidance: null,
    rngConfig: null,
    // BUG: Sets isGameWinner HERE, but the transition's own precondition
    //       requires isGameWinner==true BEFORE this can fire. DEADLOCK.
    stateDelta: [
      { op: "set", path: "players.{{battleWinnerId}}.isGameWinner", value: true },
      { op: "set", path: "game.gameEnded", value: true },
      { op: "set", path: "game.currentPhase", value: "finished" },
    ],
    messages: {
      private: [
        { to: "{{battleWinnerId}}", template: "🎉 Congratulations! Your superhero emerged victorious!" },
        { to: "{{battleLoserId}}", template: "Your superhero fought valiantly, but was defeated this time. Better luck next time!" },
      ],
      public: { template: "Game complete! {{battleWinnerName}} wins Superhero Showdown!" },
    },
  },
};


// ─── Player Phase Instructions (from production extraction) ───

export const SUPERHERO_SHOWDOWN_V2_PLAYER_PHASE_INSTRUCTIONS = {
  character_creation: {
    phase: "character_creation",
    playerActions: [{
      id: "submit-character",
      actionName: "Submit Character Description",
      validation: {
        checks: [
          { id: "wrongPhase", logic: { "==": [{ "var": "game.currentPhase" }, "character_creation"] }, errorMessage: "Cannot submit character - not in character creation phase" },
          { id: "alreadySubmitted", logic: { "!": { "var": "players.{{playerId}}.characterDescription" } }, errorMessage: "You have already submitted your character" },
          { id: "descriptionTooLong", logic: { "<=": [{ "length": { "var": "input.characterDescription" } }, 2000] }, errorMessage: "Character description must be 2000 characters or less" },
          { id: "descriptionEmpty", logic: { ">": [{ "length": { "var": "input.characterDescription" } }, 0] }, errorMessage: "Character description cannot be empty" },
        ],
      },
      mechanicsGuidance: null,
      stateDelta: [
        { op: "set", path: "players.{{playerId}}.characterDescription", value: "{{input.characterDescription}}" },
        { op: "set", path: "players.{{playerId}}.actionRequired", value: false },
      ],
      messages: {
        private: [{ to: "{{playerId}}", template: "Character submission received! Waiting for your opponent to submit their character..." }],
        public: { template: "{{playerName}} has created their superhero!" },
      },
    }],
  },
};


// ─── Cross-Artifact Validation Errors ───
// These were identified by inspection. The current per-artifact validators
// returned null for all artifacts — they don't catch cross-artifact issues.

export const SUPERHERO_SHOWDOWN_V2_VALIDATION_ERRORS = [
  // Issue 1: DEADLOCK — transition precondition depends on its own instruction effects
  'Transition "results_displayed" precondition "winner_marked" requires anyPlayer.isGameWinner==true, but isGameWinner is only set in the results_displayed transition\'s own instructions (stateDelta). No prior transition or player action sets isGameWinner. This creates a deadlock — the transition can never fire because its precondition depends on its own effects. The isGameWinner op must be moved to an earlier transition (e.g., battle_generated), or the precondition must be removed/changed.',

  // Issue 2: UNKNOWN FIELD — precondition references a non-existent schema field
  'Transition "both_characters_submitted" precondition "no_actions_required" references field "allPlayersCompletedActions" via {"var": "allPlayersCompletedActions"}, but this field does not exist in the schema. The schema has per-player "actionRequired" fields. The precondition should use the allPlayers operator: {"allPlayers": ["actionRequired", "==", false]}.',
];


// ─── Assembled CoordinatorInput ───

export const SUPERHERO_SHOWDOWN_V2_INPUT: CoordinatorInput = {
  gameSpecification: SUPERHERO_SHOWDOWN_V2_SPEC,
  validationErrors: SUPERHERO_SHOWDOWN_V2_VALIDATION_ERRORS,
  schemaFields: SUPERHERO_SHOWDOWN_V2_SCHEMA_FIELDS,
  stateTransitions: SUPERHERO_SHOWDOWN_V2_TRANSITIONS,
  playerPhaseInstructions: JSON.stringify(SUPERHERO_SHOWDOWN_V2_PLAYER_PHASE_INSTRUCTIONS),
  transitionInstructions: JSON.stringify(SUPERHERO_SHOWDOWN_V2_TRANSITION_INSTRUCTIONS),
};
