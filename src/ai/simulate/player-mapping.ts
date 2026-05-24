/**
 * Player ID Mapping Utilities
 * 
 * Manages transformation between canonical player IDs (UUIDs) and 
 * aliased player IDs (player1, player2, player3, ...) for LLM interaction.
 * 
 * Benefits of aliasing:
 * - Lower cognitive load for LLM (player1 vs uuid-abc-123-def-456)
 * - Positional semantics (player1 = first player)
 * - Fewer tokens in prompts/responses
 * - Matches training data patterns
 * - Human-readable for debugging
 */

import { BaseRuntimeState } from "#chaincraft/ai/simulate/schema.js";

/**
 * Player mapping: alias -> canonical UUID
 * Example: {"player1": "player-uuid-abc-123", "player2": "player-uuid-def-456"}
 */
export type PlayerMapping = Record<string, string>;

/**
 * Create a player mapping from an array of player IDs.
 * Maps players to player1, player2, player3, ... in the order they appear.
 * 
 * @param playerIds - Array of canonical player IDs (UUIDs)
 * @returns Mapping from aliases (player1, player2, ...) to UUIDs
 */
export function createPlayerMapping(playerIds: string[]): PlayerMapping {
  const mapping: PlayerMapping = {};
  
  playerIds.forEach((playerId, index) => {
    const alias = `player${index + 1}`;
    mapping[alias] = playerId;
  });
  
  return mapping;
}

/**
 * Create reverse mapping: UUID -> alias
 * 
 * @param mapping - Player mapping (alias -> UUID)
 * @returns Reverse mapping (UUID -> alias)
 */
export function reversePlayerMapping(mapping: PlayerMapping): Record<string, string> {
  return Object.fromEntries(
    Object.entries(mapping).map(([alias, uuid]) => [uuid, alias])
  );
}

/**
 * Recursively walk an object and replace any string value that appears as a
 * key in `valueMap` with the corresponding mapped value.
 *
 * Used to translate player UUIDs ↔ aliases embedded inside game-state
 * objects (e.g. game.currentBidderPlayerId, game.challengerPlayerId).
 * Arrays and nested objects are traversed depth-first.
 * Non-string scalar values (numbers, booleans, null) are returned unchanged.
 */
export function translateValuesDeep(obj: unknown, valueMap: Record<string, string>): unknown {
  if (typeof obj === 'string') {
    return valueMap[obj] ?? obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => translateValuesDeep(item, valueMap));
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(
        ([k, v]) => [k, translateValuesDeep(v, valueMap)]
      )
    );
  }
  return obj;
}

/**
 * Transform game state from canonical (UUID keys) to aliased (player1, player2, ... keys).
 * Used before passing state to LLM.
 *
 * In addition to renaming the player-keyed entries in `state.players`, this also
 * replaces any UUID *values* embedded inside `state.game` (e.g. `currentBidderPlayerId`)
 * with their corresponding aliases so that generated mechanic code sees a fully
 * aliased picture of the world.
 *
 * @param state - Canonical game state with UUID player keys
 * @param mapping - Player mapping (alias -> UUID)
 * @returns Aliased game state with player1, player2, ... player keys
 */
export function transformStateToAliases(
  state: BaseRuntimeState,
  mapping: PlayerMapping
): BaseRuntimeState {
  const reverseMap = reversePlayerMapping(mapping);
  
  return {
    game: translateValuesDeep(state.game, reverseMap) as BaseRuntimeState['game'],
    players: Object.fromEntries(
      Object.entries(state.players || {}).map(([uuid, playerState]) => {
        const alias = reverseMap[uuid];
        if (!alias) {
          console.warn(`[player-mapping] No alias found for player UUID: ${uuid}`);
          return [uuid, playerState]; // Fallback to UUID if no mapping
        }
        return [alias, playerState];
      })
    )
  };
}

/**
 * Transform game state from aliased (player1, player2, ... keys) to canonical (UUID keys).
 * Used after receiving state from LLM.
 *
 * In addition to restoring UUID keys in `state.players`, this also replaces any alias
 * *values* embedded inside `state.game` (e.g. `currentBidderPlayerId = "player1"`) back
 * to their canonical UUIDs.
 *
 * @param state - Aliased game state with player1, player2, ... player keys
 * @param mapping - Player mapping (alias -> UUID)
 * @returns Canonical game state with UUID player keys
 */
export function transformStateFromAliases(
  state: BaseRuntimeState,
  mapping: PlayerMapping
): BaseRuntimeState {
  return {
    game: translateValuesDeep(state.game, mapping) as BaseRuntimeState['game'],
    players: Object.fromEntries(
      Object.entries(state.players || {}).map(([alias, playerState]) => {
        const uuid = mapping[alias];
        if (!uuid) {
          console.warn(`[player-mapping] No UUID found for player alias: ${alias}`);
          return [alias, playerState]; // Fallback to alias if no mapping
        }
        return [uuid, playerState];
      })
    )
  };
}

/**
 * Serialize player mapping to JSON string for storage in workflow state.
 */
export function serializePlayerMapping(mapping: PlayerMapping): string {
  return JSON.stringify(mapping);
}

/**
 * Deserialize player mapping from JSON string.
 */
export function deserializePlayerMapping(json: string): PlayerMapping {
  try {
    return JSON.parse(json) as PlayerMapping;
  } catch (err) {
    console.error("[player-mapping] Failed to deserialize player mapping:", err);
    return {};
  }
}
