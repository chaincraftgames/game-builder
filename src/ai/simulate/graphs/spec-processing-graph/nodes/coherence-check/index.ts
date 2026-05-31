/**
 * Coherence Check Node
 *
 * Runs after all artifacts (schema, transitions, instructions, mechanics) have been
 * generated. Makes a single Sonnet call to detect cross-artifact inconsistencies that
 * sequential artifact generation cannot catch on its own.
 *
 * Inputs from state:
 *   - stateTransitions     — JSON string of TransitionsArtifact
 *   - playerPhaseInstructions — Record<phaseId, JSON string of PlayerPhaseInstructions>
 *   - transitionInstructions  — Record<transitionId, JSON string of AutomaticTransitionInstruction>
 *   - generatedMechanics      — Record<mechanicId, TypeScript source string>
 *
 * Output to state:
 *   - coherenceFindings — CoherenceCheckOutput (hasIssues + issues[])
 *
 * Pre-processing (all done in-process, no extra LLM calls):
 *   1. formatTransitionsJson     — strips display fields, keeps id/fromPhase/toPhase/requiresPlayerInput/preconditions
 *   2. formatInstructionsSummary — two sections: player action phases + automatic transitions
 *      (stateDelta write paths + messages + mechanicsGuidance summary)
 *   3. formatMechanicFieldIo     — per-mechanic read/write path summaries via regex scan
 */

import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { setupSpecInstructionsModel } from "#chaincraft/ai/model-config.js";
import type { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import type { GameCreationBus } from "#chaincraft/events/game-creation-status-bus.js";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  CoherenceCheckOutputSchema,
  type CoherenceCheckOutput,
  type CoherenceIssue,
  type MechanicFieldIo,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/coherence-check/schema.js";
import {
  coherenceCheckSystemPromptTemplate,
  coherenceCheckUserPromptTemplate,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/coherence-check/prompts.js";
import {
  PRE_VALIDATORS,
  type MechanicMessageInfo,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/coherence-check/pre-validators.js";
import { COHERENCE_ISSUE_DEFINITIONS } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/coherence-check/issue-definitions.js";

// ---------------------------------------------------------------------------
// Field I/O extraction from mechanic code
// ---------------------------------------------------------------------------

/**
 * Scan mechanic source code for fields read via getGame/getPlayer.
 * Returns dot-paths like "game.currentPhase" or "players.*.currentAction".
 */
function scanReadFields(code: string): Set<string> {
  const read = new Set<string>();
  // getGame('fieldName') → game.fieldName
  for (const m of code.matchAll(/\bgetGame\(\s*['"`]([^'"`]+)['"`]/g)) {
    read.add(`game.${m[1]}`);
  }
  // getPlayer(anyExpr, 'fieldName') → players.*.fieldName
  for (const m of code.matchAll(/\bgetPlayer\([^,]+,\s*['"`]([^'"`]+)['"`]/g)) {
    read.add(`players.*.${m[1]}`);
  }
  return read;
}

/**
 * Scan mechanic source code for fields written via setGame/setPlayer.
 * Returns dot-paths like "game.challengeWinnerId" or "players.*.diceCount".
 */
function scanWrittenFieldsLocal(code: string): Set<string> {
  const written = new Set<string>();
  for (const m of code.matchAll(/\bsetGame\(\s*['"`]([^'"`]+)['"`]/g)) {
    written.add(`game.${m[1]}`);
  }
  for (const m of code.matchAll(/\bsetPlayer\([^,]+,\s*['"`]([^'"`]+)['"`]/g)) {
    written.add(`players.*.${m[1]}`);
  }
  return written;
}

// ---------------------------------------------------------------------------
// StateDelta path extraction
// ---------------------------------------------------------------------------

/**
 * Extract all field paths written by a stateDelta ops array.
 * Handles set/increment/append/merge/rng (path), transfer (toPath),
 * setForAllPlayers/setForRandomPlayer (players.*.{field}), delete (path).
 * setFromMap/setFromDataSource: uses `path` field.
 */
function extractStateDeltaWritePaths(ops: any[]): string[] {
  const paths: string[] = [];
  if (!Array.isArray(ops)) return paths;
  for (const op of ops) {
    if (!op || typeof op.op !== "string") continue;
    switch (op.op) {
      case "set":
      case "increment":
      case "append":
      case "merge":
      case "rng":
      case "delete":
      case "setFromMap":
      case "setFromDataSource":
        if (op.path) paths.push(op.path);
        break;
      case "transfer":
        if (op.toPath) paths.push(op.toPath);
        break;
      case "setForAllPlayers":
      case "setForRandomPlayer":
        if (op.field) paths.push(`players.*.${op.field}`);
        break;
    }
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Input formatters
// ---------------------------------------------------------------------------

/**
 * Produces compact JSON for the {transitionsJson} template variable.
 * Keeps only id, fromPhase, toPhase, requiresPlayerInput, preconditions.
 */
function formatTransitionsJson(stateTransitions: string): string {
  try {
    const parsed = JSON.parse(stateTransitions);
    const transitions = (parsed.transitions ?? []).map((t: any) => ({
      id: t.id,
      fromPhase: t.fromPhase,
      toPhase: t.toPhase,
      requiresPlayerInput: t.requiresPlayerInput ?? false,
      preconditions: t.preconditions ?? [],
    }));
    return JSON.stringify(transitions, null, 2);
  } catch {
    return stateTransitions;
  }
}

/**
 * Produces the {instructionsSummary} text — two sections:
 *   1. PLAYER ACTION PHASES — currentAction shape set by each action's stateDelta
 *   2. AUTOMATIC TRANSITIONS — stateDelta write paths, messages, mechanicsGuidance summary
 */
function formatInstructionsSummary(
  playerPhaseInstructions: Record<string, string>,
  transitionInstructions: Record<string, string>,
): string {
  const lines: string[] = [];

  // --- Player action phases ---
  lines.push("=== PLAYER ACTION PHASES ===");
  for (const [phaseId, raw] of Object.entries(playerPhaseInstructions)) {
    try {
      const phase = JSON.parse(raw);
      lines.push(`Phase: ${phaseId}`);
      for (const action of (phase.playerActions ?? [])) {
        lines.push(`  Action: ${action.id}`);
        // Show the currentAction shape from stateDelta
        const currentActionOp = (action.stateDelta ?? []).find(
          (op: any) =>
            op.op === "set" &&
            typeof op.path === "string" &&
            op.path.includes("currentAction")
        );
        if (currentActionOp) {
          const val = JSON.stringify(currentActionOp.value ?? {});
          lines.push(`    stateDelta: ${currentActionOp.path} = ${val}`);
        } else {
          lines.push(`    stateDelta: (none)`);
        }
      }
    } catch {
      lines.push(`Phase: ${phaseId}  (parse error)`);
    }
  }

  lines.push("");
  lines.push("=== AUTOMATIC TRANSITIONS ===");
  for (const [transitionId, raw] of Object.entries(transitionInstructions)) {
    try {
      const t = JSON.parse(raw);
      const deltaPaths = extractStateDeltaWritePaths(t.stateDelta ?? []);
      const deltaStr = deltaPaths.length > 0 ? deltaPaths.join(", ") : "(none)";

      const pubMsg: string = t.messages?.public?.template
        ? t.messages.public.template.slice(0, 80) + (t.messages.public.template.length > 80 ? "…" : "")
        : "(none)";
      const privMsg: string =
        Array.isArray(t.messages?.private) && t.messages.private.length > 0
          ? "(per-player)"
          : "(none)";

      let mechanicsLine = "(none)";
      if (t.mechanicsGuidance) {
        const text =
          typeof t.mechanicsGuidance === "string"
            ? t.mechanicsGuidance
            : (t.mechanicsGuidance.computation ?? t.mechanicsGuidance.rules?.[0] ?? JSON.stringify(t.mechanicsGuidance));
        mechanicsLine = text.split(/[.!?]/)[0].trim().slice(0, 120);
      }

      lines.push(`Transition: ${transitionId}`);
      lines.push(`  stateDelta writes: ${deltaStr}`);
      lines.push(`  publicMessage: ${pubMsg}`);
      lines.push(`  privateMessage: ${privMsg}`);
      lines.push(`  mechanicsGuidance: ${mechanicsLine}`);
    } catch {
      lines.push(`Transition: ${transitionId}  (parse error)`);
    }
  }

  return lines.join("\n");
}

/**
 * Scan mechanic source code for setPublicMessage / setPrivateMessage calls.
 */
function scanMessageCalls(code: string): { sendsPublic: boolean; sendsPrivate: boolean } {
  return {
    sendsPublic: /\bsetPublicMessage\s*\(/.test(code),
    sendsPrivate: /\bsetPrivateMessage\s*\(/.test(code),
  };
}

/**
 * Build a map of mechanicId → MechanicMessageInfo for use by pre-validators.
 */
function buildMechanicMessages(
  generatedMechanics: Record<string, string>,
): Record<string, MechanicMessageInfo> {
  const result: Record<string, MechanicMessageInfo> = {};
  for (const [mechanicId, code] of Object.entries(generatedMechanics)) {
    result[mechanicId] = scanMessageCalls(code);
  }
  return result;
}

/**
 * Builds structured field I/O data for each mechanic (reads/writes).
 * Returned data is passed to deterministic pre-validators and also used
 * to format the LLM prompt section.
 */
function buildMechanicFieldIo(
  generatedMechanics: Record<string, string>,
): MechanicFieldIo[] {
  return Object.entries(generatedMechanics).map(([mechanicId, code]) => ({
    mechanicId,
    readsFields: [...scanReadFields(code)],
    writesFields: [...scanWrittenFieldsLocal(code)],
  }));
}

/**
 * Produces the {mechanicFieldIo} text — one block per mechanic.
 */
function formatMechanicFieldIo(
  items: MechanicFieldIo[],
  generatedMechanics: Record<string, string>,
): string {
  if (items.length === 0) return "(no generated mechanics)";

  return items
    .map(({ mechanicId, readsFields, writesFields }) => {
      const code = generatedMechanics[mechanicId] ?? '';
      const { sendsPublic, sendsPrivate } = scanMessageCalls(code);
      const msgParts: string[] = [];
      if (sendsPublic) msgParts.push("public");
      if (sendsPrivate) msgParts.push("private (per-player)");
      const msgStr = msgParts.length > 0 ? msgParts.join(", ") : "(none)";
      return (
        `Mechanic: ${mechanicId}\n` +
        `  Reads: ${readsFields.length > 0 ? readsFields.join(", ") : "(none)"}\n` +
        `  Writes: ${writesFields.length > 0 ? writesFields.join(", ") : "(none)"}\n` +
        `  Sends messages: ${msgStr}`
      );
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

/**
 * Coherence check node — call once after all artifacts are generated.
 * Returns partial state update with `coherenceFindings`.
 */
export async function runCoherenceCheck(
  state: SpecProcessingStateType,
): Promise<Partial<SpecProcessingStateType>> {
  const {
    stateTransitions,
    playerPhaseInstructions,
    transitionInstructions,
    generatedMechanics,
    stateSchema,
  } = state;

  // Skip if core artifacts are missing
  if (!stateTransitions || !transitionInstructions) {
    console.warn("[coherence_check] Missing core artifacts, skipping");
    return { coherenceFindings: { hasIssues: false, issues: [] } };
  }

  // Build schema field-type map for deterministic pre-validators.
  // Keys: "game.<name>" or "players.*.<name>"; values: FieldType string.
  const schemaFieldTypes = new Map<string, string>();
  if (stateSchema) {
    try {
      const parsedSchema: { fields?: Array<{ name: string; path: string; type: string }> } =
        JSON.parse(stateSchema);
      for (const field of (parsedSchema.fields ?? [])) {
        const prefix = field.path === 'player' ? 'players.*.' : 'game.';
        schemaFieldTypes.set(`${prefix}${field.name}`, field.type);
      }
    } catch {
      console.warn("[coherence_check] Could not parse stateSchema for pre-validators");
    }
  }

  const transitionsJson = formatTransitionsJson(stateTransitions);
  const instructionsSummary = formatInstructionsSummary(
    playerPhaseInstructions ?? {},
    transitionInstructions ?? {},
  );
  const mechanicFieldIoItems = buildMechanicFieldIo(generatedMechanics ?? {});
  const mechanicFieldIo = formatMechanicFieldIo(mechanicFieldIoItems, generatedMechanics ?? {});

  // Run deterministic pre-validators before the LLM call
  const mechanicMessages = buildMechanicMessages(generatedMechanics ?? {});
  const preValidatorIssues: CoherenceIssue[] = [];
  for (const validator of PRE_VALIDATORS) {
    preValidatorIssues.push(...validator.run(state, mechanicMessages, schemaFieldTypes, mechanicFieldIoItems));
  }
  if (preValidatorIssues.length > 0) {
    console.debug(
      `[coherence_check] Pre-validators found ${preValidatorIssues.length} issue(s):`,
      preValidatorIssues.map((i) => `${i.issueType}(${i.confidence}): ${i.affectedIds.join(", ")}`),
    );
  }

  // Format system prompt (issue types embedded at import time via buildCheckerIssueSection)
  const systemPrompt = coherenceCheckSystemPromptTemplate;

  // Format user prompt with game-specific inputs
  const userPromptTemplate = SystemMessagePromptTemplate.fromTemplate(
    coherenceCheckUserPromptTemplate,
  );
  const userMessage = await userPromptTemplate.format({
    transitionsJson,
    instructionsSummary,
    mechanicFieldIo,
  });

  const model = await setupSpecInstructionsModel();

  console.debug("[coherence_check] Running cross-artifact coherence check...");

  const result = await model.invokeWithSystemPrompt(
    systemPrompt,
    userMessage.content as string,
    { agent: "coherence-checker", workflow: "spec-processing" },
    CoherenceCheckOutputSchema,
  );

  const llmFindings = result as CoherenceCheckOutput;

  // Strip any LLM-emitted issues for issue types that are handled deterministically.
  // The pre-validator is the authoritative source for these; the LLM should never see
  // their names (the prompt omits them), but may re-derive them from context.
  const deterministicTypes = new Set(
    Object.entries(COHERENCE_ISSUE_DEFINITIONS)
      .filter(([, def]) => def.deterministic)
      .map(([type]) => type),
  );
  // Also strip issues the LLM self-vetoed — its reasoning concluded the behavior is correct.
  const filteredLlmIssues = llmFindings.issues.filter(
    (issue) => !deterministicTypes.has(issue.issueType) && issue.confidence !== 'vetoed',
  );
  const strippedCount = llmFindings.issues.length - filteredLlmIssues.length;
  if (strippedCount > 0) {
    console.debug(
      `[coherence_check] Stripped ${strippedCount} LLM issue(s) (deterministic type or self-vetoed).`,
    );
  }

  // Merge deterministic pre-validator issues with filtered LLM findings
  const allIssues = [...preValidatorIssues, ...filteredLlmIssues];
  const findings: CoherenceCheckOutput = {
    hasIssues: allIssues.length > 0,
    issues: allIssues,
  };

  if (findings.hasIssues) {
    console.warn(
      `[coherence_check] Found ${findings.issues.length} issue(s):`,
      findings.issues.map((i) => `${i.issueType}(${i.confidence}): ${i.affectedIds.join(", ")}`),
    );
  } else {
    console.debug("[coherence_check] No cross-artifact issues found.");
  }

  return { coherenceFindings: findings };
}

/**
 * LangGraph node — wraps runCoherenceCheck with bus events and non-fatal error handling.
 * Register as: workflow.addNode("coherence_check", coherenceCheckNode)
 */
export async function coherenceCheckNode(
  state: SpecProcessingStateType,
  config?: RunnableConfig,
): Promise<Partial<SpecProcessingStateType>> {
  const bus = config?.configurable?.statusBus as GameCreationBus | undefined;
  bus?.emit({ type: 'artifact:started', artifact: 'coherenceCheck' });
  try {
    const result = await runCoherenceCheck(state);
    bus?.emit({ type: 'artifact:completed', artifact: 'coherenceCheck' });
    return result;
  } catch (err) {
    console.error("[coherence_check] Error during coherence check (non-fatal):", err);
    bus?.emit({ type: 'artifact:error', artifact: 'coherenceCheck', error: err instanceof Error ? err.message : String(err) });
    return { coherenceFindings: { hasIssues: false, issues: [] } };
  }
}
