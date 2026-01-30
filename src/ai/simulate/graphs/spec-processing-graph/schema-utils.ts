/**
 * Schema Utilities for Spec Processing
 * 
 * Shared utilities for extracting and validating field references against schema.
 * Used by multiple nodes (validate-transitions, extract-instructions) to ensure
 * consistency in field validation.
 */

import { RouterContextSchema } from '#chaincraft/ai/simulate/logic/jsonlogic.js';

/**
 * Planner field definition from extract-schema planner output
 */
export interface PlannerField {
  name: string;
  type: string;
  path: 'game' | 'player';
  source: string;
  purpose: string;
  constraints?: string;
}

/**
 * Extract all field paths from planner field definitions or JSON Schema.
 * Supports both:
 * 1. Planner format: Array of {name, path, type, ...} objects
 * 2. Legacy JSON Schema format (for backward compatibility during migration)
 * 
 * @param schema - Planner field array or JSON Schema object
 * @returns Set of dot-notation field paths (e.g., "game.currentPhase", "players.score")
 */
export function extractSchemaFields(schema: any): Set<string> {
  const fields = new Set<string>();
  
  // Handle planner format (array of field definitions)
  if (Array.isArray(schema)) {
    for (const field of schema) {
      if (field.name && field.path) {
        // Convert planner format to field path
        // "name": "score", "path": "player" -> "players.score"
        // "name": "round", "path": "game" -> "game.round"
        // "name": "players.*.score" -> "players.score" (already in dot notation)
        let fieldPath = field.name;
        
        // If field name doesn't already include the path prefix, add it
        if (field.path === 'game' && !fieldPath.startsWith('game.')) {
          fieldPath = `game.${fieldPath}`;
        } else if (field.path === 'player') {
          // Normalize player paths: remove wildcards if present
          fieldPath = fieldPath.replace(/^players\.\*\./, 'players.');
          if (!fieldPath.startsWith('players.')) {
            fieldPath = `players.${fieldPath}`;
          }
        }
        
        fields.add(fieldPath);
      }
    }
    return fields;
  }
  
  // Handle JSON Schema format (legacy support)
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
    
    // Handle additionalProperties (for records/maps like players)
    if (obj?.additionalProperties?.properties) {
      traverse(obj.additionalProperties, path);
    }
  }
  
  traverse(schema);
  return fields;
}

/**
 * Check if field is from computed router context.
 * IMPORTANT: Only fields that are ACTUALLY provided by RouterContextSchema at runtime are allowed.
 * The LLM must use exact field names - no aliases or hallucinated variations.
 * 
 * @param field - Field name to check
 * @returns True if field is a computed context field
 */
export function isComputedContextField(field: string): boolean {
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
 * 
 * @param fieldRef - Field reference to validate (e.g., "players[0].score")
 * @param schemaFields - Set of valid field paths from schema
 * @returns True if field reference is valid
 */
export function isValidFieldReference(fieldRef: string, schemaFields: Set<string>): boolean {
  // Check if it's a computed context field first
  const fieldParts = fieldRef.split('.');
  const lastPart = fieldParts[fieldParts.length - 1];
  if (isComputedContextField(fieldRef) || isComputedContextField(lastPart)) {
    return true;
  }
  
  // Check if this is a .length access on an array field
  // e.g., game.choices.length -> validate game.choices exists and is an array
  let baseFieldRef = fieldRef;
  const isLengthAccess = fieldRef.endsWith('.length');
  if (isLengthAccess) {
    baseFieldRef = fieldRef.slice(0, -7); // Remove '.length'
  }
  
  // Normalize the reference by removing array notation
  // This converts:
  //   players[*].score -> players.score
  //   players[0].score -> players.score
  //   players[player-123].score -> players.score
  const normalizedRef = baseFieldRef
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
 * Extract field references from JSON Logic expressions.
 * Recursively traverses the logic tree and extracts all {"var": "field.path"} references.
 * 
 * @param logic - JSON Logic expression
 * @returns Array of field paths referenced in the logic
 */
export function extractFieldReferences(logic: any): string[] {
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
