/**
 * Mechanic Sandbox
 * 
 * Executes generated mechanic function bodies in an isolated context.
 * The function receives a read-only state and a callLLM callback,
 * and returns a partial state update to be deep-merged by the caller.
 */

/**
 * Execute a generated mechanic function body in a sandboxed context.
 * 
 * @param functionBody - The generated JS function body (code string)
 * @param state - Read-only aliased game state (game, player1, player2, etc.)
 * @param callLLM - Async callback for narrative/creative text generation
 * @returns Partial state update to deep-merge into the full state
 */
export async function executeMechanic(
  functionBody: string,
  state: Record<string, any>,
  callLLM: (prompt: string) => Promise<string>,
): Promise<Record<string, any>> {
  // Freeze state to enforce read-only contract
  const frozenState = deepFreeze(structuredClone(state));

  // Wrap the function body in a strict-mode async function
  // Strict mode ensures frozen state throws on mutation attempts
  const fn = new Function(
    "state",
    "callLLM",
    `"use strict";\nreturn (async () => {\n${functionBody}\n})();`,
  ) as (
    state: Record<string, any>,
    callLLM: (prompt: string) => Promise<string>,
  ) => Promise<Record<string, any>>;

  const result = await fn(frozenState, callLLM);

  // Validate return is a plain object (or empty)
  if (result === undefined || result === null) {
    return {};
  }
  if (typeof result !== "object" || Array.isArray(result)) {
    throw new Error(
      `Generated mechanic must return a partial state object, got: ${typeof result}`,
    );
  }

  return result;
}

/**
 * Deep-merge a partial state update into a full state object.
 * Arrays are replaced, not concatenated.
 */
export function deepMergeState(
  target: Record<string, any>,
  partial: Record<string, any>,
): Record<string, any> {
  const result = structuredClone(target);

  for (const [key, value] of Object.entries(partial)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      // Recurse for nested objects
      result[key] = deepMergeState(result[key], value);
    } else {
      // Primitive, array, or null — replace
      result[key] = structuredClone(value);
    }
  }

  return result;
}

/**
 * Deep-freeze an object to prevent mutation.
 */
function deepFreeze<T extends Record<string, any>>(obj: T): Readonly<T> {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}
