/**
 * Mechanics index
 *
 * Barrel export for all mechanic schemas and types.
 *
 * Piece-level mechanics are declared in `mechanics[]` on a GamepieceType.
 * Game-level mechanics are declared in `mechanics[]` on the top-level game spec.
 *
 * Both scopes use the same namespaced `kind` string pattern ("chaincraft:*") to
 * identify the mechanic. The engine resolves the kind to its implementation at
 * spec-compile time.
 */

// ---------------------------------------------------------------------------
// Piece-level mechanics
// ---------------------------------------------------------------------------

export { ChargesMechanicSchema } from "./charges.js";
export type { ChargesMechanic } from "./charges.js";

export { ConversionMechanicSchema } from "./conversion.js";
export type { ConversionMechanic, ConversionLeg } from "./conversion.js";

// ---------------------------------------------------------------------------
// Game-level mechanics
// ---------------------------------------------------------------------------

export { ScoreTrackMechanicSchema } from "./score-track.js";
export type { ScoreTrackMechanic } from "./score-track.js";

export {
  DominantGamepieceMechanicSchema,
  DominantGamepieceRuleSchema,
  DominantRuleSchema,
  ComparisonRuleSchema,
  MatrixRuleSchema,
} from "./dominant-gamepiece.js";
export type { DominantGamepieceMechanic, DominantGamepieceRule } from "./dominant-gamepiece.js";

// ---------------------------------------------------------------------------
// Union schemas
// ---------------------------------------------------------------------------

import { z } from "zod";
import { ChargesMechanicSchema } from "./charges.js";
import { ConversionMechanicSchema } from "./conversion.js";
import { ScoreTrackMechanicSchema } from "./score-track.js";
import { DominantGamepieceMechanicSchema } from "./dominant-gamepiece.js";

/**
 * All piece-scoped mechanic kinds. Declared in `mechanics[]` on a GamepieceType.
 * Each kind synthesizes action slots, inventory slots, preconditions, and/or
 * lifecycle hooks from a compact declaration.
 */
export const PieceMechanicSchema = z
  .discriminatedUnion("kind", [ChargesMechanicSchema, ConversionMechanicSchema])
  .describe(
    "A mechanic declaration scoped to a gamepiece type. " +
      "Piece mechanics are generative — each synthesizes one or more action slots, " +
      "preconditions, or lifecycle hooks from a compact declaration. " +
      "Kind strings are namespaced ('chaincraft:charges', 'mygame:cooldown'). " +
      "Mechanic-generated slot IDs must also be namespaced and unique across all slots.",
  );

/**
 * All game-level mechanic kinds. Declared in `mechanics[]` on the top-level game spec.
 * Each kind synthesizes game-scoped behavior (scoring, trick resolution, etc.)
 * from a compact declaration.
 */
export const GameMechanicSchema = z
  .discriminatedUnion("kind", [ScoreTrackMechanicSchema, DominantGamepieceMechanicSchema])
  .describe(
    "A game-level mechanic declaration. " +
      "Game mechanics add behavioral overlays to the game structure — scoring, " +
      "trick resolution, elimination, trading. " +
      "Mechanics that own their inventories/piece types inject them automatically; " +
      "mechanics that reference existing inventories take an inventory ID.",
  );

export type PieceMechanic = z.infer<typeof PieceMechanicSchema>;
export type GameMechanic = z.infer<typeof GameMechanicSchema>;
