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
} from "#chaincraft/ai/simulate/schema.js";
import { 
  extractSchemaFields, 
  isValidFieldReference, 
  extractFieldReferences 
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/schema-utils.js";

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
        transition.computationNeeded?.requiresLLMReasoning &&
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
          errors.push(`${context}: stateDelta[${i}] op '${op.op}' missing 'path' field`);
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
          const sum = op.probabilities.reduce((acc: number, p: number) => acc + p, 0);
          if (Math.abs(sum - 1.0) > 0.01) {
            warnings.push(`${context}: stateDelta[${i}] op 'rng' probabilities sum to ${sum}, not 1.0`);
          }
        }
        break;
    }
    
    // Validate that array values don't contain template variables
    if ((op.op === 'set' || op.op === 'append') && op.value !== undefined) {
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
 * Validate initialization completeness - all fields used in preconditions must be initialized
 */
export async function validateInitializationCompleteness(
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

  // Router context fields computed at runtime
  const ROUTER_CONTEXT_FIELDS = new Set([
    'allPlayersCompletedActions',
    'playersCount',
    'playerCount',
    'allPlayersReady',
    'anyPlayerReady',
  ]);

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

  // Find init transition
  const initTransition = transitionList.find((t: any) => t.fromPhase === 'init');
  if (!initTransition) {
    return [];
  }

  // Get init instructions
  const initInstructions = artifact.transitions[initTransition.id];
  if (!initInstructions) {
    return [`Init transition "${initTransition.id}" has no instructions in artifact`];
  }

  // Extract initialized fields
  const initializedFields = new Set<string>();
  if (initInstructions.stateDelta && Array.isArray(initInstructions.stateDelta)) {
    initInstructions.stateDelta.forEach((op: any) => {
      if (op.path && typeof op.path === 'string') {
        let normalizedPath = op.path
          .replace(/\.\{\{[^}]+\}\}\./g, '[*].')
          .replace(/\.player\d+\./g, '[*].')
          .replace(/players\.\*/g, 'players[*]');

        initializedFields.add(op.path);
        initializedFields.add(normalizedPath);

        const baseArrayPath = op.path.replace(/\[\d+\]$/, '');
        if (baseArrayPath !== op.path) {
          initializedFields.add(baseArrayPath);
          const normalizedBaseArrayPath = baseArrayPath
            .replace(/\.\{\{[^}]+\}\}\./g, '[*].')
            .replace(/\.player\d+\./g, '[*].')
            .replace(/players\.\*/g, 'players[*]');
          initializedFields.add(normalizedBaseArrayPath);
        }
      }
    });
  }

  // Check uninitialized fields
  const uninitializedFields: string[] = [];
  preconditionFields.forEach((field: string) => {
    if (ROUTER_CONTEXT_FIELDS.has(field)) return;
    
    if (initializedFields.has(field)) return;

    const normalizedField = field.replace(/\[\d+\]/g, '.*').replace(/\.\d+\./g, '.*.');
    if (initializedFields.has(normalizedField)) return;

    uninitializedFields.push(field);
  });

  uninitializedFields.forEach((field: string) => {
    errors.push(
      `Field "${field}" is used in transition preconditions but is never initialized by the init transition. ` +
      `Add a stateDelta operation in the init transition to set ${field} to an appropriate initial value.`
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
        return op.path && 
               typeof op.path === 'string' && 
               (op.path.includes('.actionRequired') || op.path.endsWith('actionRequired'));
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
 * Validate that initial state created by init transition doesn't create a deadlock
 * 
 * This function simulates applying the init transition's stateDelta and checks if:
 * 1. At least one transition from the starting phase can fire, OR
 * 2. The phase requires player input AND at least one player can act
 * 
 * Exported for testing purposes.
 */
export function validateInitialStatePreconditions(
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

  // Check if this is actually a deadlock
  const phaseMetadata = transitions.phaseMetadata?.find((pm: any) => pm.phase === startingPhase);
  const requiresPlayerInput = phaseMetadata?.requiresPlayerInput ?? false;

  // Check if players can actually act (at least one player has actionRequired=true)
  const players = Object.values(mockState.players || {});
  const anyPlayerCanAct = players.some((player: any) => player.actionRequired === true);

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
