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
import { resolveTemplates } from "#chaincraft/ai/simulate/logic/statedelta.js";
import { deserializePlayerMapping, reversePlayerMapping, transformStateToAliases, translateValuesDeep } from "#chaincraft/ai/simulate/player-mapping.js";
import { expandAndTransformOperation, isDeterministicOperation, applyDeterministicOperations, mergeDeterministicOverrides } from "#chaincraft/ai/simulate/deterministic-ops.js";
import { executeMechanic, deepMergeState } from "#chaincraft/ai/simulate/mechanic-sandbox.js";
import { evaluateJsonLogic } from "#chaincraft/ai/simulate/logic/jsonlogic.js";

/** Strip unescaped control characters (U+0000–U+001F) that appear inside JSON string values. */
function sanitizeJsonString(raw: string): string {
  // Preserve JSON structural whitespace (\n, \r, \t). Escaping those breaks
  // pretty-printed JSON by injecting literal backslashes outside string values.
  // Only escape non-whitespace control chars that are always invalid in JSON.
  return raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, (ch) =>
    '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
  );
}

export function executeChanges(model: ModelWithOptions) {
  return async (state: RuntimeStateType): Promise<Partial<RuntimeStateType>> => {
    console.debug("[execute_changes] Resolving templates and applying state deltas");
    
    let instructions = state.selectedInstructions || "{}";
    
    console.debug("[execute_changes] Instructions:", instructions.substring(0, 300));
    
    // Parse canonical state and player mapping
    let canonicalState = state.gameState ? JSON.parse(state.gameState) : { game: {}, players: {} };
    const playerMapping = deserializePlayerMapping(state.playerMapping || "{}");
    
    console.debug("[execute_changes] Player mapping:", JSON.stringify(playerMapping));

    // Ensure every player has an entry in canonical state before building flatState.
    // This is required for initialize_game (and any mechanic that runs before player
    // state has been populated), so that generated mechanics can iterate over player
    // aliases via Object.keys(state).filter(k => k.startsWith('player')).
    canonicalState.players = canonicalState.players ?? {};
    for (const uuid of Object.values(playerMapping)) {
      if (!canonicalState.players[uuid]) {
        canonicalState.players[uuid] = {};
      }
    }

    // Deterministically clear currentAction for the acting player before applying
    // their new action. This ensures stale data from a prior turn (e.g. if the
    // previous automatic-transition mechanic forgot to clear it) never bleeds into
    // the new turn. The player action stateDelta then sets the fresh value.
    if (state.playerAction) {
      const actingPlayerId = state.playerAction.playerId;
      if (actingPlayerId && canonicalState.players[actingPlayerId]) {
        canonicalState.players[actingPlayerId].currentAction = null;
      }
    }

    // Transform state to use aliases (player1, player2, ...) for LLM
    const aliasedState = transformStateToAliases(canonicalState, playerMapping);
    
    // Check if this transition has a generated mechanic function
    let transitionId: string | undefined;
    let instructionNarrativeKeys: string[] = [];
    try {
      const parsed = JSON.parse(sanitizeJsonString(instructions));
      transitionId = parsed.id;
      instructionNarrativeKeys = parsed.narrativeKeys ?? [];
    } catch { /* ignore parse errors */ }

    const generatedFunctionBody = transitionId
      ? state.generatedMechanics?.[transitionId]
      : undefined;

    // Track LLM response for message handling (used by both paths)
    let llmResponse: {
      publicMessage?: string;
      privateMessages?: Record<string, string>;
      imagePrompt?: string;
      rationale?: string;
      stateDelta?: any[];
      parsedInput?: Record<string, unknown>;
    } = {};
    let updatedState: any;

    if (!state.isInitialized) {
      // ── DIRECT PATH: Apply stateDelta ops for initialization ──
      // The initial transition (init → first phase) is fully self-contained:
      // all ops are literal values, rng rolls, or setForAllPlayers — no LLM needed.
      // Message templates are resolved against the resulting aliased state.
      console.log(`[execute_changes] DIRECT PATH: applying stateDelta ops for initialization`);

      let parsedInstructions: any;
      try {
        parsedInstructions = JSON.parse(sanitizeJsonString(instructions));
      } catch {
        throw new Error('[execute_changes] DIRECT PATH: failed to parse instructions JSON');
      }

      const ops: StateDeltaOp[] = parsedInstructions.stateDelta || [];

      // Expand setForAllPlayers + transform alias paths to UUID paths, then apply all ops.
      // rng ops are handled natively by applyStateDeltas (picks from choices[] via probabilities[]).
      const transformedOps = ops.flatMap((op: StateDeltaOp) => expandAndTransformOperation(op, playerMapping));
      const applyResult = applyStateDeltas(canonicalState, transformedOps);

      if (!applyResult.success) {
        throw new Error(`[execute_changes] DIRECT PATH stateDelta failed: ${JSON.stringify(applyResult.errors)}`);
      }
      updatedState = applyResult.newState!;

      // Translate alias values embedded in game state to UUIDs
      // (e.g. game.currentTurnPlayerId = "player1" → UUID)
      updatedState.game = translateValuesDeep(updatedState.game, playerMapping);

      // Resolve message templates against the resulting aliased state.
      // Template variables like {{game.communalDice}} are resolved via dot-path traversal.
      const resultAliased = transformStateToAliases(updatedState, playerMapping);
      const resolveByState = (template: string): string =>
        template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
          const keys = path.trim().split('.');
          let curr: any = resultAliased;
          for (const k of keys) curr = curr?.[k];
          return curr !== undefined && curr !== null ? String(curr) : _match;
        });

      const messages = parsedInstructions.messages;
      if (messages?.public?.template) {
        llmResponse.publicMessage = resolveByState(messages.public.template);
      }
      if (messages?.private && Array.isArray(messages.private)) {
        llmResponse.privateMessages = {};
        for (const pm of messages.private) {
          if (pm.to && pm.template) {
            llmResponse.privateMessages[pm.to] = resolveByState(pm.template);
          }
        }
      }

    } else if (generatedFunctionBody) {
      // ── SANDBOX PATH: Execute generated mechanic function ──
      console.log(`[execute_changes] Using generated mechanic for transition: ${transitionId}`);

      // Build narrative context for callLLM: look up only the keys listed for this transition.
      const narrativeSections = instructionNarrativeKeys
        .map((key: string) => state.specNarratives?.[key])
        .filter((content): content is string => !!content);
      const narrativeContext = narrativeSections.length > 0
        ? `\n\nNarrative style guidance:\n${narrativeSections.join('\n\n')}`
        : '';

      // Flatten aliased state for sandbox: { game, players: { player1, player2 } }
      // becomes { game, player1, player2 } so generated code uses state.player1.weapons etc.
      const flatState: Record<string, any> = { game: aliasedState.game };
      for (const [alias, playerData] of Object.entries(aliasedState.players || {})) {
        flatState[alias] = playerData;
      }

      const callLLM = async (prompt: string): Promise<string> => {
        const systemPrompt = `You are a game narrator. Generate the requested content based on the game context.${narrativeContext}\n\nCurrent game state:\n${JSON.stringify(flatState, null, 2)}`;
        const response = await model.invokeWithSystemPrompt(
          systemPrompt,
          prompt,
          { agent: "mechanic-narrator", workflow: "runtime" },
        );
        return typeof response === 'string' ? response : (response as any)?.content ?? String(response);
      };

      // Build auditable rollDice closure — logs every roll for replay/fairness proofs
      const rngLog: Array<{ min: number; max: number; result: number }> = [];
      const rollDice = (min: number, max: number): number => {
        const range = max - min + 1;
        const result = min + Math.floor(Math.random() * range);
        rngLog.push({ min, max, result });
        return result;
      };

      // Build generateImage closure — calls image generation service
      const generateImage = async (prompt: string): Promise<string> => {
        try {
          const { generateImageDirect, GAMEPLAY_IMAGE_CONFIG } = await import(
            "#chaincraft/ai/image-gen/image-gen-service.js"
          );
          const imageUrl = await generateImageDirect(
            { image_prompt: prompt },
            GAMEPLAY_IMAGE_CONFIG,
          );
          console.log("[execute_changes] Sandbox generated image:", imageUrl);
          return imageUrl;
        } catch (error) {
          console.warn("[execute_changes] Sandbox image generation failed:", error);
          return '';
        }
      };

      // Execute in sandbox
      const partialUpdate = await executeMechanic(generatedFunctionBody, flatState, callLLM, rollDice, generateImage);
      if (rngLog.length > 0) {
        console.log(`[execute_changes] RNG audit log (${rngLog.length} rolls):`, JSON.stringify(rngLog));
      }
      console.log(`[execute_changes] Sandbox returned partial update with keys: ${Object.keys(partialUpdate).join(', ')}`);

      // ── ILLEGAL ACTION: Mechanic rejected the player's input ──
      if (partialUpdate.illegalAction) {
        const errorMessage = partialUpdate.illegalAction.errorMessage ?? "Illegal action";
        console.log(`[execute_changes] Mechanic rejected action as illegal: ${errorMessage}`);

        // Increment illegalActionCount for the acting player, preserve all other state
        const actingPlayerId = state.playerAction?.playerId;
        updatedState = structuredClone(canonicalState);
        if (actingPlayerId && updatedState.players[actingPlayerId]) {
          updatedState.players[actingPlayerId].illegalActionCount =
            (updatedState.players[actingPlayerId].illegalActionCount ?? 0) + 1;
          updatedState.players[actingPlayerId].privateMessage = errorMessage;
        }
        // Set public message via llmResponse so the standard message-handling logic picks it up
        llmResponse = { publicMessage: errorMessage };

        // Skip the normal transform/merge — state is unchanged except for illegalActionCount
      } else {
        // ── LEGAL ACTION: Transform and merge as normal ──

        // Transform aliased partial update back to UUID-keyed state
        const uuidPartial: Record<string, any> = {};
        for (const [key, value] of Object.entries(partialUpdate)) {
          if (key === 'game') {
            // Translate any alias values in game object back to UUIDs
            // (e.g. game.currentBidderPlayerId = "player1" → UUID)
            uuidPartial.game = translateValuesDeep(value, playerMapping);
          } else if (playerMapping[key]) {
            // key is an alias like "player1" — map to UUID
            uuidPartial.players = uuidPartial.players || {};
            uuidPartial.players[playerMapping[key]] = value;
          }
        }

        // Deep-merge into canonical state
        updatedState = deepMergeState(canonicalState, uuidPartial);

        // Normalize sandbox mechanic messages into shared message handling.
        // Generated mechanics return game.publicMessage (state-as-truth: message
        // is a component on the game entity, symmetric with player.privateMessage).
        // Runtime message accumulation is driven via llmResponse.
        const sandboxPublicMessage =
          typeof partialUpdate.game?.publicMessage === "string"
            ? partialUpdate.game.publicMessage
            : undefined;
        const sandboxPrivateMessages =
          partialUpdate.privateMessages && typeof partialUpdate.privateMessages === "object"
            ? partialUpdate.privateMessages
            : undefined;
        if (sandboxPublicMessage || sandboxPrivateMessages) {
          llmResponse = {
            ...llmResponse,
            ...(sandboxPublicMessage ? { publicMessage: sandboxPublicMessage } : {}),
            ...(sandboxPrivateMessages ? { privateMessages: sandboxPrivateMessages } : {}),
          };
        }
      }

    } else {
      // ── LLM PATH: Original behavior ──

      // Extract deterministic operations from original instructions for post-LLM override
      let deterministicOps: StateDeltaOp[] = [];
      try {
        const parsedInstructions = JSON.parse(sanitizeJsonString(instructions));
        const originalOps: StateDeltaOp[] = parsedInstructions.stateDelta || [];
        deterministicOps = originalOps.filter(isDeterministicOperation);
        
        console.log(`[execute_changes] Found ${deterministicOps.length} deterministic ops (of ${originalOps.length} total)`);
      } catch (error) {
        // instructions might not be valid JSON if it's still a raw instruction object
        console.warn(`[execute_changes] Could not parse instructions for deterministic ops:`, error);
        console.debug("[execute_changes] Instructions value:", instructions.substring(0, 200));
      }

      const aliasedPlayerIds = Object.keys(playerMapping).sort(); // ["player1", "player2", ...]
      
      // Transform playerAction to use alias instead of UUID
      const reverseMap = reversePlayerMapping(playerMapping);
      const aliasedPlayerAction = state.playerAction ? {
        playerId: reverseMap[state.playerAction.playerId] || state.playerAction.playerId,
        playerAction: state.playerAction.playerAction
      } : null;
      
      const prompt = SystemMessagePromptTemplate.fromTemplate(executeChangesTemplate);

      // For player action phases, the LLM's only job is parsing natural language input
      // into structured currentAction fields. It must NOT see full game state — that
      // prevents it from writing mechanic-level fields (actionRequired, currentBid, etc.)
      // which belong exclusively to generated mechanics / automatic transitions.
      // Validation (JsonLogic) runs in code and has access to the full candidate state.
      let llmGameState: string;
      if (aliasedPlayerAction) {
        // Minimal context: only the acting player's alias. No game state fields exposed.
        const actingAlias = reverseMap[state.playerAction!.playerId] || state.playerAction!.playerId;
        llmGameState = JSON.stringify({ players: { [actingAlias]: {} } });
      } else {
        llmGameState = JSON.stringify(aliasedState);
      }
      
      // Format the prompt with aliased state (LLM sees p1, p2, not UUIDs)
      const promptMessage = await prompt.format({
        selectedInstructions: instructions,
        gameState: llmGameState,
        players: JSON.stringify(aliasedPlayerIds), // Pass aliased player IDs to LLM
        playerAction: aliasedPlayerAction ? JSON.stringify(aliasedPlayerAction) : "null",
      });
      
      console.debug("[execute_changes] Invoking LLM to resolve templates...");
      
      // Use structured output to get resolved stateDelta operations
      llmResponse = await model.invokeWithSystemPrompt(
        promptMessage.content as string,
        undefined,
        {
          agent: "execute-changes",
          workflow: "runtime",
        },
        executeChangesResponseSchema
      );
      
      console.log("[execute_changes] LLM resolved", llmResponse.stateDelta!.length, "operations");
      console.debug("[execute_changes] Rationale:", llmResponse.rationale);

      // ── CONTRACT ENFORCEMENT: Player action stateDelta must only write currentAction ──
      // Strip any ops that write outside players.<actingAlias>.currentAction. These are
      // mechanic-level writes (actionRequired, currentBid, etc.) that belong in generated
      // mechanics / automatic transitions — not in the player action resolution step.
      if (aliasedPlayerAction) {
        const actingAlias = reverseMap[state.playerAction!.playerId] || state.playerAction!.playerId;
        const allowedPrefix = `players.${actingAlias}.currentAction`;
        const originalCount = llmResponse.stateDelta!.length;
        llmResponse.stateDelta = llmResponse.stateDelta!.filter((op: StateDeltaOp) => {
          // transfer ops use fromPath/toPath — they never write to currentAction
          const opPath = 'path' in op ? (op as any).path : undefined;
          const allowed = typeof opPath === 'string' && opPath.startsWith(allowedPrefix);
          if (!allowed) {
            const pathStr = opPath ?? `(${op.op})`;
            console.warn(`[execute_changes] Stripped out-of-contract op: ${op.op} ${pathStr} (player action may only write ${allowedPrefix})`);
          }
          return allowed;
        });
        if (llmResponse.stateDelta!.length !== originalCount) {
          console.log(`[execute_changes] Stripped ${originalCount - llmResponse.stateDelta!.length} out-of-contract ops from player action stateDelta`);
        }
      }

      // ── STEP 1: Apply the resolved stateDelta to a candidate state ──
      // For player actions, we apply first so validation can inspect the written currentAction.
      // For automatic transitions, this is the final state (no validation step follows).
      let llmState = canonicalState;
      let llmTouchedPaths = new Set<string>();

      if (llmResponse.stateDelta!.length > 0) {
        // Transform operations from aliases (p1, p2) to UUIDs before applying
        console.debug("[execute_changes] Transforming LLM operations from aliases to UUIDs...");
        const transformedOps = llmResponse.stateDelta!.flatMap((op: StateDeltaOp) =>
          expandAndTransformOperation(op, playerMapping)
        );
        console.debug("[execute_changes] Transformed", llmResponse.stateDelta!.length, "ops to", transformedOps.length, "ops");

        const result = applyStateDeltas(canonicalState, transformedOps);

        if (!result.success) {
          console.error("[execute_changes] Failed to apply LLM state deltas:", result.errors);
          throw new Error(`LLM state delta application failed: ${JSON.stringify(result.errors)}`);
        }

        llmState = result.newState!;
        llmTouchedPaths = result.touchedPaths;
        console.debug(`[execute_changes] LLM touched ${llmTouchedPaths.size} paths`);
      }

      // ── STEP 2: Validate player actions against candidate state ──
      // Checks reference players.{{playerId}}.currentAction.* which has just been written.
      // On failure: rollback to canonicalState, send private message only.
      let validationRejected = false;
      if (state.playerAction) {
        console.log(`[execute_changes] Player action detected, evaluating validation checks`);
        try {
          const parsedInstructions = JSON.parse(sanitizeJsonString(instructions));
          const playerActions = parsedInstructions.playerActions || [];
          console.log(`[execute_changes] Found ${playerActions.length} playerActions in instructions`);

          // Derive the selected action from currentAction.type written into candidate state
          const actingAlias = reverseMap[state.playerAction.playerId] || state.playerAction.playerId;
          const candidateAliasedState = transformStateToAliases(llmState, playerMapping);
          const writtenActionType = (candidateAliasedState.players as any)?.[actingAlias]?.currentAction?.type;

          let selectedAction = writtenActionType
            ? playerActions.find((a: any) => a.id === writtenActionType)
            : undefined;

          if (!selectedAction && playerActions.length > 0) {
            const errorMessage = writtenActionType
              ? `Invalid action id '${writtenActionType}' for phase '${parsedInstructions.phase ?? "unknown"}'.`
              : "Could not determine action type from player input.";
            console.warn(`[execute_changes] ${errorMessage}`);

            const actingPlayerId = state.playerAction.playerId;
            updatedState = structuredClone(canonicalState);
            if (actingPlayerId && updatedState.players[actingPlayerId]) {
              updatedState.players[actingPlayerId].illegalActionCount =
                (updatedState.players[actingPlayerId].illegalActionCount ?? 0) + 1;
              updatedState.players[actingPlayerId].privateMessage = errorMessage;
            }
            llmResponse = { stateDelta: [] };
            validationRejected = true;
          } else if (selectedAction?.validation?.checks?.length > 0) {
            console.log(`[execute_changes] selectedAction: ${selectedAction.id}`);
            console.log(`[execute_changes] Evaluating ${selectedAction.validation.checks.length} validation checks`);

            const validationTemplateVars: Record<string, unknown> = {
              playerId: actingAlias,
            };

            // Validation context is the candidate aliased state (currentAction already written)
            const validationContext = candidateAliasedState;

            for (const check of selectedAction.validation.checks) {
              const resolvedLogic = resolveTemplates(check.logic, validationTemplateVars);
              const { result } = evaluateJsonLogic(resolvedLogic, validationContext);
              console.log(`[execute_changes] Validation check '${check.id}': ${result ? 'PASS' : 'FAIL'}`);
              if (!result) {
                // Validation failed — rollback to canonical state, private message only
                const errorMessage = String(
                  resolveTemplates(
                    check.errorMessage || "Invalid action",
                    validationTemplateVars,
                  )
                );
                console.log(`[execute_changes] Validation check '${check.id}' failed: ${errorMessage}`);

                const actingPlayerId = state.playerAction.playerId;
                updatedState = structuredClone(canonicalState);
                if (actingPlayerId && updatedState.players[actingPlayerId]) {
                  updatedState.players[actingPlayerId].illegalActionCount =
                    (updatedState.players[actingPlayerId].illegalActionCount ?? 0) + 1;
                  updatedState.players[actingPlayerId].privateMessage = errorMessage;
                }
                llmResponse = { stateDelta: [] };
                validationRejected = true;
                break;
              }
            }
          }
        } catch (e) {
          console.warn("[execute_changes] Could not evaluate validation checks:", e);
        }
      }

      // ── STEP 3: Commit candidate state (or keep rollback from validation) ──
      if (!validationRejected) {
        updatedState = llmState;
      }

      if (!validationRejected && deterministicOps.length > 0) {
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
        // Skip overriding paths that LLM explicitly touched to preserve LLM's computed values
        updatedState = mergeDeterministicOverrides(
          llmState,
          deterministicState,
          transformedDeterministicOps,
          llmTouchedPaths
        );
        
        console.log("[execute_changes] Deterministic overrides applied successfully");
      }
    } // end LLM PATH
    
    // Accumulate public messages across chained automatic transitions.
    // Start fresh when a new player action arrives (state.playerAction set) or on initialization.
    // On chained auto-transitions playerAction is already cleared, so we keep appending.
    const isNewTurn = state.playerAction !== undefined || !state.isInitialized;
    const existingMessages: string[] = isNewTurn
      ? []
      : (canonicalState.game.publicMessages ?? []);

    if (llmResponse.publicMessage) {
      let message = llmResponse.publicMessage;

      // Defense-in-depth: Anthropic structured output can bleed XML tool-call syntax into
      // string fields on long outputs. Detect and recover imagePrompt if it leaked into
      // publicMessage (e.g. "</publicMessage>\n<parameter name=\"imagePrompt\">...").
      const xmlLeakMatch = message.match(/<\/publicMessage>\s*<parameter\s+name="imagePrompt">([\s\S]*?)(?:<\/parameter>|$)/i);
      if (xmlLeakMatch) {
        console.warn("[execute_changes] Detected Anthropic XML bleed-through in publicMessage, sanitizing");
        // Strip the leaked XML from the message
        message = message.replace(/<\/publicMessage>[\s\S]*$/i, '').trim();
        // Recover imagePrompt if it wasn't populated in the structured output
        if (!llmResponse.imagePrompt && xmlLeakMatch[1]?.trim()) {
          llmResponse.imagePrompt = xmlLeakMatch[1].trim();
          console.log("[execute_changes] Recovered imagePrompt from XML bleed-through");
        }
      }

      // If an imagePrompt was generated, call the image service and embed URL in the message
      if (llmResponse.imagePrompt) {
        try {
          const { generateImageDirect, GAMEPLAY_IMAGE_CONFIG } = await import(
            "#chaincraft/ai/image-gen/image-gen-service.js"
          );
          const imageUrl = await generateImageDirect(
            { image_prompt: llmResponse.imagePrompt },
            GAMEPLAY_IMAGE_CONFIG
          );
          message += `\n\n![scene](${imageUrl})`;
          console.log("[execute_changes] Generated gameplay image:", imageUrl);
        } catch (error) {
          console.warn("[execute_changes] Image generation failed, continuing without image:", error);
        }
      }

      updatedState.game.publicMessages = [...existingMessages, message];
    } else {
      updatedState.game.publicMessages = existingMessages;
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
    
    // Ensure standard runtime fields exist for all players
    // Initialize isGameWinner to false if not already set (LLM only sets to true for winners)
    for (const playerId in updatedState.players) {
      if (updatedState.players[playerId].isGameWinner === undefined) {
        updatedState.players[playerId].isGameWinner = false;
      }
    }
    
    // Deterministically compute game.winningPlayers from player isGameWinner flags
    // This ensures winningPlayers is always accurate and LLM doesn't need to construct arrays
    const winningPlayerIds = Object.keys(updatedState.players).filter(
      playerId => updatedState.players[playerId].isGameWinner === true
    );
    updatedState.game.winningPlayers = winningPlayerIds;
    
    console.log(`[execute_changes] Phase transition to: ${state.nextPhase}`);
    console.debug("[execute_changes] Updated state sample:", JSON.stringify(updatedState).substring(0, 200));
    
    return {
      gameState: JSON.stringify(updatedState),
      playerAction: undefined, // Clear processed action
      requiresPlayerInput: false, // Will be set by router on next iteration
      transitionReady: false, // Will be set by router on next iteration
      isInitialized: true, // Mark as initialized after any state change
      imagePrompt: llmResponse.imagePrompt,
    };
  };
}
