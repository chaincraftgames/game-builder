# Artifact Editor — Design Document

**Date:** 2026-02-19  
**Status:** Draft  
**Scope:** Targeted artifact editing to resolve validation failures (Mode 1), address gameplay issues (Mode 2), and apply design changes (future). Covers the standalone `ArtifactEditor` subgraph and its composition across all three contexts.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Architecture Overview](#2-architecture-overview)
3. [Coordinator Agent](#3-coordinator-agent)
4. [Fragment Editors](#4-fragment-editors)
5. [Integration with Spec Processing Graph](#5-integration-with-spec-processing-graph)
6. [Common Fix Patterns](#6-common-fix-patterns)
7. [Interfaces & Types](#7-interfaces--types)
8. [Fragment Addressing & Extraction](#8-fragment-addressing--extraction)
9. [Execution Flow](#9-execution-flow)
10. [Re-Validation Loop](#10-re-validation-loop)
11. [Model Selection & Cost](#11-model-selection--cost)
12. [Mode 2: Sim Assistant & Gameplay Recovery](#12-mode-2-sim-assistant--gameplay-recovery)
13. [Implementation Plan](#13-implementation-plan)

---

## 1. Problem Statement

When artifact extraction produces validation errors, the spec processing graph currently:
1. Commits the errors to state (`schemaValidationErrors`, `transitionsValidationErrors`, `instructionsValidationErrors`)
2. Short-circuits the pipeline (skips downstream extraction steps)
3. `createSimulation()` in `simulate-workflow.ts` throws a hard error: `"Spec processing failed validation with N error(s)"`

The user sees a generic failure. The only remedy is to try again (which re-runs the full extraction from scratch with no corrective context). The subgraph retry infrastructure exists (`createExtractionSubgraph` has attempt counting, `maxAttempts` config, retry routing) but the actual retry paths are effectively one-shot — they re-run the same prompt, sometimes with validation errors appended to the InMemoryStore, but the executors don't currently read that feedback.

**Goal:** When validation errors occur, automatically diagnose the root cause and apply targeted fixes to specific artifact fragments before surfacing an error to the user.

---

## 2. Architecture Overview

### Artifact Editor as a Standalone Subgraph

The artifact editor is a **standalone LangGraph subgraph** — not embedded in the spec processing graph. It has its own state, its own checkpoint thread, and can be composed into any context that needs artifact changes.

```
┌─────────────────────────────────────────────────────────────────┐
│  Artifact Editor Subgraph (standalone, composable)              │
│  Input:  errors + artifacts + spec                              │
│  Output: patched artifacts (or remaining errors on failure)     │
│                                                                 │
│  ┌────────────────────────────────┐                             │
│  │  Coordinator (LLM)             │                             │
│  │  Reads: errors + artifact      │                             │
│  │         summaries + spec       │                             │
│  │  Produces: ChangePlan          │                             │
│  └──────────────┬─────────────────┘                             │
│                 │                                                │
│       ┌─────────┴───────────┐                                   │
│       ▼                     ▼                                   │
│  ┌──────────┐    ┌────────────────┐                             │
│  │  Patch   │    │  Re-extract    │                             │
│  │  (Editor │    │  (Existing     │                             │
│  │   node)  │    │   extraction   │                             │
│  └──────────┘    │   subgraph)    │                             │
│                  └────────────────┘                             │
│       │                     │                                   │
│       └─────────┬───────────┘                                   │
│                 ▼                                                │
│  Re-validate all artifacts                                      │
│  If pass → output patched artifacts                             │
│  If fail → loop (up to N) or output remaining errors            │
└─────────────────────────────────────────────────────────────────┘
```

### Composition Contexts

The same artifact editor subgraph is invoked from multiple contexts:

| Context | Who Invokes | Input | How |
|---|---|---|---|
| Mode 1 (spec processing) | Terminal node in spec processing graph | Validator error strings from state | Compiled subgraph invoked as a node |
| Mode 2 (user report) | Sim assistant | Synthetic errors from triage | Direct `invoke()` on compiled subgraph |
| Mode 2 (auto-detected) | Runtime loop in `processAction()` | Synthetic errors from detection | Direct `invoke()` on compiled subgraph |
| Future (design-via-deltas) | Design agent | Structured change descriptions | Same subgraph, different input framing |

### Composable Config Pattern

The extraction agents and the fragment editors share the same **config objects** (system prompt, validators, model), but are composed into different graph structures. The config is the reusable unit:

```
┌─────────────────────────────────────────────────────┐
│  Shared Config (per artifact type)                   │
│  • System prompt (domain knowledge)                  │
│  • Validators (deterministic checks)                 │
│  • Model selection                                   │
├──────────────────────┬──────────────────────────────┤
│                      │                               │
│  createExtraction    │  createEditorNode(config)     │
│  Subgraph(config)    │  → Single LLM call:           │
│  → Full pipeline:    │    fragment in → fragment out  │
│    plan → validate   │  → Reuses same system prompt   │
│    → execute →       │  → Reuses same validators      │
│    validate → commit │  → Different user prompt        │
│                      │    (edit, not extract)          │
└──────────────────────┴──────────────────────────────┘
```

### Agent Roles

Three agent roles:
- **Coordinator**: Lightweight diagnostic agent. Reads validation errors + artifacts + spec. Produces a structured `ChangePlan`. Does NOT know stateDelta syntax, JsonLogic, or schema format details. **Never user-facing** — always invoked programmatically.
- **Fragment Editors**: Per-artifact-type editor nodes that receive a single artifact fragment + change description and return the updated fragment. Built from the same config objects as the extraction agents via `createEditorNode()`. Same system prompt, same validators, different user prompt.
- **Sim Assistant** (Mode 2 only): User-facing conversational agent during gameplay. Triages user complaints into categories (explanation, state correction, artifact bug, design change). Only invokes the coordinator when it confirms an artifact bug, translating the user's observation into structured synthetic errors. See [Section 12](#12-mode-2-sim-assistant--gameplay-recovery).

> **Naming note:** The orchestrating subgraph is called `ArtifactEditor` (not `ArtifactRecovery`) because the same component handles all three modes — fixing validation failures, patching gameplay bugs, and applying intentional design changes. "Recovery" would be too narrow.

---

## 3. Coordinator Agent

### Role

Diagnose the root cause of validation errors. Determine which artifact(s) need changes. Produce a minimal, ordered `ChangePlan`.

### What the Coordinator Knows

- What each artifact controls (high-level descriptions, not formal schemas)
- Common fix patterns (see Section 6)
- The validation error messages and what they mean
- The game specification (for context on intent)

### What the Coordinator Does NOT Know

- StateDelta op syntax
- JsonLogic operator syntax
- JSON Schema format details
- Zod schema definitions

This separation is deliberate — the coordinator reasons about *what* to fix, not *how* to fix it. The domain-specific knowledge stays in the editors where it's already maintained.

### Coordinator System Prompt

```
You are a game artifact diagnostic agent. Your job is to analyze validation 
errors from game artifact extraction and produce a change plan.

## Artifact Types

- **Schema**: Defines game state fields. Game-level fields (game.*) and 
  player-level fields (players.*). Types: number, string, boolean, enum, 
  array, object.

- **Transitions**: Defines game phases, transitions between phases, and 
  preconditions (JsonLogic expressions) that determine when transitions fire.
  Preconditions must be deterministic — they cannot contain randomness or 
  rely on values that don't exist yet. Key phases: "init" (entry) and 
  "finished" (terminal).

- **Instructions**: Defines what happens during each transition and player 
  action. Contains stateDelta operations (atomic state mutations), messages 
  to players, and mechanics guidance. Two sub-types:
  - Transition instructions: keyed by transition ID
  - Player phase instructions: keyed by phase name, contain player actions

## Artifact Dependencies

  Schema ← Transitions (preconditions reference schema fields)
  Schema ← Instructions (stateDelta ops reference schema fields)
  Transitions ← Instructions (transition IDs, phase names must match)

Changes to Schema may require cascading changes to Transitions and/or 
Instructions. Changes to Transitions may require cascading changes to 
Instructions. Changes to Instructions are typically self-contained.

## Common Fix Patterns

### Pattern 1: Missing actionRequired setter
- Error: "Player action 'X' must include a stateDelta operation that sets 
  'players.{{playerId}}.actionRequired'"
- Fix: Patch the specific player action in instructions to add the missing op
- Artifacts affected: instructions only
- Confidence: HIGH

### Pattern 2: Non-deterministic precondition / null logic
- Error: "precondition 'X': logic cannot be null" or "non-deterministic 
  preconditions are not allowed"
- Root cause: The transition needs to check a condition that involves 
  randomness or a value that doesn't exist at precondition-check time
- Fix: Add a schema field to store a pre-calculated value, add an instruction 
  to populate it (usually via rng op in a prior transition), rewrite the 
  precondition to check the stored value
- Artifacts affected: schema + instructions + transitions
- Confidence: MEDIUM

### Pattern 3: Missing game completion flags
- Error: "No transition sets game.gameEnded=true" or "No transition sets 
  players.*.isGameWinner"
- Fix: Patch the game-ending transition instruction to include the missing ops
- Artifacts affected: instructions only
- Confidence: HIGH

### Pattern 4: Unreachable phase / no path to finished
- Error: "Phase 'X' is unreachable from init" or "Terminal phase unreachable"
- Fix: Add a missing transition or fix a fromPhase/toPhase reference
- Artifacts affected: transitions (may cascade to instructions if new 
  transition needs instructions)
- Confidence: MEDIUM

### Pattern 5: Deadlocked initial state
- Error: "Init transition creates immediate deadlock"
- Root cause: Init sets field values that block all outgoing transitions from 
  the starting phase
- Fix: Either patch init transition instruction to set compatible values, or 
  patch the blocking preconditions
- Artifacts affected: instructions or transitions
- Confidence: MEDIUM (may require examining precondition logic)

### Pattern 6: Field referenced but not in schema
- Error: "references unknown field: X"
- Fix: Add the missing field to schema
- Artifacts affected: schema only
- Confidence: HIGH

### Pattern 7: Indexed player access in preconditions
- Error: "forbidden array index access" or "explicit player ID reference"
- Fix: Rewrite precondition to use allPlayers/anyPlayer operators instead of 
  indexed access
- Artifacts affected: transitions only
- Confidence: HIGH

### Pattern 8: Invalid stateDelta structure
- Error: "missing 'op' field", "missing 'path' field", "missing 'value' 
  field", "probabilities length must match choices length"
- Fix: Patch the specific instruction's stateDelta to fix the structural issue
- Artifacts affected: instructions only
- Confidence: HIGH

### Pattern 9: Mixed literal+template path segments
- Error: "Path segment mixes literal text with template variables"
- Fix: Patch the specific stateDelta op to use proper path structure
- Artifacts affected: instructions only
- Confidence: HIGH

### Pattern 10: Invalid narrative marker reference
- Error: "Narrative marker 'X' referenced but not found in specNarratives"
- Fix: Remove the invalid marker reference from the instruction
- Artifacts affected: instructions only
- Confidence: HIGH

## Rules

1. Produce the MINIMUM set of changes to resolve all errors
2. Order changes respecting dependencies: schema → transitions → instructions
3. If multiple errors share a root cause, produce ONE change that fixes all
4. Prefer 'patch' over 'reextract' — surgical fixes are cheaper and safer
5. Use 'reextract' only when the artifact has fundamental structural problems 
   (multiple unreachable phases, completely wrong phase model)
6. For cross-artifact fixes (Pattern 2), list all affected artifacts as 
   separate changes in dependency order
7. Each change description should say WHAT to change in natural language, 
   not HOW (the editor knows the syntax)
```

### Coordinator User Prompt

```
GAME SPECIFICATION:
{gameSpecification}

VALIDATION ERRORS:
{allValidationErrors}

CURRENT ARTIFACTS:
Schema fields: {schemaFieldsSummary}
Transition phases: {transitionPhasesSummary}
Transition IDs: {transitionIdsSummary}
Instruction coverage: {instructionCoverageSummary}

Produce a ChangePlan to resolve all validation errors.
```

Note: The user prompt includes **summaries** of artifacts, not full JSON. The coordinator doesn't need the full artifact — it needs to know what fields exist, what phases exist, and what transitions are defined.

### Coordinator Output Schema (Zod)

```typescript
const ArtifactChangeSchema = z.object({
  artifact: z.enum(['schema', 'transitions', 'instructions']),
  operation: z.enum(['patch', 'reextract']),
  // For patch: specific fragment address
  fragmentAddress: z.string().optional().describe(
    'For patches: the specific fragment to edit. ' +
    'Schema: field name. ' +
    'Transitions: transition ID. ' +
    'Instructions: "transitions.<transitionId>" or "playerPhases.<phaseName>.<actionId>"'
  ),
  description: z.string().describe(
    'Natural language description of what to change. ' +
    'Say WHAT to change, not HOW (the editor knows the syntax).'
  ),
  errorsAddressed: z.array(z.string()).describe(
    'Which validation error messages this change resolves'
  ),
});

const ChangePlanSchema = z.object({
  diagnosis: z.string().describe(
    'Brief root cause analysis. What is fundamentally wrong and why.'
  ),
  confidence: z.enum(['high', 'medium', 'low']).describe(
    'How confident are you this plan will resolve all errors'
  ),
  changes: z.array(ArtifactChangeSchema).describe(
    'Ordered list of changes. Apply in order. Schema changes before ' +
    'transitions, transitions before instructions.'
  ),
});
```

---

## 4. Fragment Editors

### Composable Config Pattern

The extraction agents already have a `NodeConfig` object containing their system prompt, validators, and model. Rather than building a second subgraph factory, we create a lightweight `createEditorNode()` factory that reuses the same config:

```typescript
// Shared config — defined once per artifact type, used by both extraction and editing
interface ArtifactConfig {
  /** System prompt with all domain knowledge (JsonLogic, stateDelta ops, etc.) */
  systemPrompt: string;
  /** Validators that check artifact correctness */
  validators: Validator[];
  /** Model to use */
  model: BaseChatModel;
}

// Extraction: full pipeline (existing)
const transitionsExtractionSubgraph = createExtractionSubgraph({
  ...transitionsConfig,
  namespace: 'extract-transitions',
  planner: transitionsPlanner,
  maxAttempts: 2,
  commit: commitTransitions,
});

// Editing: lightweight single-call node (new)
const transitionsEditor = createEditorNode(transitionsConfig);
```

### `createEditorNode` Factory

```typescript
function createEditorNode(config: ArtifactConfig) {
  return async (input: FragmentPatchInput): Promise<FragmentPatchOutput> => {
    // 1. Build edit-mode user prompt (the ONLY difference from extraction)
    const userPrompt = buildEditUserPrompt(input);

    // 2. Invoke LLM with SAME cached system prompt as extraction agent
    const result = await invokeWithSystemPrompt(
      config.systemPrompt,      // <-- identical to extraction
      userPrompt,               // <-- edit-specific
      config.model,             // <-- same model
      fragmentOutputSchema,     // <-- simpler output (just the fragment)
    );

    // 3. Parse and return
    return {
      updatedFragment: result.content,
      fragmentAddress: input.fragmentAddress,
      success: true,
    };
  };
}
```

This is ~30 lines. It gets prompt cache hits from the extraction agent's system prompt (since the system prompt is identical), so the marginal cost per edit is just the user prompt + output tokens.

### Why NOT Dual-Mode Extraction Subgraph

We considered adding an `editMode` flag to `createExtractionSubgraph()`, but the extraction subgraph has 5 nodes with conditional routing (plan → validate-plan → execute → validate-execution → commit). In edit mode you'd skip the planner, skip plan validation, and want different commit behavior — so you'd add `if (editMode)` branches in 3-4 nodes. That makes the extraction subgraph harder to reason about for thin reuse gain.

The config is the reusable unit, not the subgraph.

### Artifact Configs

Defined once, shared by both extraction subgraphs and editor nodes:

```typescript
// These already exist in the codebase as parts of NodeConfig.
// We extract them into standalone configs that both factories consume.

const schemaConfig: ArtifactConfig = {
  systemPrompt: SCHEMA_EXTRACTION_SYSTEM_PROMPT,
  validators: schemaExecutorValidators,
  model: getSchemaExtractionModel(),
};

const transitionsConfig: ArtifactConfig = {
  systemPrompt: TRANSITIONS_EXTRACTION_SYSTEM_PROMPT,
  validators: transitionsExecutorValidators,
  model: getTransitionsModel(),
};

const instructionsConfig: ArtifactConfig = {
  systemPrompt: INSTRUCTIONS_EXTRACTION_SYSTEM_PROMPT,
  validators: instructionsExecutorValidators,
  model: getInstructionsModel(),
};
```

### Schema Editor

For schema patches, changes are simple enough that **no LLM is needed**. Schema field additions are deterministic:

```typescript
interface SchemaFieldAddition {
  name: string;
  type: 'number' | 'string' | 'boolean' | 'array' | 'enum';
  path: 'game' | 'player';
  description: string;
  defaultValue?: any;
}
```

The coordinator's change description can be parsed for these fields, or the coordinator can output a structured `schemaHint` for schema changes.

**When LLM IS needed:** Only for `reextract` operations — re-invoke the existing schema extraction subgraph with error context.

### Transitions Editor

Built via `createEditorNode(transitionsConfig)`. User prompt:

```
You are editing a single transition in a game artifact. Make ONLY the 
described change. Do not modify anything else.

TRANSITION TO EDIT:
{transitionFragment}

AVAILABLE STATE FIELDS:
{schemaFieldsSummary}

AVAILABLE COMPUTED CONTEXT FIELDS:
{computedContextFields}

CHANGE REQUIRED:
{changeDescription}

Return the complete updated transition JSON.
```

For `reextract` operations, `createReextractNode(transitionsConfig)` delegates to the existing transitions extraction subgraph with validation errors injected as additional context.

### Instructions Editor

Built via `createEditorNode(instructionsConfig)`. User prompt:

```
You are editing a single instruction fragment in a game artifact. Make ONLY 
the described change. Do not modify anything else.

INSTRUCTION TO EDIT:
{instructionFragment}

STATE SCHEMA FIELDS:
{schemaFieldsSummary}

CHANGE REQUIRED:
{changeDescription}

Return the complete updated instruction JSON.
```

For `reextract`, `createReextractNode(instructionsConfig)` delegates to the existing instructions extraction subgraph with error context.

---

## 5. Integration Points

The artifact editor subgraph is standalone and invoked differently depending on context.

### 5.1 Mode 1 — Spec Processing Graph Integration

A thin wrapper node in the spec processing graph invokes the compiled artifact editor subgraph:

```typescript
// In createSpecProcessingGraph():

const artifactEditorGraph = createArtifactEditorSubgraph().compile();

// Wrapper node: maps SpecProcessingState → ArtifactEditorState → SpecProcessingState
workflow.addNode("edit_artifacts", async (state) => {
  const allErrors = collectAllErrors(state);
  if (allErrors.length === 0) return {}; // Pass through

  const result = await artifactEditorGraph.invoke({
    gameSpecification: state.gameSpecification,
    errors: allErrors,
    stateSchema: state.stateSchema,
    stateTransitions: state.stateTransitions,
    playerPhaseInstructions: state.playerPhaseInstructions,
    transitionInstructions: state.transitionInstructions,
  });

  if (result.editSucceeded) {
    return {
      stateSchema: result.patchedSchema,
      stateTransitions: result.patchedTransitions,
      playerPhaseInstructions: result.patchedPlayerPhaseInstructions,
      transitionInstructions: result.patchedTransitionInstructions,
      schemaValidationErrors: null,
      transitionsValidationErrors: null,
      instructionsValidationErrors: null,
    };
  }
  return {}; // Editing failed, original errors pass through
});

workflow.addConditionalEdges(
  "extract_produced_tokens",
  (state) => hasAnyValidationErrors(state) ? "edit" : "end",
  { edit: "edit_artifacts", end: END }
);
```

The spec processing graph owns only the state mapping. All editing logic lives in the standalone subgraph.

### Error Short-Circuit Modification

**Recommendation: Let the pipeline continue even with errors (Option A from earlier discussion).** The pipeline steps already handle missing upstream artifacts gracefully (checking for empty strings and bailing out). Running the full pipeline first gives the artifact editor maximum context — it can see all errors across all artifacts at once, enabling cross-artifact root cause analysis. The cost of running downstream steps on bad artifacts is low (they fail fast on validation, adding their errors to the pile).

The existing error short-circuits to END are replaced with `continue` edges.

### 5.2 Mode 2 — Sim Assistant Direct Invocation

The sim assistant calls the same compiled subgraph directly — no spec processing graph involved:

```typescript
// In sim-assistant.ts:

const artifactEditorGraph = createArtifactEditorSubgraph().compile({ checkpointer });

async function handleArtifactBug(
  diagnostic: GameplayDiagnosticInput,
  currentArtifacts: CurrentArtifacts,
  gameSpecification: string
): Promise<ArtifactEditorResult> {
  return artifactEditorGraph.invoke({
    gameSpecification,
    errors: diagnostic.syntheticErrors,
    stateSchema: currentArtifacts.schema,
    stateTransitions: currentArtifacts.transitions,
    playerPhaseInstructions: currentArtifacts.playerPhaseInstructions,
    transitionInstructions: currentArtifacts.transitionInstructions,
  });
}
```

### 5.3 Mode 2 — Auto-Detection Direct Invocation

Runtime-detected issues (deadlocks, stuck phases) bypass the sim assistant entirely:

```typescript
// In processAction() or the runtime loop:

if (runtimeResult.deadlock || runtimeResult.illegalState) {
  const syntheticErrors = translateAutoIssue(
    buildAutoDetectedIssue(runtimeResult, gameState)
  );
  const result = await artifactEditorGraph.invoke({
    gameSpecification,
    errors: syntheticErrors,
    stateSchema: currentArtifacts.schema,
    stateTransitions: currentArtifacts.transitions,
    playerPhaseInstructions: currentArtifacts.playerPhaseInstructions,
    transitionInstructions: currentArtifacts.transitionInstructions,
  });
  // Apply patched artifacts, restart sim from last good state
}
```

### 5.4 Why This Is Better Than Embedding

1. **Testable in isolation** — unit test the artifact editor subgraph with fake errors + artifacts, no need to run the full extraction pipeline
2. **Independent checkpointing** — edit attempts get their own checkpoint thread, don't pollute the extraction checkpoint history
3. **Reusable across lifecycle phases** — spec processing, runtime, design-via-deltas all call the same `invoke()`
4. **Clean state boundaries** — artifact editor subgraph doesn't need to know about extraction-specific state (planner outputs, attempt counts, InMemoryStore namespaces)

---

## 6. Common Fix Patterns — Decision Matrix

This table maps validation error patterns to the coordinator's expected diagnosis:

| Error Pattern | Root Cause | Fix Strategy | Artifacts | Confidence |
|---|---|---|---|---|
| `"must include a stateDelta operation that sets 'players.{{playerId}}.actionRequired'"` | Missing mandatory op | Patch: add `set` op to the specific action | instructions | HIGH |
| `"No transition sets game.gameEnded=true"` | Missing game-end flag | Patch: add `set` op to game-ending transition | instructions | HIGH |
| `"No transition sets players.*.isGameWinner"` | Missing winner flag | Patch: add `setForAllPlayers` or conditional `set` op | instructions | HIGH |
| `"logic cannot be null"` | Non-deterministic precondition | Multi-patch: add schema field + init instruction + rewrite precondition | schema + instructions + transitions | MEDIUM |
| `"non-deterministic preconditions are not allowed"` | Same as above | Same as above | schema + instructions + transitions | MEDIUM |
| `"forbidden array index access"` | Indexed player access | Patch: rewrite to use `allPlayers`/`anyPlayer` | transitions | HIGH |
| `"explicit player ID reference"` | Hardcoded player IDs | Patch: rewrite to use `allPlayers`/`anyPlayer` | transitions | HIGH |
| `"Phase 'X' is unreachable from init"` | Missing transition | Patch: add transition or fix fromPhase/toPhase | transitions | MEDIUM |
| `"Terminal phase unreachable"` | No path to finished | Patch or reextract transitions | transitions | MEDIUM |
| `"Init transition creates immediate deadlock"` | Incompatible init values vs. preconditions | Patch: fix init stateDelta values or adjust preconditions | instructions or transitions | MEDIUM |
| `"references unknown field: X"` | Missing schema field | Patch: add field to schema | schema | HIGH |
| `"Path segment mixes literal text with template variables"` | Bad path syntax | Patch: fix specific stateDelta op path | instructions | HIGH |
| `"probabilities length must match choices length"` | RNG op error | Patch: fix specific rng op | instructions | HIGH |
| `"Narrative marker 'X' referenced but not found"` | Invalid marker ref | Patch: remove/replace marker in instruction | instructions | HIGH |
| `"has no outbound transitions"` | Dead-end phase | Patch: add outbound transition | transitions | MEDIUM |
| Multiple structural errors in same artifact | Fundamentally wrong extraction | Reextract with error context | varies | LOW |

---

## 7. Interfaces & Types

```typescript
// --- Change Plan (Coordinator output) ---

interface ArtifactChange {
  artifact: 'schema' | 'transitions' | 'instructions';
  operation: 'patch' | 'reextract';
  fragmentAddress?: string;
  description: string;
  errorsAddressed: string[];
}

interface ChangePlan {
  diagnosis: string;
  confidence: 'high' | 'medium' | 'low';
  changes: ArtifactChange[];
}

// --- Fragment Editor I/O ---

interface FragmentPatchInput {
  /** The JSON fragment to edit (or empty string for new additions) */
  fragment: string;
  /** Where this fragment lives in the full artifact */
  fragmentAddress: string;
  /** NL description of the change */
  changeDescription: string;
  /** Schema fields summary (always included for context) */
  schemaFieldsSummary: string;
  /** Other fragments needed for context */
  relevantContext?: string[];
  /** The validation errors that motivated this change */
  validationErrors?: string[];
}

interface FragmentPatchOutput {
  /** The updated fragment JSON */
  updatedFragment: string;
  /** The address for reinsertion */
  fragmentAddress: string;
  /** Whether the edit was applied successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

// --- Composable Config (shared by extraction and editing) ---

interface ArtifactConfig {
  /** System prompt with domain knowledge (JsonLogic, stateDelta ops, etc.) */
  systemPrompt: string;
  /** Validators that check artifact correctness */
  validators: Validator[];
  /** Model to use for LLM calls */
  model: BaseChatModel;
}

// --- Artifact Editor Subgraph State (LangGraph Annotation) ---

const ArtifactEditorState = Annotation.Root({
  // Input (set by caller)
  gameSpecification: Annotation<string>,
  errors: Annotation<string[]>,           // validator OR synthetic — uniform
  stateSchema: Annotation<string>,
  stateTransitions: Annotation<string>,
  playerPhaseInstructions: Annotation<Record<string, string>>,
  transitionInstructions: Annotation<Record<string, string>>,

  // Internal (managed by subgraph nodes)
  changePlan: Annotation<ChangePlan | null>,
  attemptNumber: Annotation<number>,

  // Output (read by caller)
  editSucceeded: Annotation<boolean>,
  patchedSchema: Annotation<string>,
  patchedTransitions: Annotation<string>,
  patchedPlayerPhaseInstructions: Annotation<Record<string, string>>,
  patchedTransitionInstructions: Annotation<Record<string, string>>,
  remainingErrors: Annotation<string[]>,
  changesApplied: Annotation<ArtifactChange[]>,
});
```

---

## 8. Fragment Addressing & Extraction

### Address Format

```
schema.<fieldName>                              → single field definition
transitions.<transitionId>                      → single transition object
transitions.<transitionId>.preconditions.<preconditionId>  → single precondition
instructions.transitions.<transitionId>         → single transition instruction
instructions.playerPhases.<phaseName>           → all actions in a phase
instructions.playerPhases.<phaseName>.<actionId> → single player action
```

### Extraction Functions

```typescript
/**
 * Extract a fragment from an artifact by address.
 * Returns the JSON string of just that fragment.
 */
function extractFragment(
  artifact: string,     // full artifact JSON string
  artifactType: 'schema' | 'transitions' | 'instructions',
  address: string       // fragment address
): string;

/**
 * Recompose a full artifact by replacing a fragment at the given address.
 * Pure deterministic operation — no LLM involved.
 */
function replaceFragment(
  artifact: string,     // full artifact JSON string
  artifactType: 'schema' | 'transitions' | 'instructions',
  address: string,      // fragment address
  updatedFragment: string  // new fragment JSON
): string;

/**
 * Insert new content into artifact (for additions like new schema fields,
 * new transitions).
 */
function insertFragment(
  artifact: string,
  artifactType: 'schema' | 'transitions' | 'instructions',
  address: string,
  newFragment: string
): string;
```

### Schema Fragment Examples

Full schema artifact (simplified):
```json
{
  "game": {
    "currentPhase": { "type": "string" },
    "gameEnded": { "type": "boolean" },
    "currentRound": { "type": "number" }
  },
  "player": {
    "actionRequired": { "type": "boolean" },
    "score": { "type": "number" }
  }
}
```

Fragment at `schema.game.deadlyChoiceIndex`:
```json
{ "type": "number" }
```

### Instructions Fragment Examples

Full transition instruction (keyed by transition ID in `transitionInstructions`):
```json
{
  "id": "initialize_game",
  "transitionName": "Initialize Game",
  "stateDelta": [
    { "op": "set", "path": "game.currentRound", "value": 1 },
    { "op": "setForAllPlayers", "field": "score", "value": 0 },
    { "op": "setForAllPlayers", "field": "actionRequired", "value": false }
  ],
  "messages": {
    "publicMessage": "Welcome to the game!"
  }
}
```

For instructions, the fragment is the entire value at the relevant key — `transitionInstructions[transitionId]` or `playerPhaseInstructions[phaseName]`. This is already how they're stored (keyed maps), so extraction is a simple key lookup. No deep JSON traversal needed.

### Transitions Fragment

The transitions artifact is a single JSON with `phases`, `phaseMetadata`, and `transitions` arrays. For patching a specific transition:

Fragment at `transitions.resolve_round`:
```json
{
  "id": "resolve_round",
  "fromPhase": "player_action",
  "toPhase": "scoring",
  "preconditions": [
    {
      "id": "all_acted",
      "logic": { "allPlayers": ["actionRequired", "==", false] },
      "deterministic": true,
      "explain": "All players have submitted their actions"
    }
  ],
  "checkedFields": ["players[*].actionRequired"],
  "humanSummary": "When all players have acted, resolve the round"
}
```

Extraction: filter `transitions` array by `id === transitionId`.
Replacement: find-and-replace in the array by matching `id`.

---

## 9. Execution Flow

### Artifact Editor Subgraph Factory

```typescript
function createArtifactEditorSubgraph() {
  const workflow = new StateGraph(ArtifactEditorState);

  // Editor nodes built from shared configs
  const schemaEditor = createEditorNode(schemaConfig);
  const transitionsEditor = createEditorNode(transitionsConfig);
  const instructionsEditor = createEditorNode(instructionsConfig);

  workflow.addNode("coordinator", coordinatorNode);
  workflow.addNode("apply_changes", applyChangesNode(
    schemaEditor, transitionsEditor, instructionsEditor
  ));
  workflow.addNode("revalidate", revalidateNode);

  workflow.addEdge(START, "coordinator");
  workflow.addEdge("coordinator", "apply_changes");
  workflow.addEdge("apply_changes", "revalidate");
  workflow.addConditionalEdges("revalidate", (state) => {
    if (state.remainingErrors.length === 0) return "done";
    if (state.attemptNumber >= MAX_EDIT_ATTEMPTS) return "done";
    return "retry";
  }, {
    done: END,
    retry: "coordinator",
  });

  return workflow;
}
```

### Node Implementations

```typescript
const MAX_EDIT_ATTEMPTS = 2;

// --- Coordinator Node ---
async function coordinatorNode(state: typeof ArtifactEditorState.State) {
  const changePlan = await invokeCoordinator({
    gameSpecification: state.gameSpecification,
    allErrors: state.errors,
    schemaSummary: summarizeSchema(state.stateSchema),
    transitionsSummary: summarizeTransitions(state.stateTransitions),
    instructionsSummary: summarizeInstructions(
      state.playerPhaseInstructions,
      state.transitionInstructions
    ),
  });

  return {
    changePlan,
    attemptNumber: state.attemptNumber + 1,
  };
}

// --- Apply Changes Node ---
function applyChangesNode(
  schemaEditor: EditorFn,
  transitionsEditor: EditorFn,
  instructionsEditor: EditorFn
) {
  return async (state: typeof ArtifactEditorState.State) => {
    if (!state.changePlan || state.changePlan.changes.length === 0) {
      return {
        patchedSchema: state.stateSchema,
        patchedTransitions: state.stateTransitions,
        patchedPlayerPhaseInstructions: state.playerPhaseInstructions,
        patchedTransitionInstructions: state.transitionInstructions,
      };
    }

    let currentSchema = state.stateSchema;
    let currentTransitions = state.stateTransitions;
    let currentPlayerPhaseInstructions = { ...state.playerPhaseInstructions };
    let currentTransitionInstructions = { ...state.transitionInstructions };
    const appliedChanges: ArtifactChange[] = [];

    for (const change of state.changePlan.changes) {
      if (change.operation === 'patch') {
        // Select editor based on artifact type
        const editor = change.artifact === 'schema' ? schemaEditor
          : change.artifact === 'transitions' ? transitionsEditor
          : instructionsEditor;

        const result = await applyPatch(change, editor, {
          schema: currentSchema,
          transitions: currentTransitions,
          playerPhaseInstructions: currentPlayerPhaseInstructions,
          transitionInstructions: currentTransitionInstructions,
        });

        if (result.success) {
          switch (change.artifact) {
            case 'schema':
              currentSchema = result.updatedArtifact!;
              break;
            case 'transitions':
              currentTransitions = result.updatedArtifact!;
              break;
            case 'instructions':
              currentPlayerPhaseInstructions = result.updatedPlayerPhaseInstructions
                ?? currentPlayerPhaseInstructions;
              currentTransitionInstructions = result.updatedTransitionInstructions
                ?? currentTransitionInstructions;
              break;
          }
          appliedChanges.push(change);
        }
      }
      // reextract — delegate to existing extraction subgraph (omitted for brevity)
    }

    return {
      patchedSchema: currentSchema,
      patchedTransitions: currentTransitions,
      patchedPlayerPhaseInstructions: currentPlayerPhaseInstructions,
      patchedTransitionInstructions: currentTransitionInstructions,
      changesApplied: appliedChanges,
    };
  };
}

// --- Revalidate Node ---
async function revalidateNode(state: typeof ArtifactEditorState.State) {
  const newErrors = await revalidateAll({
    schema: state.patchedSchema,
    transitions: state.patchedTransitions,
    playerPhaseInstructions: state.patchedPlayerPhaseInstructions,
    transitionInstructions: state.patchedTransitionInstructions,
    gameSpecification: state.gameSpecification,
  });

  return {
    editSucceeded: newErrors.length === 0,
    remainingErrors: newErrors,
    // Feed patched artifacts back as current for next loop iteration
    stateSchema: state.patchedSchema,
    stateTransitions: state.patchedTransitions,
    playerPhaseInstructions: state.patchedPlayerPhaseInstructions,
    transitionInstructions: state.patchedTransitionInstructions,
    errors: newErrors, // Next coordinator attempt sees remaining errors
  };
}
```

### `applyPatch` Detail

```typescript
async function applyPatch(
  change: ArtifactChange,
  editor: EditorFn,
  artifacts: CurrentArtifacts
): Promise<PatchResult> {
  
  // 1. Extract fragment
  const fragment = extractFragment(
    getArtifact(artifacts, change.artifact),
    change.artifact,
    change.fragmentAddress!
  );
  
  // 2. Invoke fragment editor (built from shared ArtifactConfig)
  const editorOutput = await editor({
    fragment,
    fragmentAddress: change.fragmentAddress!,
    changeDescription: change.description,
    schemaFieldsSummary: summarizeSchema(artifacts.schema),
  });
  
  // 3. Recompose full artifact
  const updatedArtifact = replaceFragment(
    getArtifact(artifacts, change.artifact),
    change.artifact,
    change.fragmentAddress!,
    editorOutput.updatedFragment
  );
  
  return { success: true, updatedArtifact };
}
```

---

## 10. Re-Validation Loop

After applying all changes from a `ChangePlan`, re-run the relevant validators. This is critical — a patch that fixes one error might introduce another.

### Which Validators to Run

Not all validators need to re-run for every change. But for simplicity in v1, **re-run all validators** for any artifact that was modified. The validators are fast (deterministic, no LLM calls).

```typescript
async function revalidateAll(artifacts: AllArtifacts): Promise<string[]> {
  const errors: string[] = [];
  
  // Build a minimal SpecProcessingStateType-like object for validators
  const pseudoState = buildPseudoState(artifacts);
  const store = new InMemoryStore();
  const threadId = 'artifact-editor-validation';
  
  // Schema validators
  // (schema validators check execution output format — may need adaptation)
  
  // Transitions validators  
  for (const validator of transitionsExecutorValidators) {
    const validatorErrors = await validator(pseudoState, store, threadId);
    errors.push(...validatorErrors);
  }
  
  // Transition structural validation
  const structuralResult = validateTransitions(pseudoState);
  errors.push(...structuralResult.errors);
  
  // Instructions validators
  for (const validator of instructionsExecutorValidators) {
    const validatorErrors = await validator(pseudoState, store, threadId);
    errors.push(...validatorErrors);
  }
  
  return errors;
}
```

### Adaptation Needed

The current validators read from `SpecProcessingState` which stores execution outputs (raw LLM output strings) in InMemoryStore, not the committed artifacts. For re-validation after patching, we need validators that can run against the committed artifact format. Two options:

1. **Adapt validators to accept artifact JSON directly** (preferred — cleaner interface)
2. **Reconstruct the InMemoryStore entries from committed artifacts** (hacky but minimal changes)

Recommendation: Create a thin adapter that wraps committed artifacts into the format validators expect. This avoids modifying the validators themselves and keeps backward compatibility.

---

## 11. Model Selection & Cost

### Coordinator

- **Model:** Haiku 4.5 (`claude-3-5-haiku`)
- **Why:** The coordinator does NL reasoning about error patterns. It doesn't need deep formal knowledge. Haiku is sufficient and cheap.
- **Estimated cost per invocation:** ~2K input tokens (prompt + errors + summaries), ~500 output tokens (ChangePlan JSON). ~$0.003 per call.

### Fragment Editors

- **Transitions editor:** Haiku 4.5 (JsonLogic rewrites are mechanical)
- **Instructions editor:** Sonnet 4 for complex mechanics changes, Haiku 4.5 for simple patches (missing actionRequired, missing flags)
  - Heuristic: If the change description mentions "rng", "mechanics", or "computation" → Sonnet. Otherwise → Haiku.
- **Schema editor:** Deterministic (no LLM) for field additions. LLM only for reextract.
- **Estimated cost per patch:** ~1-3K input tokens (system prompt cached + fragment + change), ~200-800 output tokens (updated fragment). ~$0.002-$0.01 per patch.

### Total Artifact Editor Cost Estimate

Typical edit session (3 errors, HIGH confidence fixes):
- 1 coordinator call: ~$0.003
- 2-3 editor patches: ~$0.006-$0.03
- **Total: ~$0.01-$0.04 per edit attempt**

Compare to full re-extraction: ~$0.21. Artifact editor is **5-20x cheaper**.

### Latency

- Coordinator: ~3-4s (Haiku, small prompt)
- Each patch: ~2-4s (Haiku, small prompt) or ~5-8s (Sonnet)
- Re-validation: ~0.1s (deterministic)
- **Total: ~8-20s per edit attempt**

Compare to full re-extraction: ~47-90s. Artifact editor is **3-5x faster**.

---

## 12. Mode 2: Sim Assistant & Gameplay Recovery

The coordinator's prompt and output schema are unchanged between Mode 1 and Mode 2. The critical difference is **who produces the error input**.

- **Mode 1:** Deterministic validators produce error strings → coordinator receives them directly.
- **Mode 2:** A user-facing **sim assistant** triages gameplay issues, confirms artifact bugs, and translates observations into synthetic error strings → coordinator receives those.

The coordinator never sees raw user text. The sim assistant is the bridge.

### Why a Separate Sim Assistant?

Not every user complaint requires artifact changes:

| User Says | Actual Category | Coordinator Needed? |
|---|---|---|
| "Player 2 should have won that round" | One-off state correction | No |
| "Scoring always gives the wrong player points" | Artifact bug | Yes |
| "Why did the game end?" | Explanation request | No |
| "Players can never leave the bidding phase" | Could be artifact bug OR misunderstanding | Maybe — after investigation |
| "Steal mechanics should work differently" | Design change request | No |

A pure pass-through to the coordinator would waste LLM calls on non-bug issues and would try to "fix" artifacts for cases where the game is behaving correctly. The sim assistant filters and classifies first.

### Sim Assistant Role

The sim assistant is a conversational agent available during gameplay simulation. It handles all user interaction about game behavior and has four response modes:

#### Response Category: EXPLANATION

The game is working correctly; the user doesn't understand why something happened.

- **Action:** Examine game state + action history, explain what transition fired and why.
- **No artifact changes.** No coordinator invocation.
- **Example:** User: "Why did the game end?" → Assistant reads `game.gameEnded`, finds the transition that set it, explains the preconditions that triggered it.

#### Response Category: STATE_CORRECTION

A one-off error in the current game state. The artifact rules are correct but the state diverged (e.g., after manual override, or an LLM executor made a bad state update).

- **Action:** Propose a specific state correction. Apply if user confirms.
- **No artifact changes.** No coordinator invocation.
- **Example:** User: "Player 2's score should be 15, not 10" → Assistant proposes `set game.players[1].score = 15`, applies on confirmation.

#### Response Category: ARTIFACT_BUG

The game rules/mechanics are systematically wrong. The same error would occur every time this situation arises.

- **Action:** Formulate structured diagnostic input, invoke the coordinator via the artifact editor.
- **Artifact editor invoked** with synthetic errors derived from the observation.
- **Example:** User: "Points always go to the wrong player" → Assistant examines the scoring transition, confirms it's applying points incorrectly in the artifact, produces synthetic errors, passes to coordinator.

#### Response Category: DESIGN_CHANGE

The user wants the game to work differently than the specification describes. This is not a bug.

- **Action:** Acknowledge the request, explain it requires a spec change (not an artifact fix).
- **No artifact changes.** Routes to design-via-deltas workflow (future).
- **Example:** User: "I want players to be able to steal from each other" → This isn't in the spec, so it's not a bug.

### Sim Assistant System Prompt

```
You are a game assistant helping players and game designers during 
simulation testing.

You have access to:
- The current game state (all fields and their values)
- The action history (last N actions and resulting state transitions)
- The game specification (what the game is supposed to do)
- The game artifacts (schema, transitions, instructions)

## When a user reports an issue or asks a question:

Determine which category it falls into:

1. **EXPLANATION** — The game is behaving correctly, but the user doesn't 
   understand why. Explain what happened using game state and action 
   history. Reference specific transitions and preconditions. No changes 
   needed.

2. **STATE_CORRECTION** — A one-off error in the current game state. The 
   rules are correct, but a specific value is wrong (e.g., wrong score 
   after a glitch). Propose the specific state change and wait for user 
   confirmation before applying.

3. **ARTIFACT_BUG** — The game rules/mechanics are systematically wrong. 
   The same error would happen every time this situation occurs. Before 
   classifying as ARTIFACT_BUG, verify by:
   - Checking if the artifact actually specifies wrong behavior (not just 
     an unexpected-but-correct outcome)
   - Looking at the relevant transition/instruction to confirm the logic 
     is incorrect
   - Identifying which specific artifact fragment contains the bug
   Then formulate a diagnostic report and invoke the artifact editor.

4. **DESIGN_CHANGE** — The user wants the game to work differently than 
   the specification describes. This is not a bug — the artifact correctly 
   implements the spec, but the spec itself needs updating. Acknowledge 
   the request and explain that this requires a specification change.

## Rules

- Always investigate before classifying. Read the relevant artifact 
  fragments and game state before deciding.
- If you're unsure between EXPLANATION and ARTIFACT_BUG, lean toward 
  EXPLANATION first and explain what you see. Ask the user if they think 
  the behavior is correct according to the game rules.
- Never invoke the artifact editor for EXPLANATION, STATE_CORRECTION, 
  or DESIGN_CHANGE issues.
- For STATE_CORRECTION, always propose the change and wait for 
  confirmation. Never apply state changes silently.
- Be conversational. You're helping a game designer test their game.
```

### Synthetic Error Generation

When the sim assistant classifies an issue as ARTIFACT_BUG, it produces a `GameplayDiagnosticInput` that gets translated into the same error format the coordinator already understands:

```typescript
interface GameplayDiagnosticInput {
  category: 'artifact_bug';
  /** Human-readable description of the symptom */
  symptom: string;
  /** Specific state snapshots or action logs showing the problem */
  evidence: string[];
  /** Which artifact(s) the assistant suspects are wrong */
  suspectedArtifact: 'schema' | 'transitions' | 'instructions';
  /** Optional: specific fragment the assistant identified as buggy */
  suspectedFragment?: string;
  /** Error strings formatted for the coordinator */
  syntheticErrors: string[];
}
```

The `syntheticErrors` field is the bridge. The sim assistant translates gameplay observations into error strings that match patterns the coordinator already knows:

| Observation | Synthetic Error |
|---|---|
| Points go to wrong player | `"Transition 'resolve_round' stateDelta sets score on incorrect player path"` |
| Game never ends | `"No transition sets game.gameEnded=true under reachable conditions"` (matches Pattern 3) |
| Player can't act despite it being their turn | `"Phase 'player_action' does not set actionRequired=true for active player"` (matches Pattern 1) |
| Game stuck in same phase | `"Phase 'bidding' has no outbound transitions with satisfiable preconditions given current state"` (matches Pattern 4/5) |
| Random outcome never varies | `"Transition 'resolve' rng op probabilities are degenerate (single outcome with p=1.0)"` (matches Pattern 8) |

The coordinator processes these synthetic errors identically to validation errors — same prompt, same fix patterns, same `ChangePlan` output. No coordinator prompt changes needed.

### Auto-Detected Gameplay Issues

Not all Mode 2 invocations come from user reports. Some issues are detected automatically by the runtime:

```typescript
interface AutoDetectedIssue {
  type: 'deadlock' | 'unexpected_end' | 'stuck_phase' | 'illegal_state';
  details: string;
  currentState: Record<string, any>;
  currentPhase: string;
  turnsSinceLastTransition: number;
}
```

Auto-detected issues bypass the sim assistant's triage (they're already confirmed problems) and go directly to the coordinator with synthetic errors:

- `deadlock` → `"Deadlock detected in phase '{phase}': no transitions fire and no player input expected"`
- `stuck_phase` → `"Phase '{phase}' has been active for {N} turns with no transition firing"`
- `unexpected_end` → `"Game ended unexpectedly in phase '{phase}' — gameEnded set to true when game should continue"`
- `illegal_state` → `"Illegal state detected: {details}"` (pass through)

### Integration Points for Mode 2

```typescript
// 1. User-reported issues (via API)
app.post('/api/sim/:sessionId/report-issue', async (req, res) => {
  const { message } = req.body;
  // Invoke sim assistant with user message + current game state
  const result = await simAssistant.handleUserReport(sessionId, message);
  // result.category determines what happened:
  // - EXPLANATION: just returns the explanation text
  // - STATE_CORRECTION: returns proposed change for confirmation
  // - ARTIFACT_BUG: coordinator was invoked, artifacts may have been patched
  // - DESIGN_CHANGE: returns explanation that spec change is needed
  res.json(result);
});

// 2. Auto-detected issues (from runtime graph)
// In processAction() or the runtime loop:
if (runtimeResult.deadlock || runtimeResult.illegalState) {
  const autoIssue = buildAutoDetectedIssue(runtimeResult, gameState);
  const syntheticErrors = translateAutoIssue(autoIssue);
  // Bypass sim assistant, invoke artifact editor directly
  const result = await artifactEditorGraph.invoke({
    gameSpecification,
    errors: syntheticErrors,
    stateSchema: currentArtifacts.schema,
    stateTransitions: currentArtifacts.transitions,
    playerPhaseInstructions: currentArtifacts.playerPhaseInstructions,
    transitionInstructions: currentArtifacts.transitionInstructions,
  });
  // Apply patched artifacts, restart sim from last good state
}
```

### Coordinator Changes for Mode 2

**None.** The coordinator's system prompt, output schema, and fix patterns are identical. The only difference is the source of error strings (validators vs. sim assistant vs. auto-detection). This is the key architectural benefit — the coordinator is a stable, testable core that doesn't need to understand where errors come from.

### Sim Assistant Model Selection

- **Model:** Sonnet 4 (needs reasoning about game behavior, state analysis, and conversational ability)
- **Why not Haiku:** The sim assistant needs to read game state, understand gameplay context, and produce nuanced classifications. Haiku would over-classify as ARTIFACT_BUG.
- **Cost per invocation:** ~3-5K input tokens (system prompt + game state + action history + user message), ~300-800 output tokens. ~$0.02-$0.04 per call.
- **Only invoked on user reports.** Auto-detected issues bypass it entirely.

### Sim Assistant File Location

```
game-builder/src/ai/simulate/artifact-editor/
  sim-assistant.ts            — Sim assistant agent (prompt, triage, synthetic error generation)
  auto-detection.ts           — Runtime issue detection and synthetic error translation
```

---

## 13. Implementation Plan

### Phase 1: Core Infrastructure (3-4 days)

| # | Task | Details |
|---|---|---|
| 1.1 | Define TypeScript interfaces | `ChangePlan`, `ArtifactChange`, `FragmentPatchInput/Output`, `ArtifactEditorState`, `ArtifactConfig` |
| 1.2 | Implement fragment extraction/replacement | `extractFragment()`, `replaceFragment()`, `insertFragment()` for each artifact type |
| 1.3 | Implement artifact summarizers | `summarizeSchema()`, `summarizeTransitions()`, `summarizeInstructions()` — compact representations for coordinator prompt |
| 1.4 | Implement coordinator agent | System prompt, user prompt template, Zod output schema, `invokeCoordinator()` |
| 1.5 | Unit tests for fragment ops | Test extract/replace/insert for all artifact types and addressing patterns |

### Phase 2: Fragment Editors (2-3 days)

| # | Task | Details |
|---|---|---|
| 2.1 | Schema editor (deterministic) | Field addition/modification without LLM |
| 2.2 | Extract `ArtifactConfig` objects | Factor system prompts + validators + models out of `NodeConfig` into shared `ArtifactConfig` objects consumed by both `createExtractionSubgraph` and `createEditorNode` |
| 2.3 | `createEditorNode` factory | Lightweight factory: config → async function (fragment in → fragment out) |
| 2.4 | Transitions & instructions editors | Instantiate via `createEditorNode(transitionsConfig)` and `createEditorNode(instructionsConfig)` with edit-mode user prompts |
| 2.5 | Re-validation adapter | Wrapper that feeds committed artifacts to existing validator functions |
| 2.6 | Unit tests for editors | Test each editor with representative change descriptions |

### Phase 3: Integration (2-3 days)

| # | Task | Details |
|---|---|---|
| 3.1 | Artifact editor subgraph implementation | `createArtifactEditorSubgraph()` factory: coordinator → apply_changes → revalidate → loop |
| 3.2 | Spec processing graph integration | Thin wrapper node that maps SpecProcessingState ↔ ArtifactEditorState, modify error routing |
| 3.3 | Model config | Add `setupArtifactEditorCoordinatorModel()` and `setupFragmentEditorModel()` to model-config.ts |
| 3.4 | Logging & tracing | Edit attempts logged to LangSmith under dedicated tracer project |
| 3.5 | Integration tests | Test with known-failing specs (RPS with missing actionRequired, Westward Peril with deadlocked init, etc.) |

### Phase 4: Validation & Tuning (2-3 days)

| # | Task | Details |
|---|---|---|
| 4.1 | Test against real failure cases | Run existing game specs, capture failures, verify artifact editor resolves them |
| 4.2 | Tune coordinator prompt | Adjust common fix patterns based on real edit success/failure data |
| 4.3 | Handle edge cases | Partially extracted artifacts, multiple root causes, cascading fix failures |
| 4.4 | Metrics | Track edit attempt count, success rate, errors resolved per attempt, cost per edit session |

### Estimated Total (Mode 1): 9-13 days

### Phase 5: Sim Assistant — Mode 2 (5-7 days, after Mode 1 is stable)

| # | Task | Details |
|---|---|---|
| 5.1 | Sim assistant agent | System prompt, triage logic, conversational flow |
| 5.2 | Synthetic error generation | `GameplayDiagnosticInput` → synthetic error strings, mapped to coordinator patterns |
| 5.3 | Auto-detection module | Runtime deadlock/stuck/illegal-state detection, automatic synthetic error translation |
| 5.4 | State correction handler | Direct state mutation for STATE_CORRECTION category (no coordinator) |
| 5.5 | API endpoint | `POST /api/sim/:sessionId/report-issue` wired to sim assistant |
| 5.6 | Integration with runtime graph | Auto-detected issues → coordinator bypass path |
| 5.7 | Integration tests | Test all 4 categories with representative user reports + auto-detected scenarios |

### Estimated Total (Mode 1 + Mode 2): 14-20 days

### File Locations (New)

```
game-builder/src/ai/simulate/artifact-editor/
  types.ts                    — ChangePlan, ArtifactChange, ArtifactConfig, ArtifactEditorState, etc.
  artifact-config.ts          — Shared ArtifactConfig objects (extracted from NodeConfig)
  coordinator.ts              — Coordinator agent (prompt, invocation, output parsing)
  fragment-ops.ts             — extractFragment, replaceFragment, insertFragment
  editor-factory.ts           — createEditorNode() factory
  artifact-summarizers.ts     — Compact artifact representations for prompts
  artifact-editor-subgraph.ts — createArtifactEditorSubgraph() factory (standalone subgraph)
  revalidation.ts             — Adapter to run existing validators on committed artifacts
  sim-assistant.ts            — Sim assistant agent (prompt, triage, synthetic error generation)
  auto-detection.ts           — Runtime issue detection and synthetic error translation
  __tests__/
    fragment-ops.test.ts
    coordinator.test.ts
    editor-factory.test.ts
    artifact-editor-subgraph.test.ts
    sim-assistant.test.ts
    auto-detection.test.ts
```

### Files Modified

```
game-builder/src/ai/simulate/graphs/spec-processing-graph/
  node-shared.ts          — Extract ArtifactConfig from NodeConfig (NodeConfig still extends it)
  index.ts                — Add thin artifact editor wrapper node, modify error routing
game-builder/src/ai/model-config.ts
  — Add setupArtifactEditorCoordinatorModel(), setupSimAssistantModel()
game-builder/src/ai/simulate/simulate-workflow.ts
  — Add auto-detection hooks in processAction(), add report-issue handler
```
