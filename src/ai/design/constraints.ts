/**
 * Game Design Constraints
 *
 * Single source of truth for:
 *  - CONSTRAINTS_TEXT: the registry string injected into the agent system prompt
 *  - CONSTRAINT_FEW_SHOT_EXAMPLES: demonstration responses for constraint violations,
 *    kept here so that changes to constraints can be paired with updated examples
 *    in the same file.
 *
 * When adding or changing a constraint:
 *   1. Update CONSTRAINTS_TEXT below
 *   2. Add or update a corresponding entry in CONSTRAINT_FEW_SHOT_EXAMPLES
 */

// ---------------------------------------------------------------------------
// Constraints text (injected into <constraints_registry> in the system prompt)
// ---------------------------------------------------------------------------

export const CONSTRAINTS_TEXT = `
## Not Supported ##
* Graphics beyond simple text or ASCII drawings (such as an ASCII grid)
* Any graphics that update in the background without player input, e.g. animation, graphics that update in a game loop.
* Asynchronous actions by the game (all game actions must be player initiated).  This would pose problems for games with "random" or "spontaneous" game actions.
* Time limits or timing based gameplay.  This would include players having to take action within a certain time, although you generally can handle deciding which of a set of players took an action first.
* Player counts greater than 5 are not supported.

## Limited Support ##
* Narrative generation, particularly long narratives that need to stay coherent.  Shorter, ad hoc narratives are okay.
* Scoring over multiple rounds.
* Complex state machines (nested phases).
* Gameplay that requires remembering and updating spatial locations of gamepieces, e.g. Battleship.
`.trim();

// ---------------------------------------------------------------------------
// Few-shot examples for constraint violations
//
// These use the same shape as FEW_SHOT_EXAMPLES in prompts.ts and are spread
// into the start of that array so constraint-violation behavior is the highest-
// weight pattern the model sees.
//
// ADD AN EXAMPLE HERE whenever you add or update a constraint.
// ---------------------------------------------------------------------------

export const CONSTRAINT_FEW_SHOT_EXAMPLES = [
  // ── NOT SUPPORTED: auto-advancing state + timing ─────────────────────────
  {
    user: "I want to make a Tetris game",
    assistant:
      "I love the idea, but I need to flag some constraints that make Tetris impossible to implement in this system:\n\n" +
      "1. **Falling pieces** — Tetris pieces drop automatically without player input. Our system only supports player-initiated actions; the game engine cannot take autonomous actions between turns.\n" +
      "2. **Timing-based gameplay** — Tetris requires players to respond within a time limit as pieces fall faster. Time-limited input is not supported.\n\n" +
      "Both of these are in the **Not Supported** category, so Tetris as-is can't be built here.\n\n" +
      "However, we could make a game with a **Tetris theme** that works within these constraints — for example, a turn-based puzzle where players are dealt a sequence of piece shapes and must decide how to place them on a grid to complete rows. This preserves the strategic 'fit the pieces' feeling without requiring real-time mechanics. Interested in exploring that direction?\n\n" +
      "<game_title>Tetris-Themed Puzzle</game_title>",
    flags: { specUpdateNeeded: false, metadataUpdateNeeded: false },
    explanation:
      "User proposed a NOT SUPPORTED game — immediately identify the specific violated constraints by " +
      "mechanic (not just title recognition), do not set any update flags, suggest a concrete text-based " +
      "alternative that preserves the theme",
  },

  // ── SUPPORTED WITH LIMITATIONS: spatial position tracking ────────────────
  {
    user: "I want to make a Battleship game where players track ship positions on a grid",
    assistant:
      "Battleship is possible, but I need to flag a limitation before we go further: tracking and updating " +
      "spatial positions of game pieces on a grid is listed as **Supported with Limitations** in our system. " +
      "Managing the full grid of ship locations, hits, and misses over many turns can be error-prone — the AI " +
      "game engine may make mistakes tracking positions across a large board.\n\n" +
      "To reduce that risk we could:\n" +
      "- Use a smaller grid (e.g., 5x5 instead of 10x10)\n" +
      "- Reduce the number of ships\n\n" +
      "Are you comfortable proceeding with those limitations, or would you prefer a different concept?\n\n" +
      "<game_title>Battleship Concept</game_title>",
    flags: { specUpdateNeeded: false, metadataUpdateNeeded: false },
    explanation:
      "User proposed a SUPPORTED WITH LIMITATIONS game — proactively warn before any design work, explain " +
      "the specific limitation, ask if they want to continue before setting any flags",
  },
] as const;
