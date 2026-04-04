/**
 * Schemas for mechanic generation and validation.
 *
 * Follows the node-level schema.ts convention: Zod schemas as single source
 * of truth, TS types inferred via z.infer<>.
 *
 * See: GENERATED_MECHANICS_DESIGN.md §6, §7
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// TscError — mirrors the interface in tsc-validator.ts for Zod composition
// ---------------------------------------------------------------------------

export const tscErrorSchema = z.object({
  code: z.number().describe("TypeScript diagnostic error code (e.g. 2339, 2322)"),
  message: z.string().describe("Human-readable error message"),
  mechanicId: z.string().describe("The transitionId this error belongs to"),
  line: z.number().describe("1-based line number within the mechanic source"),
  column: z.number().describe("0-based character offset within the line"),
});

export type TscError = z.infer<typeof tscErrorSchema>;

// ---------------------------------------------------------------------------
// MechanicTarget — input to generateAndValidateMechanic
// ---------------------------------------------------------------------------

export const mechanicTargetSchema = z.object({
  id: z.string().describe("Unique identifier (transitionId or actionId)"),
  type: z.enum(["transition", "action"]).describe("Type of mechanic"),
  functionName: z.string().describe('Function name for the generated export (e.g., "resolve_round_outcome")'),
  instructions: z.string().describe("Plan-only instructions (rules + computation) for this mechanic"),
  expectedStateChanges: z.array(z.string()).optional().describe("Fields expected to change (for prompt context)"),
  messageGuidance: z.string().optional().describe("Guidance for public/private messages"),
  repairContext: z.object({
    previousCode: z.string().describe("The code from the previous generation attempt that failed tsc validation"),
    tscErrors: z.array(z.string()).describe("Human-readable tsc error messages from the failed attempt"),
  }).optional().describe("Present only during repair — contains prior code and tsc errors"),
});

export type MechanicTarget = z.infer<typeof mechanicTargetSchema>;

// ---------------------------------------------------------------------------
// MechanicError — error container for a single failed mechanic
// ---------------------------------------------------------------------------

export const mechanicErrorSchema = z.object({
  mechanicId: z.string(),
  errors: z.array(tscErrorSchema),
});

export type MechanicError = z.infer<typeof mechanicErrorSchema>;

// ---------------------------------------------------------------------------
// GenerateMechanicResult — output of generateAndValidateMechanic
// ---------------------------------------------------------------------------

export const generateMechanicResultSchema = z.object({
  mechanicId: z.string(),
  code: z.string().describe("Generated TypeScript source (always present — needed for repair even on failure)"),
  errors: z.array(tscErrorSchema).optional().describe("tsc errors (present only when validation fails)"),
  valid: z.boolean().describe("Whether tsc validation passed"),
});

export type GenerateMechanicResult = z.infer<typeof generateMechanicResultSchema>;
