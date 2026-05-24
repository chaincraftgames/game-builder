# Action Schemas & Structured Execution - Future Design

## Current Problem (Feb 2026)

### Observed Issue
After weapon creation, `actionRequired` field contains string `"0 weapons remaining"` instead of numeric/boolean value:

```json
{
  "players": {
    "player1": {
      "actionRequired": "0 weapons remaining",  // ❌ Should be: 0 or false
      "weapons": ["sword", "shield", "bow"]
    }
  }
}
```

**Result:** Transition precondition `actionRequired == false` fails, game stuck in weapon_creation phase.

### Root Cause Analysis

**Current Flow:**
```
Player: "I want to make a rubber duck weapon"
  ↓
Execute-Changes LLM receives:
  - All 3 action definitions (100+ lines JSON)
  - Current state
  - Player input
  - NO state schema
  - NO action schema
  ↓
LLM must:
  1. Parse player input → extract weaponDescription
  2. Classify which action (create-weapon)
  3. Resolve template: {{weaponsRemaining}}
  4. Generate confirmation message
  ↓
Problem: LLM treats {{weaponsRemaining}} as message template
Output: "0 weapons remaining" (descriptive string)
Expected: 0 (number) for arithmetic comparison
```

**Why LLM Gets It Wrong:**
1. No state schema provided → doesn't know `actionRequired` is boolean
2. No computation rules → doesn't know to calculate `3 - weapons.length`
3. Template variables not defined → interprets as freeform message
4. Doing deterministic work (arithmetic) in non-deterministic way (LLM generation)

## Short-Term Fix (Current Plan)

**Add state schema to execute-changes prompt:**
- Provides field type information
- Helps LLM understand `actionRequired: boolean`
- Clarifies that `{{weaponsRemaining}}` is numeric computation
- Adds type validation instructions

**Implementation:** Modify execute-changes node prompt to include schema and explicit type constraints.

**Pros:**
- ✅ Minimal code change
- ✅ Fixes immediate bug
- ✅ Can implement quickly

**Cons:**
- ❌ Still using expensive LLM for deterministic work
- ❌ Still sending all 3 actions when only 1 used
- ❌ No structural validation
- ❌ Doesn't address architectural issues

## Long-Term Architecture (Future Redesign)

### Core Problem: Mixed Concerns

Current execute-changes node does:
1. **NLP (needs LLM):** Parse natural language → structured action
2. **Deterministic (doesn't need LLM):** Template substitution, arithmetic
3. **Complex mechanics (needs LLM):** Apply game rules, generate narratives

**Key Insight:** Only (1) and (3) need LLM. (2) should be deterministic code.

### Proposed Solution: Structured Actions with Schemas

#### 1. Define Action Schemas During Spec Processing

**Schema Node Output:**
```json
{
  "stateSchema": { /* existing */ },
  "gamepieceSchemas": {
    "Sword": { "damage": "number", "type": "string" },
    "Monster": { "hp": "number", "maxHP": "number", "xp": "number" }
  },
  "actionSchemas": {
    "create-weapon": {
      "type": "object",
      "properties": {
        "weaponDescription": { "type": "string" }
      },
      "required": ["weaponDescription"]
    },
    "attack-monster": {
      "type": "object",
      "properties": {
        "weapon": { "type": "string" },
        "target": { "type": "string" }
      },
      "required": ["weapon", "target"]
    }
  },
  "stateTransitions": { /* can reference actionSchemas */ }
}
```

**Why Schema Node?**
- Has full game spec context
- Already extracts data structures (state, gamepieces)
- Actions are typed data structures (like gamepieces)
- Transitions may need to reference action data
- No circular dependencies (schema → instructions → execution)

#### 2. Runtime: Two-Stage Execution

**Stage 1: Small LLM (Classification & Parsing)**
```
Input: 
  - Natural language: "hit the monster with the sword"
  - Available action schemas: { attack-monster: {...}, flee: {...} }

Output:
  {
    "actionId": "attack-monster",
    "actionData": { "weapon": "sword", "target": "monster" }
  }

Validation: Against actionSchema (JSON Schema)
Cost: ~200-500 tokens
```

**Stage 2: Deterministic Resolution + Conditional LLM**
```typescript
// Deterministic Phase (Pre-LLM)
function executeAction(actionId, actionData, state) {
  const instructions = getInstructions(actionId);
  
  // Resolve templates deterministically
  const context = {
    playerId: currentPlayer,
    action: actionData,
    weaponsRemaining: 3 - (state.players[currentPlayer].weapons.length + 1)
  };
  
  let stateDelta = resolveTemplates(instructions.stateDelta, context);
  
  // Try to apply deterministic ops
  const { resolved, unresolved } = applyDeterministicOps(stateDelta, state);
  
  if (unresolved.length === 0) {
    // All resolved! No LLM needed
    return { stateDelta: resolved, cost: 0 };
  }
  
  // Non-deterministic mechanics remain → call LLM
  const enrichedContext = buildMechanicsContext(unresolved, state, actionData);
  const llmResponse = await executeLLM(unresolved, enrichedContext);
  
  return { 
    stateDelta: [...resolved, ...llmResponse.stateDelta],
    cost: llmResponse.tokens
  };
}
```

**Stage 3: Recursive Template Resolution (Existing Plan)**
See [RECURSIVE_DETERMINISTIC_RESOLUTION.md](./RECURSIVE_DETERMINISTIC_RESOLUTION.md)

#### 3. Enhanced MechanicsGuidance with Context Enrichment

**Current Problem:** LLM must "remember" state values
```json
{
  "mechanicsGuidance": {
    "rules": ["Decrement monster HP by weapon damage"]
  }
}
```
LLM must recall: What's the weapon damage? What's current HP?

**Proposed: Pre-Resolved Context**
```json
{
  "mechanicsGuidance": {
    "rules": ["Decrement target HP by weapon damage", "If HP <= 0, award XP"],
    "context": {
      "weapon": {
        "name": "{{action.weapon}}",
        "damage": "{{inventory[action.weapon].damage}}",
        "type": "{{inventory[action.weapon].type}}"
      },
      "target": {
        "name": "{{action.target}}",
        "currentHP": "{{monsters[action.target].hp}}",
        "maxHP": "{{monsters[action.target].maxHP}}",
        "xpValue": "{{monsters[action.target].xp}}"
      }
    }
  }
}
```

**Pre-LLM Resolution:**
```json
{
  "rules": ["Decrement target HP by weapon damage", "If HP <= 0, award XP"],
  "context": {
    "weapon": { "name": "sword", "damage": 5, "type": "melee" },
    "target": { "name": "goblin", "currentHP": 8, "maxHP": 10, "xpValue": 50 }
  }
}
```

**LLM receives concrete values:**
- No memory lookup required
- Simple arithmetic on provided numbers
- Clear decision criteria
- Type-safe (numbers, not references)

### Complete Flow Example: Weapon Creation

**Current (Broken):**
```
Input: "rubber duck weapon"
→ LLM (1500 tokens, all 3 actions)
  - Parse input
  - Calculate weaponsRemaining
  - Generate message
→ Output: actionRequired = "0 weapons remaining" (❌ string)
```

**Proposed:**
```
Input: "rubber duck weapon"

→ Stage 1: Classification LLM (300 tokens)
  Input: "rubber duck weapon" + action schemas
  Output: { actionId: "create-weapon", weaponDescription: "rubber duck weapon" }
  Validate: ✓ Matches create-weapon schema

→ Stage 2: Deterministic Execution (0 tokens)
  Context: {
    playerId: "player1",
    action: { weaponDescription: "rubber duck weapon" },
    weaponsRemaining: 3 - (2 + 1) = 0
  }
  
  StateDelta:
    - append players.player1.weapons: "rubber duck weapon"
    - set players.player1.actionRequired: 0  (✓ number)
  
  Message template: "✅ Weapon created! {{weaponsRemaining}} remaining"
  Resolved: "✅ Weapon created! 0 remaining"

→ Total: 300 tokens (80% reduction)
→ Output: actionRequired = 0 (✓ correct type)
```

### Benefits Summary

| Aspect | Current | Proposed |
|--------|---------|----------|
| **Cost** | 1500 tokens/action | 300 tokens (classification only) |
| **Type Safety** | ❌ LLM generates strings | ✅ TypeScript enforces types |
| **Determinism** | ❌ LLM arithmetic | ✅ Deterministic computation |
| **Validation** | ❌ No schema | ✅ JSON Schema validation |
| **Context Size** | All 3 actions (redundant) | Only selected action |
| **Auditability** | Hard to trace LLM decisions | Clear: parse → compute → apply |
| **Testing** | Hard to unit test | Easy to test each stage |

## Design Decisions & Rationale

### Q: Why Schema Node for Action Schemas (not Instruction Node)?

**Answer:** Actions are **data structures**, not execution logic.

- Schema node already extracts: state schema, gamepiece schemas
- Action schemas are same category: typed data flowing through system
- Transitions need to reference action data → must be defined when transitions extracted
- Schema node has full game spec context
- Clean separation: data modeling (schema) vs execution (instructions)

**Analogy:**
```
Gamepiece: Sword { damage: number }  → Schema Node ✓
Action: Attack { weapon: string }    → Schema Node ✓
Instruction: How to execute attack   → Instruction Node ✓
```

### Q: Why Two-Stage (Classification + Execution)?

**Answer:** Different capabilities needed:

| Stage | What | Why LLM/Deterministic |
|-------|------|----------------------|
| Classification | Parse "hit monster with sword" → structured data | NLP (LLM required) |
| Execution | Apply templates, compute values | Deterministic (code faster/cheaper) |
| Complex Mechanics | "Rock beats scissors" → determine winner | Rule interpretation (LLM) |

Mixing stages = using expensive LLM for cheap work.

### Q: Why Not Computation Functions?

**Initial idea:** Add named functions like `weaponsRemaining(state, args)`

**Problem:** Who defines them? Where do they come from?

**Better solution:** Use mechanicsGuidance with enriched context:
- Game-specific computations in natural language rules
- Pre-resolve lookups deterministically
- LLM applies rules to concrete values (not references)
- No custom computation language to learn/validate

### Q: Can Transitions Reference Action Data?

**Yes, but through state:**

**Option A (Recommended): Semantic State Fields**
```json
// Action updates semantic state
{ "op": "set", "path": "combat.attackType", "value": "fire" }

// Transition checks semantic state
{ "logic": { "==": [{ "var": "combat.attackType" }, "fire"] } }
```

**Option B: Standard lastAction Field**
```json
// Runtime automatically tracks
state.players[playerId].lastAction = {
  id: "attack-monster",
  data: { weapon: "sword", target: "goblin" }
};

// Transition can check
{ "logic": { "==": [{ "var": "players.player1.lastAction.id" }, "attack-monster"] } }
```

**Why not opaque action data in transitions:**
- Circular dependency: transitions need schemas, schemas need transitions
- State should be self-describing
- Replay/audit requires state to tell full story

## Implementation Roadmap

### Phase 0: Immediate Fix (Current Sprint)
- [ ] Add state schema to execute-changes prompt
- [ ] Add explicit type constraints to prompt
- [ ] Test with weapon creation game
- [ ] Verify actionRequired gets numeric value

**Timeline:** 1-2 days
**Risk:** Low
**Benefit:** Fixes immediate bug

### Phase 1: Action Schema Extraction (Next Sprint)
- [ ] Update schema node to extract action schemas
- [ ] Update schema node prompt with action schema instructions
- [ ] Modify schema output format to include actionSchemas
- [ ] Update instruction node to reference action schemas
- [ ] Add validation that instructions reference valid schemas

**Timeline:** 1 week
**Risk:** Medium (affects spec processing)
**Benefit:** Foundation for future improvements

### Phase 2: Classification LLM (Sprint +2)
- [ ] Create classification node/agent
- [ ] Small prompt: just action schemas + player input
- [ ] JSON Schema validation of parsed actions
- [ ] Integration with execute-changes node
- [ ] Performance testing (latency vs single LLM)

**Timeline:** 1 week
**Risk:** Medium (new runtime component)
**Benefit:** 60-80% prompt reduction

### Phase 3: Deterministic Execution (Sprint +3)
- [ ] Template resolution in TypeScript
- [ ] Context enrichment for mechanicsGuidance
- [ ] Recursive template resolution (see RECURSIVE_DETERMINISTIC_RESOLUTION.md)
- [ ] Fall back to LLM only for unresolved mechanics
- [ ] Comprehensive testing

**Timeline:** 2 weeks
**Risk:** High (major refactor)
**Benefit:** 80%+ cost reduction for simple actions

### Phase 4: Gamepiece Schemas (Future)
- [ ] Extract gamepiece schemas in schema node
- [ ] Reference in action schemas and state
- [ ] Type validation across system
- [ ] Editor tooling integration

**Timeline:** TBD
**Risk:** Medium
**Benefit:** Full type safety across game definition

## Open Questions for Future

1. **Schema Evolution:** How to handle schema changes between game versions?
2. **Validation Errors:** How to surface schema violations to game designers?
3. **Complex Actions:** What if action needs multi-step execution?
4. **Action Composition:** Can actions reference other actions?
5. **Conditional Schemas:** Different schema based on game state?
6. **Performance:** Profile deterministic resolution overhead
7. **Caching:** Should we cache parsed actions for repeated input?

## References

- [Recursive Deterministic Resolution](./RECURSIVE_DETERMINISTIC_RESOLUTION.md) - Template resolution algorithm
- [JSON Schema](https://json-schema.org/) - Standard for action schemas
- [JSON Logic](https://jsonlogic.com/) - Used for preconditions and validation

---

**Status:** Design Complete - Awaiting Phase 1 Implementation
**Last Updated:** February 5, 2026
**Next Review:** After immediate fix validated in production
