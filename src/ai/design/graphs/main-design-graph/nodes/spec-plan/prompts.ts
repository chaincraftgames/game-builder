/**
 * Spec Planning Prompts
 * 
 * Prompts for generating specification change plans.
 */

/**
 * Core guidelines for describing gameplay requirements
 */
const BASE_CONTENT_GUIDELINES = `
**⚠️ CRITICAL — CROSS-SESSION PERSISTENCE IS NOT A GAME FEATURE:**
Saving, loading, persisting, or reusing ANY game data (characters, items, achievements, etc.) 
across game sessions is handled ENTIRELY by the game engine's NFT/token system. 
The change plan must NEVER describe: save/load flows, save decisions, token persistence, 
token collections, token management, loading saved data in future games, or modification 
of saved data. These are NOT game phases, NOT player actions, and NOT game features.
If the user wants to save game data, reduce it to a single line: 
"NFT support: [data type] containing [what content]"
Example: "NFT support: hero character containing player-provided name and description"
That is ALL. No further detail about saving/loading.

Focus on PLAYER EXPERIENCE and GAMEPLAY OUTCOMES, not system implementation:

**Include:**
- What players can do and when (available actions)
- How actions resolve and what changes (outcomes and effects)
- What information players see (public vs hidden, timing of reveals)
- When the game ends (win/loss conditions, termination triggers)
- Critical fairness rules (timeouts, ties, edge cases that affect outcomes)
- NFT support (if applicable): a single line noting what data type to save and what content it contains

**Exclude (spec-processing will extract these):**
- Data structures, field names, state schemas
- Input validation details (character limits, regex patterns)
- Phase transition logic, state machine definitions
- Algorithm implementations (assignment methods, calculations)
- System procedures (error handling, persistence, retries)
- ALL save/load/persistence mechanics — regardless of what the user or conversation calls them ("saving characters", "tokenization", "save as token", "save as NFT", "persist", "reuse in future games", etc.) — the game engine handles this. Never plan save/load phases, save decision steps, or token management features.

**For narrative requirements:** Include WHAT narrative must accomplish (mention X, reveal Y, hide Z, length targets). Use markers for HOW to write (tone, style, examples).`;

/**
 * Example for initial game specification
 */
const INITIAL_EXAMPLE = `
**Example:**
"Card-drafting game where players build winning combinations:

**Setup**: Each player starts with 5 cards from a 60-card deck.

**Player Actions**: Each turn, players simultaneously choose one card from hand and reveal together. Cards resolve in priority order (shown on card) with effects like draw, discard, or gain points.

**Card Passing**: After resolution, pass remaining hand left to next player.

**Ending**: When deck empties, player with most victory points wins."`;

/**
 * Examples for updating existing specification
 */
const UPDATE_EXAMPLES = `
**Example for adding mechanics:**
"Add resource management: Players start with 10 gold coins and collect 2 per turn. New action: spend 5 gold to draw 2 cards. Win condition updated: first to 20 points OR 50 gold wins."

**Example for already-implemented feature:**
"Add score tracking (already implemented - no update needed)"`;

/**
 * Base template for spec planning - common context and structure
 */
const BASE_SPEC_PLAN_TEMPLATE = `You are a game specification planner.

Your task is to analyze the user's conversation and extract key metadata about the game, along with a clear plan describing what changes need to be made to the game specification.

**Context:**

!___ CACHE:current-spec ___!
{currentSpec}
!___ END-CACHE ___!

{conversationSummary}

{conversationHistory}

---

{format_instructions}`;

/**
 * Instructions for initial spec generation
 */
const INITIAL_SPEC_INSTRUCTIONS = `

**Provide a structured plan with these parts:**

1. **summary**: Concise 1-2 sentence game concept
2. **playerCount**: Min/max players (as numbers)
3. **narrativeStyleGuidance**: Tone, style, and narrative voice from user's description
   - Tone: "dark", "humorous", "whimsical", "dramatic", "lighthearted"
   - Audience: "family-friendly", "mature themes", "educational"
   - Examples: "Whimsical and absurd, encouraging silly creativity" or "Dark fantasy with grim consequences"
4. **changes**: Complete gameplay requirements

**Guidelines for 'changes':**
${BASE_CONTENT_GUIDELINES}
${INITIAL_EXAMPLE}`;

/**
 * Instructions for iterative spec updates
 */
const ITERATIVE_SPEC_INSTRUCTIONS = `

**You must provide a structured plan with these parts:**
Provide a structured plan with these parts:**

1. **summary**: Updated game concept (only if changed)
2. **playerCount**: Updated min/max (only if changed)
3. **narrativeStyleGuidance**: Updated tone/style (ONLY if user explicitly changed it)
   - Include when user says: "make it darker", "more humorous", "family-friendly version"
   - Omit when user only changed mechanics/rules
   - Provide COMPLETE guidance, not just changes
4. **narrativeChanges**: Specific narrative section updates (ONLY if user requests narrative content changes)
   - For story elements, atmosphere, flavor text changes
   - Format: \`[{{ key: "TONE_STYLE", changes: "what to modify" }}]\`
   - Example: "Make turn 1 less scary" → \`[{{ key: "TURN_1_GUIDE", changes: "Reduce horror, more mysterious" }}]\`
   - Omit for pure gameplay changes
5. **changes**: What needs to change in the specification

**Guidelines for 'changes':**
${BASE_CONTENT_GUIDELINES}
- **If feature already exists**: Note "(already implemented)" and keep brief
`

/**
 * Get the appropriate spec plan prompt based on whether this is initial generation
 * 
 * @param isInitial - Whether this is the first spec generation (no existing spec)
 * @returns Complete system prompt for spec planning
 */
export function getSpecPlanPrompt(isInitial: boolean): string {
  return BASE_SPEC_PLAN_TEMPLATE + (isInitial ? INITIAL_SPEC_INSTRUCTIONS : ITERATIVE_SPEC_INSTRUCTIONS);
}

/**
 * Legacy export for backwards compatibility
 * @deprecated Use getSpecPlanPrompt() instead
 */
export const SYSTEM_PROMPT = BASE_SPEC_PLAN_TEMPLATE + INITIAL_SPEC_INSTRUCTIONS;