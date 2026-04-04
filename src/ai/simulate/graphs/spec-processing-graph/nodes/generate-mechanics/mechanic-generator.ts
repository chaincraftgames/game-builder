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
 * Strip markdown code fences from LLM output.
 */
function stripMarkdownFences(code: string): string {
  return code
    .replace(/^```(?:typescript|ts)?\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
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

  // 5. Return result — always include code (needed for repair even on failure)
  return {
    mechanicId: target.id,
    code,
    valid: tscResult.valid,
    ...(tscResult.errors.length > 0 ? { errors: tscResult.errors } : {}),
  };
}
