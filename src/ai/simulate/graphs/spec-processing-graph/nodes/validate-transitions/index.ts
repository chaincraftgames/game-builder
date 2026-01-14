/**
 * Validate Transitions Node
 * 
 * Validates generated transitions for structural integrity, semantic correctness,
 * and potential runtime issues. Can optionally attempt automatic correction.
 */

import type { SpecProcessingStateType } from '../../spec-processing-state.js';
import { 
  extractSchemaFields, 
  isValidFieldReference, 
  extractFieldReferences 
} from '../../schema-utils.js';

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
  
  // Validate that all non-terminal phases can reach a terminal phase
  // Build adjacency list for reachability check
  const adjacencyList = new Map<string, Set<string>>();
  phases.forEach((phase: string) => adjacencyList.set(phase, new Set()));
  transitionList.forEach((t: any) => {
    adjacencyList.get(t.fromPhase)?.add(t.toPhase);
  });
  
  // Check reachability from each non-terminal phase to any terminal phase
  phases.forEach((phase: string) => {
    if (phase === initPhase || terminalPhases.has(phase)) return;
    
    // BFS to find if any terminal phase is reachable
    const visited = new Set<string>();
    const queue = [phase];
    visited.add(phase);
    let foundTerminal = false;
    
    while (queue.length > 0 && !foundTerminal) {
      const current = queue.shift()!;
      
      if (terminalPhases.has(current)) {
        foundTerminal = true;
        break;
      }
      
      const neighbors = adjacencyList.get(current) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    
    if (!foundTerminal) {
      issues.push({
        severity: 'error',
        category: 'deadlock',
        message: `Phase "${phase}" has no path to any terminal phase. Game cannot end from this phase.`,
        context: { 
          phase, 
          terminalPhases: Array.from(terminalPhases),
          outboundTransitions: transitionList.filter((t: any) => t.fromPhase === phase).map((t: any) => t.toPhase)
        }
      });
    }
  });
  
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
        // Check for indexed array access (both bracket and dot notation)
        const hasIndexedAccess = /\[\d+\]|\.\d+\./.test(field);
        
        if (hasIndexedAccess) {
          issues.push({
            severity: 'error',
            category: 'reference',
            message: `Transition ${t.id} precondition uses indexed array access: ${field}. ` +
                     `Indexed access is not allowed in preconditions. ` +
                     `Use 'anyPlayer' or 'allPlayers' custom operators instead. ` +
                     `Example: {"anyPlayer": ["${field.split('.').pop()}", "!=", null]}`,
            context: { transition: t, precondition: p, field }
          });
        } else if (!isValidFieldReference(field, schemaFields)) {
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
