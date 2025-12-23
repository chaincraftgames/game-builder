import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import jsonLogic from "json-logic-js";
import { BaseRuntimeState } from "#chaincraft/ai/simulate/schema.js";
import { RuntimePlayerState } from "#chaincraft/api/simulate/schemas.js";

// JsonLogic primitive and recursive node schema (permissive)
const JsonLogicPrimitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const JsonLogicNode: z.ZodType<any> = z.lazy(() =>
  z.union([
    JsonLogicPrimitive,
    z.array(JsonLogicNode),
    z.record(z.string(), z.union([JsonLogicPrimitive, JsonLogicNode, z.array(JsonLogicNode)])),
  ]),
);

export const JsonLogicSchema = JsonLogicNode;
export const JsonLogicSchemaJson = zodToJsonSchema(JsonLogicSchema, "JsonLogic");
export type JsonLogic = z.infer<typeof JsonLogicSchema>;

/**
 * Register custom JSON Logic operations for player queries
 * Format: {"anyPlayer": {"field": "score", "op": ">=", "value": 3}}
 * or shorthand array (json-logic will NOT evaluate): {"anyPlayer": ["score", ">=", 3]}
 */
// NOTE: json-logic-js custom operations receive (arg1, arg2, arg3, ...) as individual arguments
// NOT (data, arg). The data context is accessed via 'this' which json-logic sets up.
// Array format works: {"anyPlayer": ["score", ">=", 3]} passes 3 arguments: "score", ">=", 3

jsonLogic.add_operation("allPlayers", function(this: any, field: string, operator: string, value: any) {
  // Access the data context - json-logic binds 'this' to the data
  const data = this;
  const players = data.players ? Object.values(data.players) : [];
  if (players.length === 0) return true; // vacuous truth
  
  return players.every((player: any) => {
    const fieldValue = player[field];
    const logic = { [operator]: [fieldValue, value] };
    return jsonLogic.apply(logic, data);
  });
});

jsonLogic.add_operation("anyPlayer", function(this: any, field: string, operator: string, value: any) {
  // Access the data context - json-logic binds 'this' to the data
  const data = this;
  const players = data.players ? Object.values(data.players) : [];
  
  return players.some((player: any) => {
    const fieldValue = player[field];
    const logic = { [operator]: [fieldValue, value] };
    return jsonLogic.apply(logic, data);
  });
});

/**
 * Custom lookup operation for dynamic array/object access.
 * Enables accessing array elements or object properties using variable indices/keys.
 * 
 * Format: {"lookup": [collection, index]}
 * - collection: JsonLogic expression that resolves to an array or object
 * - index: JsonLogic expression that resolves to a number (for arrays) or string (for objects)
 * 
 * Examples:
 * - {"lookup": [{"var": "game.deadlyOptions"}, {"var": "game.currentTurn"}]}
 * - {"lookup": [{"var": "game.rounds"}, {"var": "game.currentRound"}]}
 * 
 * Returns: The value at the specified index/key, or undefined if not found
 */
jsonLogic.add_operation("lookup", function(this: any, collectionExpr: any, indexExpr: any) {
  // Access the data context - json-logic binds 'this' to the data
  const data = this;
  
  // Evaluate the collection expression to get the array/object
  const collection = jsonLogic.apply(collectionExpr, data);
  
  // Evaluate the index expression to get the index/key
  const index = jsonLogic.apply(indexExpr, data);
  
  // Handle null/undefined gracefully
  if (collection === null || collection === undefined) {
    return undefined;
  }
  
  // Access the element
  return collection[index];
});

// Export the configured jsonLogic instance with custom operations registered
export { jsonLogic };

/**
 * Supported json-logic-js operations.
 * These are the operations that json-logic-js actually implements.
 * Operations not in this list will fail at runtime.
 */
const SUPPORTED_JSONLOGIC_OPERATIONS = new Set([
  // Comparison
  '==', '===', '!=', '!==', '>', '>=', '<', '<=',
  // Logic
  '!', '!!', 'and', 'or', 'if',
  // Arithmetic
  '+', '-', '*', '/', '%', 'max', 'min',
  // Array
  'map', 'filter', 'all', 'none', 'some', 'merge',
  // String
  'in', 'cat', 'substr',
  // Misc
  'var', 'missing', 'missing_some', 'log',
  // Custom operations
  'allPlayers', 'anyPlayer', 'lookup',
]);

/**
 * Validate that a JsonLogic expression only uses supported operations.
 * Returns an array of unsupported operations found (empty if valid).
 */
export function validateJsonLogicOperations(logic: any): string[] {
  const unsupported: string[] = [];
  
  const check = (obj: any): void => {
    if (!obj || typeof obj !== 'object') return;
    
    if (Array.isArray(obj)) {
      obj.forEach(check);
      return;
    }
    
    // Check each key - if it's an operation, validate it
    for (const [key, value] of Object.entries(obj)) {
      // Validate custom player operations format (must be array: ["field", "op", value])
      if (key === 'anyPlayer' || key === 'allPlayers') {
        if (!Array.isArray(value) || value.length !== 3 || typeof value[0] !== 'string' || typeof value[1] !== 'string') {
          unsupported.push(`${key}:must-be-array-format-[field,op,value]`);
        }
        continue; // Don't recurse into the array
      }
      
      // If the key is an operation (not 'var' arguments)
      if (key !== 'var' && !SUPPORTED_JSONLOGIC_OPERATIONS.has(key)) {
        // Skip keys that look like properties (e.g., 'accumulator', 'currentItem')
        // Only flag keys that are being used as operations
        if (typeof value === 'object' || Array.isArray(value)) {
          unsupported.push(key);
        }
      }
      check(value);
    }
  };
  
  check(logic);
  return [...new Set(unsupported)]; // Deduplicate
}

// Router context schema: the small, curated set of fields the router will compute
export const RouterContextSchema = z
  .object({
    playersCount: z
      .number()
      .int()
      .nonnegative()
      .describe("Total number of players in the game"),
    playersRequiringActionCount: z
      .number()
      .int()
      .nonnegative()
      .describe("Number of players who still need to act"),
    allPlayersCompletedActions: z
      .boolean()
      .describe("True when all players have completed their actions"),
  })
  .describe(
    "Computed context fields available during precondition evaluation. " +
    "NOTE: Preconditions also have access to custom JsonLogic operations for player queries: " +
    "1) 'allPlayers': Returns true if ALL players satisfy condition. Format: {allPlayers: ['fieldName', 'operator', value]}. Example: {allPlayers: ['score', '<', 3]} checks if every player's score < 3. " +
    "2) 'anyPlayer': Returns true if ANY player satisfies condition. Format: {anyPlayer: ['fieldName', 'operator', value]}. Example: {anyPlayer: ['score', '>=', 3]} checks if any player's score >= 3. " +
    "Operators: ==, !=, >, >=, <, <="
  );

export type RouterContext = z.infer<typeof RouterContextSchema>;
export const RouterContextSchemaJson = zodToJsonSchema(RouterContextSchema, "RouterContext");

/**
 * Build a small router context from canonical state.
 * The `state` parameter is expected to be the canonical game state object produced by the extractor.
 */
export function buildRouterContext(state: BaseRuntimeState): RouterContext {
  const players = Array.isArray(state?.players) ? state.players : [];
  const playersCount = players.length;

  const playersRequiringActionCount = players.reduce((acc: number, p: RuntimePlayerState) => {
    if (p?.actionRequired) return acc + 1;
    return acc;
  }, 0);

  const allPlayersCompletedActions = playersCount > 0 ? playersRequiringActionCount === 0 : true;

  const ctx: RouterContext = {
    playersCount,
    playersRequiringActionCount,
    allPlayersCompletedActions,
  };

  return ctx;
}

/**
 * Evaluate a JsonLogic expression against the provided context.
 * Returns an object containing the `result` and optional `diagnostics` when validation fails.
 */
export function evaluateJsonLogic(logic: any, context: any): { result: any; diagnostics?: any } {
  const diagnostics: any = {};

  const parsed = JsonLogicSchema.safeParse(logic);
  if (!parsed.success) {
    diagnostics.logicValid = false;
    diagnostics.logicErrors = parsed.error.errors.map((e) => e.message);
    return { result: null, diagnostics };
  }

  const ctxParsed = RouterContextSchema.safeParse(context);
  if (!ctxParsed.success) {
    diagnostics.contextValid = false;
    diagnostics.contextErrors = ctxParsed.error.errors.map((e) => e.message);
    return { result: null, diagnostics };
  }

  try {
    const result = jsonLogic.apply(logic, context);
    return { result };
  } catch (err: any) {
    diagnostics.runtimeError = String(err?.message ?? err);
    return { result: null, diagnostics };
  }
}

export default {
  JsonLogicSchema,
  JsonLogicSchemaJson,
  RouterContextSchema,
  buildRouterContext,
  evaluateJsonLogic,
  validateJsonLogicOperations,
};
