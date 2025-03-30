import { z, ZodObject, ZodRecord } from "zod";

import { SchemaField, buildStateSchema } from "#chaincraft/ai/simulate/schemaBuilder.js";
import { SimulationStateType } from "#chaincraft/ai/simulate/simulate-state.js";
import { zodToJsonSchema } from "zod-to-json-schema";

// Runtime version - bump when extensions change
export const RUNTIME_VERSION = "1.0";

// Runtime extensions for game and player state
const runtimeGameStateSchemaExtension = z.object({
  gameEnded: z
    .boolean()
    .default(false)
    .describe("Whether the game has ended"),
  publicMessage: z
    .string()
    .optional()
    .describe("Public game state, instructions, etc... to all players"),
});

const runtimePlayerStateSchemaExtension = z.object({
  illegalActionCount: z
    .number()
    .default(0)
    .describe("Number of illegal actions taken by the player"),
  privateMessage: z
    .string()
    .optional()
    .describe(`
Private message to the player. Should only be used to communicate information that 
a) ABSOLUTELY CANNOT be included in the public message
b) contains EXCLUSIVELY player-specific information that others should never see
c) would break the game or violate fairness without this specific private message
    `),
  actionsAllowed: z
    .boolean()
    .default(true)
    .describe("Whether the player is allowed to take actions, e.g. they have not yet completed all their allowed actions for the current game phase or they are allowed to react to or counter an action by another player."),
  actionRequired: z
    .boolean()
    .default(false)
    .describe("If true, no further actions can be taken by any player and the game cannot proceed until this player takes an action."),
});

type RuntimePlayerState = z.infer<typeof runtimePlayerStateSchemaExtension>;
type BaseRuntimeState = {
    game: z.infer<typeof runtimeGameStateSchemaExtension>,
    players: Record<string, RuntimePlayerState>
}

// Serialize schema fields with version
export function serializeSchema(fields: SchemaField[]): string {
  return JSON.stringify(fields);
}

// Reconstruct complete schema from serialized form
export function deserializeSchema(schemaJson: string): z.ZodObject<any> {
  const fields = JSON.parse(schemaJson) as SchemaField[];
  const baseSchema = buildStateSchema(fields);
  
  if (!(baseSchema instanceof z.ZodObject)) {
    throw new Error("Schema must be a ZodObject");
  }
  
  return extendSchema(baseSchema);
}

// Apply runtime extensions to base schema
export function extendSchema(schema: ZodObject<any>): z.ZodObject<any> {
  const playerSchema =
    schema.shape.players instanceof ZodRecord
      ? schema.shape.players.valueSchema
      : schema.shape.players;

  const extendedSchema = z.object({
    game: runtimeGameStateSchemaExtension.merge(schema.shape.game),
    players: z.record(runtimePlayerStateSchemaExtension.merge(playerSchema)),
  });

  return schema.merge(extendedSchema);
}

export const getGameState = (state: SimulationStateType) => {
  const schema = deserializeSchema(state.schema);
  type GameState = z.infer<typeof schema> & BaseRuntimeState;
  
  // Parse the JSON string into an object first
  const gameState = typeof state.gameState === 'string' 
      ? JSON.parse(state.gameState)
      : state.gameState;
      
  return schema.parse(gameState) as GameState;
  }