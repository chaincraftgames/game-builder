# Generated Mechanics — Design Document

**Date:** 2026-03-28  
**Status:** Draft  
**Supersedes:** Portions of INSTRUCTION_ARCHITECTURE.md (execution model), generate-mechanics spike (placement in pipeline)  
**Related:** artifact-editing-design.md, ACTION_SCHEMAS_FUTURE_DESIGN.md

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Design Principles](#2-design-principles)
3. [Architecture Overview](#3-architecture-overview)
4. [Instructions as Plan (No Execution Layer)](#4-instructions-as-plan-no-execution-layer)
5. [TypeScript Interface Generation from Schema](#5-typescript-interface-generation-from-schema)
6. [Mechanic Code Generation](#6-mechanic-code-generation)
7. [tsc Validation](#7-tsc-validation)
8. [Repair Graph Extension](#8-repair-graph-extension)
9. [Player Input & Action Schemas](#9-player-input--action-schemas)
10. [Runtime Execution Model](#10-runtime-execution-model)
11. [Migration from Current Architecture](#11-migration-from-current-architecture)
12. [Open Questions](#12-open-questions)

---

## 1. Problem Statement

The current spec-processing pipeline produces three artifact types: **schema**, **transitions**, and **instructions**. Instructions contain both a plan layer (mechanicsGuidance, rules, computation descriptions) and an execution layer (stateDelta ops, message templates). At runtime, `execute-changes` interprets instructions by sending them to an LLM which resolves `{{template}}` variables in stateDelta ops and message templates.

This creates several problems:

1. **Dual execution model.** The spike added a sandbox code path alongside the existing LLM+stateDelta path. Two execution models means two codepaths to maintain, two failure modes, and branching logic in execute-changes.

2. **No validation of runtime behavior.** StateDelta ops with `{{templates}}` are opaque until the LLM resolves them. We can validate structure but not whether the LLM will produce correct values.

3. **Repair graph blind to code.** The artifact editor handles schema, transitions, and instructions. Generated mechanics code isn't an artifact the repair graph knows about. If a generated function is broken, the only recourse is full regeneration.

4. **Instructions conflate specification with implementation.** `mechanicsGuidance` is a spec ("compare RPS choices, determine winner"). `stateDelta` is an implementation ("increment path `players.{{winnerId}}.roundsWon`"). These serve different purposes but are entangled in the same artifact.

### Core Insight

There is no game mechanic that is implemented better as template-resolved stateDelta ops than as generated code. Even trivial operations like `set game.gameEnded = true` are ~5 tokens more expensive as code but gain: type-checkability, a single execution model, and repairability.

---

## 2. Design Principles

1. **All mechanics are generated TypeScript.** Transitions and player actions alike. One execution model, one artifact type to generate and repair.

2. **Instructions are a plan, not an implementation.** They describe *what* should happen (rules, computations, expected state changes) — not *how* (no stateDelta ops, no message templates).

3. **Generated code is a first-class artifact.** Like schema, transitions, and instructions — it's produced, validated, repaired, and versioned.

4. **tsc is the primary validator.** Schema → TypeScript interfaces → type-check generated code → catch field access errors, type mismatches, and missing required fields at generation time, not runtime.

5. **`callLLM` is a tool, not the execution model.** Available in generated code for narrative generation and free-form input interpretation, but not the default path for state mutations.

6. **Repair graph handles all 4 artifact types.** The coordinator can diagnose whether a failure originates in schema, transitions, instructions (plan), or mechanics (code), and target the fix accordingly.

---

## 3. Architecture Overview

### Current Pipeline (spike)

```
extract_schema → extract_transitions → validate → repair_transitions
  → extract_instructions (plan + execution) → repair_artifacts
  → generate_mechanics (spike, post-repair) → extract_produced_tokens → END
```

Problems: generate_mechanics runs after repair (no repair loop for code), instructions still contain stateDelta ops, dual execution model at runtime.

### Proposed Pipeline

```
extract_schema → generate_state_interfaces (deterministic)
  → extract_transitions → validate_transitions → repair_transitions
  → extract_instructions (plan only)
  → generate_mechanics (TypeScript, typed against interfaces)
  → validate_mechanics (tsc + structural checks)
  → repair_artifacts (schema + transitions + instructions + mechanics)
  → extract_produced_tokens → END
```

Key changes:
- **generate_state_interfaces** is a new deterministic node (no LLM) between schema extraction and transitions extraction. Converts `GameStateField[]` → TypeScript interfaces using structured type info.
- **extract_instructions** produces plan-only output (no stateDelta ops, no message templates).
- **generate_mechanics** produces TypeScript functions typed against the generated interfaces.
- **validate_mechanics** runs tsc in-memory to type-check generated code. Also performs structural checks (exports expected functions, function signatures match contract).
- **repair_artifacts** is expanded to handle all 4 artifact types, positioned after mechanics validation.

### Artifact Dependency Graph

```
Schema (GameStateField[] — enriched with structured type info)
  ↕ generates
State Interfaces (TypeScript)
  ← used by
Generated Mechanics (TypeScript)
  ← guided by
Instructions (plan only)
  ← structured by
Transitions (phases, preconditions)
```

Repair implications: a fix to Schema cascades to State Interfaces (deterministic regen), which may invalidate Generated Mechanics (tsc catches this). A fix to Instructions (plan) may require mechanics regeneration.

### Schema Consumer Views

Not all consumers need the full enriched schema. Each downstream node gets a filtered view:

| Consumer | What it sees | Fields used |
|---|---|---|
| Transitions extraction | `"game.weaponMappings: record (Secret RPS mappings)"` | `name`, `path`, `type`, `purpose` |
| Instructions extraction | Same flat summary | `name`, `path`, `type`, `purpose` |
| Repair coordinator | Same flat summary | `name`, `path`, `type`, `purpose` |
| **Interface generator** | Full enriched fields | All fields including `properties`, `enumValues`, etc. |
| **Mechanics generation** | TypeScript interfaces (output of generator) | Consumes interfaces, not raw schema |

The existing `deriveSchemaFieldsSummary()` function already strips fields down to `name: type (purpose)` for LLM prompt contexts. It continues to work unchanged — it simply ignores the new structured fields.

---

## 4. Instructions as Plan (No Execution Layer)

### Current Instruction Structure (to be replaced)

```json
{
  "id": "resolve_round_outcome",
  "transitionName": "Resolve Round Outcome",
  "mechanicsGuidance": {
    "rules": ["Rock beats Scissors", ...],
    "computation": "Look up RPS mapping, determine winner, generate narrative"
  },
  "stateDelta": [
    { "op": "increment", "path": "players.{{winnerId}}.roundsWon", "value": "{{roundPoints}}" },
    { "op": "set", "path": "game.roundOutcome", "value": "{{narrative}}" }
  ],
  "messages": {
    "public": { "template": "Round {{game.currentRound}}: {{narrative}}" }
  }
}
```

### Proposed Plan-Only Instruction Structure

```json
{
  "id": "resolve_round_outcome",
  "transitionName": "Resolve Round Outcome",
  "mechanicsGuidance": {
    "rules": ["Rock beats Scissors", "Scissors beats Paper", "Paper beats Rock", ...],
    "computation": "Look up secret RPS mapping for each player's weapon, apply RPS rules, determine winner or tie, increment winner's score, generate narrative"
  },
  "rngConfig": null,
  "expectedStateChanges": {
    "game": ["roundOutcome"],
    "player": ["roundsWon"]
  },
  "messageGuidance": {
    "public": "Announce the round result: include both weapon names, winner or tie, humorous narrative, current scores for both players",
    "private": null
  },
  "imageContentSpec": null
}
```

Changes:
- **Removed:** `stateDelta[]` (template-based execution layer — replaced by generated code)
- **Removed:** `messages` templates (e.g. `"Round {{currentRound}}: {{narrative}}"`) — replaced by `messageGuidance`
- **Added:** `expectedStateChanges` — declares which fields the mechanic *should* modify. Used for validation (tsc can warn if the return type doesn't include expected fields; the repair coordinator can see intent vs. implementation mismatch).
- **Changed:** `messages` → `messageGuidance` — retains the *specification* of what messages to produce (who receives them, what content to include) without the template syntax. Guides code generation, not runtime template resolution. Can be a description string, or `null` if no message expected.
- **Retained:** `mechanicsGuidance`, `rngConfig`, `imageContentSpec` (plan layer, unchanged)

For player actions, `validation.checks[]` (JsonLogic preconditions) remain in instructions — they're evaluated deterministically before mechanic execution and are plan-level artifacts.

---

## 5. TypeScript Interface Generation from Schema

### Source: stateSchema artifact (`GameStateField[]`)

The `stateSchema` artifact is `JSON.stringify(GameStateField[])` — our custom format. This is what the schema extraction node produces and what all downstream artifact nodes consume.

#### Current `GameStateField`

```typescript
interface GameStateField {
  name: string;           // e.g. "currentRound", "weapons"
  type: string;           // free-form: "number", "object", "enum", etc.
  path: 'game' | 'player';
  source: string;         // "system", "player input", "base" — DEAD: never read by any code
  purpose: string;        // human-readable description
  constraints?: string;   // free-form: "enum:[rock,paper,scissors]" — DEAD: never read by any code
}
```

The original design prioritized: (1) minimal token count vs. JSON Schema, (2) simplicity for LLM consumers that don't need to parse JSON Schema structure. Both remain valid goals.

Analysis of field usage reveals that `source` and `constraints` are dead — they are written but never consumed by any downstream code. The only programmatically consumed fields are `name`, `path`, `type`, and `purpose`.

#### Proposed Enriched `GameStateField`

Replace `source` and `constraints` (dead fields) with structured type info. Make `type` a union instead of free-form string:

```typescript
type FieldType = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'record';

interface GameStateField {
  name: string;
  type: FieldType;
  path: 'game' | 'player';
  purpose: string;
  // Structured type detail (optional — only for complex types)
  enumValues?: string[];           // when type or valueType is 'enum'
  valueType?: FieldType;           // inner type when type is 'array' or 'record'
  required?: boolean;              // default true if omitted
}
```

Changes from current:
- **Removed:** `source` (dead), `constraints` (dead), `object` type (collapsed into `record`)
- **Changed:** `type` from `string` to `FieldType` union: `'string' | 'number' | 'boolean' | 'enum' | 'array' | 'record'`
- **Added:** `valueType` as `FieldType` union — the inner type for both `'array'` (element type) and `'record'` (value type). No separate `elementType` needed: when `type` already tells you the container kind, the role of `valueType` is unambiguous.
- **Added:** Single `enumValues` field — applies when `type` or `valueType` is `'enum'`. Only one level can be `'enum'` in a single field definition (no nesting depth), so one `enumValues` suffices.

**Why no `object` type:** The distinction between `object` (fixed keys with known properties) and `record` (dynamic keys with typed values) adds a decision point for the LLM with negligible validation benefit. Game code accesses nested structures by variable key (`weapons[selectedWeapon]`), not literal key — so tsc can't catch field-name typos in nested access regardless. Everything with sub-structure is a `record` with a typed value. If a field has dynamic string keys with string values → `record` with `valueType: 'string'`. If it has enum values → `record` with `valueType: 'enum'` and `enumValues`.

> **Future direction:** This flat schema format is transitional. The target architecture uses a component-based schema (ECS) where game state is defined by composable typed components rather than flat field lists. The enriched `GameStateField` is designed to be simple enough to migrate from without accumulated complexity.

#### Token Impact

Simple fields (majority of fields) — **zero overhead:**
```json
{"name":"currentRound","type":"number","path":"game","purpose":"Current round number"}
```
Actually fewer tokens than before (no `source` field).

Complex fields — **~15 extra tokens:**
```json
{"name":"weaponMappings","type":"record","path":"game","purpose":"Secret RPS mappings","valueType":"enum","enumValues":["rock","paper","scissors"]}
{"name":"weapons","type":"record","path":"player","purpose":"Player's 3 weapons","valueType":"string"}
```

For a typical game with ~15-20 fields where 3-4 are complex, total overhead is ~60 tokens. Negligible. And we *save* tokens by dropping `source` from every field.

#### Consumer Views — Not All Consumers See the Full Structure

The enriched schema is the canonical data model, but each consumer gets a filtered view suited to its needs. This preserves the original design goal of keeping LLM inputs simple:

**Flat summary** (for transitions, instructions, repair coordinator — via `deriveSchemaFieldsSummary()`):
```
game.currentRound: number (Current round number)
game.weaponMappings: record (Secret RPS mappings)
players.*.weapons: record (Player's 3 weapons)
```
Existing function, continues to work unchanged — ignores new fields. Low token count, easy for LLM to parse.

**Full enriched fields** (only for the interface generator — deterministic, not an LLM):
Reads `enumValues`, `valueType`, etc. to produce TypeScript interfaces with full type depth.

**TypeScript interfaces** (for mechanics generation LLM):
The mechanics LLM never sees `GameStateField[]` directly — it sees the generated TypeScript interfaces. TypeScript is arguably *easier* for an LLM to work with than either JSON Schema or our custom format.

### Output: TypeScript Interfaces

Deterministic generation (no LLM) from `GameStateField[]`, mapping:

| `GameStateField` | TypeScript |
|---|---|
| `type: 'string'` | `string` |
| `type: 'number'` | `number` |
| `type: 'boolean'` | `boolean` |
| `type: 'enum', enumValues: ['a','b','c']` | `"a" \| "b" \| "c"` |
| `type: 'array', valueType: 'string'` | `string[]` |
| `type: 'array', valueType: 'enum', enumValues: [...]` | `("a" \| "b" \| "c")[]` |
| `type: 'record', valueType: 'string'` | `Record<string, string>` |
| `type: 'record', valueType: 'number'` | `Record<string, number>` |
| `type: 'record', valueType: 'enum', enumValues: [...]` | `Record<string, "a" \| "b" \| "c">` |
| `type: 'record'` (no valueType) | `Record<string, unknown>` |

Example output for wacky-weapons:

```typescript
// Auto-generated from stateSchema — DO NOT EDIT
export interface GameState {
  currentRound: number;
  maxRounds: number;
  weaponMappings: Record<string, "rock" | "paper" | "scissors">;
  roundOutcome: string;
  gameEnded: boolean;
  winningPlayers: string[];
  publicMessages: string[];
}

export interface PlayerState {
  roundsWon: number;
  selectedWeapon: string;
  weapons: Record<string, string>;
  ready: boolean;
  actionRequired: boolean;
  isGameWinner: boolean;
}

export interface MechanicState {
  game: GameState;
  [playerAlias: `player${number}`]: PlayerState;
}

export type CallLLM = (prompt: string) => Promise<string>;

export interface MechanicResult {
  game?: Partial<GameState>;
  [playerAlias: `player${number}`]: Partial<PlayerState>;
  publicMessage?: string;
  privateMessages?: Record<string, string>;
}
```

### Node Placement

`generate_state_interfaces` runs immediately after `extract_schema`. It's deterministic — reading `GameStateField[]`, emitting TypeScript source as a string. No LLM, no validation needed. Stored in state as `stateInterfaces: string` (the TypeScript source text).

If the schema is repaired later, `generate_state_interfaces` re-runs automatically (deterministic — no cost).

---

## 6. Mechanic Code Generation

### What Gets Generated

One TypeScript async function per:
- **Automatic transition** (`transitionInstructions` entries)
- **Player action** (`playerPhaseInstructions` action entries)

### Function Signature (uniform)

```typescript
// Automatic transition
export async function resolve_round_outcome(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> { ... }

// Player action — adds typed input parameter
export async function finalize_weapons(
  state: MechanicState,
  input: FinalizeWeaponsInput,  // per-action input schema
  callLLM: CallLLM
): Promise<MechanicResult> { ... }
```

### Generation Prompt Context

The LLM receives:
1. **State interfaces** (TypeScript) — defines what fields exist and their types
2. **Function signature** — pre-defined, not generated
3. **MechanicsGuidance** — rules and computation description from the plan
4. **Expected state changes** — which fields should be modified
5. **Message guidance** — what messages to produce, who receives them, what content to include
6. **Generic examples** — show the pattern, not game-specific code

### callLLM Usage

Available in all generated functions. Two legitimate uses:

1. **Narrative generation** — producing creative text (battle descriptions, announcements)
2. **Free-form input interpretation** — for narrative games where player input isn't structured

```typescript
// Narrative use
const narrative = await callLLM("Describe the battle between the weapons");
return { game: { roundOutcome: narrative }, publicMessage: narrative };

// Input interpretation use (narrative game)
const interpreted = await callLLM(`Player said: "${input.raw}". What action did they take?`);
```

The runtime injects narrative context (tone, style) into callLLM automatically — generated code provides only the content request.

---

## 7. tsc Validation

### In-Memory Compilation

Use the TypeScript compiler API for in-memory validation — no temp files:

```typescript
import ts from 'typescript';

function validateMechanics(
  stateInterfaces: string,    // generated from schema
  mechanicSources: Record<string, string>  // transitionId → TypeScript source
): { valid: boolean; errors: TscError[] }
```

### What tsc Catches

| Error Class | Example | tsc Code |
|---|---|---|
| Nonexistent field access | `state.player1.health` (not in schema) | TS2339 |
| Field name typos | `state.player1.selectedWepon` | TS2551 |
| Wrong return type | `{ game: { currentRound: "next" } }` (string, not number) | TS2322 |
| Wrong callLLM usage | `callLLM(42)` | TS2345 |
| Type-incorrect operations | `state.game.currentRound.length` (number has no .length) | TS2339 |

### What tsc Does NOT Catch (runtime concerns)

| Error Class | Example | Why |
|---|---|---|
| Logic errors | Wrong RPS comparison | Types correct, semantics wrong |
| Wrong literal values | `roundsWon: 99` instead of `+1` | Type-correct number |
| Missing mutations | Forgot to increment score | Partial return allows omissions |
| Dynamic key misses | `weaponMappings[key]` where key doesn't exist | Record allows any string key |

### Structural Checks (beyond tsc)

In addition to type-checking, `validate_mechanics` performs:
- **Export verification**: each expected function is exported
- **Signature verification**: parameters match the contract (state, input?, callLLM)
- **Coverage**: every transition and player action in instructions has a corresponding function

### Error Classification for Repair

tsc errors are structured and include error codes, enabling deterministic routing:

- **TS2339/TS2551** (property doesn't exist) → likely code typo OR schema gap. Coordinator decides: is the field needed? If so → add to schema. If not → regenerate mechanic.
- **TS2322** (type mismatch) → wrong return type in generated code → regenerate mechanic with error context
- **TS2345** (argument type) → wrong callLLM usage → regenerate mechanic
- **Missing export** → regeneration (function wasn't produced)

---

## 8. Repair Graph Extension

### Current Artifact Editor

```
coordinator → edit_schema → edit_transitions → edit_instructions → revalidate → retry?
```

Handles 3 artifact types: schema, transitions, instructions.

### Extended Artifact Editor

```
coordinator → edit_schema → edit_transitions → edit_instructions → edit_mechanics → revalidate → retry?
```

Handles 4 artifact types: schema, transitions, instructions, **mechanics**.

### Type Changes

**ArtifactChange.artifact enum:**
```typescript
// Current
artifact: z.enum(['schema', 'transitions', 'instructions'])

// Proposed
artifact: z.enum(['schema', 'transitions', 'instructions', 'mechanics'])
```

**ArtifactEditorState additions:**
```typescript
// New fields
generatedMechanics: Record<string, string>;  // transitionId → TypeScript source
stateInterfaces: string;                      // TypeScript interfaces source
```

**CoordinatorInput additions:**
```typescript
generatedMechanics?: string;  // JSON string of transitionId → source
stateInterfaces?: string;     // TypeScript interfaces (for context)
tscErrors?: string[];         // Structured tsc diagnostic strings
```

### New Coordinator Fix Patterns

**Pattern 11: Field access on nonexistent schema field (TS2339/TS2551)**
- Error: `"Property 'health' does not exist on type 'PlayerState'"`
- Root cause: Generated code references a field not in the schema
- Fix TWO possible approaches:
  1. Add field to schema (if the game spec implies it should exist) → schema + regen interfaces + regen mechanic
  2. Fix the code to use the correct field name (if typo) → mechanics only
- Artifacts affected: schema or mechanics
- Confidence: HIGH (tsc provides exact field name and sometimes suggests correction)

**Pattern 12: Return type mismatch (TS2322)**
- Error: `"Type 'string' is not assignable to type 'number'"`
- Fix: Regenerate mechanic with error context
- Artifacts affected: mechanics only
- Confidence: HIGH

**Pattern 13: Mechanic logic doesn't match plan**
- Error: Runtime behavioral failure (post-validation, from sim assistant)
- Fix: Compare mechanic code against instructions plan, regenerate mechanic with explicit correction guidance
- Artifacts affected: mechanics (possibly instructions if plan is ambiguous)
- Confidence: MEDIUM

### edit_mechanics Node

Analogous to edit_instructions:
- For `patch` operations: receives the specific function body, error context, and instructions plan. LLM produces corrected function body.
- For `reextract` operations: regenerates the function from scratch using the instructions plan and state interfaces.
- Output is re-validated by tsc before the repair loop completes.

### Standalone Repair Invocation

The graph can be invoked standalone for runtime error repair (sim assistant use case):

```typescript
const graph = await createArtifactEditorGraph();
const result = await graph.invoke({
  gameSpecification,
  errors: ['RuntimeError: Cannot read property "weapon" of undefined at resolve_round_outcome'],
  schemaFields: deriveSchemaFieldsSummary(stateSchema),
  stateSchema,
  stateInterfaces,
  stateTransitions,
  playerPhaseInstructions: { ... },
  transitionInstructions: { ... },
  generatedMechanics: { resolve_round_outcome: '...' },
}, config);
```

The revalidate node would need a mode switch: structural validation (default) vs. runtime re-execution against the failing input.

---

## 9. Player Input & Action Schemas

### The Input Interpretation Problem

Generated code receives typed state but potentially untyped player input:
- Player types `"r"`, `"rock"`, `"I choose rock"`, `"ROCK"`
- Code does `if (input.choice === 'rock')` → fails for all but the exact string

### Solution: Layered Input Handling

**Layer 1: Structured input (action schemas exist)**

The action schema defines expected fields and types. The frontend renders appropriate controls (dropdown, text field, etc.). Input arrives pre-validated:

```typescript
interface FinalizeWeaponsInput {
  weapon1: string;
  weapon2: string;
  weapon3: string;
}
```

Generated code receives clean typed input. No interpretation needed.

**Layer 2: Free-form / narrative input**

For narrative-driven games where players type natural language, the generated code calls `callLLM` explicitly for interpretation:

```typescript
export async function narrative_action(
  state: MechanicState,
  input: { raw: string },
  callLLM: CallLLM
): Promise<MechanicResult> {
  const interpreted = await callLLM(
    `Player said: "${input.raw}". What action did they take? Options: attack, defend, flee.`
  );
  // ... work with interpreted result
}
```

### Input Type Generation

When action schemas exist, each player action gets a typed input interface generated alongside the state interfaces:

```typescript
// From action schema for "finalize_weapons"
export interface FinalizeWeaponsInput {
  weapon1: string;
  weapon2: string;
  weapon3: string;
}

// From action schema for "submit_choice" (with constraint)
export interface SubmitChoiceInput {
  choice: "rock" | "paper" | "scissors";
}

// Fallback: narrative / free-form
export interface RawInput {
  raw: string;
}
```

tsc then validates that generated code accesses input fields correctly.

### Separation of Concerns

```
Raw player input
  → Input normalization (upstream, not part of mechanic)
      - Structured: frontend controls → typed object
      - Fuzzy: prefix match, case-insensitive, Levenshtein
      - Open-ended: LLM extraction (in callLLM, not in mechanic)
  → Typed input object
      → Mechanic code (receives clean, typed input)
```

Input normalization is NOT part of the mechanic function. It's an upstream concern handled by the runtime or frontend.

---

## 10. Runtime Execution Model

### Current Model (dual-path, to be replaced)

```
execute-changes receives selectedInstructions
  → extract deterministic stateDelta ops
  → if generated mechanic exists:
      → sandbox path (new Function + deepFreeze)
  → else:
      → LLM path (resolve templates, return stateDelta + messages)
  → apply deterministic overrides
```

### Proposed Model (single-path)

```
execute-changes receives transitionId (or actionId)
  → look up compiled mechanic function
  → build typed state snapshot (aliased, frozen)
  → build typed input (player actions only)
  → execute mechanic(state, [input,] callLLM)
  → validate return against MechanicResult shape
  → apply result to canonical state
  → apply deterministic overrides (currentPhase, gameEnded, winningPlayers)
```

### Deterministic Overrides (preserved)

Certain fields are too critical to trust to generated code:
- `game.currentPhase` — forced to router's `nextPhase`
- `game.gameEnded` — forced `true` if entering "finished" phase
- `player.isGameWinner` — defaulted to `false` if unset
- `game.winningPlayers` — computed from player flags

These overrides are applied after mechanic execution regardless of what the code returns. This preserves the safety properties of the current deterministic override system.

### Sandbox Execution

The spike's sandbox approach (strict-mode `new Function` + `deepFreeze`) remains the execution mechanism. Generated TypeScript is transpiled to JavaScript via `ts.transpileModule()` (~5ms) after tsc validation passes.

Production hardening (future): `vm.createContext` or worker threads for stronger isolation.

---

## 11. Migration from Current Architecture

### Phase 1: Foundation (minimal changes, unlocks tsc)

1. Enrich `GameStateField` with structured type info (union `type`, optional `enumValues`/`properties`/`elementType`/etc.). Remove dead `source` and `constraints` fields. Update schema extraction prompt and `baseSchemaFields` generation.
2. Implement `generate_state_interfaces` node (`GameStateField[]` → TypeScript interfaces)
3. Modify generate_mechanics to produce TypeScript (instead of JS) typed against generated interfaces
4. Add `validate_mechanics` node with in-memory tsc compilation
5. Wire: `... → generate_mechanics → validate_mechanics → repair_artifacts → ...`

No changes to instructions extraction or execute-changes. The LLM path continues to work. Generated mechanics override it when available (existing spike behavior). Existing consumers (`deriveSchemaFieldsSummary`, `extractSchemaFields`) updated to use new `type` union — minor change, no behavioral difference.

### Phase 2: Instructions as Plan

1. Modify extract_instructions prompt to produce plan-only output (remove stateDelta, message templates)
2. Add `expectedStateChanges` and `messageGuidance` to instruction schema
3. Generate mechanics for ALL transitions and player actions (not just mechanicsGuidance-flagged ones)
4. Remove LLM execution path from execute-changes (all execution through sandbox)

### Phase 3: Repair Graph Extension

1. Add `'mechanics'` to `ArtifactChange.artifact` enum
2. Add `edit_mechanics` node to artifact editor graph
3. Add `generatedMechanics` and `stateInterfaces` to ArtifactEditorState
4. Add Patterns 11-13 to coordinator prompt
5. Extend revalidate node with tsc re-validation mode

### Phase 4: Action Schema Integration

1. Generate typed input interfaces from action schemas
2. Add input parameter to player action mechanic signatures
3. Implement input normalization layer upstream of mechanic execution
4. Frontend renders controls from action schemas

---

## 12. Open Questions

### Schema Extraction Prompt Changes
The schema extraction prompt currently instructs the LLM to produce `source` and `constraints` (free-form). The updated prompt drops `source`, drops `object` type (everything with sub-structure becomes `record`), replaces `constraints` with the structured optional fields (`enumValues`, `elementType`, `valueType`, `valueEnumValues`), and makes `type` a strict union of 6 values. The LLM already produces the right type strings — this just formalizes them and eliminates the `object` vs `record` decision point. The simplified type set (`string | number | boolean | enum | array | record`) reduces extraction errors by removing an ambiguous choice.

### Nested Object Access Depth
By collapsing `object` into `record` (no `properties`), tsc cannot validate nested fixed-key access like `state.player1.weapons.weapon1`. Access through `Record<string, string>` allows any string key. This is an acceptable trade-off because: (1) game code typically accesses sub-structures by variable key, not literal key, (2) top-level field access errors (the highest-value error class) are fully caught, (3) the component-based schema (future) will handle structured typing at a deeper level.

### Partial Returns and Missing Mutations
Generated code returns `Partial<GameState>` — it's allowed to omit fields it doesn't change. This means tsc can't verify that the code *does* modify `expectedStateChanges` fields. Options:
- Accept this gap (runtime/behavioral testing catches it)
- Make `expectedStateChanges` fields *required* in the return type per-function (tsc enforces it, but makes the interface generation per-function rather than shared)
- Post-execution check: compare returned keys against `expectedStateChanges` (deterministic, no tsc)

### Revalidate Mode for Runtime Errors
For standalone repair (sim assistant), the revalidate node needs to re-execute the mechanic against the failing input, not just type-check. Design: revalidate receives an `executionContext` (state snapshot + input + expected behavior) and re-runs the sandbox. If the mechanic succeeds, repair is validated. This needs careful design — what does "success" mean if the original error was behavioral, not a crash?

### callLLM Typing
Currently `callLLM` returns `Promise<string>`. For structured interpretation (e.g., "extract weapon names → return `{weapon1, weapon2, weapon3}`"), the code would need to `JSON.parse()` the result — losing type safety. Options:
- Keep it as `string` (simple, explicit about the boundary)
- Add a generic overload: `callLLM<T>(prompt: string, schema: ZodSchema<T>): Promise<T>` (type-safe but more complex contract)

### Token Cost of All-Code vs. Hybrid
Generating code for trivial ops (~5 extra tokens per function) is negligible at generation time. But the generation prompt itself is larger (needs interfaces, contract, examples). Measure actual token cost on representative games before committing. If cost is problematic for simple games, consider a "trivial mechanic" fast-path that generates boilerplate code deterministically (no LLM) for pure-assignment transitions.
