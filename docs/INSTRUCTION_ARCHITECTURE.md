# Instruction Architecture & Change Agent Flow

## Overview

This document explains how phase instructions are structured, what role the LLM plays versus deterministic code, and how the change agent processes player actions and automatic transitions.

## Core Concept: Template-Based Instructions

Instructions are **pre-generated artifacts** that specify how to handle player actions and automatic transitions. They contain:

1. **Templated stateDelta operations** with `{{placeholders}}`
2. **JsonLogic preconditions** for validation
3. **Templated messages** with `{{placeholders}}` for state interpolation
4. **Metadata** about what state fields are needed

### Example: RPS "submit_choice" Action

```json
{
  "actionName": "submit_choice",
  "validation": {
    "preconditions": {
      "and": [
        {"===": [{"var": "game.phase"}, "choice"]},
        {"!": {"var": "players.{{playerId}}.choice"}},
        {"in": [{"var": "input.choice"}, ["rock", "paper", "scissors"]]}
      ]
    },
    "errorMessages": {
      "wrongPhase": "Cannot submit choice outside choice phase",
      "alreadySubmitted": "You have already submitted your choice",
      "invalidChoice": "Choice must be rock, paper, or scissors"
    }
  },
  "stateDelta": [
    {
      "op": "set",
      "path": "players.{{playerId}}.choice",
      "value": "{{input.choice}}"
    },
    {
      "op": "set",
      "path": "players.{{playerId}}.submittedAt",
      "value": "{{timestamp}}"
    }
  ],
  "messages": {
    "private": {
      "to": "{{playerId}}",
      "template": "You chose {{input.choice}}"
    },
    "public": {
      "template": "{{playerName}} has submitted their choice"
    }
  },
  "requiredStateFields": [
    "game.phase",
    "players.{{playerId}}.choice",
    "players.{{playerId}}.name"
  ]
}
```

## Change Agent Flow

### High-Level Process

```
Player Action → Router → Change Agent → Verifier → Committer
                  ↓
            (selects instruction)
                  ↓
        Deterministic Code ← → LLM
```

### Detailed Steps

#### 1. Router (Deterministic)

**Input:** Player action + current state
**Processing:**
- Look up current phase from state
- Match action name to phase instructions
- Load instruction artifact

**Output:** 
- Selected instruction
- Minimal state slice (only requiredStateFields)
- Phase key + version

#### 2. Change Agent (Hybrid: Deterministic + LLM)

**Deterministic Processing:**

```typescript
// 1. Extract minimal state slice
const stateSlice = extractFields(state, instruction.requiredStateFields);

// 2. Evaluate JsonLogic preconditions
const validationResult = evaluateJsonLogic(
  instruction.validation.preconditions, 
  { ...stateSlice, input: playerInput }
);

if (!validationResult.valid) {
  return { 
    error: instruction.validation.errorMessages[validationResult.failedRule] 
  };
}

// 3. Check if this is deterministic (no templates)
const hasTemplates = hasAnyTemplateVariables(instruction.stateDelta);

if (!hasTemplates) {
  // Fully deterministic - no LLM needed!
  return {
    stateDelta: instruction.stateDelta,
    messages: instruction.messages
  };
}
```

**LLM Processing (when templates exist):**

```typescript
// 4. LLM resolves templates
const llmPrompt = {
  instruction: instruction,
  stateSlice: stateSlice,
  playerInput: playerInput,
  task: "Resolve all {{template}} variables and return stateDelta + messages"
};

const llmResponse = await llm.invoke({
  systemPrompt: phaseInstructionPrompt,
  input: llmPrompt,
  schema: ChangeAgentResponseSchema // Zod schema for structured output
});

// LLM returns:
{
  "rationale": "Player p1 chose rock, timestamp is 2025-12-01T10:30:00Z",
  "stateDelta": [
    {
      "op": "set",
      "path": "players.p1.choice",
      "value": "rock"  // Resolved from {{input.choice}}
    },
    {
      "op": "set",
      "path": "players.p1.submittedAt",
      "value": "2025-12-01T10:30:00Z"  // Resolved from {{timestamp}}
    }
  ],
  "messages": {
    "private": {
      "to": "p1",
      "content": "You chose rock"  // Resolved template
    },
    "public": {
      "content": "Alice has submitted their choice"  // Resolved {{playerName}}
    }
  }
}
```

**Key Point:** The LLM doesn't decide WHAT to do (that's in the instruction). It only resolves template variables using the state slice and input.

#### 3. Verifier (Deterministic)

**Input:** stateDelta from change agent
**Processing:**

```typescript
// 1. Apply deltas to shadow state
const result = applyStateDeltas(state, stateDelta);

if (!result.success) {
  return { error: result.errors };
}

// 2. Validate game invariants
const invariantChecks = [
  () => result.newState.players.length <= result.newState.game.maxPlayers,
  () => result.newState.game.round >= 0,
  // ... other invariants
];

for (const check of invariantChecks) {
  if (!check()) {
    return { error: "Invariant violation" };
  }
}

// 3. Success
return { 
  success: true, 
  newState: result.newState 
};
```

#### 4. Committer (Deterministic)

**Input:** Verified state + metadata
**Processing:**
- Persist newState to LangGraph memory
- Log stateDelta, messages, RNG seed
- Record instruction version used
- Increment turn counter

**Output:** Updated checkpoint

## Two-Tier Instruction System

### Tier 1: Fully Deterministic (~5% of instructions)

**No template variables → No LLM call needed**

Example: RPS "start_game" action
```json
{
  "actionName": "start_game",
  "stateDelta": [
    {
      "op": "set",
      "path": "game.phase",
      "value": "choice"
    },
    {
      "op": "set",
      "path": "game.round",
      "value": 1
    }
  ],
  "messages": {
    "public": {
      "template": "Game started! Round 1 - make your choices"
    }
  }
}
```

**Change Agent Processing:**
1. Router selects instruction
2. Deterministic code evaluates preconditions (if any)
3. **No LLM call** - instruction already contains literal values
4. Verifier applies deltas
5. Committer persists state

**Cost:** ~$0 (no LLM inference)

### Tier 2: LLM-Driven (~95% of instructions)

**Has template variables → LLM resolves at runtime**

Example: RPS "resolve_round" transition
```json
{
  "transitionName": "resolve_round",
  "trigger": {
    "preconditions": {
      "and": [
        {"===": [{"var": "game.phase"}, "choice"]},
        {"!==": [{"var": "players.p1.choice"}, null]},
        {"!==": [{"var": "players.p2.choice"}, null]}
      ]
    }
  },
  "stateDelta": [
    {
      "op": "set",
      "path": "game.phase",
      "value": "reveal"
    },
    {
      "op": "increment",
      "path": "players.{{winnerId}}.score",
      "amount": 1
    },
    {
      "op": "append",
      "path": "game.history",
      "value": {
        "round": "{{game.round}}",
        "p1Choice": "{{players.p1.choice}}",
        "p2Choice": "{{players.p2.choice}}",
        "winner": "{{winnerId}}"
      }
    }
  ],
  "messages": {
    "public": {
      "template": "{{player1Name}} chose {{p1Choice}}, {{player2Name}} chose {{p2Choice}}. {{winnerName}} wins!"
    }
  },
  "requiredStateFields": [
    "game.round",
    "players.p1.choice",
    "players.p1.name",
    "players.p2.choice",
    "players.p2.name"
  ]
}
```

**Change Agent Processing:**
1. Router selects instruction
2. Deterministic code:
   - Evaluates preconditions (both players submitted)
   - Extracts required state fields
   - Detects templates exist
3. **LLM call** with:
   - Instruction template
   - State slice: `{ game: { round: 1 }, players: { p1: { choice: "rock", name: "Alice" }, p2: { choice: "scissors", name: "Bob" } } }`
   - Task: "Determine winner using RPS rules and resolve all templates"
4. LLM returns:
   ```json
   {
     "rationale": "Rock beats scissors, so p1 wins",
     "stateDelta": [
       { "op": "set", "path": "game.phase", "value": "reveal" },
       { "op": "increment", "path": "players.p1.score", "amount": 1 },
       { "op": "append", "path": "game.history", "value": { "round": 1, "p1Choice": "rock", "p2Choice": "scissors", "winner": "p1" } }
     ],
     "messages": {
       "public": { "content": "Alice chose rock, Bob chose scissors. Alice wins!" }
     }
   }
   ```
5. Verifier applies deltas
6. Committer persists state

**Cost:** ~$0.001-0.01 per action (Haiku/Sonnet)

## What's in the Instruction Artifact?

Generated during **extract-instructions** phase (before runtime):

```typescript
interface PhaseInstructions {
  phase: string;
  requiresPlayerInput: boolean;
  
  playerActions: Array<{
    actionName: string;
    description: string;
    
    // Deterministic validation
    validation?: {
      preconditions: JsonLogic;
      errorMessages: Record<string, string>;
    };
    
    // Templated state changes
    stateDelta: StateDeltaOp[];  // May contain {{templates}}
    
    // Templated messages
    messages?: {
      private?: {
        to: string;  // May be {{playerId}}
        template: string;  // May contain {{vars}}
      };
      public?: {
        template: string;  // May contain {{vars}}
      };
    };
    
    // What state the LLM needs to resolve templates
    requiredStateFields: string[];
  }>;
  
  automaticTransitions: Array<{
    transitionName: string;
    priority: number;  // Order to check transitions
    
    // When to trigger
    trigger: {
      preconditions: JsonLogic;
    };
    
    // Similar structure to playerActions
    stateDelta: StateDeltaOp[];
    messages?: { ... };
    requiredStateFields: string[];
  }>;
}
```

## What's NOT in the Instructions?

Instructions do **NOT** contain:
- ❌ Natural language descriptions of what to do
- ❌ Examples or hints for the LLM
- ❌ Game rules or logic (that's in stateDelta templates)
- ❌ Multiple options or branching logic

The instruction IS the executable specification. The LLM's job is minimal: resolve template variables, not make decisions.

## Why This Approach?

### Benefits

1. **Auditability**: Every instruction version is immutable and logged
2. **Performance**: 
   - ~5% of actions need no LLM (deterministic)
   - ~95% only need small state slices + template resolution (cheap)
3. **Reliability**: Verifier catches invalid state changes before persistence
4. **Cost**: Structured output 3-5x faster than tool calls, 2-3x cheaper
5. **Determinism**: Same state + input + instruction version = same output (RNG seed logged)

### Trade-offs

1. **Upfront Cost**: Must generate instructions during discovery phase
2. **Flexibility**: Can't easily add new actions mid-game (need new instruction version)
3. **LLM Dependency**: Still need LLM for ~95% of actions (due to messaging)
4. **Complexity**: Template resolution adds layer vs pure deterministic or pure LLM

## Example: Complete RPS Round Flow

### State Before
```json
{
  "game": { "phase": "choice", "round": 1 },
  "players": {
    "p1": { "name": "Alice", "choice": null, "score": 0 },
    "p2": { "name": "Bob", "choice": null, "score": 0 }
  }
}
```

### Action 1: Player 1 submits choice

**Router:**
- Loads "choice" phase instructions
- Finds "submit_choice" action
- Extracts state slice: `{ game.phase, players.p1.choice, players.p1.name }`

**Change Agent:**
- Evaluates preconditions: ✓ (phase is "choice", p1 hasn't chosen yet, "rock" is valid)
- Detects templates: `{{playerId}}`, `{{input.choice}}`, `{{timestamp}}`
- **LLM call** to resolve templates
- LLM returns literal stateDelta

**Verifier:**
- Applies: `{ "op": "set", "path": "players.p1.choice", "value": "rock" }`
- Checks invariants: ✓
- Returns newState

**Committer:**
- Persists state
- Logs: `{ action: "submit_choice", player: "p1", stateDelta: [...], instructionVersion: "v1.0.0" }`

### Action 2: Player 2 submits choice

Same flow as Action 1, but for p2.

### State After Both Choices
```json
{
  "game": { "phase": "choice", "round": 1 },
  "players": {
    "p1": { "name": "Alice", "choice": "rock", "score": 0 },
    "p2": { "name": "Bob", "choice": "scissors", "score": 0 }
  }
}
```

### Automatic Transition: Resolve round

**Router:**
- Checks all automatic transitions for "choice" phase
- Finds "resolve_round" transition
- Evaluates trigger preconditions: ✓ (both players have chosen)

**Change Agent:**
- Extracts state slice: `{ game.round, players.p1.choice, players.p1.name, players.p2.choice, players.p2.name }`
- Detects templates: `{{winnerId}}`, `{{winnerName}}`, etc.
- **LLM call** with instruction + state slice
- LLM determines winner (rock > scissors → p1) and resolves all templates
- Returns literal stateDelta

**Verifier:**
- Applies all deltas (set phase, increment score, append history)
- Checks invariants: ✓

**Committer:**
- Persists state
- Logs transition with full context

### State After Transition
```json
{
  "game": { 
    "phase": "reveal", 
    "round": 1,
    "history": [
      { "round": 1, "p1Choice": "rock", "p2Choice": "scissors", "winner": "p1" }
    ]
  },
  "players": {
    "p1": { "name": "Alice", "choice": "rock", "score": 1 },
    "p2": { "name": "Bob", "choice": "scissors", "score": 0 }
  }
}
```

## Encoding Game Mechanics

### The Critical Question

**How do we express game rules like "rock beats scissors beats paper" or "highest trump suit wins"?**

### Three Approaches

#### Option 1: Natural Language Instructions (Proposed Approach)

The instruction includes NL description of the mechanic alongside templated stateDelta ops:

```json
{
  "transitionName": "resolve_round",
  "mechanicsGuidance": {
    "rules": [
      "Rock beats scissors",
      "Scissors beats paper", 
      "Paper beats rock",
      "If both players choose the same, it's a tie (no score change)"
    ],
    "computation": "Compare players.p1.choice against players.p2.choice using RPS rules to determine winnerId (or null for tie)"
  },
  "stateDelta": [
    {
      "op": "set",
      "path": "game.phase",
      "value": "reveal"
    },
    {
      "op": "increment",
      "path": "players.{{winnerId}}.score",
      "amount": 1,
      "condition": "{{winnerId !== null}}"
    },
    {
      "op": "append",
      "path": "game.history",
      "value": {
        "round": "{{game.round}}",
        "p1Choice": "{{players.p1.choice}}",
        "p2Choice": "{{players.p2.choice}}",
        "winner": "{{winnerId}}",
        "outcome": "{{outcome}}"
      }
    }
  ],
  "messages": {
    "public": {
      "template": "{{player1Name}} chose {{p1Choice}}, {{player2Name}} chose {{p2Choice}}. {{outcomeMessage}}"
    }
  }
}
```

**LLM Processing:**
1. Reads mechanicsGuidance natural language
2. Reads current state slice
3. Applies rules (rock > scissors, etc.)
4. Resolves templates: `{{winnerId}}` → "p1", `{{outcome}}` → "win", `{{outcomeMessage}}` → "Alice wins!"
5. Returns literal stateDelta

**Scaling Examples:**

**Spades Trump Mechanics:**
```json
{
  "transitionName": "resolve_trick",
  "mechanicsGuidance": {
    "rules": [
      "Spades are always trump",
      "If any spades were played, highest spade rank wins",
      "If no spades played, highest card of the led suit wins",
      "Rank order: A > K > Q > J > 10 > 9 > ... > 2"
    ],
    "computation": "Examine all cards in currentTrick, apply trump hierarchy, determine winnerId"
  },
  "stateDelta": [
    {
      "op": "set",
      "path": "players.{{winnerId}}.tricksWon",
      "value": "{{incrementedTricksWon}}"
    },
    {
      "op": "append",
      "path": "players.{{winnerId}}.tricksPile",
      "value": "{{currentTrick}}"
    },
    {
      "op": "set",
      "path": "game.currentTrick",
      "value": []
    }
  ]
}
```

**Oregon Trail Non-Deterministic Event:**
```json
{
  "transitionName": "random_event",
  "mechanicsGuidance": {
    "rules": [
      "Random events occur every 5-10 days of travel",
      "Event probability based on: party health, supplies, weather, terrain",
      "Possible events: illness, broken wagon, river crossing, wildlife encounter, found supplies",
      "Event severity: minor (10% resource loss), moderate (25%), severe (50%)",
      "Good events (found supplies): 20% chance if supplies < 100"
    ],
    "computation": "Use RNG seed to select event type and severity. Calculate resource changes based on current party state and event severity."
  },
  "stateDelta": [
    {
      "op": "set",
      "path": "game.lastEvent",
      "value": {
        "day": "{{game.day}}",
        "type": "{{eventType}}",
        "severity": "{{eventSeverity}}"
      }
    },
    {
      "op": "increment",
      "path": "party.{{affectedResource}}",
      "amount": "{{resourceChange}}"
    },
    {
      "op": "set",
      "path": "party.members.{{affectedMemberId}}.health",
      "value": "{{newHealthValue}}"
    }
  ],
  "messages": {
    "public": {
      "template": "{{eventNarrative}}"
    }
  },
  "rngConfig": {
    "seedSource": "game.rngSeed",
    "operations": [
      "Select event type from weighted distribution",
      "Roll severity (1-100)",
      "Select affected party member if applicable"
    ]
  }
}
```

**Pros:**
- ✅ Flexible - can express any game mechanic in NL
- ✅ LLM is good at applying rules described in natural language
- ✅ Works for deterministic AND non-deterministic mechanics
- ✅ Easy to generate during discovery phase
- ✅ Human-readable for debugging

**Cons:**
- ❌ LLM might hallucinate or misapply rules
- ❌ Not perfectly deterministic (same prompt might yield different outcomes)
- ❌ Harder to verify correctness (can't diff NL easily)
- ❌ More expensive (larger prompts with full rule text)

#### Option 2: Hardcoded Mechanic Functions

Create a library of game mechanic functions that instructions reference:

```json
{
  "transitionName": "resolve_round",
  "mechanicFunction": "rps_determine_winner",
  "mechanicInputs": {
    "choice1": "{{players.p1.choice}}",
    "choice2": "{{players.p2.choice}}"
  },
  "stateDelta": [
    {
      "op": "increment",
      "path": "players.{{winnerId}}.score",
      "amount": 1,
      "condition": "{{winnerId !== null}}"
    }
  ]
}
```

**Required Infrastructure:**
- Predefined mechanic library: `rps_determine_winner()`, `spades_trick_winner()`, `oregon_trail_random_event()`
- Mechanic registry mapping names to implementations
- Standard interfaces for inputs/outputs

**Pros:**
- ✅ Perfectly deterministic
- ✅ Testable (unit tests for each mechanic function)
- ✅ Reusable across games
- ✅ Cheaper (no LLM call for computation)

**Cons:**
- ❌ Requires building mechanic library upfront
- ❌ Limited to pre-implemented mechanics
- ❌ Instructions generator must know which mechanics exist
- ❌ Doesn't scale to novel game mechanics
- ❌ Still need LLM for messaging

#### Option 3: Hybrid (NL + Optional Mechanic Functions)

Instructions can specify EITHER a mechanic function OR NL guidance:

```json
{
  "transitionName": "resolve_round",
  "computation": {
    "type": "mechanic_function",
    "function": "rps_determine_winner",
    "inputs": { ... },
    "fallback": {
      "type": "llm",
      "guidance": "Apply RPS rules: rock > scissors > paper > rock"
    }
  }
}
```

**Pros:**
- ✅ Best of both worlds - deterministic when possible, flexible otherwise
- ✅ Can add mechanics to library over time

**Cons:**
- ❌ More complex infrastructure
- ❌ Two code paths to maintain

### Recommendation: Start with Option 1 (NL Guidance)

**Rationale:**

1. **Phase alignment**: We're in discovery/training phase - need flexibility to handle any game mechanic
2. **Messaging requirement**: Already need LLM call for ~95% of instructions (for message interpolation)
3. **Cost analysis**: Marginal cost of including mechanics guidance in prompt is low (< 100 tokens per instruction)
4. **Future optimization**: Can migrate to Option 3 later - add mechanic functions for common patterns (RPS, trick-taking, dice rolls)

### Ensuring Determinism with NL Guidance

**Critical Requirements:**

1. **Seed-based RNG**: All randomness must use logged RNG seed
   ```json
   "rngConfig": {
     "seedSource": "game.rngSeed",
     "algorithm": "xorshift128+",
     "operations": ["event_type", "severity_roll", "affected_member"]
   }
   ```

2. **Explicit Rule Ordering**: NL rules must be unambiguous
   ```json
   "mechanicsGuidance": {
     "rules": [
       "1. Check if any spades played → use spade trump hierarchy",
       "2. If no spades → use led suit hierarchy", 
       "3. Rank order: A=14, K=13, Q=12, J=11, 10-2 face value"
     ]
   }
   ```

3. **Computational Checks**: Verifier validates LLM's computation
   ```typescript
   // For RPS, verifier can check if winner determination was correct
   function verifyRPSWinner(p1Choice, p2Choice, declaredWinner) {
     const expected = computeRPSWinner(p1Choice, p2Choice);
     return expected === declaredWinner;
   }
   ```

4. **Assertion Fields in LLM Response**: LLM must show its work
   ```json
   {
     "rationale": "p1 chose rock, p2 chose scissors. Rock beats scissors per rules.",
     "computationSteps": [
       "p1.choice = 'rock'",
       "p2.choice = 'scissors'",
       "Applied rule: rock > scissors",
       "Result: winnerId = 'p1'"
     ],
     "stateDelta": [ ... ]
   }
   ```

5. **Retry with Correction**: If verifier catches wrong computation
   ```typescript
   if (!verifyComputation(llmResponse)) {
     return await retryWithError(
       originalPrompt,
       `Computation error: ${verifier.explanation}. Please recalculate.`
     );
   }
   ```

## Design Decisions (Finalized)

### 1. Mechanic Encoding: Natural Language Guidance ✓

**Decision:** Use NL mechanics guidance in instructions. LLM applies rules at runtime.

**Rationale:** 
- Maximum flexibility for novel game mechanics
- Marginal cost since LLM already needed for messaging
- Eventually move to fully deterministic generated games (no LLM simulation)
- Deterministic mechanic library NOT planned for sim workflow

**Implementation:** Instructions include `mechanicsGuidance` field with explicit rules.

---

### 2. Verification Strategy: Minimal Verification + User Dispute Resolution ✓

**Decision:** Do NOT implement aggressive computation verification or automatic retries.

**Rationale:**
- Verification/retries may not improve reliability significantly
- Priority: Speed and cost over rigid correctness
- Users can dispute errors: "Hey, my score is wrong"
- Future: Master judge agent handles disputes via state delta corrections

**Implementation:**
- Verifier only checks: schema validity, invariants, operation feasibility
- No computation double-checking (e.g., don't verify "rock beats scissors")
- Errors reported to user with recovery options

---

### 3. Instruction Mutability: Versioned with Spec Artifacts ✓

**Decision:** Instructions are part of spec processing artifacts. Updated only when schema is versioned.

**Rationale:**
- Instructions generated during discovery phase
- Immutable during game runs (same artifact version throughout)
- Changes require reprocessing spec → new artifact version
- Ensures auditability and consistency

**Implementation:**
- Instructions stored in artifact with version metadata
- LangGraph logs instruction version used per turn
- Router loads versioned instructions at runtime

---

### 4. LLM Prompt Structure: System Prompts Only ✓

**Decision:** NEVER use user messages in sim workflow. System prompts only.

**Rationale:**
- User messages reserved exclusively for player communication
- Sim workflow is internal orchestration (no user involvement)
- Only design phase conversation agent uses user messages

**Implementation:**
- All LLM calls use SystemMessagePromptTemplate
- Change agent, planner, executor: system prompts
- User messages only in design agent for spec creation

---

### 5. Error Handling: Preserve State + User Recovery ✓

**Decision:** If anything fails, leave state unaltered. Message user to retry action.

**Rationale:**
- Game must always be in recoverable state
- Even retries can fail → need graceful degradation
- User didn't do anything wrong → don't penalize them
- Prefer safe rollback over partial/corrupted state

**Implementation:**
```typescript
// Snapshot before applying deltas
const stateSnapshot = deepClone(state);

try {
  const result = applyStateDeltas(state, llmResponse.stateDelta);
  
  if (!result.success) {
    throw new Error(result.errors.join(', '));
  }
  
  const invariantCheck = verifyInvariants(result.newState);
  
  if (!invariantCheck.valid) {
    throw new Error(invariantCheck.violations.join(', '));
  }
  
  // Success - commit state
  return { success: true, newState: result.newState };
  
} catch (error) {
  // Restore snapshot (or just don't commit changes)
  return {
    success: false,
    state: stateSnapshot,
    userMessage: "We encountered an issue processing your action. Nothing was changed. Please try your action again or rephrase it."
  };
}
```

**No Automatic Retries:** If LLM response is invalid, report error and wait for user to retry manually.

---

### 6. RNG Integration: LLM Generates/Reports Randomness ✓

**Decision:** LLM handles randomness internally and reports what it "rolled".

**Rationale:**
- True determinism impossible with LLM simulation (outputs vary)
- Teaching LLM RNG algorithms adds complexity/hallucination risk
- Logging "rolls made" provides audit trail for disputes
- Simpler prompts, better probabilistic reasoning
- Future deterministic games: RNG in generated code, not LLM

**Implementation:**
```json
// LLM Response Schema
{
  "randomnessUsed": [
    {
      "purpose": "event_type",
      "method": "Rolled 67/100 against distribution",
      "distribution": { "illness": "40-80", "broken_wagon": "80-95", "found_supplies": "0-40" },
      "result": "illness"
    },
    {
      "purpose": "severity", 
      "method": "Rolled 23/100",
      "thresholds": { "minor": "0-25", "moderate": "25-60", "severe": "60-100" },
      "result": "moderate"
    }
  ],
  "rationale": "Event type roll 67 falls in illness range (40-80). Severity roll 23 is moderate (25-60).",
  "stateDelta": [ ... ]
}
```

**Audit Trail:** Committer logs all `randomnessUsed` entries with turn metadata for dispute resolution.

---

### 7. State Slicing: Start Without Slicing ✓

**Decision:** Send FULL state to LLM. Do NOT implement state slicing initially.

**Rationale:**
- **Discovery phase risk**: Generator may miss required fields
- **Cost vs. complexity**: Slicing saves ~$0.15 per game but adds significant complexity
- **Token reality**: Most text game states < 1,000 tokens (LLM handles easily)
- **Premature optimization**: Can add later if state grows > 2,000 tokens
- **Graceful degradation**: Missing fields hard to recover from gracefully

**When to Revisit:**
- After 10+ successful games with reliable instruction generator
- When state consistently exceeds 2,000 tokens
- When cost becomes measurable concern (>$1 per game)
- Implement as: soft slicing (hints) → hard slicing with full-state fallback

**Current Implementation:**
```typescript
const llmPrompt = {
  instruction: instruction,
  state: state, // Full state, no slicing
  playerInput: playerInput,
  task: "Resolve instruction and return stateDelta"
};
```

**Future Optimization (if needed):**
```typescript
// Soft slicing - provide full state with focus hints
const promptHint = instruction.requiredStateFields.length > 0
  ? `Primary fields needed: ${instruction.requiredStateFields.join(', ')}`
  : '';

const llmPrompt = {
  instruction: instruction,
  state: state, // Still full state
  focusHint: promptHint,
  playerInput: playerInput,
  task: "Resolve instruction. Focus on hint fields for efficiency."
};
```

---

## Architecture Summary

**Instruction Generation (Discovery Phase):**
1. Planner analyzes spec → identifies actions/transitions with mechanics guidance (NL)
2. Executor generates templated stateDelta ops + message templates
3. Artifacts versioned and stored immutably

**Runtime Execution (Simulation Phase):**
1. **Router**: Selects instruction for current phase + action
2. **Change Agent** (deterministic): Validates JsonLogic preconditions
3. **Change Agent** (LLM): Resolves templates using full state + mechanics guidance
4. **Verifier**: Validates schema, applies deltas, checks invariants
5. **Committer**: Persists state OR rollback + user error message

**Error Recovery:**
- State snapshot before changes
- Any failure → restore snapshot, message user
- User retries action manually
- Future: Judge agent for disputes

**Cost Model:**
- ~$0.003 per LLM call (Haiku with full state)
- 100 turns = ~$0.30 per game
- Acceptable for MVP phase

## Next Steps

Once aligned on this architecture:
1. Create planner prompt template (analyzes spec → generates instruction hints)
2. Create executor prompt template (hints → concrete templated instructions)
3. Implement extract-instructions orchestration
4. Build change agent runtime nodes (router, executor, verifier)
5. Test with RPS end-to-end
