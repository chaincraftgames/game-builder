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
    validateInstructionsArtifact(instructions, schema);

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
    
    // Validate field references if schema provided
    if (schemaFields) {
      const pathField = op.path || op.fromPath || op.toPath;
      if (pathField && typeof pathField === 'string') {
        // Extract field path without template variables
        const cleanPath = pathField.replace(/\{\{[^}]+\}\}/g, '*');
        // Skip validation if path is fully templated or contains complex expressions
        if (!cleanPath.includes('{{') && cleanPath !== '*') {
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
 * Validate instructions artifact for correctness and completeness
 */
function validateInstructionsArtifact(artifact: InstructionsArtifact, schema?: any): void {
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
