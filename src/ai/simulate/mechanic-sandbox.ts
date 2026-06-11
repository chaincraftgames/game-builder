/**
 * Mechanic Sandbox
 * 
 * Executes generated mechanic function bodies in an isolated context.
 * The function receives a read-only state and a callLLM callback,
 * and returns a partial state update to be deep-merged by the caller.
 */

import ts from 'typescript';
import { SYSTEM_CONTROLLED_FIELDS } from './graphs/spec-processing-graph/nodes/extract-schema/schema.js';

/**
 * Transpile a TypeScript mechanic module to JavaScript and extract the
 * function body. Handles both full modules (`export async function …`)
 * and raw function bodies (plain JS statements).
 *
 * @param code - TypeScript module source or raw JS function body
 * @returns Plain JavaScript function body suitable for `new Function()`
 */
export function prepareMechanicBody(code: string): string {
  // Transpile TS → JS (strips type annotations, `as` casts, etc.)
  const jsCode = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      removeComments: false,
    },
  }).outputText;

  // If code is a full module with an export function wrapper, extract the body
  const bodyMatch = jsCode.match(
    /export\s+async\s+function\s+\w+\s*\([^)]*\)\s*\{/,
  );
  if (!bodyMatch) {
    // Already a raw function body (or plain JS) — return as-is
    return jsCode.trim();
  }

  // Use the TypeScript AST to locate the exported function's body — this is
  // categorically correct and handles all edge cases (string literals, template
  // expressions, regex literals, comments) that a naive brace counter cannot.
  const sourceFile = ts.createSourceFile(
    'mechanic.js', jsCode, ts.ScriptTarget.ES2022, /* setParentNodes */ true, ts.ScriptKind.JS,
  );
  let functionBody: string | undefined;
  const visit = (node: ts.Node): void => {
    if (functionBody !== undefined) return;
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
      node.body
    ) {
      const start = node.body.getStart(sourceFile) + 1; // after opening '{'
      const end   = node.body.getEnd()             - 1; // before closing '}'
      functionBody = jsCode.slice(start, end).trim();
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  if (functionBody === undefined) {
    throw new Error('prepareMechanicBody: could not locate function body in transpiled code');
  }

  return functionBody;
}

/**
 * Execute a generated mechanic in a sandboxed context.
 * 
 * Accepts either a full TypeScript module (`export async function …`)
 * or a raw JavaScript function body. TypeScript is transpiled and the
 * function body extracted automatically via `prepareMechanicBody`.
 * 
 * @param code - TypeScript module source or raw JS function body
 * @param state - Read-only aliased game state (game, player1, player2, etc.)
 * @param callLLM - Async callback for narrative/creative text generation
 * @param rollDice - Auditable RNG: returns integer from min to max (inclusive)
 * @param generateImage - Async callback for image generation: returns image URL
 * @returns Partial state update to deep-merge into the full state
 */
export async function executeMechanic(
  code: string,
  state: Record<string, any>,
  callLLM: (prompt: string) => Promise<string>,
  rollDice: (min: number, max: number) => number,
  generateImage?: (prompt: string) => Promise<string>,
): Promise<Record<string, any>> {
  const functionBody = prepareMechanicBody(code);

  // Freeze state to enforce read-only contract
  const frozenState = deepFreeze(structuredClone(state));

  // ── Build setter/getter context ──
  // These implement the typed API declared in state-interfaces.ts.
  // `result` accumulates the partial state update that the mechanic produces.
  const result: Record<string, any> = {};

  const setGame = (field: string, value: any) => {
    result.game = result.game ?? {};
    result.game[field] = value;
  };
  // Write-through: reads check the result accumulator first so that values
  // written earlier in the same mechanic execution are visible to later reads.
  const getGame = (field: string) =>
    result.game !== undefined && Object.prototype.hasOwnProperty.call(result.game, field)
      ? result.game[field]
      : (frozenState.game as any)?.[field] ?? null;

  const setPlayer = (playerAlias: string, field: string, value: any) => {
    result[playerAlias] = result[playerAlias] ?? {};
    result[playerAlias][field] = value;
  };
  const getPlayer = (playerAlias: string, field: string) =>
    result[playerAlias] !== undefined && Object.prototype.hasOwnProperty.call(result[playerAlias], field)
      ? result[playerAlias][field]
      : (frozenState[playerAlias] as any)?.[field] ?? null;

  const setPublicMessage = (message: string) => {
    result.game = result.game ?? {};
    result.game.publicMessage = message;
  };
  const setPrivateMessage = (playerAlias: string, message: string) => {
    result.privateMessages = result.privateMessages ?? {};
    result.privateMessages[playerAlias] = message;
  };
  const rejectAction = (errorMessage: string) => {
    // Overwrite everything in result with only the illegalAction signal
    Object.keys(result).forEach(k => delete result[k]);
    result.illegalAction = { errorMessage };
  };
  const buildResult = () => result;

  // generateImage fallback: no-op that returns empty string if not provided
  const generateImageFn = generateImage ?? (async () => {
    console.warn('[mechanic-sandbox] generateImage called but no implementation provided — returning empty string');
    return '';
  });

  // Wrap the function body in a strict-mode async function
  // Strict mode ensures frozen state throws on mutation attempts
  const fn = new Function(
    "state",
    "callLLM",
    "rollDice",
    "generateImage",
    "setGame",
    "getGame",
    "setPlayer",
    "getPlayer",
    "setPublicMessage",
    "setPrivateMessage",
    "rejectAction",
    "buildResult",
    `"use strict";\nreturn (async () => {\n${functionBody}\n})();`,
  ) as (
    state: Record<string, any>,
    callLLM: (prompt: string) => Promise<string>,
    rollDice: (min: number, max: number) => number,
    generateImage: (prompt: string) => Promise<string>,
    setGame: (field: string, value: any) => void,
    getGame: (field: string) => any,
    setPlayer: (playerAlias: string, field: string, value: any) => void,
    getPlayer: (playerAlias: string, field: string) => any,
    setPublicMessage: (message: string) => void,
    setPrivateMessage: (playerAlias: string, message: string) => void,
    rejectAction: (errorMessage: string) => void,
    buildResult: () => Record<string, any>,
  ) => Promise<Record<string, any>>;

  const mechanicResult = await fn(
    frozenState, callLLM, rollDice, generateImageFn,
    setGame, getGame, setPlayer, getPlayer,
    setPublicMessage, setPrivateMessage, rejectAction, buildResult,
  );

  // Mechanics using the new setter API call buildResult() which returns the
  // accumulated `result` object. Mechanics using the old direct-return style
  // return their own object. Either way we merge/use the final value.
  // Prefer the returned value if it's non-empty; fall back to the accumulated result.
  const finalResult = (mechanicResult && typeof mechanicResult === 'object' && !Array.isArray(mechanicResult))
    ? mechanicResult
    : result;

  // Validate return is a plain object (or empty)
  if (finalResult === undefined || finalResult === null) {
    return {};
  }
  if (typeof finalResult !== "object" || Array.isArray(finalResult)) {
    throw new Error(
      `Generated mechanic must return a partial state object, got: ${typeof finalResult}`,
    );
  }

  // Strip system-controlled fields from mechanic output (belt-and-suspenders).
  // TSC validation at generation time should already prevent these, but runtime
  // stripping guarantees the router stays the single authority over phase/game-end.
  if (finalResult.game && typeof finalResult.game === 'object') {
    for (const field of SYSTEM_CONTROLLED_FIELDS) {
      if (field in finalResult.game) {
        console.warn(
          `[mechanic-sandbox] Stripping system-controlled field 'game.${field}' from mechanic output. ` +
          `This field is managed exclusively by the router.`
        );
        delete finalResult.game[field];
      }
    }
  }

  return finalResult;
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
