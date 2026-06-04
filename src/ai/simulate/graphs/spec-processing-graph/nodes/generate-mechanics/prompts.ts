/**
 * Prompts for mechanic code generation
 *
 * Cache strategy: The contract (role + rules + output format) and state
 * interfaces are identical across all mechanics for the same game.
 * Wrapping them in a single CACHE block means calls 2..N for a game
 * get a prompt-cache hit on ~700 tokens of static content.
 */

/**
 * Prompt for generating a complete exported TypeScript async function
 * implementing a single game mechanic. Used by mechanic-generator.ts.
 *
 * Template variables: stateInterfaces, functionName, targetId, targetType,
 *                     instructions, messageGuidance
 *
 * Cache markers: contract + stateInterfaces are wrapped so they are
 * reused across all mechanic generations for the same game.
 */
export const generateMechanicTsPrompt = `!___ CACHE:mechanic-contract ___!
You are a game mechanic code generator. You produce TypeScript async functions that implement game mechanics deterministically.

## Function Contract

Types and functions are already imported — do NOT add import statements.

**Reading state** — use \`getGame(field)\` and \`getPlayer(playerAlias, field)\`:
- \`getGame('currentBidCount')\` → returns \`GameState['currentBidCount']\`
- \`getPlayer('player1', 'diceCount')\` → returns \`PlayerState['diceCount']\`
- Direct access via \`state.game.field\` is still available for reading. Do NOT write to \`state\`.

**Writing state** — ONLY use \`setGame\` and \`setPlayer\`. Direct assignment to \`state\` or its fields is forbidden:
- \`setGame('currentBidCount', 5)\` — sets a game-level field. Field name must be a string literal.
- \`setPlayer('player1', 'diceCount', 4)\` — sets a per-player field. Field name must be a string literal.
- \`as any\` is FORBIDDEN. tsc and a post-generation scan will reject it.

**Messages:**
- \`setPublicMessage('text')\` — visible to all players
- \`setPrivateMessage('player1', 'text')\` — private to that player

**For illegal player actions:** call \`rejectAction('reason')\` and return \`buildResult()\`. No state changes are applied.

**Finish every code path with:** \`return buildResult();\`

**Other injected functions:**
- \`callLLM(prompt)\` returns \`Promise<string>\`. Use ONLY for creative/narrative text, never for game logic.
- \`rollDice(min, max)\` returns an integer from min to max (inclusive). Use for ALL randomness. NEVER use \`Math.random()\`.

**Rules:**
1. NEVER write to \`state\` directly. Always use \`setGame\`/\`setPlayer\`.
2. NEVER use \`as any\` — it bypasses type safety and will cause validation failure.
3. Field names in \`setGame\`/\`setPlayer\` must be string literals (not variables) — tsc enforces this.
4. For arrays/objects: read with \`getGame\`/\`getPlayer\`, mutate a local copy, write back with \`setGame\`/\`setPlayer\`.
5. All game logic must be deterministic code. \`callLLM\` is ONLY for narrative text.
6. No imports, no require — only standard TypeScript/JavaScript built-ins.
7. For **player action** mechanics: validate the action, call \`rejectAction('reason')\` if invalid and \`return buildResult()\`. Only call \`setGame\`/\`setPlayer\` when the action is valid.
8. For **automatic transition** mechanics that process player-submitted data: **always read from each player's \`currentAction\` field** — never from any other state field, regardless of what field names the instructions mention. Player-submitted data exists only in \`currentAction\` until the mechanic clears it.
   - **Single-player submission** (turn-based): find the one player whose \`currentAction\` is not null. Read their submission from it.
   - **Simultaneous submission** (all players acted): iterate all player aliases and read each player's \`currentAction\` independently. All players will have a non-null \`currentAction\`.
   - If \`mechanicsGuidance\` names a state field (e.g. \`players.weapons\`) for player-submitted data, that field is wrong — read \`currentAction\` instead.
   - ⛔ **Do NOT guard on \`currentAction.type\`** when reading player submissions in automatic transitions. The transition precondition already guarantees every required player submitted the correct action. Checking \`currentAction.type\` adds no safety and creates a cross-artifact coupling hazard: if the type string in the mechanic doesn't exactly match the action's \`id\` in \`playerPhaseInstructions\`, the guard silently fails and submissions are never read. Read the submission fields directly from \`currentAction\` without any type check.
   - ⛔ **NEVER cast \`currentAction\` to a custom inline type** (e.g. \`as {{ type: string; count: number }}\`). The \`CurrentAction\` type in the state interfaces already has the exact field names from the action definitions — use them directly. If you need to narrow to a specific action variant, use \`Extract\`: \`const action = currentAction as Extract<CurrentAction, {{ type: 'yourActionId' }}>\`. Casting to an inline type silently renames fields and causes runtime errors.
9. ⛔ **MANDATORY: After reading \`currentAction\`, always clear it.** For every player whose \`currentAction\` you read, call \`setPlayer(alias, 'currentAction', null)\` before returning. This is required regardless of whether the action succeeded or was skipped. Failure to clear \`currentAction\` will break turn detection for future rounds.
10. Do NOT re-validate player input — JsonLogic validation already ran. If \`currentAction\` is present, the action is legal.
10. Handle edge cases (ties, missing data) gracefully.
11. ⛔ **NEVER reference \`GameState_*\` or \`PlayerState_*\` sub-interface type names unless they are explicitly defined in the State Interfaces section below.** Fields with type \`Record<string, T>\` do NOT have a generated sub-interface — use \`Record<string, T>\` inline. If you need to type a value extracted from a record field, look up its type in the stateInterfaces (e.g. if \`lastRoundChoices\` is \`Record<string, string | null>\`, use that type directly, not \`GameState_LastRoundChoices\`).

## Example Pattern

\`\`\`typescript
export async function exampleMechanic(
  state: MechanicState,
  callLLM: CallLLM,
  rollDice: RollDice
): Promise<MechanicResult> {{
  const score = getGame('score');
  setGame('score', score + 1);

  const dice = getPlayer('player1', 'diceValues') as number[];
  dice.push(rollDice(1, 6));
  setPlayer('player1', 'diceValues', dice);

  setPublicMessage('Player 1 rolled a die.');
  return buildResult();
}}
\`\`\`

## State Interfaces

\`\`\`typescript
{stateInterfaces}
\`\`\`
!___ END-CACHE ___!

## Target

Function: **{functionName}** (id: "{targetId}", type: {targetType})

## Instructions

{instructions}

{messageGuidance}

## Output

Write a complete exported async TypeScript function with this exact signature:

\`\`\`typescript
export async function {functionName}(
  state: MechanicState,
  callLLM: CallLLM,
  rollDice: RollDice
): Promise<MechanicResult> {{
  // use setGame / setPlayer / setPublicMessage / setPrivateMessage / rejectAction
  // end every code path with: return buildResult();
}}
\`\`\`

Return ONLY the TypeScript function. No import statements, no markdown fences, no explanatory text.`;
/**
 * Repair context section appended to the prompt when regenerating a failed mechanic.
 * Template variables: previousCode, tscErrors
 */
export const repairContextSection = `

## Previous Attempt (FAILED)

The previous implementation failed TypeScript validation. Fix the errors below.

### Previous Code
\`\`\`typescript
{previousCode}
\`\`\`

### TypeScript Errors
{tscErrors}

Fix ALL errors while preserving the intended game logic. Do NOT repeat the same mistakes.`;
