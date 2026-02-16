/**
 * Utility functions for transitions extraction
 */

import { RouterContextSchema } from "#chaincraft/ai/simulate/logic/jsonlogic.js";

// extractFieldsFromJsonSchema removed - use extractSchemaFields from schema-utils.ts instead

/**
 * Format computed context fields list for prompt injection.
 * Creates clear list of exact field names available from router context.
 */
export function formatComputedContextForPrompt(): string {
  const schema = RouterContextSchema.shape;
  let output = "Computed Context Fields (available during precondition evaluation):\n\n";
  
  for (const [fieldName, zodType] of Object.entries(schema)) {
    const description = (zodType as any)._def?.description || "";
    const typeName = (zodType as any)._def?.typeName === "ZodBoolean" ? "boolean" : "number";
    output += `  • ${fieldName} (${typeName}) - ${description}\n`;
  }
  
  output += "\nIMPORTANT: Use these EXACT field names in preconditions. Do NOT invent similar names.";
  
  return output;
}

// formatFieldsListForPrompt removed - fields are now formatted inline

/**
 * Check if JsonLogic contains forbidden array index access to players.
 * Array indices like players[0], players[1] are not allowed.
 * Wildcard patterns like players[*] are allowed.
 */
export function containsForbiddenArrayAccess(logic: any): string | null {
  if (!logic || typeof logic !== 'object') return null;
  
  // Check all string values for player array access patterns
  const checkString = (str: string): string | null => {
    // Match players[0], players[1], etc. but NOT players[*]
    const forbiddenPattern = /players\[(\d+)\]/;
    const match = str.match(forbiddenPattern);
    if (match) {
      return `players[${match[1]}]`;
    }
    return null;
  };
  
  // Recursively check all values in the logic tree
  if (typeof logic === 'string') {
    return checkString(logic);
  }
  
  if (Array.isArray(logic)) {
    for (const item of logic) {
      const result = containsForbiddenArrayAccess(item);
      if (result) return result;
    }
  } else if (typeof logic === 'object') {
    for (const value of Object.values(logic)) {
      if (typeof value === 'string') {
        const result = checkString(value);
        if (result) return result;
      } else {
        const result = containsForbiddenArrayAccess(value);
        if (result) return result;
      }
    }
  }
  
  return null;
}

/**
 * Check if JsonLogic contains explicit player ID references.
 * References like players.player1, players.p1, players.alice are forbidden.
 * ONLY allPlayers/anyPlayer operations should be used to check player fields.
 */
export function containsExplicitPlayerReference(logic: any, parentKey?: string): string | null {
  if (!logic || typeof logic !== 'object') return null;
  
  // If we're inside an allPlayers or anyPlayer operation, explicit player refs are OK
  if (parentKey === 'allPlayers' || parentKey === 'anyPlayer') {
    return null;
  }
  
  // Check if this is a "var" operation with explicit player reference
  if (logic.var && typeof logic.var === 'string') {
    const varPath = logic.var;
    
    // Match patterns like players.player1, players.p1, players.alice
    const explicitPlayerPattern = /^players\.([a-zA-Z_][a-zA-Z0-9_]*)\.(.+)$/;
    const match = varPath.match(explicitPlayerPattern);
    
    if (match) {
      const playerId = match[1];
      const field = match[2];
      return `players.${playerId}.${field}`;
    }
  }
  
  // Recursively check all nested objects and arrays
  if (Array.isArray(logic)) {
    for (const item of logic) {
      const result = containsExplicitPlayerReference(item, parentKey);
      if (result) return result;
    }
  } else if (typeof logic === 'object') {
    for (const [key, value] of Object.entries(logic)) {
      const result = containsExplicitPlayerReference(value, key);
      if (result) return result;
    }
  }
  
  return null;
}
