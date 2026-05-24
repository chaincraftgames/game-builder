/**
 * Mechanic Generator
 *
 * Generates and validates a single TypeScript mechanic function.
 * Designed to be called per-mechanic (one Send target per invocation).
 *
 * Flow: format prompt → LLM call → strip fences → tsc validate → result
 *
 * See: GENERATED_MECHANICS_DESIGN.md §6, §7
 */

import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import type { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { validateMechanics } from "./tsc-validator.js";
import { generateMechanicTsPrompt, repairContextSection } from "./prompts.js";
import type { MechanicTarget, GenerateMechanicResult } from "./schema.js";

/**
 * Scan generated mechanic code for fields written via setGame/setPlayer.
 * Returns a set of dot-paths like "game.challengeWinnerId" or "players.*.diceCount".
 * Used for precondition coverage validation.
 */
export function scanWrittenFields(code: string): Set<string> {
  const written = new Set<string>();
  // setGame('fieldName', ...) → game.fieldName
  for (const m of code.matchAll(/\bsetGame\(\s*['"`]([^'"`]+)['"`]/g)) {
    written.add(`game.${m[1]}`);
  }
  // setPlayer(anyExpr, 'fieldName', ...) → players.*.fieldName
  for (const m of code.matchAll(/\bsetPlayer\([^,]+,\s*['"`]([^'"`]+)['"`]/g)) {
    written.add(`players.*.${m[1]}`);
  }
  return written;
}

/**
 * Strip markdown code fences from LLM output.
 * Handles both:
 * - Pure code block (```typescript\n...\n```)
 * - Prose + code block (LLM explains itself before the code)
 */
function stripMarkdownFences(code: string): string {
  // If there's a code fence anywhere in the response, extract its contents
  const fenceMatch = code.match(/```(?:typescript|ts)?\n([\s\S]*?)\n?```/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  // No code fence found — return trimmed as-is
  return code.trim();
}

/**
 * Generate and validate a single mechanic.
 *
 * 1. Formats the generation prompt with target instructions + state interfaces
 * 2. Calls the LLM to produce TypeScript code
 * 3. Strips markdown fences if present
 * 4. Validates the code against state interfaces using in-memory tsc
 * 5. Returns the result with code (always) and errors (if validation failed)
 *
 * @param model - LLM model for code generation
 * @param target - Mechanic target (transition/action ID, instructions, function name)
 * @param stateInterfaces - TypeScript interfaces source (from generateStateInterfaces)
 * @returns Generation result: always includes code, includes errors only if tsc failed
 */
export async function generateAndValidateMechanic(
  model: ModelWithOptions,
  target: MechanicTarget,
  stateInterfaces: string,
): Promise<GenerateMechanicResult> {
  // 1. Format the generation prompt
  const promptTemplate = SystemMessagePromptTemplate.fromTemplate(
    generateMechanicTsPrompt,
  );
  const systemMessage = await promptTemplate.format({
    stateInterfaces,
    functionName: target.functionName,
    targetId: target.id,
    targetType: target.type,
    instructions: target.instructions,
    messageGuidance: target.messageGuidance || "",
  });

  // 1b. Append repair context if present (retry with tsc error feedback)
  let systemPrompt = systemMessage.content as string;
  if (target.repairContext) {
    const repairTemplate = SystemMessagePromptTemplate.fromTemplate(
      repairContextSection,
    );
    const repairMessage = await repairTemplate.format({
      previousCode: target.repairContext.previousCode,
      tscErrors: target.repairContext.tscErrors.map((e, i) => `${i + 1}. ${e}`).join("\n"),
    });
    systemPrompt += repairMessage.content as string;
  }

  // 2. Call LLM
  const response = await model.invokeWithSystemPrompt(
    systemPrompt,
    "Generate the TypeScript function now.",
    {
      agent: "mechanic-generator",
      workflow: "spec-processing",
      mechanicId: target.id,
    },
  );

  // 3. Extract and clean code from response
  const rawCode =
    typeof response === "string"
      ? response
      : (response?.content ?? String(response));
  const code = stripMarkdownFences(rawCode);

  // 4. Validate with tsc
  const tscResult = validateMechanics(stateInterfaces, {
    [target.id]: code,
  });

  // 4b. Scan for `as any` usage — bypasses typed setter enforcement
  const asAnyMatches = [...code.matchAll(/\bas\s+any\b/g)];
  const asAnyErrors: string[] = asAnyMatches.map((m) => {
    const lineNum = code.slice(0, m.index).split('\n').length;
    return `Forbidden: 'as any' at line ${lineNum} bypasses type-safe setter enforcement. Use setGame/setPlayer with a typed value instead.`;
  });

  const allErrors = [...(tscResult.errors ?? []), ...asAnyErrors.map(msg => ({
    code: 0,
    message: msg,
    mechanicId: target.id,
    line: 0,
    column: 0,
  }))];

  // 5. Return result — always include code (needed for repair even on failure)
  return {
    mechanicId: target.id,
    code,
    valid: tscResult.valid && asAnyErrors.length === 0,
    ...(allErrors.length > 0 ? { errors: allErrors } : {}),
    writtenFields: [...scanWrittenFields(code)],
  };
}
