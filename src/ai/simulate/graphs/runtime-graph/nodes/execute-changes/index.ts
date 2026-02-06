/**
 * Execute Changes Node
 * 
 * Executes game instructions by applying stateDelta operations to game state.
 * Handles three scenarios:
 * 1. Deterministic transitions: stateDelta with no templates (could be applied directly, but LLM validates)
 * 2. Non-deterministic transitions: uses mechanicsGuidance to compute values and resolve templates
 * 3. Player actions: resolves templates from player input and applies operations
 * 
 * Uses structured output to ensure valid state format.
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { RuntimeStateType } from "#chaincraft/ai/simulate/graphs/runtime-graph/runtime-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { executeChangesTemplate } from "#chaincraft/ai/simulate/graphs/runtime-graph/nodes/execute-changes/prompts.js";
import { executeChangesResponseSchema } from "#chaincraft/ai/simulate/graphs/runtime-graph/nodes/execute-changes/schema.js";
import { applyStateDeltas, type StateDeltaOp } from "#chaincraft/ai/simulate/logic/statedelta.js";
import { deserializePlayerMapping, reversePlayerMapping, transformStateToAliases } from "#chaincraft/ai/simulate/player-mapping.js";
import { expandAndTransformOperation, isDeterministicOperation, applyDeterministicOperations, mergeDeterministicOverrides } from "#chaincraft/ai/simulate/deterministic-ops.js";
import { expandNarratives } from "#chaincraft/ai/design/expand-narratives.js";

export function executeChanges(model: ModelWithOptions) {
  return async (state: RuntimeStateType): Promise<Partial<RuntimeStateType>> => {
    console.debug("[execute_changes] Resolving templates and applying state deltas");
    
    // Expand narrative markers in instructions if narratives are present
    let instructions = state.selectedInstructions || "{}";
    if (state.specNarratives && Object.keys(state.specNarratives).length > 0) {
      instructions = expandNarratives(instructions, state.specNarratives);
      console.debug("[execute_changes] Expanded narrative markers in instructions");
    }
    
    console.debug("[execute_changes] Instructions:", instructions.substring(0, 300));
    
    // Parse canonical state and player mapping
    let canonicalState = state.gameState ? JSON.parse(state.gameState) : { game: {}, players: {} };
    const playerMapping = deserializePlayerMapping(state.playerMapping || "{}");
    
    console.debug("[execute_changes] Player mapping:", JSON.stringify(playerMapping));
    
    // Extract deterministic operations from original instructions for post-LLM override
    let deterministicOps: StateDeltaOp[] = [];
    try {
      const parsedInstructions = JSON.parse(instructions);
      const originalOps: StateDeltaOp[] = parsedInstructions.stateDelta || [];
      deterministicOps = originalOps.filter(isDeterministicOperation);
      
      console.log(`[execute_changes] Found ${deterministicOps.length} deterministic ops (of ${originalOps.length} total)`);
    } catch (error) {
      // instructions might not be valid JSON if it's still a raw instruction object
      console.warn(`[execute_changes] Could not parse instructions for deterministic ops:`, error);
      console.debug("[execute_changes] Instructions value:", instructions.substring(0, 200));
    }
    
    // Transform state to use aliases (player1, player2, ...) for LLM
    const aliasedState = transformStateToAliases(canonicalState, playerMapping);
    
    // Transform player IDs array to aliases for prompt
    const aliasedPlayerIds = Object.keys(playerMapping).sort(); // ["player1", "player2", ...]
    
    // Transform playerAction to use alias instead of UUID
    const reverseMap = reversePlayerMapping(playerMapping);
    const aliasedPlayerAction = state.playerAction ? {
      playerId: reverseMap[state.playerAction.playerId] || state.playerAction.playerId,
      playerAction: state.playerAction.playerAction
    } : null;
    
    const prompt = SystemMessagePromptTemplate.fromTemplate(executeChangesTemplate);
    
    // Format the prompt with aliased state (LLM sees p1, p2, not UUIDs)
    const promptMessage = await prompt.format({
      selectedInstructions: instructions,
      gameState: JSON.stringify(aliasedState), // Pass aliased state to LLM
      players: JSON.stringify(aliasedPlayerIds), // Pass aliased player IDs to LLM
      playerAction: aliasedPlayerAction ? JSON.stringify(aliasedPlayerAction) : "null",
    });
    
    console.debug("[execute_changes] Invoking LLM to resolve templates...");
    
    // Use structured output to get resolved stateDelta operations
    const llmResponse = await model.invokeWithSystemPrompt(
      promptMessage.content as string,
      undefined,
      {
        agent: "execute-changes",
        workflow: "runtime",
      },
      executeChangesResponseSchema
    );
    
    console.log("[execute_changes] LLM resolved", llmResponse.stateDelta.length, "operations");
    console.debug("[execute_changes] Rationale:", llmResponse.rationale);
    
    // Apply the resolved stateDelta operations from LLM to get llmState
    let llmState = canonicalState;
    
    if (llmResponse.stateDelta.length > 0) {
      // Transform operations from aliases (p1, p2) to UUIDs before applying
      console.debug("[execute_changes] Transforming LLM operations from aliases to UUIDs...");
      const transformedOps = llmResponse.stateDelta.flatMap((op: StateDeltaOp) => 
        expandAndTransformOperation(op, playerMapping)
      );
      console.debug("[execute_changes] Transformed", llmResponse.stateDelta.length, "ops to", transformedOps.length, "ops");
      
      const result = applyStateDeltas(canonicalState, transformedOps);
      
      if (!result.success) {
        console.error("[execute_changes] Failed to apply LLM state deltas:", result.errors);
        throw new Error(`LLM state delta application failed: ${JSON.stringify(result.errors)}`);
      }
      
      llmState = result.newState!;
    }
    
    // Apply deterministic operations directly to canonical state
    // These override any LLM values for the same fields (ensures reliability)
    let updatedState = llmState;
    
    if (deterministicOps.length > 0) {
      console.log("[execute_changes] Applying deterministic operations override...");
      
      // Transform deterministic ops from aliases to UUIDs
      const transformedDeterministicOps = deterministicOps.flatMap(op => 
        expandAndTransformOperation(op, playerMapping)
      );
      
      const deterministicState = applyDeterministicOperations(
        canonicalState,
        deterministicOps,
        playerMapping
      );
      
      // Merge: LLM state + deterministic overrides
      // Use transformed ops so setByPath uses UUID paths, not alias paths
      updatedState = mergeDeterministicOverrides(
        llmState,
        deterministicState,
        transformedDeterministicOps
      );
      
      console.log("[execute_changes] Deterministic overrides applied successfully");
    }
    
    // Apply messages to state
    if (llmResponse.publicMessage) {
      updatedState.game.publicMessage = llmResponse.publicMessage;
    }
    
    if (llmResponse.privateMessages) {
      // Map private messages back to UUID player IDs
      for (const [alias, message] of Object.entries(llmResponse.privateMessages)) {
        const uuid = playerMapping[alias];
        if (uuid && updatedState.players[uuid]) {
          updatedState.players[uuid].privateMessage = message;
        }
      }
    }
    
    // Deterministically override phase to match router's decision
    // Router is the state machine controller - it determines which phase to transition to
    updatedState.game.currentPhase = state.nextPhase;
    updatedState.game.gameEnded = state.nextPhase === "finished" ? true : updatedState.game?.gameEnded || false;
    
    console.log(`[execute_changes] Phase transition to: ${state.nextPhase}`);
    console.debug("[execute_changes] Updated state sample:", JSON.stringify(updatedState).substring(0, 200));
    
    return {
      gameState: JSON.stringify(updatedState),
      playerAction: undefined, // Clear processed action
      requiresPlayerInput: false, // Will be set by router on next iteration
      transitionReady: false, // Will be set by router on next iteration
      isInitialized: true, // Mark as initialized after any state change
    };
  };
}
