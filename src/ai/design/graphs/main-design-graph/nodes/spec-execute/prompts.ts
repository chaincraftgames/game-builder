/**
 * Spec Execution Prompts
 * 
 * Prompts for executing specification updates.
 */

/**
 * Static guidelines for narrative markers (cached section)
 */
const MARKER_GUIDELINES = `
**NARRATIVE MARKERS** - For lengthy narrative guidance:

Use markers for extensive narrative style guidance and examples:

\`!___ NARRATIVE:KEY_NAME ___!\` (UPPERCASE_SNAKE_CASE)

**When to use markers:**

1. **Tone & Style Guidance**: "Write with X atmosphere, Y voice..."
   → \`!___ NARRATIVE:TONE_STYLE ___!\`

2. **Content Generation Examples**: "Example scenarios, pattern templates..."
   → \`!___ NARRATIVE:GENERATION_GUIDE ___!\`

3. **Progressive Narrative Guides**: "Turn 1 setup, Turn 5 climax..."
   → \`!___ NARRATIVE:TURN_X_GUIDE ___!\`

**DO NOT use markers for:**
- Core game rules or exact mechanics
- Win/loss conditions
- Brief explanations (1-2 sentences)

**How to use markers:**
- Place ONLY the marker: \`!___ NARRATIVE:KEY_NAME ___!\`
- Do NOT write content after the marker
- Continue immediately with next section
- Marker will be expanded with full guidance later
`;

export const SYSTEM_PROMPT = `!___ CACHE:spec-execute-guidelines ___!
You are writing a SKELETON game specification that focuses on gameplay requirements.

A skeleton spec describes WHAT happens in the game (player experience, outcomes, rules) and uses MARKERS for lengthy narrative guidance.

**Your Task:**

Generate a complete SKELETON specification (pure markdown) implementing the plan's changes.

Output ONLY markdown - no JSON, no code fences, no wrapper.

**What to Include:**

Write requirements needed for: game setup, player actions, action outcomes, information visibility, game progression, and win/loss determination.

✅ **Include:**
- What players can do: "Players submit a weapon name each round"
- How actions resolve: "Weapons battle using rock-paper-scissors logic"  
- What players see: "Players see narrative, winner, and standings"
- When game ends: "First to win 3 rounds wins the match"
- Fairness rules: "Players have 90 seconds; timeout = auto-generated weapon"
- Narrative requirements: "Narrative must mention all weapons and declare winner clearly"

❌ **Exclude (spec-processing will handle):**
- Data structures: "Player state has fields: roundsWon, weaponName..."
- Validation details: "Weapon name must match regex ^[a-zA-Z0-9 -']+$"
- Phase logic: "Transition to RESOLUTION when all submitted OR timer expires"
- Algorithms: "Assign R/P/S using weighted randomization with rebalancing..."

**Quality Standards:**
- Be specific: Use exact numbers, not "some", "usually", "about"
- Be complete: Cover all actions, outcomes, and end conditions
- Be clear: Rules should be unambiguous

**Focus on WHAT happens (requirements), not HOW to implement it.**

${MARKER_GUIDELINES}
!___ END-CACHE ___!

**Game Metadata:**

- Summary: {summary}
- Player Count: {playerCount}

**Preservation:** {preservationGuidance}

**Context:**

{currentSpec}

---

**Apply these changes:**

{changePlan}

**Notes:**
- Apply changes sequentially (later overrides earlier if contradictory)
- Preserve unmentioned aspects of current spec
- Generate coherent specification incorporating all changes

Begin the markdown skeleton specification:`;

/**
 * Guidance text for first spec vs update
 */
export function getPreservationGuidance(isFirstSpec: boolean): string {
  if (isFirstSpec) {
    return "This is the first specification, so create a comprehensive new document from scratch";
  }
  return "This is an update - preserve all existing rules and content unless explicitly changed by the plan";
}
