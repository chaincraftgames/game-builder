/**
 * Metadata Module Schema
 *
 * No dependencies on other spec modules.
 * Referenced by: all other modules (name, playerCount used for context).
 */

import { z } from "zod";

export const PlayerCountSchema = z
  .strictObject({
    min: z.number().int().min(1).describe("Minimum number of players"),
    max: z.number().int().min(1).describe("Maximum number of players"),
  })
  .refine((d) => d.max >= d.min, {
    message: "max must be greater than or equal to min",
  })
  .describe("Valid player count range. Both min and max are inclusive.");

export const CURRENT_SPEC_VERSION = 1;

export const MetadataModuleSchema = z
  .strictObject({
    name: z.string().describe("The display name of the game"),
    specVersion: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Spec format version this spec was written for; omit for version 1."),
    playerCount: PlayerCountSchema,
  })
  .describe(
    "Game metadata: name and player count constraints. " +
      "Player-count-specific setup (different starting state for 2 vs 4 players, etc.) " +
      "belongs in the root flow node's on-enter clause, not here. " +
      "No dependencies on other spec modules.",
  );

export type PlayerCountRange = z.infer<typeof PlayerCountSchema>;
export type MetadataModule = z.infer<typeof MetadataModuleSchema>;
