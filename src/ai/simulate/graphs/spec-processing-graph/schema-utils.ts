/**
 * Schema Utilities for Spec Processing
 * 
 * Shared utilities for extracting and validating field references against JSON Schema.
 * Used by multiple nodes (validate-transitions, extract-instructions) to ensure
 * consistency in field validation.
 */

import { RouterContextSchema } from '#chaincraft/ai/simulate/logic/jsonlogic.js';

/**
 * Extract all field paths from a JSON Schema.
 * Handles:
 * - Object properties (fixed fields)
 * - Array items (items.properties)
 * - Record/map structures (additionalProperties)
 * 
 * @param schema - JSON Schema object
 * @returns Set of dot-notation field paths (e.g., "game.currentPhase", "players.score")
 */
export function extractSchemaFields(schema: any): Set<string> {
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
