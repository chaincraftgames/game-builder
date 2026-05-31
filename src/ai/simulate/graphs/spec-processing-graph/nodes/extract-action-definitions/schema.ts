/**
 * Schemas for Action Definitions Artifact
 *
 * Action definitions are the authoritative source for player action contracts:
 * - What actions a player can take
 * - What input data each action requires
 *
 * This artifact is separate from the state schema. The state schema owns
 * persistent game/player outcome fields. Action definitions own the ephemeral
 * player input fields captured in player.currentAction.
 */

import z from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const ActionInputFieldSchema = z.object({
  name: z.string().describe(
    "Field name, camelCase (e.g. 'count', 'faceValue', 'targetPlayerId', 'cardId')"
  ),
  type: z.enum(["string", "number", "boolean", "enum"]).describe(
    "Data type of this input field"
  ),
  description: z.string().describe(
    "What the player is providing in this field"
  ),
  required: z.boolean().describe(
    "Whether the player must provide this field to take the action"
  ),
  enumValues: z.array(z.string()).optional().describe(
    "Allowed values when type is 'enum' (e.g. ['rock', 'paper', 'scissors'])"
  ),
  min: z.number().optional().describe(
    "Minimum value when type is 'number'"
  ),
  max: z.number().optional().describe(
    "Maximum value when type is 'number'"
  ),
});

export const ActionDefinitionSchema = z.object({
  id: z.string().describe(
    "Stable action identifier, camelCase (e.g. 'bid', 'challenge', 'playCard', 'drawCard', 'attack', 'pass')"
  ),
  actionName: z.string().describe(
    "Human-readable action name (e.g. 'Place Bid', 'Challenge', 'Play Card')"
  ),
  description: z.string().describe(
    "What the player is doing when they take this action"
  ),
  inputFields: z.array(ActionInputFieldSchema).describe(
    "Fields the player must provide when taking this action. Use an empty array for actions with no input (e.g. 'challenge', 'pass')."
  ),
});

export const ActionDefinitionsArtifactSchema = z.object({
  version: z.string().describe("Artifact version (e.g., '1.0.0')"),
  generatedAt: z.string().describe("ISO timestamp of generation"),
  actions: z.array(ActionDefinitionSchema).describe(
    "All distinct player action types defined for this game"
  ),
});

export type ActionInputField = z.infer<typeof ActionInputFieldSchema>;
export type ActionDefinition = z.infer<typeof ActionDefinitionSchema>;
export type ActionDefinitionsArtifact = z.infer<typeof ActionDefinitionsArtifactSchema>;

export const ActionDefinitionsArtifactSchemaJson = zodToJsonSchema(
  ActionDefinitionsArtifactSchema,
  "ActionDefinitionsArtifact",
);
