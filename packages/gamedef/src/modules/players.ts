/**
 * Players Module Schema
 *
 * Forward references (string-typed here, resolved by cross-section validator):
 *   - RoleAssignmentTiming "subflow-start".subflowId → flow module node IDs
 *   - RoleAssignment "condition".condition → prose that may reference inventory
 *     names, player state fields, and gamepiece properties (e.g., "player
 *     holding the king token", "player with fewest coins in their treasury")
 *
 * Referenced by: flow (role conditions, eligiblePlayers), actions (targets),
 *                effects (role-based targeting).
 *
 * Key design decisions:
 * - Players can hold multiple roles simultaneously at runtime.
 * - Assignment METHOD and assignment TIMING are independent axes.
 * - Player elimination is NOT a role: use the built-in player.property.eliminated
 *   (see the state module).
 *
 * TODO (revisit): NFT-gated roles — a player may only be eligible to choose a
 *   role if they own a particular NFT (e.g., a character card earned in a
 *   previous game). Currently modeled as method: "player-choice" where the
 *   eligible options are filtered by the player's persistent-token inventory.
 *   No schema change needed today, but the choice-phase flow and the
 *   persistent-tokens module will need to express this eligibility constraint
 *   explicitly when those modules are designed.
 */

import { z } from "zod";
import { IdentifierSchema } from "#gamedef/modules/common.js";
import { PassiveEffectSchema } from "#gamedef/modules/effects.js";

// ---------------------------------------------------------------------------
// Assignment timing — when a role is (re)assigned or re-evaluated
// ---------------------------------------------------------------------------

export const RoleAssignmentTimingSchema = z
  .discriminatedUnion("when", [
    z.object({
      when: z.literal("game-start"),
    }),
    z.object({
      when: z.literal("subflow-start"),
      subflowId: z
        .string()
        .describe(
          "ID of the flow node whose start triggers (re)assignment. " +
            "Forward reference to the flow module — validated cross-section.",
        ),
    }),
  ])
  .describe(
    "When this role is automatically assigned or re-evaluated. " +
      "'game-start' = once at game initialization. " +
      "'subflow-start' = each time the named flow node begins (e.g., each round). " +
      "For roles assigned only by an explicit effect, use method 'effect' — no timing needed.",
  );

// ---------------------------------------------------------------------------
// Assignment method — how the role is assigned
// ---------------------------------------------------------------------------

export const RoleAssignmentSchema = z
  .discriminatedUnion("method", [
    z.object({
      method: z.literal("random"),
      at: RoleAssignmentTimingSchema,
    }).describe(
      "Engine randomly assigns this role from the pool of eligible players at the given time.",
    ),

    z.object({
      method: z.literal("player-choice"),
      description: z
        .string()
        .optional()
        .describe(
          "Optional clarification of how the choice is presented or any constraints on it. " +
            "The flow module must include a phase where this choice is presented to players.",
        ),
    }).describe(
      "Player self-selects this role. Requires a corresponding flow phase for the choice. " +
        "Example: choosing a character class at the start of a deck builder game.",
    ),

    z.object({
      method: z.literal("rotating"),
      at: RoleAssignmentTimingSchema,
      direction: z
        .enum(["clockwise", "counterclockwise"])
        .default("clockwise")
        .describe("Direction role passes around the table."),
    }).describe(
      "Role passes to the next player in turn order at the specified timing. " +
        "Example: dealer rotates clockwise at the start of each round.",
    ),

    z.object({
      method: z.literal("condition"),
      condition: z
        .string()
        .describe(
          "Prose condition evaluated at the specified time. " +
            "Examples: 'player with fewest coins', 'player currently holding the king token'.",
        ),
      at: RoleAssignmentTimingSchema,
    }).describe(
      "Role is assigned to whichever player meets the given condition at the specified time.",
    ),

    z.object({
      method: z.literal("effect"),
    }).describe(
      "Role is only ever assigned or removed via an explicit effect. " +
        "The engine never auto-evaluates this role. " +
        "Use this for incapacitation, earned titles, and any role whose trigger is complex game logic.",
    ),
  ])
  .describe(
    "How this role is assigned to players. Method and timing are independent: " +
      "random/rotating/condition require a timing declaration; player-choice and effect do not.",
  );

// ---------------------------------------------------------------------------
// Role visibility
// ---------------------------------------------------------------------------

export const RoleVisibilitySchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("public"),
    }),
    z.object({
      type: z.literal("hidden"),
      revealedOn: z
        .string()
        .optional()
        .describe(
          "Event or condition that reveals this role to all players. " +
            "Examples: 'player is eliminated', 'game-end', 'challenge-resolution'. " +
            "Role revelation is modeled as a visibility-change event, not a static property.",
        ),
    }),
  ])
  .describe(
    "Whether this role is publicly known to all players or hidden. " +
      "Hidden roles control what a player can see — connects to the information visibility layer.",
  );

// ---------------------------------------------------------------------------
// Role definition
// ---------------------------------------------------------------------------

export const RoleDefinitionSchema = z
  .object({
    id: IdentifierSchema.describe(
        "Unique identifier for this role. Referenced in flow conditions " +
          "(e.g., startingPlayer: { role: dealer }), action eligibility " +
          "(e.g., eligiblePlayers: role(mafia)), and turn order.",
      ),
    description: z
      .string()
      .optional()
      .describe("Human-readable description of what this role means in the game."),
    assignment: RoleAssignmentSchema,
    visibility: RoleVisibilitySchema,
    passives: z
      .array(PassiveEffectSchema)
      .optional()
      .describe(
        "Passive effects granted by this role. Enabled while a player holds the role. " +
          "Fires automatically (no player choice) when the named trigger effect executes " +
          "and the scope condition is met. Omit for roles with no passive abilities.",
      ),
  })
  .describe(
    "A named player role. Roles are a typed player property. " +
      "A player can hold multiple roles simultaneously at runtime — the spec defines what roles " +
      "exist and how they are assigned; the engine tracks which players hold which roles.",
  );

// ---------------------------------------------------------------------------
// Players module
// ---------------------------------------------------------------------------

export const PlayersModuleSchema = z
  .object({
    roles: z
      .array(RoleDefinitionSchema)
      .optional()
      .describe(
        "Roles defined by this game spec. Omit entirely if the game has no role distinctions. " +
          "Do not model player elimination as a role — use the built-in " +
          "player.property.eliminated. " +
          "Note: players may also hold roles defined outside this spec (e.g., from expansion " +
          "or persistent-token auxiliary specs) — those use the same RoleDefinition schema " +
          "and are merged by the engine at runtime. This array is not the exhaustive universe " +
          "of roles a player can hold.",
      ),
  })
  .describe(
    "Player role definitions. No dependencies on other spec modules. " +
      "Player-count-specific setup lives in the root flow node's on-enter clause.",
  );

export type RoleAssignmentTiming = z.infer<typeof RoleAssignmentTimingSchema>;
export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>;
export type RoleVisibility = z.infer<typeof RoleVisibilitySchema>;
export type RoleDefinition = z.infer<typeof RoleDefinitionSchema>;
export type PlayersModule = z.infer<typeof PlayersModuleSchema>;
