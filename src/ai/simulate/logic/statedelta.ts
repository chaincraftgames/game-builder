/**
 * StateDelta Operations Module
 * 
 * Defines atomic state mutation operations for deterministic game state updates.
 * These operations are the building blocks for both deterministic instructions
 * and LLM-generated state changes.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Get a value from an object using dot-notation path
 */
function getByPath(obj: any, path: string): any {
  const keys = path.split(".");
  let current = obj;
  for (const key of keys) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Set a value in an object using dot-notation path, creating nested objects as needed
 */
function setByPath(obj: any, path: string, value: any): void {
  const keys = path.split(".");
  const lastKey = keys.pop()!;
  let current = obj;
  
  for (const key of keys) {
    if (!(key in current) || current[key] == null || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }
  
  current[lastKey] = value;
}

/**
 * Deep clone an object
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Set operation: assigns a value to a path, creating nested objects as needed
 */
export const SetOpSchema = z.object({
  op: z.literal("set"),
  path: z.string().describe("Dot-notation path (e.g., 'game.phase', 'players.p1.score')"),
  value: z.any().describe("Value to set at the path"),
});

/**
 * Increment operation: adds a numeric value to the current value at path
 * 
 * Note: value can be a string template variable (e.g., "{{trustChange}}") in instruction artifacts.
 * These templates must be resolved to actual numbers before applying the operation.
 */
export const IncrementOpSchema = z.object({
  op: z.literal("increment"),
  path: z.string().describe("Dot-notation path to a numeric field"),
  value: z.union([z.number(), z.string()]).describe("Amount to add (can be negative for decrement). Can be a number or template variable like {{amount}}"),
});

/**
 * Append operation: adds an item to an array at path
 */
export const AppendOpSchema = z.object({
  op: z.literal("append"),
  path: z.string().describe("Dot-notation path to an array field"),
  value: z.any().describe("Value to append to the array"),
});

/**
 * Delete operation: removes a field from the state
 */
export const DeleteOpSchema = z.object({
  op: z.literal("delete"),
  path: z.string().describe("Dot-notation path to delete"),
});

/**
 * Transfer operation: moves a numeric value from one path to another
 * 
 * Note: value can be a string template variable in instruction artifacts.
 * These templates must be resolved to actual numbers before applying the operation.
 */
export const TransferOpSchema = z.object({
  op: z.literal("transfer"),
  fromPath: z.string().describe("Source path for the value"),
  toPath: z.string().describe("Destination path for the value"),
  value: z.union([z.number(), z.string()]).optional().describe("Amount to transfer (defaults to entire value at fromPath). Can be a number or template variable like {{amount}}"),
});

/**
 * Merge operation: shallow merges an object into the object at path
 */
export const MergeOpSchema = z.object({
  op: z.literal("merge"),
  path: z.string().describe("Dot-notation path to an object"),
  value: z.record(z.any()).describe("Object properties to merge"),
});

/**
 * RNG operation: randomly selects a value from choices with given probabilities
 * NOTE: This operation is PRE-PROCESSED by the router before execution.
 * The router converts it to a set operation with a concrete random value.
 */
export const RngOpSchema = z.object({
  op: z.literal("rng"),
  path: z.string().describe("Dot-notation path where the random value will be set"),
  choices: z.array(z.any()).describe("Array of possible values to choose from"),
  probabilities: z.array(z.number()).describe("Array of probabilities for each choice (must sum to ~1.0)"),
});

/**
 * Union of all state delta operations
 */
export const StateDeltaOpSchema = z.discriminatedUnion("op", [
  SetOpSchema,
  IncrementOpSchema,
  AppendOpSchema,
  DeleteOpSchema,
  TransferOpSchema,
  MergeOpSchema,
  RngOpSchema,
]);

/**
 * Array of state delta operations (typical for instruction execution)
 */
export const StateDeltaArraySchema = z.array(StateDeltaOpSchema);

export type StateDeltaOp = z.infer<typeof StateDeltaOpSchema>;
export type SetOp = z.infer<typeof SetOpSchema>;
export type IncrementOp = z.infer<typeof IncrementOpSchema>;
export type AppendOp = z.infer<typeof AppendOpSchema>;
export type DeleteOp = z.infer<typeof DeleteOpSchema>;
export type TransferOp = z.infer<typeof TransferOpSchema>;
export type RngOp = z.infer<typeof RngOpSchema>;
export type MergeOp = z.infer<typeof MergeOpSchema>;

// JSON schema exports for prompt injection
export const StateDeltaOpSchemaJson = zodToJsonSchema(StateDeltaOpSchema, "StateDeltaOp");
export const StateDeltaArraySchemaJson = zodToJsonSchema(StateDeltaArraySchema, "StateDeltaArray");

/**
 * Result of applying state deltas
 */
export interface ApplyDeltaResult {
  success: boolean;
  newState?: any;
  errors?: Array<{
    op: StateDeltaOp;
    error: string;
  }>;
}

/**
 * Applies a single state delta operation to the state object.
 * Returns an error string if the operation fails, or null on success.
 */
function applySingleOp(state: any, op: StateDeltaOp): string | null {
  try {
    switch (op.op) {
      case "set": {
        setByPath(state, op.path, op.value);
        return null;
      }

      case "increment": {
        const currentValue = getByPath(state, op.path);
        if (typeof currentValue !== "number") {
          return `Path ${op.path} is not a number (current: ${typeof currentValue})`;
        }
        // Ensure value is resolved to a number (templates must be resolved before applying)
        if (typeof op.value !== "number") {
          return `Increment value must be a resolved number, got: ${typeof op.value}. Template variables like {{amount}} must be resolved before applying operations.`;
        }
        setByPath(state, op.path, currentValue + op.value);
        return null;
      }

      case "append": {
        const currentValue = getByPath(state, op.path);
        if (!Array.isArray(currentValue)) {
          return `Path ${op.path} is not an array (current: ${typeof currentValue})`;
        }
        currentValue.push(op.value);
        return null;
      }

      case "delete": {
        const pathParts = op.path.split(".");
        const lastKey = pathParts.pop();
        if (!lastKey) {
          return `Invalid path for delete: ${op.path}`;
        }
        const parentPath = pathParts.join(".");
        const parent = parentPath ? getByPath(state, parentPath) : state;
        if (parent && typeof parent === "object") {
          delete parent[lastKey];
        }
        return null;
      }

      case "transfer": {
        const fromValue = getByPath(state, op.fromPath);
        if (typeof fromValue !== "number") {
          return `Source path ${op.fromPath} is not a number (current: ${typeof fromValue})`;
        }
        
        const toValue = getByPath(state, op.toPath);
        if (toValue !== undefined && typeof toValue !== "number") {
          return `Destination path ${op.toPath} exists but is not a number (current: ${typeof toValue})`;
        }

        const transferAmount = op.value !== undefined ? op.value : fromValue;
        
        // Ensure value is resolved to a number (templates must be resolved before applying)
        if (typeof transferAmount !== "number") {
          return `Transfer value must be a resolved number, got: ${typeof transferAmount}. Template variables like {{amount}} must be resolved before applying operations.`;
        }
        
        if (transferAmount > fromValue) {
          return `Cannot transfer ${transferAmount} from ${op.fromPath} (current: ${fromValue})`;
        }

        setByPath(state, op.fromPath, fromValue - transferAmount);
        setByPath(state, op.toPath, (toValue || 0) + transferAmount);
        return null;
      }

      case "merge": {
        const currentValue = getByPath(state, op.path);
        if (currentValue !== undefined && (typeof currentValue !== "object" || Array.isArray(currentValue))) {
          return `Path ${op.path} is not an object (current: ${typeof currentValue})`;
        }
        const merged = { ...currentValue, ...op.value };
        setByPath(state, op.path, merged);
        return null;
      }

      default:
        return `Unknown operation type: ${(op as any).op}`;
    }
  } catch (err: any) {
    return `Unexpected error applying op: ${err.message || err}`;
  }
}

/**
 * Applies an array of state delta operations to a state object.
 * Returns a deep clone of the state with all operations applied.
 * 
 * Operations are applied sequentially. If any operation fails, the function
 * returns the error details and the state up to that point.
 * 
 * @param state - The initial state object (will not be modified)
 * @param deltas - Array of state delta operations to apply
 * @returns Result containing the new state or errors
 */
export function applyStateDeltas(state: any, deltas: StateDeltaOp[]): ApplyDeltaResult {
  // Validate all deltas first
  const validationErrors: Array<{ op: StateDeltaOp; error: string }> = [];
  
  for (const delta of deltas) {
    const parsed = StateDeltaOpSchema.safeParse(delta);
    if (!parsed.success) {
      validationErrors.push({
        op: delta,
        error: `Schema validation failed: ${parsed.error.errors.map(e => e.message).join(", ")}`,
      });
    }
  }

  if (validationErrors.length > 0) {
    return {
      success: false,
      errors: validationErrors,
    };
  }

  // Deep clone the state to avoid mutations
  const newState = deepClone(state);
  const applicationErrors: Array<{ op: StateDeltaOp; error: string }> = [];

  // Apply each delta sequentially
  for (const delta of deltas) {
    const error = applySingleOp(newState, delta);
    if (error) {
      applicationErrors.push({ op: delta, error });
    }
  }

  if (applicationErrors.length > 0) {
    return {
      success: false,
      newState,
      errors: applicationErrors,
    };
  }

  return {
    success: true,
    newState,
  };
}

/**
 * Validates a state delta array against the schema.
 * Returns detailed error information if validation fails.
 */
export function validateStateDeltas(deltas: unknown): { 
  valid: boolean; 
  errors?: string[]; 
  parsed?: StateDeltaOp[] 
} {
  const result = StateDeltaArraySchema.safeParse(deltas);
  
  if (result.success) {
    return { valid: true, parsed: result.data };
  }

  return {
    valid: false,
    errors: result.error.errors.map(e => `${e.path.join(".")}: ${e.message}`),
  };
}

/**
 * Template variable pattern: {{variableName}}
 */
const TEMPLATE_VARIABLE_PATTERN = /\{\{([^}]+)\}\}/g;

/**
 * Check if a value contains template variables ({{var}})
 */
export function hasTemplateVariables(value: any): boolean {
  if (value === null || value === undefined) return false;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return TEMPLATE_VARIABLE_PATTERN.test(str);
}

/**
 * Resolve template variables in a value using the provided variable map.
 * Template variables use {{variableName}} syntax.
 * 
 * @param template - Value that may contain {{variable}} placeholders
 * @param variables - Map of variable names to values
 * @returns Resolved value with all templates replaced
 * 
 * @example
 * resolveTemplates("players.{{playerId}}.score", { playerId: "p1" })
 * // Returns: "players.p1.score"
 * 
 * resolveTemplates({ winner: "{{winnerId}}" }, { winnerId: "p1" })
 * // Returns: { winner: "p1" }
 */
export function resolveTemplates<T = any>(
  template: T,
  variables: Record<string, any>
): T {
  if (template === null || template === undefined) {
    return template;
  }

  // For strings, do direct replacement
  if (typeof template === 'string') {
    // If the entire string is just a template variable, return the value directly
    // This preserves type (e.g., numbers, booleans)
    const wholeMatch = template.match(/^\{\{([^}]+)\}\}$/);
    if (wholeMatch) {
      const varName = wholeMatch[1].trim();
      const value = variables[varName];
      return (value !== undefined ? value : template) as T;
    }
    
    // Otherwise do string interpolation
    return template.replace(TEMPLATE_VARIABLE_PATTERN, (match, varName) => {
      const trimmedName = varName.trim();
      const value = variables[trimmedName];
      return value !== undefined ? String(value) : match;
    }) as T;
  }

  // For objects/arrays, recursively resolve
  if (Array.isArray(template)) {
    return template.map(item => resolveTemplates(item, variables)) as T;
  }

  if (typeof template === 'object') {
    const resolved: any = {};
    for (const [key, value] of Object.entries(template)) {
      resolved[key] = resolveTemplates(value, variables);
    }
    return resolved;
  }

  // For other types (number, boolean), return as-is
  return template;
}

/**
 * Resolve templates in a stateDelta operation array.
 * Returns a new array with all template variables replaced with literal values.
 * 
 * @param templateOps - Array of delta operations that may contain {{variable}} placeholders
 * @param variables - Map of variable names to values
 * @returns New array with resolved operations (literal values only)
 */
export function resolveStateDeltaTemplates(
  templateOps: StateDeltaOp[],
  variables: Record<string, any>
): StateDeltaOp[] {
  return templateOps.map(op => resolveTemplates(op, variables));
}

/**
 * Extract all template variable names from a value.
 * 
 * @param value - Value that may contain {{variable}} placeholders
 * @returns Array of unique variable names found
 * 
 * @example
 * extractTemplateVariables("players.{{playerId}}.{{field}}")
 * // Returns: ["playerId", "field"]
 */
export function extractTemplateVariables(value: any): string[] {
  if (value === null || value === undefined) return [];
  
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  const matches = str.matchAll(TEMPLATE_VARIABLE_PATTERN);
  const variables = new Set<string>();
  
  for (const match of matches) {
    variables.add(match[1].trim());
  }
  
  return Array.from(variables);
}

export default {
  StateDeltaOpSchema,
  StateDeltaArraySchema,
  StateDeltaOpSchemaJson,
  StateDeltaArraySchemaJson,
  applyStateDeltas,
  validateStateDeltas,
  hasTemplateVariables,
  resolveTemplates,
  resolveStateDeltaTemplates,
  extractTemplateVariables,
};
