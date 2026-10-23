/**
 * Mechanic: chaincraft:score-track
 * Scope: game-level
 *
 * Tracks player or team scores on a line-structure inventory.
 *
 * ## Integration
 *
 * ### Exposes
 *   Inventories:     "chaincraft:score-track:<id>:track"    (mechanic-owned)
 *     Game-scoped line inventory of length trackLength. Not in inventories module.
 *   Gamepiece types: "chaincraft:score-track:<id>:marker"   (mechanic-owned)
 *     Score marker piece — one instance per player or team. Not in gamepiece-types.
 *   Effects (by effectRef):
 *     { effectRef: "chaincraft:score-track:<id>:advance", params: { delta: N } }
 *     Moves the actor's marker N positions forward. Call from actions or flow hooks
 *     whenever a player/team scores points.
 *   Setup effect (auto-injected):
 *     Places one marker per player/team at position 0 in root loop's onEnter.
 *   End condition (auto-wired when winAt is set):
 *     Exits the root flow loop when any marker reaches winAt.
 *
 * ### References
 *   players.ts:    `scoringProperty`  — must match a property declared on the player/team.
 *     The engine keeps this property in sync with the marker position. Readable via
 *     JsonLogic: { var: "actor.property.<scoringProperty>" }
 *
 * ### Properties defined
 *   On player (scope: "player") or team (scope: "team"):
 *     <scoringProperty>  — integer, kept in sync with marker position by the engine.
 *     Forward reference: declare this property in the players module.
 *
 * ### Configuration
 *   Required: trackLength, scoringProperty, scope
 *   Optional: id (required if >1 track), label, winAt, finalRound (default: false)
 *
 * ## Engine synthesis
 *   1. A game-scoped line inventory for the track (length: trackLength)
 *   2. A score marker gamepiece type (one per player or team)
 *   3. An `advance` effect callable by ref (see Exposes above)
 *   4. Setup move: places markers at position 0 in root loop onEnter
 *   5. Optional end condition on root loop when winAt is set
 *
 * @example Simple 10-point track (Tic-tac-toe variant)
 * ```yaml
 * kind: chaincraft:score-track
 * id: main-score
 * trackLength: 10
 * scoringProperty: score
 * scope: player
 * winAt: 10
 * ```
 * @example Catan-style victory points (no physical track, just property sync)
 * ```yaml
 * kind: chaincraft:score-track
 * id: vp-track
 * trackLength: 15
 * scoringProperty: victoryPoints
 * scope: player
 * winAt: 10
 * finalRound: true       # all players finish current round after someone hits 10
 * ```
 * @example Two tracks — score + morale (no win condition on morale)
 * ```yaml
 * - kind: chaincraft:score-track
 *   id: score-track
 *   trackLength: 20
 *   scoringProperty: score
 *   scope: player
 *   winAt: 20
 *   finalRound: true
 * - kind: chaincraft:score-track
 *   id: morale-track
 *   trackLength: 10
 *   scoringProperty: morale
 *   scope: team
 * ```
 */

import { z } from "zod";

export const ScoreTrackMechanicSchema = z
  .object({
    kind: z.literal("chaincraft:score-track"),
    id: z
      .string()
      .optional()
      .describe(
        "Mechanic instance ID. Required when the game has multiple score tracks. " +
          "Used to disambiguate the generated advance effect ref: " +
          "'chaincraft:score-track:<id>:advance'. " +
          "Omit when there is exactly one score track.",
      ),
    label: z
      .string()
      .optional()
      .describe("Display name for this track (e.g., 'Victory Points', 'Score'). Shown in game UI."),
    trackLength: z
      .number()
      .int()
      .min(2)
      .describe(
        "Number of positions on the track (0-based, so length 10 = positions 0–9). " +
          "The mechanic injects a game-scoped line inventory with this capacity.",
      ),
    scoringProperty: z
      .string()
      .describe(
        "Player or team property ID to keep in sync with marker position. " +
          "Forward reference to a property declared on the player/team in the players module. " +
          "The engine updates this property automatically when the marker advances. " +
          "Other modules can read it via JsonLogic: { var: 'actor.property.<scoringProperty>' }.",
      ),
    scope: z
      .enum(["player", "team"])
      .describe(
        "Whether one marker is created per player or per team. " +
          "'player': one score marker per player, tracking individual scores. " +
          "'team': one score marker per team, tracking team scores.",
      ),
    winAt: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "If set, the engine auto-wires an endCondition onto the root flow loop: " +
          "exit when any player/team's marker reaches this position. " +
          "Omit to manage end conditions manually in flow.",
      ),
    finalRound: z
      .boolean()
      .optional()
      .describe(
        "Only meaningful when winAt is set. " +
          "If true: when a player/team reaches winAt mid-rotation, the engine completes " +
          "the current full iteration so all players finish their turn before the game ends. " +
          "If false (default): the loop exits immediately when winAt is reached.",
      ),
  })
  .describe(
    "Game-level mechanic: tracks player or team scores on a line-structure board. " +
      "Owns and injects the track inventory and marker piece type. " +
      "Exposes an 'advance' effect callable from actions and flow hooks. " +
      "Optionally auto-wires a win condition onto the root flow loop.",
  );

export type ScoreTrackMechanic = z.infer<typeof ScoreTrackMechanicSchema>;
