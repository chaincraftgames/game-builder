/**
 * Metadata Module Schema
 *
 * No dependencies on other spec modules.
 * Referenced by: all other modules (name, playerCount used for context).
 */

import { z } from "zod";

export const RngSeedSourceSchema = z
  .enum(["game-id", "round-id", "fixed"])
  .describe(
    "How the RNG seed is derived. 'game-id' = one seed per game instance (most common). " +
      "'round-id' = re-seeded each round. 'fixed' = deterministic seed for testing.",
  );

export const RngConfigSchema = z
  .object({
    seedSource: RngSeedSourceSchema,
  })
  .describe(
    "RNG configuration for replay and audit. Omit entirely for games with no randomness. " +
      "RNG usage (dice rolls, shuffles, random selection) is declared inline in effects and " +
      "on-enter clauses — this section only configures the seed strategy.",
  );

export const PlayerCountSchema = z
  .object({
    min: z.number().int().min(1).describe("Minimum number of players"),
    max: z.number().int().min(1).describe("Maximum number of players"),
  })
  .refine((d) => d.max >= d.min, {
    message: "max must be greater than or equal to min",
  })
  .describe("Valid player count range. Both min and max are inclusive.");

export const MetadataModuleSchema = z
  .object({
    name: z.string().describe("The display name of the game"),
    playerCount: PlayerCountSchema,
    rng: RngConfigSchema.optional(),
  })
  .describe(
    "Game metadata: name, player count constraints, and RNG seed configuration. " +
      "Player-count-specific setup (different starting state for 2 vs 4 players, etc.) " +
      "belongs in the root flow node's on-enter clause, not here. " +
      "No dependencies on other spec modules.",
  );

export type RngSeedSource = z.infer<typeof RngSeedSourceSchema>;
export type RngConfig = z.infer<typeof RngConfigSchema>;
export type PlayerCountRange = z.infer<typeof PlayerCountSchema>;
export type MetadataModule = z.infer<typeof MetadataModuleSchema>;
