/**
 * Validate Transitions Node
 * 
 * Validates generated transitions for structural integrity, semantic correctness,
 * and potential runtime issues. Can optionally attempt automatic correction.
 */

import type { SpecProcessingStateType } from '../../spec-processing-state.js';
import { RouterContextSchema } from '#chaincraft/ai/simulate/logic/jsonlogic.js';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  category: 'structure' | 'semantic' | 'deadlock' | 'reference';
  message: string;
  context?: any;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Validate transitions artifact
 */
export function validateTransitions(state: SpecProcessingStateType): ValidationResult {
  const issues: ValidationIssue[] = [];
  
  // Parse transitions if string
  let transitions: any;
  try {
    transitions = typeof state.stateTransitions === 'string' 
      ? JSON.parse(state.stateTransitions)
      : state.stateTransitions;
  } catch (e) {
    issues.push({
      severity: 'error',
      category: 'structure',
      message: 'Failed to parse stateTransitions as JSON',
      context: { error: String(e) }
    });
    return { valid: false, issues };
  }
  
  // Parse schema if string
  let schema: any;
  try {
    schema = typeof state.stateSchema === 'string'
      ? JSON.parse(state.stateSchema)
      : state.stateSchema;
  } catch (e) {
    issues.push({
      severity: 'error',
      category: 'structure',
      message: 'Failed to parse stateSchema as JSON',
      context: { error: String(e) }
    });
    return { valid: false, issues };
  }
  
  // Validate basic structure
  if (!transitions.phases || !Array.isArray(transitions.phases)) {
    issues.push({
      severity: 'error',
      category: 'structure',
      message: 'Missing or invalid phases array'
    });
  }
  
  if (!transitions.transitions || !Array.isArray(transitions.transitions)) {
    issues.push({
      severity: 'error',
      category: 'structure',
      message: 'Missing or invalid transitions array'
    });
  }
  
  // If basic structure is broken, can't continue
  if (issues.some(i => i.severity === 'error')) {
    return { valid: false, issues };
  }
  
  const phases = transitions.phases;
  const transitionList = transitions.transitions;
  
  // Validate phase connectivity
  const phaseInbound = new Map<string, number>();
  const phaseOutbound = new Map<string, number>();
  
  phases.forEach((phase: string) => {
    phaseInbound.set(phase, 0);
    phaseOutbound.set(phase, 0);
  });
  
  transitionList.forEach((t: any) => {
    if (!t.fromPhase || !t.toPhase) {
      issues.push({
        severity: 'error',
        category: 'structure',
        message: `Transition ${t.id} missing fromPhase or toPhase`,
        context: { transition: t }
      });
      return;
    }
    
    if (!phases.includes(t.fromPhase)) {
      issues.push({
        severity: 'error',
        category: 'reference',
        message: `Transition ${t.id} references unknown fromPhase: ${t.fromPhase}`,
        context: { transition: t, knownPhases: phases }
      });
    }
    
    if (!phases.includes(t.toPhase)) {
      issues.push({
        severity: 'error',
        category: 'reference',
        message: `Transition ${t.id} references unknown toPhase: ${t.toPhase}`,
        context: { transition: t, knownPhases: phases }
      });
    }
    
    phaseOutbound.set(t.fromPhase, (phaseOutbound.get(t.fromPhase) || 0) + 1);
    phaseInbound.set(t.toPhase, (phaseInbound.get(t.toPhase) || 0) + 1);
  });
  
  // Identify terminal phases (no outbound transitions)
  const initPhase = phases[0]; // Assume first phase is init
  const terminalPhases = new Set<string>();
  
  phases.forEach((phase: string) => {
    const outbound = phaseOutbound.get(phase) || 0;
    const inbound = phaseInbound.get(phase) || 0;
    
    if (outbound === 0 && phase !== initPhase) {
      terminalPhases.add(phase);
    }
    
    // Check for unreachable phases
    if (inbound === 0 && phase !== initPhase) {
      issues.push({
        severity: 'warning',
        category: 'deadlock',
        message: `Phase "${phase}" has no inbound transitions (unreachable)`,
        context: { phase }
      });
    }
    
    // Check for potential deadlocks
    if (outbound === 0 && !terminalPhases.has(phase) && phase !== initPhase) {
      issues.push({
        severity: 'error',
        category: 'deadlock',
        message: `Phase "${phase}" has no outbound transitions (potential deadlock)`,
        context: { phase }
      });
    }
  });
  
  // Validate init transition exists
  const hasInitTransition = transitionList.some((t: any) => 
    t.fromPhase === initPhase
  );
  
  if (!hasInitTransition) {
    issues.push({
      severity: 'error',
      category: 'structure',
      message: `No transition from init phase "${initPhase}",`,
      context: { initPhase, transitions: transitionList.filter((t: any) => t.fromPhase === initPhase) }
    });
  }
  
  // Validate preconditions reference valid schema fields
  const schemaFields = extractSchemaFields(schema);
  
  transitionList.forEach((t: any) => {
    if (!t.preconditions || !Array.isArray(t.preconditions)) {
      issues.push({
        severity: 'warning',
        category: 'semantic',
        message: `Transition ${t.id} has no preconditions`,
        context: { transition: t }
      });
      return;
    }
    
    t.preconditions.forEach((p: any) => {
      if (!p.logic) return;
      
      const referencedFields = extractFieldReferences(p.logic);
      referencedFields.forEach((field: string) => {
        if (!isValidFieldReference(field, schemaFields)) {
          issues.push({
            severity: 'error',
            category: 'reference',
            message: `Transition ${t.id} precondition references unknown field: ${field}`,
            context: { transition: t, precondition: p, field }
          });
        }
      });
    });
  });
  
  const hasErrors = issues.some(i => i.severity === 'error');
  return { valid: !hasErrors, issues };
}

/**
 * Extract all field paths from schema
 */
function extractSchemaFields(schema: any): Set<string> {
  const fields = new Set<string>();
  
  function traverse(obj: any, path: string = '') {
    if (obj?.properties) {
      for (const [key, value] of Object.entries(obj.properties)) {
        const fieldPath = path ? `${path}.${key}` : key;
        fields.add(fieldPath);
        traverse(value, fieldPath);
      }
    }
    
    // Handle array items
    if (obj?.items?.properties) {
      traverse(obj.items, path);
    }
  }
  
  traverse(schema);
  return fields;
}

/**
 * Extract field references from JSON Logic
 */
function extractFieldReferences(logic: any): string[] {
  const fields: string[] = [];
  
  function traverse(obj: any) {
    if (typeof obj !== 'object' || obj === null) return;
    
    if (obj.var) {
      if (typeof obj.var === 'string') {
        fields.push(obj.var);
      }
    }
    
    for (const value of Object.values(obj)) {
      if (typeof value === 'object') {
        traverse(value);
      } else if (Array.isArray(value)) {
        value.forEach(item => traverse(item));
      }
    }
  }
  
  traverse(logic);
  return fields;
}

/**
 * Check if field is from computed router context.
 * IMPORTANT: Only fields that are ACTUALLY provided by RouterContextSchema at runtime are allowed.
 * The LLM must use exact field names - no aliases or hallucinated variations.
 */
function isComputedContextField(field: string): boolean {
  // Extract field names dynamically from RouterContextSchema to ensure strict validation
  const schemaShape = RouterContextSchema.shape;
  const computedFields = Object.keys(schemaShape);
  
  return computedFields.includes(field);
}

/**
 * Validate a field reference against schema fields.
 * Handles:
 * - Wildcards: players[*].score matches players.score in schema
 * - Array indices: players[0].score matches players.score in schema
 * - Player IDs: players[player-123].score matches players.score in schema
 * - Computed context fields: playersCount, allPlayersCompletedActions, etc.
 */
function isValidFieldReference(fieldRef: string, schemaFields: Set<string>): boolean {
  // Check if it's a computed context field first
  const fieldParts = fieldRef.split('.');
  const lastPart = fieldParts[fieldParts.length - 1];
  if (isComputedContextField(fieldRef) || isComputedContextField(lastPart)) {
    return true;
  }
  
  // Normalize the reference by removing array notation
  // This converts:
  //   players[*].score -> players.score
  //   players[0].score -> players.score
  //   players[player-123].score -> players.score
  const normalizedRef = fieldRef
    .replace(/\[\*\]/g, '')           // Remove wildcards
    .replace(/\[\d+\]/g, '')          // Remove numeric indices
    .replace(/\[[\w-]+\]/g, '');      // Remove player IDs
  
  // Check if normalized reference exists in schema
  if (schemaFields.has(normalizedRef)) {
    return true;
  }
  
  // Also check if any schema field with wildcard notation would match
  // For example, if schema has "players[*].score", check if our normalized ref matches
  for (const schemaField of schemaFields) {
    const normalizedSchema = schemaField
      .replace(/\[\*\]/g, '')
      .replace(/\[\d+\]/g, '')
      .replace(/\[[\w-]+\]/g, '');
    
    if (normalizedRef === normalizedSchema) {
      return true;
    }
  }
  
  return false;
}

/**
 * Create validation node
 */
export function createValidationNode() {
  return async (state: SpecProcessingStateType): Promise<SpecProcessingStateType> => {
    console.debug('[validate_transitions] Validating generated transitions');
    
    const result = validateTransitions(state);
    
    if (result.issues.length > 0) {
      console.debug('[validate_transitions] Found validation issues:');
      result.issues.forEach(issue => {
        const prefix = issue.severity === 'error' ? '  ❌' : '  ⚠️ ';
        console.debug(`${prefix} [${issue.category}] ${issue.message}`);
      });
    }
    
    if (!result.valid) {
      const errorMessages = result.issues
        .filter(i => i.severity === 'error')
        .map(i => i.message)
        .join('; ');
      
      throw new Error(`Transition validation failed: ${errorMessages}`);
    }
    
    if (result.issues.some(i => i.severity === 'warning')) {
      console.warn('[validate_transitions] Validation passed with warnings');
    } else {
      console.debug('[validate_transitions] Validation passed');
    }
    
    return state;
  };
}
