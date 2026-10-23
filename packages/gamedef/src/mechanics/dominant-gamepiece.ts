/**
 * Mechanic: chaincraft:dominant-gamepiece
 * Scope: game-level
 *
 * Determines hierarchical (who-beats-whom) relationships between gamepieces in an
 * inventory and resolves an overall winner. A general comparison engine — it powers
 * trick-taking dominant gamepiece suits, "highest value wins" showdowns, and cyclic matchups like
 * Rock-Paper-Scissors.
 *
 * ## How it works
 *
 * The mechanic evaluates every piece currently in `evaluationInventory` by applying an
 * ordered list of `rules`. Each rule assigns a rank to every piece (rank 0 = best).
 * Rules are applied in order: the first rule partitions pieces into ranked groups, and
 * each subsequent rule breaks ties *within* a group. The piece(s) ending at rank 0 win.
 *
 * The owner of the unique rank-0 piece is written to `winnerToState` as the round winner.
 * If two or more pieces tie at rank 0 (no rule breaks the tie), the result is a draw and
 * `winnerToState` receives an empty string.
 *
 * ## Rule types (mirrors the engine's dominant-gamepiece rule kinds)
 *
 *   dominant   — one specific value beats everything else (e.g. dominant gamepiece suit, Ace-high).
 *                The dominant value may be literal or a JsonLogic expression reading
 *                game state (e.g. the dynamically declared dominant gamepiece suit).
 *   comparison — order pieces along an ordinal scale (e.g. card rank, weapon power).
 *                Highest or lowest wins.
 *   matrix     — cyclic / non-transitive relationships defined by explicit beats-lists
 *                (e.g. Rock beats Scissors, Scissors beats Paper, Paper beats Rock).
 *
 * Chain rules for tie-breaking, e.g. trick-taking = [dominant dominant gamepiece] → [dominant leading
 * suit] → [comparison rank highest].
 *
 * ## Integration
 *
 * ### Exposes
 *   Effects (by effectRef):
 *     { effectRef: "chaincraft:dominant-gamepiece:resolve" }      (single dominant gamepiece mechanic)
 *     { effectRef: "chaincraft:dominant-gamepiece:<id>:resolve" } (when an id is set)
 *     Evaluates `evaluationInventory`, applies the rule chain, and writes the winning
 *     piece's owner to `winnerToState` (empty string on a draw). Call from flow hooks
 *     (e.g. a round's onComplete) or actions.
 *
 * ### References (does not own)
 *   inventories.ts:     `evaluationInventory` — inventory holding the pieces to compare.
 *   gamepiece-types.ts: each rule's `property` — a property on the pieces being compared.
 *   state.ts:           `winnerToState` — a string game property to receive the winner ID.
 *
 * ### Configuration
 *   Required: evaluationInventory, rules (>= 1), winnerToState
 *   Optional: id (required if >1 dominant gamepiece mechanic), label
 *
 * @example Rock-Paper-Scissors (Absurd Armaments — weapons carry a hidden `rps` property)
 * ```yaml
 * kind: chaincraft:dominant-gamepiece
 * evaluationInventory: arena
 * winnerToState: game.property.roundWinner
 * rules:
 *   - kind: matrix
 *     property: rps
 *     beats:
 *       rock: [scissors]
 *       paper: [rock]
 *       scissors: [paper]
 * ```
 * @example Spades (dominant suit beats all; ties broken by rank)
 * ```yaml
 * kind: chaincraft:dominant-gamepiece
 * evaluationInventory: trick-pile
 * winnerToState: game.property.trickWinner
 * rules:
 *   - kind: dominant
 *     property: suit
 *     dominantValue: spades
 *   - kind: comparison
 *     property: rank
 *     order: [2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A]
 *     direction: highest
 * ```
 * @example Euchre (dominant declared during bidding — read dynamically from game state)
 * ```yaml
 * kind: chaincraft:dominant-gamepiece
 * evaluationInventory: trick-pile
 * winnerToState: game.property.trickWinner
 * rules:
 *   - kind: dominant
 *     property: suit
 *     dominantValue: { var: "game.property.declaredDominant" }
 *   - kind: comparison
 *     property: rank
 *     order: [9, 10, J, Q, K, A]
 *     direction: highest
 * ```
 * @example Highest value wins (simple showdown, no dominant)
 * ```yaml
 * kind: chaincraft:dominant-gamepiece
 * evaluationInventory: showdown
 * winnerToState: game.property.roundWinner
 * rules:
 *   - kind: comparison
 *     property: power
 *     direction: highest
 * ```
 */

import { z } from "zod";
// ---------------------------------------------------------------------------
// Dominant rules (chained for tie-breaking; rank 0 = best)
// ---------------------------------------------------------------------------

/**
 * A single value beats all other values for the named property.
 * Use for dominant suits and "this type always wins" relationships.
 *
 * @example Spades always dominant
 * ```yaml
 * { kind: dominant, property: suit, dominantValue: spades }
 * ```
 * @example Dominant declared dynamically (state path string read at runtime)
 * ```yaml
 * { kind: dominant, property: suit, dominantValue: "game.property.declaredDominant" }
 * ```
 */
export const DominantRuleSchema = z
  .object({
    kind: z.literal("dominant"),
    property: z
      .string()
      .describe(
        "Property ID on the evaluated pieces whose value is tested for dominance. " +
          "Forward reference to a property declared on the pieces' gamepiece type.",
      ),
    dominantValue: z
      .union([z.string(), z.number()])
      .describe(
        "The value that beats all other values of this property. " +
          "Accepts a literal (e.g. 'spades', 1) or a state path string " +
          "(e.g. 'game.property.declaredDominant') for dynamically declared dominant-gamepiece. " +
          "Pieces matching this value rank above all non-matching pieces; ties among matching " +
          "(or among non-matching) pieces fall through to the next rule in the chain.",
      ),
  })
  .describe(
    "Dominant-value rule: pieces whose property equals dominantValue beat all others. " +
      "Use for dominant suits and single-dominant-type relationships.",
  );

/**
 * Order pieces along an ordinal scale; highest (or lowest) wins.
 * Omit `order` for natural numeric comparison of a numeric property.
 *
 * @example Higher card rank wins (explicit order, low → high)
 * ```yaml
 * { kind: comparison, property: rank, order: [2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A], direction: highest }
 * ```
 * @example Lowest numeric value wins (natural numeric order)
 * ```yaml
 * { kind: comparison, property: power, direction: lowest }
 * ```
 */
export const ComparisonRuleSchema = z
  .object({
    kind: z.literal("comparison"),
    property: z
      .string()
      .describe(
        "Property ID on the evaluated pieces holding the value to compare. " +
          "Forward reference to a property declared on the pieces' gamepiece type.",
      ),
    order: z
      .array(z.union([z.string(), z.number()]))
      .min(2)
      .optional()
      .describe(
        "Explicit ordinal ranking of the property's values, from lowest to highest. " +
          "Required for non-numeric values (e.g. card ranks ['J','Q','K','A']). " +
          "Omit for a numeric property to use natural numeric ordering.",
      ),
    direction: z
      .enum(["highest", "lowest"])
      .default("highest")
      .describe(
        "Which end of the order wins. 'highest': the greatest value (or last in 'order') " +
          "ranks 0. 'lowest': the smallest value (or first in 'order') ranks 0. Defaults to 'highest'.",
      ),
  })
  .describe(
    "Comparison rule: ranks pieces along an ordinal scale. Highest or lowest wins.",
  );

/**
 * Cyclic / non-transitive relationships defined by explicit beats-lists.
 * The canonical Rock-Paper-Scissors rule. The engine builds the relationship matrix
 * from the map and ranks pieces by how many opponents they beat.
 *
 * @example Rock-Paper-Scissors
 * ```yaml
 * kind: matrix
 * property: rps
 * beats:
 *   rock: [scissors]
 *   paper: [rock]
 *   scissors: [paper]
 * ```
 * @example Rock-Paper-Scissors-Lizard-Spock
 * ```yaml
 * kind: matrix
 * property: rpsls
 * beats:
 *   rock: [scissors, lizard]
 *   paper: [rock, spock]
 *   scissors: [paper, lizard]
 *   lizard: [paper, spock]
 *   spock: [rock, scissors]
 * ```
 */
export const MatrixRuleSchema = z
  .object({
    kind: z.literal("matrix"),
    property: z
      .string()
      .describe(
        "Property ID on the evaluated pieces holding the matchup category " +
          "(e.g. 'rps'). Forward reference to an enum property declared on the pieces' " +
          "gamepiece type. Each piece's value must be a key of 'beats'.",
      ),
    beats: z
      .record(z.string(), z.array(z.string()).min(1))
      .describe(
        "Maps each category value to the list of values it defeats. " +
          "Keys and listed values must cover the same value set (every value that can " +
          "appear must be a key). Example RPS: { rock: [scissors], paper: [rock], " +
          "scissors: [paper] }. The engine ranks each piece by the number of opposing " +
          "pieces it beats; the piece beating all others ranks 0. A cycle among the " +
          "present pieces (e.g. rock vs paper vs scissors) yields no winner — a draw.",
      ),
  })
  .describe(
    "Matrix rule: cyclic, non-transitive relationships (Rock-Paper-Scissors and kin). " +
      "Declared as a beats-map rather than a raw matrix to keep it readable and authorable.",
  );

export const DominantGamepieceRuleSchema = z
  .discriminatedUnion("kind", [
    DominantRuleSchema,
    ComparisonRuleSchema,
    MatrixRuleSchema,
  ])
  .describe(
    "One rule in a dominant chain. Applied in order; each rule breaks ties left by the " +
      "previous one. Rank 0 = best. Kinds: 'dominant' (one value beats all), " +
      "'comparison' (ordinal high/low), 'matrix' (cyclic RPS-style relationships).",
  );

export type DominantGamepieceRule = z.infer<typeof DominantGamepieceRuleSchema>;

// ---------------------------------------------------------------------------
// Dominant mechanic
// ---------------------------------------------------------------------------

export const DominantGamepieceMechanicSchema = z
  .object({
    kind: z.literal("chaincraft:dominant-gamepiece"),
    id: z
      .string()
      .optional()
      .describe(
        "Mechanic instance ID. Required when the game has more than one dominant-gamepiece mechanic. " +
          "Disambiguates the generated resolve effect ref: 'chaincraft:dominant-gamepiece:<id>:resolve'. " +
          "Omit when there is exactly one dominant-gamepiece mechanic " +
          "(ref is then 'chaincraft:dominant-gamepiece:resolve').",
      ),
    label: z
      .string()
      .optional()
      .describe("Display name for this comparison (e.g., 'Weapon Clash', 'Trick'). Shown in game UI."),
    evaluationInventory: z
      .string()
      .describe(
        "Inventory ID holding the pieces to compare. Must be declared in the inventories " +
          "module — it is also referenced by the move effects that place pieces into it and " +
          "by flow conditions. Typically a game-scoped inventory (e.g. 'arena', 'trick-pile').",
      ),
    rules: z
      .array(DominantGamepieceRuleSchema)
      .min(1)
      .describe(
        "Ordered list of comparison rules. The first rule ranks all pieces; each later " +
          "rule breaks ties within the groups the previous rules produced. Provide a single " +
          "rule for simple comparisons (RPS, highest-wins) or chain several for trick-taking " +
          "(dominant-gamepiece → leading suit → rank).",
      ),
    winnerToState: z
      .string()
      .optional()
      .describe(
        "Dot-path to a string game property that receives the winning piece's OWNER ID " +
          "(e.g. 'game.property.roundWinner'). Forward reference to a property declared in " +
          "the state module. This is a convenience output derived from the winning piece's " +
          "owner — scoring and loop end conditions typically read it. Set to an empty string " +
          "when the comparison is a draw (a tie at rank 0 that no rule breaks). " +
          "Provide at least one of 'winnerToState' or 'winningPieceToState'.",
      ),
    winningPieceToState: z
      .string()
      .optional()
      .describe(
        "Dot-path to a string game property that receives the winning PIECE's ID " +
          "(e.g. 'game.property.winningWeapon'). Forward reference to a property declared in " +
          "the state module. The winning piece is the fundamental result — the player winner " +
          "in 'winnerToState' is simply its owner. Use this when narration or follow-on effects " +
          "need the actual piece (to read its properties, illustrate it, etc.). Set to an empty " +
          "string on a draw. Provide at least one of 'winnerToState' or 'winningPieceToState'.",
      ),
  })
  .describe(
    "Game-level mechanic: ranks gamepieces in an inventory via a chain of comparison rules " +
      "and resolves an overall winner. References (does not own) the evaluation inventory. " +
      "Exposes a 'resolve' effect callable from flow hooks and actions. The mechanic " +
      "identifies the winning PIECE; the winning PLAYER is derived as that piece's owner. " +
      "Writes the winning piece's ID to 'winningPieceToState' and/or its owner's ID to " +
      "'winnerToState' (provide at least one). Supports dominant-value (dominant suit), ordinal " +
      "comparison (highest/lowest), and matrix (Rock-Paper-Scissors) relationships, chained " +
      "for tie-breaking.",
  );

export type DominantGamepieceMechanic = z.infer<typeof DominantGamepieceMechanicSchema>;
