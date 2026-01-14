/**
 * Spec Planning Prompts
 * 
 * Prompts for generating specification change plans.
 */

/**
 * Base guidelines for describing game content/changes
 */
const BASE_CONTENT_GUIDELINES = `- Describe the mechanical rules needed to run the game
- Include: setup, player actions, state transitions, validation rules, win/loss conditions
- Exclude: strategy tips, player motivation, thematic flavor, "why this is fun"
- Reference specific sections if updating (e.g., "in the Setup phase", "in the player turn structure")`;

/**
 * Example for initial game specification
 */
const INITIAL_EXAMPLE = `
**Example:**
"Based on the user's description of a card-drafting game:

1. **Game Setup**: Each player starts with 5 cards drawn from a shared deck of 60 cards. Place remaining deck in center.

2. **Turn Structure**: On each turn, players simultaneously select one card from their hand and place it face-down. Once all players have selected, reveal cards simultaneously.

3. **Card Resolution**: Cards are resolved in priority order (shown on each card). Effects may include: draw cards, force opponent to discard, gain victory points.

4. **Passing Cards**: After resolution, each player passes their remaining hand to the player on their left.

5. **Victory Conditions**: Game ends when deck is empty. Player with most victory points wins."`;

/**
 * Examples for updating existing specification
 */
const UPDATE_EXAMPLES = `
**Example for adding new mechanics:**
"Based on the user's request to add a resource management mechanic:

1. **Setup Phase**: Add a step where each player receives 10 gold coins at the start of the game

2. **Player Turn Structure**: Insert a new 'Income Phase' at the beginning of each turn where players collect 2 gold coins

3. **Actions**: Add a new action 'Purchase Card' - costs 5 gold coins, allows player to draw 2 cards from the deck

4. **Victory Conditions**: Modify the win condition - first player to reach 20 points OR accumulate 50 gold coins wins

5. **Rules Clarification**: Players can carry unlimited gold between turns, but must spend all gold before the game ends or forfeit it"

**Example for already-implemented feature:**
"Add score tracking to the game (already implemented - current spec includes comprehensive scoring system with point tracking and victory conditions)"`;

/**
 * Base template for spec planning - common context and structure
 */
const BASE_SPEC_PLAN_TEMPLATE = `You are a game specification planner.

Your task is to analyze the user's conversation and extract key metadata about the game, along with a clear plan describing what changes need to be made to the game specification.

**Context:**

{currentSpec}

{conversationSummary}

{conversationHistory}

---

{format_instructions}`;

/**
 * Instructions for initial spec generation
 */
const INITIAL_SPEC_INSTRUCTIONS = `

**You must provide a structured plan with these parts:**

1. **summary**: A concise 1-2 sentence description of the game concept
2. **playerCount**: The minimum and maximum number of players (as min/max numbers)
3. **narrativeStyleGuidance**: Extract tone, style, and narrative preferences from the user's description
   - Look for descriptors like "dark", "humorous", "serious", "whimsical", "dramatic", "lighthearted"
   - Identify target audience and narrative voice (e.g., "family-friendly", "mature themes", "educational")
   - Note any specific stylistic requirements or genre conventions
   - Examples: "Dark fantasy with grim consequences and morally ambiguous choices", "Lighthearted family game with silly humor and simple language"
4. **changes**: A comprehensive description of what the game specification should contain (setup, rules, mechanics, turn structure, win conditions, etc.)

**Guidelines for the 'changes' field:**
${BASE_CONTENT_GUIDELINES}
${INITIAL_EXAMPLE}`;

/**
 * Instructions for iterative spec updates
 */
const ITERATIVE_SPEC_INSTRUCTIONS = `

**You must provide a structured plan with these parts:**

1. **summary**: A concise 1-2 sentence description of the game concept (only if changed)
2. **playerCount**: The minimum and maximum number of players (only if changed)
3. **narrativeStyleGuidance**: Updated tone/style guidance (ONLY if user explicitly changed narrative style)
   - Examples of when to include: "make it darker", "more humorous", "less serious", "family-friendly version"
   - Examples of when to OMIT: User only changed mechanics, rules, or gameplay elements
   - If included, provide the COMPLETE updated guidance, not just the change
4. **narrativeChanges**: Array of specific narrative section updates (ONLY if user explicitly requests changes to narrative content)
   - Use this when user requests changes to story elements, atmospheric descriptions, flavor text, or narrative guidance
   - Each entry should have: \`key\` (the narrative marker like "TONE_STYLE", "TURN_1_GUIDE") and \`changes\` (what to modify)
   - If user references narrative content but you're unsure which marker, the conversational agent will have asked them to clarify
   - Examples of when to include:
     * "Make turn 1 less scary" → \`[{{ key: "TURN_1_GUIDE", changes: "Reduce horror elements, make more mysterious" }}]\`
     * "Update the opening atmosphere" → \`[{{ key: "OPENING_SCENE", changes: "User's requested changes..." }}]\`
   - Examples of when to OMIT: User changed game rules/mechanics (that goes in 'changes' field)
5. **changes**: A clear, natural language plan describing what needs to change in the specification

**Guidelines for the 'changes' field:**
${BASE_CONTENT_GUIDELINES}
- **If the requested feature already exists in the spec**: Keep it VERY brief - just state what was requested and note "(already implemented)" or "(no update required)". Do NOT provide lengthy explanations.
${UPDATE_EXAMPLES}`;

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