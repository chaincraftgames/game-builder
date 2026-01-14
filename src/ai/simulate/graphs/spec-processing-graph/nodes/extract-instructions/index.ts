/**
 * Extract Instructions Node
 *
 * Two-phase process:
 * 1. Planner: Analyzes spec and identifies WHAT instructions are needed (hints)
 * 2. Executor: Transforms hints into concrete templated instructions
 *
 * Output: InstructionsArtifact with JsonLogic preconditions, StateDelta operations,
 * message templates, and mechanics guidance for runtime execution.
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { SpecProcessingStateType } from "../../spec-processing-state.js";
import { 
  extractSchemaFields, 
  isValidFieldReference, 
  extractFieldReferences 
} from "../../schema-utils.js";
import {
  planInstructionsTemplate,
  executeInstructionsTemplate,
} from "./prompts.js";
import {
  InstructionsArtifact,
  InstructionsArtifactSchema,
  InstructionsArtifactSchemaJson,
} from "#chaincraft/ai/simulate/schema.js";
import {
  InstructionsPlanningResponse,
  InstructionsPlanningResponseSchema,
  InstructionsPlanningResponseSchemaJson,
} from "./schema.js";

export function extractInstructions(model: ModelWithOptions) {
  return async (
    state: SpecProcessingStateType
  ): Promise<Partial<SpecProcessingStateType>> => {
    console.debug(
      "[extract_instructions] Extracting runtime instructions from specification"
    );

    // ========================================================================
    // PHASE 1: PLANNER - Identify what instructions are needed
    // ========================================================================
    
    console.debug("[extract_instructions] Running planner to identify instruction requirements...");
    
    // Parse transitions to extract phase names and transition IDs for explicit injection
    const transitionsArtifact = typeof state.stateTransitions === 'string' 
      ? JSON.parse(state.stateTransitions) 
      : state.stateTransitions ?? {};
    const phaseNames = transitionsArtifact.phases || [];
    const transitionIds = (transitionsArtifact.transitions || []).map((t: any) => ({
      id: t.id,
      fromPhase: t.fromPhase,
      toPhase: t.toPhase
    }));
    
    console.debug(`[extract_instructions] Extracted ${phaseNames.length} phase names: ${phaseNames.join(', ')}`);
    console.debug(`[extract_instructions] Extracted ${transitionIds.length} transition IDs`);
    
    // Format narrative markers section
    const narrativeMarkers = Object.keys(state.specNarratives || {});
    const narrativeMarkersSection = narrativeMarkers.length > 0
      ? `The following narrative markers are available for reference in instruction guidance:

${narrativeMarkers.map(m => `- !___ NARRATIVE:${m} ___!`).join('\n')}

These markers will be expanded at runtime to provide full narrative guidance to the LLM.`
      : "No narrative markers available for this game (purely mechanical game).";
    
    const plannerPrompt = SystemMessagePromptTemplate.fromTemplate(
      planInstructionsTemplate
    );

    const plannerSystemMessage = await plannerPrompt.format({
      gameSpecification: String(state.gameSpecification ?? ""),
      transitionsArtifact: String(state.stateTransitions ?? "{}"),
      phaseNamesList: phaseNames.map((p: string, i: number) => `${i + 1}. "${p}"`).join('\n'),
      transitionIdsList: transitionIds.map((t: any, i: number) => 
        `${i + 1}. id="${t.id}" (${t.fromPhase} → ${t.toPhase})`
      ).join('\n'),
      stateSchema: String(state.stateSchema ?? ""),
      planningSchemaJson: JSON.stringify(InstructionsPlanningResponseSchemaJson, null, 2),
      narrativeMarkersSection,
      validationFeedback: "", // Empty on first run, would contain errors on retry
    });

    const plannerResponse = await model.invokeWithSystemPrompt(
      plannerSystemMessage.content as string,
      undefined,
      {
        agent: "extract-instructions-planner",
        workflow: "spec-processing",
      }
    );

    // Extract and parse planner output
    let plannerHints: InstructionsPlanningResponse;
    
    try {
      const content = (plannerResponse as any).content as string;
      
      // Remove markdown code fences if present
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.substring(7);
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.substring(3);
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.substring(0, jsonStr.length - 3);
      }
      jsonStr = jsonStr.trim();
      
      // Parse and validate
      const parsedJson = JSON.parse(jsonStr);
      plannerHints = InstructionsPlanningResponseSchema.parse(parsedJson);
      
      console.debug(
        `[extract_instructions] Planner identified ${plannerHints.playerPhases.length} player phases, ${plannerHints.transitions.length} transitions`
      );
      
    } catch (error) {
      console.error("[extract_instructions] Failed to parse planner output:", error);
      throw new Error(`Planner output validation failed: ${error}`);
    }

    // Validate planner output
    validatePlannerOutput(plannerHints);

    // ========================================================================
    // PHASE 2: EXECUTOR - Generate concrete templated instructions
    // ========================================================================
    
    console.debug("[extract_instructions] Running executor to generate concrete instructions...");
    
    // Extract phase names and transition IDs from planner hints for explicit injection
    const plannerPhaseNames = plannerHints.playerPhases.map(pi => pi.phase);
    const plannerTransitionIds = plannerHints.transitions.map(t => ({ 
      id: t.id, 
      basedOnTransition: t.trigger.basedOnTransition 
    }));
    
    const executorPrompt = SystemMessagePromptTemplate.fromTemplate(
      executeInstructionsTemplate
    );

    const executorSystemMessage = await executorPrompt.format({
      phaseNamesList: plannerPhaseNames.map((p: string, i: number) => `${i + 1}. "${p}"`).join('\n'),
      transitionIdsList: plannerTransitionIds.map((t: any, i: number) => 
        `${i + 1}. id="${t.id}"`
      ).join('\n'),
      stateSchema: String(state.stateSchema ?? ""),
      plannerHints: JSON.stringify(plannerHints, null, 2),
      executorSchemaJson: JSON.stringify(InstructionsArtifactSchemaJson, null, 2),
      narrativeMarkersSection,
      gameSpecificationSummary: `Game: ${(state.gameSpecification as any)?.summary || 'Untitled Game'}\nPlayer Count: ${(state.gameSpecification as any)?.playerCount?.min || '?'}-${(state.gameSpecification as any)?.playerCount?.max || '?'}`,
      validationFeedback: "", // Empty on first run, would contain errors on retry
    });

    const executorResponse = await model.invokeWithSystemPrompt(
      executorSystemMessage.content as string,
      undefined,
      {
        agent: "extract-instructions-executor",
        workflow: "spec-processing",
      },
      InstructionsArtifactSchema
    );

    // Parse and validate executor output
    let instructions: InstructionsArtifact;
    
    try {
      instructions = InstructionsArtifactSchema.parse(executorResponse);
      
      console.debug(
        `[extract_instructions] Executor generated instructions for ${Object.keys(instructions.playerPhases).length} player phases, ` +
        `${Object.keys(instructions.transitions).length} transitions`
      );
      console.debug(
        `[extract_instructions] Metadata: ${instructions.metadata.totalPlayerPhases} player phases, ` +
        `${instructions.metadata.totalTransitions} transitions`
      );
      
    } catch (error) {
      console.error("[extract_instructions] Failed to validate executor output:", error);
      throw new Error(`Executor output validation failed: ${error}`);
    }

    // Validate executor output with schema field validation
    const schema = typeof state.stateSchema === 'string'
      ? JSON.parse(state.stateSchema)
      : state.stateSchema;
    validateInstructionsArtifact(instructions, state, schema, state.specNarratives);

    // ========================================================================
    // POST-PROCESS: Resolve positional player templates
    // ========================================================================
    
    // Replace templates like {{p1id}}, {{player1id}} with concrete aliases player1, player2, etc.
    // This makes initialization deterministic and ensures consistency with player mapping
    instructions = resolvePositionalPlayerTemplates(instructions);

    // ========================================================================
    // RETURN RESULTS
    // ========================================================================
    
    const instructionsJson = JSON.stringify(instructions, null, 2);
    
    console.debug(
      `[extract_instructions] Instructions artifact generated successfully (${instructionsJson.length} characters)`
    );

    // Build separated instruction maps
    const playerPhaseInstructionsMap: Record<string, string> = {};
    const transitionInstructionsMap: Record<string, string> = {};
    
    // Add player phase instructions (keyed by phase name)
    for (const [phaseName, phaseInstructions] of Object.entries(instructions.playerPhases)) {
      playerPhaseInstructionsMap[phaseName] = JSON.stringify(phaseInstructions, null, 2);
    }
    
    // Add transition instructions (keyed by transition ID)
    for (const [transitionId, transitionInstructions] of Object.entries(instructions.transitions)) {
      transitionInstructionsMap[transitionId] = JSON.stringify(transitionInstructions, null, 2);
    }
    
    console.debug(
      `[extract_instructions] Built instruction maps: ${Object.keys(instructions.playerPhases).length} player phases, ` +
      `${Object.keys(instructions.transitions).length} transitions`
    );

    return {
      playerPhaseInstructions: playerPhaseInstructionsMap,
      transitionInstructions: transitionInstructionsMap,
    };
  };
}

/**
 * Validate planner output for completeness and consistency
 */
function validatePlannerOutput(hints: InstructionsPlanningResponse): void {
  const errors: string[] = [];

  // Check coverage
  if (!hints.playerPhases && !hints.transitions) {
    errors.push("No instructions provided by planner");
  }

  if (hints.playerPhases && hints.playerPhases.length === 0 && hints.transitions && hints.transitions.length === 0) {
    errors.push("Planner provided empty arrays for both playerPhases and transitions");
  }

  // Validate each player phase instruction
  for (const phaseInst of hints.playerPhases || []) {
    // Player phases should have player actions
    if (phaseInst.playerActions.length === 0) {
      console.warn(
        `[extract_instructions][planner-validation] Player phase '${phaseInst.phase}' has no player actions`
      );
    }
  }

  // Validate each transition instruction
  for (const transition of hints.transitions || []) {
    // Check that transitions requiring LLM reasoning have mechanics descriptions
    if (
      transition.computationNeeded?.requiresLLMReasoning &&
      !transition.mechanicsDescription
    ) {
      console.warn(
        `[extract_instructions][planner-validation] Transition '${transition.id}' requires LLM reasoning but has no mechanics description`
      );
    }
  }

  if (errors.length > 0) {
    console.error(
      "[extract_instructions][planner-validation] Planner output validation failed:",
      errors
    );
    throw new Error(`Planner validation failed: ${errors.join("; ")}`);
  }
}

/**
 * Validate that narrative markers referenced in instructions exist in specNarratives
 */
function validateNarrativeMarkers(
  artifact: InstructionsArtifact,
  specNarratives: Record<string, string> | undefined
): string[] {
  const errors: string[] = [];
  const narrativeMarkerPattern = /!___ NARRATIVE:(\w+) ___!/g;
  const availableMarkers = new Set(Object.keys(specNarratives || {}));
  const referencedMarkers = new Set<string>();

  // Extract all narrative markers from the artifact
  const artifactStr = JSON.stringify(artifact);
  let match;
  while ((match = narrativeMarkerPattern.exec(artifactStr)) !== null) {
    referencedMarkers.add(match[1]);
  }

  // Check each referenced marker exists in specNarratives
  for (const marker of referencedMarkers) {
    if (!availableMarkers.has(marker)) {
      errors.push(
        `Narrative marker '${marker}' referenced but not found in specNarratives. ` +
        `Available markers: ${Array.from(availableMarkers).join(', ') || 'none'}`
      );
    }
  }

  return errors;
}

/**
 * Validate stateDelta operations for correctness
 */
function validateStateDelta(
  stateDelta: any[],
  context: string,
  errors: string[],
  warnings: string[],
  schemaFields?: Set<string>
): void {
  const validOps = ['set', 'increment', 'append', 'delete', 'transfer', 'merge', 'rng'];
  
  for (let i = 0; i < stateDelta.length; i++) {
    const op = stateDelta[i];
    
    if (!op.op) {
      errors.push(`${context}: stateDelta[${i}] missing 'op' field`);
      continue;
    }
    
    if (!validOps.includes(op.op)) {
      errors.push(`${context}: stateDelta[${i}] has invalid op '${op.op}'. Valid ops: ${validOps.join(', ')}`);
      continue;
    }
    
    // Validate required fields per operation type
    switch (op.op) {
      case 'set':
      case 'increment':
      case 'append':
      case 'merge':
        if (!op.path) {
          errors.push(`${context}: stateDelta[${i}] op 'set' missing 'path' field`);
        }
        if (op.value === undefined) {
          errors.push(`${context}: stateDelta[${i}] op '${op.op}' missing 'value' field`);
        }
        break;
        
      case 'delete':
        if (!op.path) {
          errors.push(`${context}: stateDelta[${i}] op 'delete' missing 'path' field`);
        }
        break;
        
      case 'transfer':
        if (!op.fromPath) {
          errors.push(`${context}: stateDelta[${i}] op 'transfer' missing 'fromPath' field`);
        }
        if (!op.toPath) {
          errors.push(`${context}: stateDelta[${i}] op 'transfer' missing 'toPath' field`);
        }
        if (op.amount === undefined) {
          errors.push(`${context}: stateDelta[${i}] op 'transfer' missing 'amount' field`);
        }
        break;
        
      case 'rng':
        if (!op.path) {
          errors.push(`${context}: stateDelta[${i}] op 'rng' missing 'path' field`);
        }
        if (!op.choices || !Array.isArray(op.choices) || op.choices.length === 0) {
          errors.push(`${context}: stateDelta[${i}] op 'rng' missing or invalid 'choices' array`);
        }
        if (!op.probabilities || !Array.isArray(op.probabilities)) {
          errors.push(`${context}: stateDelta[${i}] op 'rng' missing or invalid 'probabilities' array`);
        } else if (op.choices && op.probabilities.length !== op.choices.length) {
          errors.push(`${context}: stateDelta[${i}] op 'rng' probabilities length (${op.probabilities.length}) must match choices length (${op.choices.length})`);
        } else {
          // Validate probabilities sum to ~1.0
          const sum = op.probabilities.reduce((acc: number, p: number) => acc + p, 0);
          if (Math.abs(sum - 1.0) > 0.01) {
            warnings.push(`${context}: stateDelta[${i}] op 'rng' probabilities sum to ${sum}, not 1.0`);
          }
        }
        break;
    }
    
    // Validate that array values don't contain template variables (they won't be expanded)
    if ((op.op === 'set' || op.op === 'append') && op.value !== undefined) {
      if (Array.isArray(op.value)) {
        const hasTemplates = JSON.stringify(op.value).includes('{{');
        if (hasTemplates) {
          errors.push(
            `${context}: stateDelta[${i}] op '${op.op}' has array value containing template variables. ` +
            `Template variables in arrays are not expanded. ` +
            `Use bracket notation to set array elements individually: ` +
            `Instead of {"op": "set", "path": "array", "value": ["{{var1}}", "{{var2}}"]}, ` +
            `use {"op": "set", "path": "array[0]", "value": "{{var1}}"} and {"op": "set", "path": "array[1]", "value": "{{var2}}"}`
          );
        }
      } else if (typeof op.value === 'object' && op.value !== null) {
        // Also check nested arrays in objects
        const checkForTemplatesInArrays = (obj: any, path: string = ''): void => {
          for (const [key, val] of Object.entries(obj)) {
            const fullPath = path ? `${path}.${key}` : key;
            if (Array.isArray(val) && JSON.stringify(val).includes('{{')) {
              errors.push(
                `${context}: stateDelta[${i}] op '${op.op}' has nested array at '${fullPath}' containing template variables. ` +
                `Template variables in arrays are not expanded.`
              );
            } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
              checkForTemplatesInArrays(val, fullPath);
            }
          }
        };
        checkForTemplatesInArrays(op.value);
      }
    }
    
    // Validate field references if schema provided
    if (schemaFields) {
      const pathField = op.path || op.fromPath || op.toPath;
      if (pathField && typeof pathField === 'string') {
        // Extract field path without template variables
        // Handle both dot and bracket notation:
        //   players.{{playerId}}.score → players[*].score
        //   players[{{playerId}}].score → players[*].score
        let cleanPath = pathField
          .replace(/\[\{\{[^}]+\}\}\]/g, '[*]')      // Handle bracket notation first: [{{x}}] → [*]
          .replace(/\.?\{\{[^}]+\}\}\.?/g, '[*].')   // Then handle dot notation: .{{x}}. → [*].
          .replace(/\.\[/g, '[')                      // Fix players.[*] → players[*]
          .replace(/\.\./g, '.')                      // Fix double dots
          .replace(/\.\s*$/, '');                     // Remove trailing dot
        
        // Skip validation if path is fully templated or contains complex expressions
        if (!cleanPath.includes('{{') && cleanPath !== '[*]') {
          if (!isValidFieldReference(cleanPath, schemaFields)) {
            warnings.push(
              `${context}: stateDelta[${i}] references unknown field: ${pathField}`
            );
          }
        }
      }
    }
  }
}

/**
 * Validate that the init transition initializes all fields required by transition preconditions.
 * 
 * Every field referenced in any transition precondition MUST be initialized by the init transition,
 * EXCEPT for router context fields which are computed at runtime.
 * This ensures preconditions can be evaluated without undefined values and prevents runtime deadlocks.
 */
function validateInitializationCompleteness(
  artifact: InstructionsArtifact,
  state: SpecProcessingStateType
): string[] {
  const errors: string[] = [];

  // Fields computed by the router at runtime, not stored in game state
  const ROUTER_CONTEXT_FIELDS = new Set([
    'allPlayersCompletedActions',
    'playersCount',
    'playerCount',
    'allPlayersReady',
    'anyPlayerReady',
  ]);

  // Parse transitions to get preconditions
  let transitions: any;
  try {
    transitions = typeof state.stateTransitions === 'string'
      ? JSON.parse(state.stateTransitions)
      : state.stateTransitions;
  } catch (e) {
    // If transitions can't be parsed, skip this validation
    return [];
  }

  const transitionList = transitions.transitions || [];

  // 1. Collect all fields referenced in preconditions
  const preconditionFields = new Set<string>();
  transitionList.forEach((t: any) => {
    if (!t.preconditions || !Array.isArray(t.preconditions)) return;

    t.preconditions.forEach((p: any) => {
      if (!p.logic) return;
      const fields = extractFieldReferences(p.logic);
      fields.forEach((f: string) => {
        // Strip .length suffix since it's automatic on arrays - only validate the base array exists
        const baseField = f.endsWith('.length') ? f.slice(0, -7) : f;
        preconditionFields.add(baseField);
      });
    });
  });

  // If no fields are used in preconditions, nothing to validate
  if (preconditionFields.size === 0) return [];

  // 2. Find the init transition
  const initTransition = transitionList.find((t: any) => t.fromPhase === 'init');
  if (!initTransition) {
    return []; // Should be caught by other validations
  }

  // 3. Get the init transition's instructions from artifact
  const initInstructions = artifact.transitions[initTransition.id];
  if (!initInstructions) {
    return [`Init transition "${initTransition.id}" has no instructions in artifact`];
  }

  // 4. Extract fields set by init's stateDelta
  const initializedFields = new Set<string>();
  if (initInstructions.stateDelta && Array.isArray(initInstructions.stateDelta)) {
    initInstructions.stateDelta.forEach((op: any) => {
      if (op.path && typeof op.path === 'string') {
        // Normalize to bracket-wildcard format to match precondition field extraction
        // players.{{playerId}}.score -> players[*].score
        // players.{{player1Id}}.score -> players[*].score
        // players.player1.score -> players[*].score
        let normalizedPath = op.path
          .replace(/\.\{\{[^}]+\}\}\./g, '[*].')     // .{{playerId}}. -> [*].
          .replace(/\.player\d+\./g, '[*].')         // .player1. -> [*].
          .replace(/players\.\*/g, 'players[*]');    // players.* -> players[*]

        initializedFields.add(op.path);  // Add original path
        initializedFields.add(normalizedPath);  // Add normalized path

        // Also add base array path if this is an array index initialization
        // e.g., game.deadlyChoiceIndexPerTurn[0] -> game.deadlyChoiceIndexPerTurn
        const baseArrayPath = op.path.replace(/\[\d+\]$/, '');
        if (baseArrayPath !== op.path) {
          initializedFields.add(baseArrayPath);
          // Normalize the base array path too
          const normalizedBaseArrayPath = baseArrayPath
            .replace(/\.\{\{[^}]+\}\}\./g, '[*].')
            .replace(/\.player\d+\./g, '[*].')
            .replace(/players\.\*/g, 'players[*]');
          initializedFields.add(normalizedBaseArrayPath);
        }
      }
    });
  }

  // 5. Check that all precondition fields are initialized (excluding router context fields)
  const uninitializedFields: string[] = [];
  preconditionFields.forEach((field: string) => {
    // Skip router context fields - they're computed at runtime
    if (ROUTER_CONTEXT_FIELDS.has(field)) return;
    
    if (initializedFields.has(field)) return;

    // Check if a wildcard version is initialized (e.g., players.* covers players[0])
    const normalizedField = field.replace(/\[\d+\]/g, '.*').replace(/\.\d+\./g, '.*.');
    if (initializedFields.has(normalizedField)) return;

    uninitializedFields.push(field);
  });

  // Report uninitialized fields as errors
  uninitializedFields.forEach((field: string) => {
    errors.push(
      `Field "${field}" is used in transition preconditions but is never initialized by the init transition "${initTransition.id}". ` +
      `This will cause transitions to fail at runtime when comparing undefined values. ` +
      `Add a stateDelta operation in the init transition to set ${field} to an appropriate initial value.`
    );
  });

  return errors;
}

/**
 * Validate that the initial state satisfies preconditions for transitions from the starting phase.
 * This catches deadlocks where init sets values that prevent any transition from firing.
 * 
 * @param artifact - Instructions artifact with transitions
 * @param state - Processing state with stateTransitions
 * @returns Array of error messages (empty if valid)
 */
function validateInitialStatePreconditions(
  artifact: InstructionsArtifact,
  state: SpecProcessingStateType
): string[] {
  console.debug('[extract_instructions][validation] Validating initial state preconditions');
  const errors: string[] = [];

  // 1. Parse transitions
  let transitions: any;
  try {
    transitions = typeof state.stateTransitions === 'string'
      ? JSON.parse(state.stateTransitions)
      : state.stateTransitions;
  } catch (e) {
    return ['Cannot parse stateTransitions to validate initial state preconditions'];
  }

  if (!transitions.transitions || !Array.isArray(transitions.transitions)) {
    return []; // Should be caught by other validations
  }

  // 2. Find init transition and its target phase
  const initTransition = transitions.transitions.find((t: any) => t.fromPhase === 'init');
  if (!initTransition) {
    return []; // Should be caught by other validations
  }

  const startingPhase = initTransition.toPhase;
  if (!startingPhase) {
    return ['Init transition has no toPhase'];
  }

  // 3. Get init instructions
  const initInstructions = artifact.transitions[initTransition.id];
  if (!initInstructions) {
    return []; // Should be caught by other validations
  }

  // 4. Build mock initial state by applying init's stateDelta
  const mockState: any = {
    game: {},
    players: {}
  };

  if (initInstructions.stateDelta && Array.isArray(initInstructions.stateDelta)) {
    initInstructions.stateDelta.forEach((op: any) => {
      if (!op.path || typeof op.path !== 'string') return;

      // Skip RNG operations - we don't know the exact value but we know it will be set
      if (op.op === 'rng') {
        // Set a placeholder value of the appropriate type based on choices
        const path = op.path;
        const parts = path.split('.');
        let current = mockState;
        
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (!current[part]) {
            current[part] = {};
          }
          current = current[part];
        }
        
        const lastPart = parts[parts.length - 1];
        // Set to first choice value (or 0 for numbers, 'string' for strings, true for boolean)
        if (op.choices && Array.isArray(op.choices) && op.choices.length > 0) {
          current[lastPart] = op.choices[0];
        } else {
          current[lastPart] = null; // Unknown type
        }
        return;
      }

      // Handle set operations
      if (op.op === 'set') {
        const path = op.path;
        const value = op.value;
        
        // Parse path and set value
        const parts = path.split('.');
        let current = mockState;
        
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          // Handle both object keys and array indices
          const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
          if (arrayMatch) {
            const arrayName = arrayMatch[1];
            const index = parseInt(arrayMatch[2], 10);
            if (!current[arrayName]) {
              current[arrayName] = [];
            }
            if (!current[arrayName][index]) {
              current[arrayName][index] = {};
            }
            current = current[arrayName][index];
          } else {
            if (!current[part]) {
              current[part] = {};
            }
            current = current[part];
          }
        }
        
        const lastPart = parts[parts.length - 1];
        const arrayMatch = lastPart.match(/^(.+)\[(\d+)\]$/);
        if (arrayMatch) {
          const arrayName = arrayMatch[1];
          const index = parseInt(arrayMatch[2], 10);
          if (!current[arrayName]) {
            current[arrayName] = [];
          }
          current[arrayName][index] = value;
        } else {
          current[lastPart] = value;
        }
      }
    });
  }

  // 5. Find all transitions from the starting phase
  const startingTransitions = transitions.transitions.filter(
    (t: any) => t.fromPhase === startingPhase
  );

  if (startingTransitions.length === 0) {
    errors.push(
      `Init transition moves to phase "${startingPhase}" but there are no transitions from that phase. ` +
      `This creates an immediate deadlock.`
    );
    return errors;
  }

  // 6. Check if any transition's preconditions can be satisfied
  // For simplicity, we'll check for deterministic boolean fields that have explicit false values
  // preventing transitions from firing
  const canFireTransitions = startingTransitions.filter((t: any) => {
    if (!t.preconditions || !Array.isArray(t.preconditions)) {
      return true; // No preconditions means it can fire
    }

    // Check for simple blocking conditions: boolean fields set to wrong value
    const blockingConditions = t.preconditions.filter((p: any) => {
      if (!p.logic) return false;

      // Check for allPlayers/anyPlayer patterns on boolean fields
      // Pattern: {"allPlayers": ["fieldName", "==", true]}
      if (p.logic.allPlayers && Array.isArray(p.logic.allPlayers) && p.logic.allPlayers.length === 3) {
        const [field, op, expectedValue] = p.logic.allPlayers;
        
        if (typeof expectedValue === 'boolean' && (op === '==' || op === '===')) {
          // Check if any player has this field set to the opposite value
          const players = Object.values(mockState.players || {});
          if (players.length > 0) {
            const allMatch = players.every((player: any) => player[field] === expectedValue);
            if (!allMatch) {
              return true; // Blocking condition found
            }
          }
        }
      }

      if (p.logic.anyPlayer && Array.isArray(p.logic.anyPlayer) && p.logic.anyPlayer.length === 3) {
        const [field, op, expectedValue] = p.logic.anyPlayer;
        
        if (typeof expectedValue === 'boolean' && (op === '==' || op === '===')) {
          // Check if no player has this field set to the expected value
          const players = Object.values(mockState.players || {});
          if (players.length > 0) {
            const anyMatch = players.some((player: any) => player[field] === expectedValue);
            if (!anyMatch) {
              return true; // Blocking condition found
            }
          }
        }
      }

      return false;
    });

    // If any blocking condition found, this transition cannot fire
    return blockingConditions.length === 0;
  });

  if (canFireTransitions.length === 0) {
    // Build helpful error message
    const phaseMetadata = transitions.phaseMetadata?.find((pm: any) => pm.phase === startingPhase);
    const requiresPlayerInput = phaseMetadata?.requiresPlayerInput ?? false;

    console.error('[extract_instructions][validation] Deadlock detected in initial state!');
    console.error(`[extract_instructions][validation] Starting phase: ${startingPhase}, requiresPlayerInput: ${requiresPlayerInput}`);
    console.error(`[extract_instructions][validation] Mock state:`, JSON.stringify(mockState, null, 2));

    errors.push(
      `Init transition creates immediate deadlock. After initialization, game moves to phase "${startingPhase}" ` +
      `but none of the ${startingTransitions.length} transition(s) from that phase can fire. ` +
      `Phase requires player input: ${requiresPlayerInput}. ` +
      `Common issue: init sets boolean fields (like actionRequired) to values that block all transitions. ` +
      `Review init transition stateDelta and starting transitions' preconditions to ensure compatibility.`
    );

    // Add details about each transition's blocking conditions
    startingTransitions.forEach((t: any) => {
      if (!t.preconditions || t.preconditions.length === 0) return;
      
      const issues: string[] = [];
      t.preconditions.forEach((p: any) => {
        if (p.logic?.allPlayers && Array.isArray(p.logic.allPlayers) && p.logic.allPlayers.length === 3) {
          const [field, op, expectedValue] = p.logic.allPlayers;
          if (typeof expectedValue === 'boolean') {
            const players = Object.values(mockState.players || {});
            if (players.length > 0) {
              const actualValues = players.map((player: any) => player[field]);
              const allMatch = players.every((player: any) => player[field] === expectedValue);
              if (!allMatch) {
                issues.push(
                  `Precondition "${p.id}" requires all players have ${field}=${expectedValue}, ` +
                  `but init sets it to ${JSON.stringify(actualValues)}`
                );
              }
            }
          }
        }
      });

      if (issues.length > 0) {
        errors.push(`  Transition "${t.id}" (${t.fromPhase} → ${t.toPhase}): ${issues.join('; ')}`);
      }
    });
  }

  return errors;
}

/**
 * Validate instructions artifact for correctness and completeness
 */
function validateInstructionsArtifact(
  artifact: InstructionsArtifact,
  state: SpecProcessingStateType,
  schema?: any,
  specNarratives?: Record<string, string>
): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Extract schema fields for validation if schema provided and in correct format
  // Schema should be a JSON Schema object with type: "object" and properties
  let schemaFields: Set<string> | undefined;
  if (schema && schema.type === 'object' && schema.properties) {
    schemaFields = extractSchemaFields(schema);
  } else if (schema) {
    console.debug(
      '[extract_instructions][validation] Schema format not recognized for field validation (expected JSON Schema with type="object" and properties). Skipping field validation.'
    );
  }

  // Check coverage
  if (!artifact.playerPhases && !artifact.transitions) {
    errors.push("No instructions in artifact");
  }

  const playerPhaseCount = Object.keys(artifact.playerPhases || {}).length;
  const transitionCount = Object.keys(artifact.transitions || {}).length;

  if (playerPhaseCount === 0 && transitionCount === 0) {
    errors.push("Artifact has empty playerPhases and transitions");
  }

  // Validate each player phase instruction
  for (const [phaseName, phaseInst] of Object.entries(artifact.playerPhases || {})) {
    // Validate player actions
    for (const action of phaseInst.playerActions || []) {
      // Check that actions with validation have properly structured checks
      if (action.validation) {
        if (!action.validation.checks || action.validation.checks.length === 0) {
          warnings.push(
            `Action '${action.id}' has validation config but no checks array`
          );
        }
        
        // Check that each check has required fields
        for (const check of action.validation.checks || []) {
          if (!check.id) {
            errors.push(`Action '${action.id}' has validation check without id`);
          }
          if (!check.errorMessage) {
            errors.push(
              `Action '${action.id}' validation check '${check.id}' has no errorMessage`
            );
          }
        }
      }

      // Check that actions have stateDelta operations
      if (!action.stateDelta || action.stateDelta.length === 0) {
        warnings.push(`Action '${action.id}' has no stateDelta operations`);
      } else {
        // Validate stateDelta operations
        validateStateDelta(action.stateDelta, `Action '${action.id}'`, errors, warnings, schemaFields);
      }
    }

  }

  // Validate transition instructions
  for (const [transitionId, transition] of Object.entries(artifact.transitions || {})) {
    // Router handles transition selection based on preconditions in stateTransitions
    // Instructions only need stateDelta operations
    
    // Check that transitions have stateDelta operations
    if (!transition.stateDelta || transition.stateDelta.length === 0) {
      warnings.push(`Transition '${transition.id}' has no stateDelta operations`);
    } else {
      // Validate stateDelta operations
      validateStateDelta(transition.stateDelta, `Transition '${transition.id}'`, errors, warnings, schemaFields);
    }

    // Check that transitions with mechanics guidance have properly formatted rules
    if (transition.mechanicsGuidance) {
      if (!transition.mechanicsGuidance.rules || transition.mechanicsGuidance.rules.length === 0) {
        warnings.push(
          `Transition '${transition.id}' has mechanicsGuidance but no rules array`
        );
      }
    }
  }

  // Validate metadata matches actual counts
  const totalPlayerActions = Object.values(artifact.playerPhases || {}).reduce(
    (sum, phase) => sum + phase.playerActions.length,
    0
  );
  const totalTransitions = Object.keys(artifact.transitions || {}).length;

  if (artifact.metadata.totalPlayerPhases !== playerPhaseCount) {
    warnings.push(
      `Metadata totalPlayerPhases (${artifact.metadata.totalPlayerPhases}) ` +
      `doesn't match actual count (${playerPhaseCount})`
    );
  }

  if (artifact.metadata.totalTransitions !== totalTransitions) {
    warnings.push(
      `Metadata totalTransitions (${artifact.metadata.totalTransitions}) ` +
      `doesn't match actual count (${totalTransitions})`
    );
  }

  // Validate narrative markers
  const narrativeErrors = validateNarrativeMarkers(artifact, specNarratives);
  if (narrativeErrors.length > 0) {
    errors.push(...narrativeErrors);
  }

  // Validate initialization completeness
  const initializationErrors = validateInitializationCompleteness(artifact, state);
  if (initializationErrors.length > 0) {
    errors.push(...initializationErrors);
  }

  // Validate initial state satisfies starting phase preconditions
  const initialStatePreconditionErrors = validateInitialStatePreconditions(artifact, state);
  if (initialStatePreconditionErrors.length > 0) {
    errors.push(...initialStatePreconditionErrors);
  }

  // Log warnings
  if (warnings.length > 0) {
    console.warn(
      "[extract_instructions][artifact-validation] Validation warnings:",
      warnings
    );
  }

  // Throw if critical errors found
  if (errors.length > 0) {
    console.error(
      "[extract_instructions][artifact-validation] Validation failed:",
      errors
    );
    throw new Error(`Instructions artifact validation failed: ${errors.join("; ")}`);
  }
}

/**
 * Resolve positional player templates to concrete aliases.
 * 
 * Replaces two patterns with concrete player aliases (player1, player2, etc.):
 * 1. Template variables: {{p1id}}, {{player1id}}, {{p2Id}}, etc.
 * 2. Direct path references: players.p1.field, players.p2.field, etc.
 * 
 * This makes initialization deterministic and ensures the game state uses
 * the same player keys (player1, player2) as the player mapping.
 * 
 * Patterns matched (case-insensitive):
 * - {{p1id}}, {{p2id}}, {{p3id}}, ... → player1, player2, player3, ...
 * - {{player1id}}, {{player2id}}, ... → player1, player2, player3, ...
 * - players.p1.field → players.player1.field
 * - players.p2.field → players.player2.field
 * 
 * @param artifact - Instructions artifact to process
 * @returns Artifact with resolved player templates
 */
function resolvePositionalPlayerTemplates(
  artifact: InstructionsArtifact
): InstructionsArtifact {
  // Regex to match {{p<N>id}} or {{player<N>id}} (case-insensitive)
  // Captures the number in group 1
  const templatePattern = /\{\{(?:p|player)(\d+)id\}\}/gi;
  
  // Regex to match players.p<N>. in paths
  // Captures the number in group 1
  const pathPattern = /\bplayers\.p(\d+)\./g;
  
  const resolver = (str: string): string => {
    // First resolve template variables: {{p1id}} → player1
    let result = str.replace(templatePattern, (match, numberStr) => {
      const number = parseInt(numberStr, 10);
      return `player${number}`;
    });
    
    // Then resolve direct path references: players.p1. → players.player1.
    result = result.replace(pathPattern, (match, numberStr) => {
      const number = parseInt(numberStr, 10);
      return `players.player${number}.`;
    });
    
    return result;
  };
  
  const resolveInObject = (obj: any): any => {
    if (typeof obj === 'string') {
      return resolver(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map(resolveInObject);
    }
    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = resolveInObject(value);
      }
      return result;
    }
    return obj;
  };
  
  return resolveInObject(artifact);
}
