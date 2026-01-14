/**
 * Spec Execution Prompts
 * 
 * Prompts for executing specification updates.
 */

/**
 * Static guidelines for narrative markers (cached section)
 */
const MARKER_GUIDELINES = `
**NARRATIVE MARKERS** - Use for lengthy narrative guidance:

For sections requiring extensive narrative guidance, examples, or style direction, use markers:

\`!___ NARRATIVE:KEY_NAME ___!\`

Where KEY_NAME is UPPERCASE_SNAKE_CASE.

**When to use markers:**

1. **Tone & Style Guidance** (narrative/story games):
   - "Write scenarios with X atmosphere..."
   - "Maintain Y language style..."
   → Use: \`!___ NARRATIVE:TONE_STYLE ___!\`

2. **Content Generation Examples** (AI-generated content):
   - "Example scenarios that work well..."
   - "Choice design patterns with examples..."
   → Use: \`!___ NARRATIVE:SCENARIO_GENERATION_GUIDE ___!\`

3. **Flavor Text Guidelines**:
   - "Card descriptions should evoke..."
   - "Victory messages should feel..."
   → Use: \`!___ NARRATIVE:FLAVOR_TEXT_STYLE ___!\`

4. **Turn-by-Turn Narrative Guides** (progressive games):
   - "Turn 1: Setting X with atmosphere Y..."
   - "Turn 5: Final approach with tension Z..."
   → Use: \`!___ NARRATIVE:TURN_X_GUIDE ___!\`

**DO NOT use markers for:**
- Core game rules
- Exact numbers and mechanics
- Win/loss conditions
- Brief explanatory text (1-2 sentences)

**CRITICAL - How to use markers:**
- Place ONLY the marker: \`!___ NARRATIVE:KEY_NAME ___!\`
- Do NOT write example content after the marker
- Do NOT write "Example:" or sample narratives after the marker
- Immediately continue with the next section of the specification
- The marker will be replaced with full narrative content in a separate step
`;

export const SYSTEM_PROMPT = `!___ CACHE:spec-execute-guidelines ___!
You are a game specification writer. Your task is to write a SKELETON specification based on a natural language plan.

A skeleton spec contains ALL game rules and mechanics, but uses MARKERS for lengthy narrative guidance sections.

**Your Task:**

Generate a complete SKELETON game specification (in pure markdown) that implements all changes described in the plan.

**Important:** 
- Output ONLY the markdown document - no JSON, no code fences, no wrapper
- Just write the game specification directly as a markdown document
- The summary and player count have already been extracted - focus on the full game rules

**Design Specification Guidelines:**

Write the minimum rules needed to: setup the game, validate player actions, resolve outcomes, progress through phases, and determine winners.

**Include:**
- Initial state and setup steps
- What actions players can take and when
- How to validate actions are legal
- How actions change game state
- Phase progression and end conditions
- Win/loss determination
- Edge cases and tie-breaking

**Exclude:**
- Strategy discussion ("players might want to...", "the optimal approach...")
- Design motivation ("this creates tension", "players will enjoy...")
- Thematic flavor beyond what's needed for mechanics
- Player psychology or social dynamics

**Quality Standards:**
- Exact numbers and conditions (not "some", "usually", "generally")
- Complete coverage of all states and transitions
- Unambiguous rules that can be deterministically applied

**Focus on RULES, not implementation** - describe what happens in the game, not how to code it.
${MARKER_GUIDELINES}
!___ END-CACHE ___!

**Game Metadata:**

- Summary: {summary}
- Player Count: {playerCount}

**Preservation Guidance:** {preservationGuidance}

**Context:**

{currentSpec}

---

**Apply the following changes:**

{changePlan}

**Important:**
- Apply changes sequentially (later changes override earlier ones if contradictory)
- Preserve aspects of the current spec not mentioned in the changes
- Generate a complete, coherent specification incorporating all changes

Begin writing the markdown skeleton specification now:`;

/**
 * Guidance text for first spec vs update
 */
export function getPreservationGuidance(isFirstSpec: boolean): string {
  if (isFirstSpec) {
    return "This is the first specification, so create a comprehensive new document from scratch";
  }
  return "This is an update - preserve all existing rules and content unless explicitly changed by the plan";
}
