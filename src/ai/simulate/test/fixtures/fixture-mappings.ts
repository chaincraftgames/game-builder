/**
 * Fixture Field Mappings
 * 
 * When fixtures are regenerated and field/phase names change, update this mapping file.
 * All tests use these mappings, so you only need to update in one place.
 * 
 * MAINTENANCE:
 * 1. Regenerate fixtures: npm run fixtures:generate
 * 2. Check what changed (git diff or inspect artifacts.json)
 * 3. Update mappings below to match new names
 * 4. Tests automatically work with new names
 */

export interface GameFieldMapping {
  // Game-level fields (beyond base schema)
  game: {
    round?: string;           // e.g., "round", "currentRound", "roundNumber"
    phase?: string;           // e.g., "phase", "currentPhase" (usually same)
    winner?: string;          // e.g., "winner", "winningPlayer"
  };
  
  // Player-level fields (beyond base schema)
  player: {
    score: string;            // e.g., "score", "points", "wins"
    choice?: string;          // e.g., "currentChoice", "move", "selection"
    ready?: string;           // e.g., "ready", "isReady", "hasSubmitted"
  };
  
  // Phase names from transitions
  phases: {
    init: string;             // Initial phase name
    firstActive: string;      // First gameplay phase (after init)
    resolve?: string;         // Resolution/scoring phase (if applicable)
    final: string;            // Final/end game phase
  };
  
  // Transition IDs
  transitions: {
    initialize: string;       // Initialize game transition
    playerAction?: string;    // Main player action transition (if applicable)
    resolve?: string;         // Resolve/scoring transition (if applicable)
    gameEnd?: string;         // Game ending transition (if applicable)
  };
}

/**
 * RPS Game Mappings
 * Updated: 2025-12-09 (regenerated fixtures with consistent phase names)
 */
export const rpsMapping: GameFieldMapping = {
  game: {
    round: "roundNumber",
    phase: "currentPhase",
  },
  player: {
    score: "score",
    choice: "currentChoice",
  },
  phases: {
    init: "init",
    firstActive: "choice_submission",
    resolve: "reveal_and_score",
    final: "game_end",
  },
  transitions: {
    initialize: "initialize_game",
    playerAction: "both_players_chose",
    resolve: "round_scored_continue",
    gameEnd: "round_scored_game_won",
  },
};

/**
 * Oracle Game Mappings
 * Updated: 2025-12-09 (regenerated fixtures with consistent phase names)
 */
export const oracleMapping: GameFieldMapping = {
  game: {
    phase: "currentPhase",
  },
  player: {
    score: "wisdomReceived", // Oracle uses wisdom instead of score
  },
  phases: {
    init: "init",
    firstActive: "greeting",
    final: "concluded",
  },
  transitions: {
    initialize: "initialize_game",
    playerAction: "player_speaks",
  },
};

/**
 * Get mapping for a specific game
 */
export function getMapping(game: "rps" | "oracle"): GameFieldMapping {
  switch (game) {
    case "rps":
      return rpsMapping;
    case "oracle":
      return oracleMapping;
    default:
      throw new Error(`No mapping for game: ${game}`);
  }
}

/**
 * Helper to get nested field value using mapping
 */
export function getPlayerField(
  playerState: any,
  field: keyof GameFieldMapping["player"],
  mapping: GameFieldMapping
): any {
  const fieldName = mapping.player[field];
  if (!fieldName) {
    throw new Error(`Field ${field} not mapped for this game`);
  }
  return playerState[fieldName];
}

/**
 * Helper to get game field value using mapping
 */
export function getGameField(
  gameState: any,
  field: keyof GameFieldMapping["game"],
  mapping: GameFieldMapping
): any {
  const fieldName = mapping.game[field];
  if (!fieldName) {
    throw new Error(`Field ${field} not mapped for this game`);
  }
  return gameState[fieldName];
}
