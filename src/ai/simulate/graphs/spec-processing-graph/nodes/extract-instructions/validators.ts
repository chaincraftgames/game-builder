/**
 * Instructions Validators
 * 
 * Validation functions for planner and executor outputs
 */

import { BaseStore } from "@langchain/langgraph";
import { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { getFromStore } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";
import {
  InstructionsPlanningResponseSchema,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/schema.js";
import {
  InstructionsArtifact,
  InstructionsArtifactSchema,
  TransitionsArtifact,
} from "#chaincraft/ai/simulate/schema.js";
import { 
  extractSchemaFields, 
  isValidFieldReference, 
  extractFieldReferences 
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/schema-utils.js";
import { getOrBuildGraph } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/transition-graph.js";

/**
 * Validate planner output for completeness
 */
export async function validatePlanCompleteness(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];
  
  const plannerOutput = await getFromStore(
    store,
    ["instructions", "plan", "output"],
    threadId
  );

  if (!plannerOutput || typeof plannerOutput !== 'string') {
    return ["Planner output is missing or invalid"];
  }

  // Parse and validate structure
  try {
    let jsonStr = plannerOutput.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.substring(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.substring(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.substring(0, jsonStr.length - 3);
    }
    jsonStr = jsonStr.trim();
    
    const parsedJson = JSON.parse(jsonStr);
    const hints = InstructionsPlanningResponseSchema.parse(parsedJson);

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
          `[instructions][planner-validation] Player phase '${phaseInst.phase}' has no player actions`
        );
      }
    }

    // Validate each transition instruction
    for (const transition of hints.transitions || []) {
      // Check that transitions requiring LLM reasoning have mechanics descriptions
      if (
        transition.requiresLLMReasoning &&
        !transition.mechanicsDescription
      ) {
        console.warn(
          `[instructions][planner-validation] Transition '${transition.id}' requires LLM reasoning but has no mechanics description`
        );
      }
    }
  } catch (error) {
    errors.push(`Planner output parsing/validation failed: ${error}`);
  }

  return errors;
}

/**
 * Validate executor output is parseable JSON
 */
export async function validateJsonParseable(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];

  const executionOutput = await getFromStore(
    store,
    ["instructions", "execution", "output"],
    threadId
  );

  if (!executionOutput) {
    return ["Execution output is missing"];
  }

  try {
    const parsed = typeof executionOutput === 'string' 
      ? JSON.parse(executionOutput)
      : executionOutput;
    
    // Try to parse with schema
    InstructionsArtifactSchema.parse(parsed);
  } catch (error) {
    errors.push(`Execution output is not valid InstructionsArtifact: ${error}`);
  }

  return errors;
}

/**
 * Validate that path segments don't mix literals with template variables
 */
function validatePathSegmentStructure(
  path: string,
  context: string,
  errors: string[]
): void {
  // Split path into segments
  const segments = path.split('.');
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    
    // Skip empty segments
    if (!segment) continue;
    
    // Find all template occurrences
    const templateMatches = segment.match(/\{\{[^}]+\}\}/g);
    
    if (!templateMatches || templateMatches.length === 0) {
      // Pure literal - OK
      continue;
    }
    
    if (templateMatches.length === 1) {
      // Check if the template is the entire segment
      const isFullTemplate = segment === templateMatches[0];
      if (isFullTemplate) {
        // Pure template - OK
        continue;
      }
    }
    
    // Has templates but is not a pure template - this is invalid
    errors.push(
      `${context}: Path segment "${segment}" mixes literal text with template variables. ` +
      `Each segment must be EITHER a literal value OR a complete template variable. ` +
      `Invalid: "scoreP{{id}}", Valid: "score" or "{{fieldName}}"`
    );
  }
}

/**
 * Validate path structure in all stateDelta operations
 */
export async function validatePathStructure(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];

  const executionOutput = await getFromStore(
    store,
    ["instructions", "execution", "output"],
    threadId
  );

  if (!executionOutput) {
    return ["Execution output is missing"];
  }

  const artifact: InstructionsArtifact = typeof executionOutput === 'string' 
    ? JSON.parse(executionOutput)
    : executionOutput;

  // Validate player phases
  for (const [phaseName, phaseInst] of Object.entries(artifact.playerPhases || {})) {
    for (const action of phaseInst.playerActions || []) {
      if (action.stateDelta && Array.isArray(action.stateDelta)) {
        for (let i = 0; i < action.stateDelta.length; i++) {
          const op = action.stateDelta[i] as any;
          const pathField = op.path || op.fromPath || op.toPath;
          
          if (pathField && typeof pathField === 'string') {
            validatePathSegmentStructure(
              pathField,
              `Action '${action.id}' stateDelta[${i}]`,
              errors
            );
          }
        }
      }
    }
  }

  // Validate transitions
  for (const [transitionId, transition] of Object.entries(artifact.transitions || {})) {
    if (transition.stateDelta && Array.isArray(transition.stateDelta)) {
      for (let i = 0; i < transition.stateDelta.length; i++) {
        const op = transition.stateDelta[i] as any;
        const pathField = op.path || op.fromPath || op.toPath;
        
        if (pathField && typeof pathField === 'string') {
          validatePathSegmentStructure(
            pathField,
            `Transition '${transition.id}' stateDelta[${i}]`,
            errors
          );
        }
      }
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
  const validOps = ['set', 'increment', 'append', 'delete', 'transfer', 'merge', 'rng', 'setForAllPlayers'];
  
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
          errors.push(`${context}: stateDelta[${i}] op '${op.op}' missing 'path' field`);
        }
        if (op.value === undefined) {
          errors.push(`${context}: stateDelta[${i}] op '${op.op}' missing 'value' field`);
        }
        break;
        
      case 'setForAllPlayers':
        if (!op.field) {
          errors.push(`${context}: stateDelta[${i}] op 'setForAllPlayers' missing 'field' field`);
        }
        if (op.value === undefined) {
          errors.push(`${context}: stateDelta[${i}] op 'setForAllPlayers' missing 'value' field`);
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
          const sum = op.probabilities.reduce((acc: number, p: number) => acc + p, 0);
          if (Math.abs(sum - 1.0) > 0.01) {
            warnings.push(`${context}: stateDelta[${i}] op 'rng' probabilities sum to ${sum}, not 1.0`);
          }
        }
        break;
    }
    
    // Validate that array values don't contain template variables
    if ((op.op === 'set' || op.op === 'append' || op.op === 'setForAllPlayers') && op.value !== undefined) {
      if (Array.isArray(op.value)) {
        const hasTemplates = JSON.stringify(op.value).includes('{{');
        if (hasTemplates) {
          errors.push(
            `${context}: stateDelta[${i}] op '${op.op}' has array value containing template variables. ` +
            `Template variables in arrays are not expanded. Use bracket notation to set array elements individually.`
          );
        }
      }
    }
    
    // Validate field references if schema provided
    if (schemaFields) {
      const pathField = op.path || op.fromPath || op.toPath;
      if (pathField && typeof pathField === 'string') {
        let cleanPath = pathField
          .replace(/\[\{\{[^}]+\}\}\]/g, '[*]')
          .replace(/\.?\{\{[^}]+\}\}\.?/g, '[*].')
          .replace(/\.\[/g, '[')
          .replace(/\.\./g, '.')
          .replace(/\.\s*$/, '');
        
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
 * Validate precondition coverage - all fields used in preconditions must be written by some stateDelta op
 */
export async function validatePreconditionsCanPass(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];

  const executionOutput = await getFromStore(
    store,
    ["instructions", "execution", "output"],
    threadId
  );

  if (!executionOutput) {
    return ["Execution output is missing"];
  }

  const artifact: InstructionsArtifact = typeof executionOutput === 'string' 
    ? JSON.parse(executionOutput)
    : executionOutput;

  // Parse transitions
  let transitions: any;
  try {
    transitions = typeof state.stateTransitions === 'string'
      ? JSON.parse(state.stateTransitions)
      : state.stateTransitions;
  } catch (e) {
    return [];
  }

  const transitionList = transitions.transitions || [];

  // Collect all fields referenced in preconditions
  const preconditionFields = new Set<string>();
  transitionList.forEach((t: any) => {
    if (!t.preconditions || !Array.isArray(t.preconditions)) return;

    t.preconditions.forEach((p: any) => {
      if (!p.logic) return;
      const fields = extractFieldReferences(p.logic);
      fields.forEach((f: string) => {
        const baseField = f.endsWith('.length') ? f.slice(0, -7) : f;
        preconditionFields.add(baseField);
      });
    });
  });

  if (preconditionFields.size === 0) return [];
  // Router context fields computed at runtime
  const ROUTER_CONTEXT_FIELDS = new Set([
    'allPlayersCompletedActions',
    'playersCount',
    'playerCount',
    'allPlayersReady',
    'anyPlayerReady',
  ]);

  // Collect all fields written by any stateDelta (transitions + player actions)
  const writtenFields = new Set<string>();

  const addPath = (path: string) => {
    if (!path || typeof path !== 'string') return;
    writtenFields.add(path);
    const normalizedPath = path
      .replace(/\.\{\{[^}]+\}\}\./g, '[*].')
      .replace(/\.player\d+\./g, '[*].')
      .replace(/players\.\*/g, 'players[*]')
      .replace(/\[\d+\]/g, '');
    writtenFields.add(normalizedPath);
  };

  // Transition stateDelta ops
  if (artifact.transitions) {
    Object.values(artifact.transitions).forEach((t: any) => {
      (t?.stateDelta || []).forEach((op: any) => {
        addPath(op.path);
        addPath(op.fromPath);
        addPath(op.toPath);
        if (op.field && op.op === 'setForAllPlayers') {
          addPath(`players[*].${op.field}`);
        }
      });
    });
  }

  // Player action stateDelta ops
  Object.values(artifact.playerPhases || {}).forEach((phase: any) => {
    (phase?.playerActions || []).forEach((action: any) => {
      (action?.stateDelta || []).forEach((op: any) => {
        addPath(op.path);
        addPath(op.fromPath);
        addPath(op.toPath);
        if (op.field && op.op === 'setForAllPlayers') {
          addPath(`players[*].${op.field}`);
        }
      });
    });
  });

  // Check coverage
  const missingFields: string[] = [];
  preconditionFields.forEach((field: string) => {
    if (ROUTER_CONTEXT_FIELDS.has(field)) return;
    if (writtenFields.has(field)) return;
    const normalizedField = field.replace(/\[\d+\]/g, '').replace(/\.\d+\./g, '.');
    if (writtenFields.has(normalizedField)) return;
    missingFields.push(field);
  });

  missingFields.forEach((field: string) => {
    errors.push(
      `Field "${field}" is used in transition preconditions but is never written by any stateDelta operation.`
    );
  });

  return errors;
}

/**
 * Validate actionRequired is set in player actions
 */
export async function validateActionRequiredSet(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];

  const executionOutput = await getFromStore(
    store,
    ["instructions", "execution", "output"],
    threadId
  );

  if (!executionOutput) {
    return ["Execution output is missing"];
  }

  const artifact: InstructionsArtifact = typeof executionOutput === 'string' 
    ? JSON.parse(executionOutput)
    : executionOutput;

  // Validate each player phase instruction
  for (const [phaseName, phaseInst] of Object.entries(artifact.playerPhases || {})) {
    for (const action of phaseInst.playerActions || []) {
      if (!action.stateDelta || action.stateDelta.length === 0) {
        continue;
      }

      const hasActionRequiredOp = action.stateDelta.some((op: any) => {
        // Check for operations with path (set, increment, etc.)
        if (op.path && typeof op.path === 'string') {
          return op.path.includes('.actionRequired') || op.path.endsWith('actionRequired');
        }
        // Check for setForAllPlayers operations with field
        if (op.op === 'setForAllPlayers' && op.field === 'actionRequired') {
          return true;
        }
        return false;
      });
      
      if (!hasActionRequiredOp) {
        errors.push(
          `Player action '${action.id}' must include a stateDelta operation that sets ` +
          `'players.{{playerId}}.actionRequired' to true or false. This ensures the router ` +
          `knows whether the player has completed their required actions for this phase.`
        );
      }
    }
  }

  return errors;
}

/**
 * Validate narrative markers exist
 */
export async function validateNarrativeMarkers(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];

  const executionOutput = await getFromStore(
    store,
    ["instructions", "execution", "output"],
    threadId
  );

  if (!executionOutput) {
    return ["Execution output is missing"];
  }

  const artifact: InstructionsArtifact = typeof executionOutput === 'string' 
    ? JSON.parse(executionOutput)
    : executionOutput;

  const narrativeMarkerPattern = /!___ NARRATIVE:(\w+) ___!/g;
  const availableMarkers = new Set(Object.keys(state.specNarratives || {}));
  const referencedMarkers = new Set<string>();

  const artifactStr = JSON.stringify(artifact);
  let match;
  while ((match = narrativeMarkerPattern.exec(artifactStr)) !== null) {
    referencedMarkers.add(match[1]);
  }

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
 * Validate artifact structure and stateDelta operations
 */
export async function validateArtifactStructure(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const executionOutput = await getFromStore(
    store,
    ["instructions", "execution", "output"],
    threadId
  );

  if (!executionOutput) {
    return ["Execution output is missing"];
  }

  const artifact: InstructionsArtifact = typeof executionOutput === 'string' 
    ? JSON.parse(executionOutput)
    : executionOutput;

  // Extract schema fields (supports both planner format array and legacy JSON Schema object)
  let schemaFields: Set<string> | undefined;
  const schema = typeof state.stateSchema === 'string'
    ? JSON.parse(state.stateSchema)
    : state.stateSchema;
    
  if (schema) {
    schemaFields = extractSchemaFields(schema);
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

  // Validate player phases
  for (const [phaseName, phaseInst] of Object.entries(artifact.playerPhases || {})) {
    for (const action of phaseInst.playerActions || []) {
      if (action.validation) {
        if (!action.validation.checks || action.validation.checks.length === 0) {
          warnings.push(`Action '${action.id}' has validation config but no checks array`);
        }
        
        for (const check of action.validation.checks || []) {
          if (!check.id) {
            errors.push(`Action '${action.id}' has validation check without id`);
          }
          if (!check.errorMessage) {
            errors.push(`Action '${action.id}' validation check '${check.id}' has no errorMessage`);
          }
        }
      }

      if (!action.stateDelta || action.stateDelta.length === 0) {
        warnings.push(`Action '${action.id}' has no stateDelta operations`);
      } else {
        validateStateDelta(action.stateDelta, `Action '${action.id}'`, errors, warnings, schemaFields);
      }
    }
  }

  // Validate transitions
  for (const [transitionId, transition] of Object.entries(artifact.transitions || {})) {
    if (!transition.stateDelta || transition.stateDelta.length === 0) {
      warnings.push(`Transition '${transition.id}' has no stateDelta operations`);
    } else {
      validateStateDelta(transition.stateDelta, `Transition '${transition.id}'`, errors, warnings, schemaFields);
    }

    if (transition.mechanicsGuidance) {
      if (!transition.mechanicsGuidance.rules || transition.mechanicsGuidance.rules.length === 0) {
        warnings.push(`Transition '${transition.id}' has mechanicsGuidance but no rules array`);
      }
    }
  }

  if (warnings.length > 0) {
    console.warn("[instructions][artifact-validation] Validation warnings:", warnings);
  }

  return errors;
}

/**
 * Normalize a path by replacing template variables with wildcards for comparison.
 * Also normalizes wildcard notation to be consistent.
 * Examples:
 *   "players.{{codeMakerId}}.role" -> "players.[*].role"
 *   "players[*].role" -> "players.[*].role"
 *   "game.{{someVar}}" -> "game.[*]"
 *   "players.p1.score" -> "players.p1.score"
 */
function normalizePath(path: string): string {
  // Replace {{anyVariable}} with [*]
  let normalized = path.replace(/\{\{[^}]+\}\}/g, '[*]');
  
  // Normalize bracket notation: ensure consistent format with dots
  // "players[*].role" -> "players.[*].role"
  normalized = normalized.replace(/\[(\*|\d+)\]/g, '.[*]');
  
  // Clean up double dots that might result
  normalized = normalized.replace(/\.\.+/g, '.');
  
  return normalized;
}

/**
 * Extract normalized field paths written by a single stateDelta operation.
 * Handles set, setForAllPlayers, increment, append, merge, delete, transfer, rng.
 */
function getWrittenFieldsFromOp(op: any): string[] {
  if (!op) return [];
  if (op.op === 'setForAllPlayers' && op.field) {
    return [normalizePath(`players[*].${op.field}`)];
  }
  if (op.op === 'transfer') {
    const fields: string[] = [];
    if (op.fromPath) fields.push(normalizePath(op.fromPath));
    if (op.toPath) fields.push(normalizePath(op.toPath));
    return fields;
  }
  if (op.path && typeof op.path === 'string') {
    return [normalizePath(op.path)];
  }
  return [];
}

/**
 * Validate field coverage: Check that all fields used in transition preconditions
 * are set by at least one stateDelta operation somewhere in the instructions.
 * 
 * This is a soft validation (warnings only) that catches common bugs like:
 * - Fields referenced in preconditions but never initialized
 * - Typos in field names between transitions and instructions
 * 
 * Returns array of warning messages.
 */
export async function validateFieldCoverage(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const warnings: string[] = [];

  // 1. Get artifact from store
  const executionOutput = await getFromStore(
    store,
    ["instructions", "execution", "output"],
    threadId
  );

  if (!executionOutput) {
    return []; // No artifact yet, skip validation
  }

  let artifact: InstructionsArtifact;
  try {
    artifact = typeof executionOutput === 'string'
      ? JSON.parse(executionOutput)
      : executionOutput;
  } catch (e) {
    return []; // Can't parse, skip validation
  }

  // 2. Parse transitions
  let transitions: TransitionsArtifact;
  try {
    transitions = typeof state.stateTransitions === 'string'
      ? JSON.parse(state.stateTransitions)
      : state.stateTransitions;
  } catch (e) {
    return []; // Skip if can't parse - should be caught by other validations
  }

  if (!transitions.transitions || !Array.isArray(transitions.transitions)) {
    return [];
  }

  // 3. Collect all fields SET by any instruction's stateDelta
  const fieldsSet = new Set<string>();

  // Helper to add field from an operation
  const addFieldFromOp = (op: any) => {
    if (op.op === 'set' && op.path) {
      fieldsSet.add(normalizePath(op.path));
    } else if (op.op === 'setForAllPlayers' && op.field) {
      // setForAllPlayers sets players[*].field
      fieldsSet.add(`players[*].${op.field}`);
    } else if (op.op === 'increment' && op.path) {
      fieldsSet.add(normalizePath(op.path));
    } else if (op.op === 'append' && op.path) {
      fieldsSet.add(normalizePath(op.path));
    } else if (op.op === 'merge' && op.path) {
      fieldsSet.add(normalizePath(op.path));
    } else if (op.op === 'delete' && op.path) {
      // Delete operations don't initialize but do touch the field
      fieldsSet.add(normalizePath(op.path));
    } else if (op.op === 'transfer') {
      if (op.fromPath) fieldsSet.add(normalizePath(op.fromPath));
      if (op.toPath) fieldsSet.add(normalizePath(op.toPath));
    } else if (op.op === 'rng' && op.path) {
      fieldsSet.add(normalizePath(op.path));
    }
  };

  // Scan all transition instructions
  if (artifact.transitions) {
    for (const [transitionId, instruction] of Object.entries(artifact.transitions)) {
      if (instruction.stateDelta && Array.isArray(instruction.stateDelta)) {
        instruction.stateDelta.forEach(addFieldFromOp);
      }
    }
  }

  // Scan all player phase instructions
  if (artifact.playerPhases) {
    for (const [phase, instruction] of Object.entries(artifact.playerPhases)) {
      if (typeof instruction === 'string') continue; // Skip raw strings
      
      if (instruction.playerActions && Array.isArray(instruction.playerActions)) {
        for (const action of instruction.playerActions) {
          if (action.stateDelta && Array.isArray(action.stateDelta)) {
            action.stateDelta.forEach(addFieldFromOp);
          }
        }
      }
    }
  }

  // 4. Check all fields READ by transitions (from checkedFields)
  const fieldsRead = new Set<string>();
  const fieldUsage = new Map<string, string[]>(); // field -> [transition IDs that use it]

  for (const transition of transitions.transitions) {
    if (!transition.checkedFields || !Array.isArray(transition.checkedFields)) {
      continue;
    }

    for (const field of transition.checkedFields) {
      fieldsRead.add(field);
      
      if (!fieldUsage.has(field)) {
        fieldUsage.set(field, []);
      }
      fieldUsage.get(field)!.push(transition.id);
    }
  }

  // 5. Find fields that are read but never set
  const uninitializedFields: string[] = [];

  for (const field of fieldsRead) {
    // Check if this field (or a normalized version) is set
    const normalizedField = normalizePath(field);
    
    // Check exact match or normalized match
    if (!fieldsSet.has(field) && !fieldsSet.has(normalizedField)) {
      uninitializedFields.push(field);
    }
  }

  // 6. Generate warnings
  if (uninitializedFields.length > 0) {
    console.warn('[extract_instructions][validation] Field coverage warnings:');
    for (const field of uninitializedFields) {
      const usedBy = fieldUsage.get(field) || [];
      const warning = `Field '${field}' is used in transition preconditions (${usedBy.join(', ')}) ` +
        `but is never set by any stateDelta operation. This may cause transitions to never fire. ` +
        `Consider adding a stateDelta operation to initialize this field.`;
      warnings.push(warning);
      console.warn(`  ⚠️  ${warning}`);
    }
  }

  // Return empty array - warnings are logged but don't block validation
  return [];
}

/**
 * Validate that no transition is self-blocking: a transition whose precondition
 * checks a field that is ONLY ever set by that same transition's own stateDelta
 * can never fire — it's a guaranteed runtime deadlock.
 *
 * Returns hard errors for guaranteed deadlocks (field written nowhere else).
 * Logs warnings for suspicious cases where another transition also writes the field
 * (which may still be valid depending on execution order).
 */
export async function validateSelfBlockingTransitions(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];

  // 1. Get instructions artifact
  const executionOutput = await getFromStore(
    store,
    ["instructions", "execution", "output"],
    threadId
  );
  if (!executionOutput) return [];

  let artifact: InstructionsArtifact;
  try {
    artifact = typeof executionOutput === 'string'
      ? JSON.parse(executionOutput)
      : executionOutput;
  } catch (e) {
    return [];
  }

  // 2. Parse transitions artifact
  let transitions: TransitionsArtifact;
  try {
    transitions = typeof state.stateTransitions === 'string'
      ? JSON.parse(state.stateTransitions)
      : state.stateTransitions;
  } catch (e) {
    return [];
  }
  if (!transitions.transitions || !Array.isArray(transitions.transitions)) return [];

  // 3. Build map: normalizedField -> Set<transitionId> for every field written anywhere
  const fieldWrittenBy = new Map<string, Set<string>>();
  for (const [transitionId, instruction] of Object.entries(artifact.transitions || {})) {
    for (const op of instruction.stateDelta || []) {
      for (const field of getWrittenFieldsFromOp(op)) {
        if (!fieldWrittenBy.has(field)) fieldWrittenBy.set(field, new Set());
        fieldWrittenBy.get(field)!.add(transitionId);
      }
    }
  }

  // 4. For each transition, find checkedFields only written by that same transition
  for (const transition of transitions.transitions) {
    if (!transition.checkedFields || transition.checkedFields.length === 0) continue;
    if (!transition.preconditions || transition.preconditions.length === 0) continue;

    const instruction = artifact.transitions[transition.id];
    if (!instruction?.stateDelta || instruction.stateDelta.length === 0) continue;

    // Normalized fields written by THIS transition's stateDelta
    const writtenByThis = new Set<string>();
    for (const op of instruction.stateDelta) {
      for (const field of getWrittenFieldsFromOp(op)) {
        writtenByThis.add(field);
      }
    }
    if (writtenByThis.size === 0) continue;

    // Check each field read by preconditions
    for (const checkedField of transition.checkedFields) {
      const normalized = normalizePath(checkedField);
      if (!writtenByThis.has(normalized)) continue;

      // This transition both checks and sets the same field
      const allWriters = fieldWrittenBy.get(normalized) ?? new Set();
      const otherWriters = [...allWriters].filter(id => id !== transition.id);

      if (otherWriters.length === 0) {
        errors.push(
          `Transition '${transition.id}' is self-blocking: field '${checkedField}' is checked ` +
          `by a precondition but is only ever set by this transition's own stateDelta. ` +
          `The transition can never fire because the precondition can never be satisfied before it runs. ` +
          `Fix: move the stateDelta op that sets '${checkedField}' to the predecessor transition ` +
          `that fires immediately before '${transition.id}' (i.e., the transition that targets phase '${transition.fromPhase}').`
        );
      } else {
        console.warn(
          `[extract_instructions][validation] Transition '${transition.id}' both checks and sets ` +
          `field '${checkedField}'. Other transitions also set this field: [${otherWriters.join(', ')}]. ` +
          `Verify one of those always fires before '${transition.id}'.`
        );
      }
    }
  }

  return errors;
}

/**
 * Validate that initial state created by init transition doesn't create a deadlock
 * 
 * This function simulates applying the init transition's stateDelta and checks if:
 * 1. At least one transition from the starting phase can fire, OR
 * 2. The phase requires player input AND at least one player can act
 * 
 * Exported for testing purposes.
 */
export async function validateInitialStatePreconditions(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  console.debug('[extract_instructions][validation] Validating initial state preconditions');
  const errors: string[] = [];

  // 1. Get artifact from store
  const executionOutput = await getFromStore(
    store,
    ["instructions", "execution", "output"],
    threadId
  );

  if (!executionOutput) {
    return []; // No artifact yet, skip validation
  }

  let artifact: InstructionsArtifact;
  try {
    artifact = typeof executionOutput === 'string'
      ? JSON.parse(executionOutput)
      : executionOutput;
  } catch (e) {
    return []; // Can't parse, skip validation
  }

  // 2. Parse transitions
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

  // 3. Find init transition and its target phase
  const initTransition = transitions.transitions.find((t: any) => t.fromPhase === 'init');
  if (!initTransition) {
    return []; // Should be caught by other validations
  }

  const startingPhase = initTransition.toPhase;
  if (!startingPhase) {
    return ['Init transition has no toPhase'];
  }

  // 4. Get init instructions
  const initInstructions = artifact.transitions[initTransition.id];
  if (!initInstructions) {
    return []; // Should be caught by other validations
  }

  // 5. Build mock initial state by applying init's stateDelta
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

  // Check if this is actually a deadlock
  const phaseMetadata = transitions.phaseMetadata?.find((pm: any) => pm.phase === startingPhase);
  const requiresPlayerInput = phaseMetadata?.requiresPlayerInput ?? false;

  // Check if players can actually act (at least one player has actionRequired truthy)
  const players = Object.values(mockState.players || {});
  const anyPlayerCanAct = players.some((player: any) => !!player.actionRequired);

  // Deadlock conditions:
  // 1. Automatic phase (no player input) AND no transitions can fire
  // 2. Player input phase AND no transitions can fire AND no players can act
  const isDeadlock = canFireTransitions.length === 0 && (!requiresPlayerInput || !anyPlayerCanAct);

  if (isDeadlock) {
    console.error('[extract_instructions][validation] Deadlock detected in initial state!');
    console.error(`[extract_instructions][validation] Starting phase: ${startingPhase}, requiresPlayerInput: ${requiresPlayerInput}, anyPlayerCanAct: ${anyPlayerCanAct}`);
    console.error(`[extract_instructions][validation] Mock state:`, JSON.stringify(mockState, null, 2));

    if (!requiresPlayerInput) {
      // Automatic phase deadlock
      errors.push(
        `Init transition creates immediate deadlock. After initialization, game moves to phase "${startingPhase}" ` +
        `but none of the ${startingTransitions.length} transition(s) from that phase can fire. ` +
        `Phase does NOT require player input, so at least one automatic transition must be able to fire. ` +
        `Common issue: init sets boolean fields to values that block all automatic transitions. ` +
        `Review init transition stateDelta and starting transitions' preconditions to ensure compatibility.`
      );
    } else {
      // Player input phase deadlock (no transitions can fire AND no players can act)
      errors.push(
        `Init transition creates immediate deadlock. After initialization, game moves to phase "${startingPhase}" ` +
        `but none of the ${startingTransitions.length} transition(s) from that phase can fire AND no players can act. ` +
        `Phase requires player input but all players have actionRequired=false, preventing any player actions. ` +
        `No transitions can fire and no players can act, creating a permanent deadlock. ` +
        `Fix: Either set actionRequired=true for players OR ensure at least one transition can fire immediately.`
      );
    }

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
 * Validate that game can properly end with winners declared
 * 
 * Checks:
 * 1. At least one transition sets game.gameEnded = true
 * 2. At least one transition sets players.*.isGameWinner = true
 * 3. At least one terminal path sets isGameWinner (warns if none do)
 */
export async function validateGameCompletion(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];
  
  try {
    // Get execution output from store (Instructions artifact)
    const executionOutput = await getFromStore(
      store,
      ["instructions", "execution", "output"],
      threadId
    );
    
    if (!executionOutput) {
      return ["Execution output is missing - cannot validate game completion"];
    }
    
    const instructionsArtifact: InstructionsArtifact = typeof executionOutput === 'string' 
      ? JSON.parse(executionOutput)
      : executionOutput;
    
    // Get transitions artifact from state (needed for path analysis)
    const transitionsJson = state.stateTransitions;
    if (!transitionsJson) {
      errors.push("Transitions artifact not found in state");
      return errors;
    }
    
    const transitionsArtifact: TransitionsArtifact = JSON.parse(transitionsJson);
    
    // Build or retrieve cached graph
    const graph = getOrBuildGraph(threadId, transitionsArtifact, instructionsArtifact);
    
    // Check 1: At least one transition must set gameEnded
    const gameEndedSetters = graph.findFieldSetters('game.gameEnded');
    
    if (gameEndedSetters.length === 0) {
      errors.push(
        'No transition sets game.gameEnded=true. At least one transition must explicitly end the game. ' +
        'Without this, the game cannot terminate properly.'
      );
    }
    
    // Check 2: At least one transition must set isGameWinner for players
    const isGameWinnerSetters = graph.findFieldSetters('players.*.isGameWinner');
    
    if (isGameWinnerSetters.length === 0) {
      errors.push(
        'No transition sets players.*.isGameWinner. At least one transition must mark winning players. ' +
        'Set isGameWinner=true for each winning player before or when the game ends. ' +
        'Runtime will automatically compute game.winningPlayers from these flags.'
      );
    }
    
    // Check 3: All terminal paths set isGameWinner somewhere along the path
    // Note: We don't require isGameWinner to be set for draw/no-winner scenarios
    const terminalPaths = graph.getTerminalPaths();
    
    if (terminalPaths.length === 0) {
      // This is a structural issue, should be caught by phase connectivity validation
      errors.push('No paths from init to "finished" phase found. Game cannot end.');
    } else {
      // Check if ANY path sets isGameWinner (at least one winning scenario)
      let hasWinningPath = false;
      for (const path of terminalPaths) {
        if (graph.pathSetsField(path, 'players.*.isGameWinner')) {
          hasWinningPath = true;
          break;
        }
      }
      
      // Warn if no paths set isGameWinner (might be intentional for draw-only games)
      if (!hasWinningPath) {
        errors.push(
          'No path to "finished" sets players.*.isGameWinner. ' +
          'If your game has winners, at least one ending path must set isGameWinner=true for winning players. ' +
          'If this is a draw-only game (no winners), you can ignore this warning.'
        );
      }
    }
    
  } catch (error) {
    errors.push(`Error validating game completion: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return errors;
}

/**
 * Validate phase connectivity and structural soundness
 * 
 * Checks:
 * 1. "finished" phase exists (required terminal phase)
 * 2. All defined phases are reachable from init
 * 3. "finished" phase is reachable from init
 */
export async function validatePhaseConnectivity(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];
  
  try {
    // Load transitions from state (stored as JSON string)
    const transitionsJson = state.stateTransitions;
    
    if (!transitionsJson) {
      errors.push("Transitions artifact not found in state");
      return errors;
    }
    
    const transitionsArtifact: TransitionsArtifact = JSON.parse(transitionsJson);
    
    // Build graph (instructions not needed for structural validation)
    const graph = getOrBuildGraph(threadId, transitionsArtifact);
    
    // Check 1: "finished" phase exists (validated elsewhere but double-check)
    const terminalPhase = graph.getTerminalPhase();
    const allPhases = new Set(transitionsArtifact.phases);
    
    if (!allPhases.has(terminalPhase)) {
      errors.push(
        `Terminal phase '${terminalPhase}' not found in phases array. ` +
        `This is required by convention.`
      );
      return errors;
    }
    
    // Check 2: All defined phases are reachable from init
    const reachablePhases = graph.getReachablePhasesFromInit();
    
    for (const phase of allPhases) {
      if (!reachablePhases.has(phase)) {
        errors.push(
          `Phase '${phase}' is unreachable from init phase. ` +
          `This phase will never execute and should be removed or connected to the game flow.`
        );
      }
    }
    
    // Check 3: "finished" phase is reachable
    if (!reachablePhases.has(terminalPhase)) {
      errors.push(
        `Terminal phase '${terminalPhase}' is unreachable from init. ` +
        `Game cannot properly end because the terminal phase cannot be reached.`
      );
    }
    
  } catch (error) {
    errors.push(`Error validating phase connectivity: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return errors;
}

