# Test: Narrative Generation from Skeleton

## Test Setup

**Skeleton Spec**: westward-peril-skeleton.md (2,435 words)
**Narrative Markers**: 9 sections to fill

## Test Prompt Template

```
You are generating narrative guidance for a game specification.

GAME CONCEPT:
Westward Peril - A single-player survival game where players make choices 
to navigate 5 dangerous turns on a westward journey. Each turn presents 
4 choices (1 deadly, 3 safe). Victory = survive all 5 turns.

STRUCTURAL SKELETON:
[Full skeleton spec provided here]

SECTION TO GENERATE: {NARRATIVE_KEY}

Generate comprehensive narrative guidance for this section. This guidance 
will be used by runtime LLMs to generate story content, scenarios, and 
flavor text during actual gameplay.

Your output should:
- Provide clear tone and style direction
- Give concrete examples of good narrative choices
- Explain what makes compelling vs weak narratives
- Be thorough - this is narrative guidance, not token-limited runtime content
- Stay consistent with the game's western frontier theme and survival stakes
- Reference the structural requirements from the skeleton when relevant

Output only the narrative content (no markers, no wrapping text).
```

## Test Narrative: TONE_STYLE

**Prompt**: Generate narrative guidance for TONE_STYLE given skeleton above

**Expected Output**:
Should produce ~600 words covering:
- Balance of dramatic peril with frontier realism
- When death should feel serious vs when gallows humor fits
- Avoiding melodrama while maintaining stakes
- Examples of tone-appropriate vs tone-inappropriate descriptions

---

## Test Narrative: TURN_1_GUIDE

**Prompt**: Generate narrative guidance for TURN_1_GUIDE given skeleton above

**Expected Output**:
Should produce ~200-300 words covering:
- Typical scenario types for early journey (supplies, companions, route choice)
- Example situations that work well for Turn 1
- How to establish character capability and commitment
- Connection to motivation without forcing it
- Setting details: towns, settlements, departure points

---

## Test Concern: Coherence Across Independent Generations

**Problem**: Each narrative section generated in separate LLM call. Will they:
- Use consistent tone?
- Reference each other appropriately?
- Avoid contradictions?
- Create cohesive guidance package?

**Mitigation Strategies**:
1. Always provide full skeleton as context (gives shared foundation)
2. Order generation: Start with TONE_STYLE, then reference it in subsequent generations
3. Include previously generated narratives in context for later generations
4. Final validation pass: Check all narratives together for conflicts

**Test Plan**:
1. Generate TONE_STYLE first (no dependencies)
2. Generate TURN_1_GUIDE second (can reference tone)
3. Check if Turn 1 guidance respects tone guidance
4. Generate TURN_2_GUIDE third (can reference both)
5. Check if all three are coherent and non-contradictory
