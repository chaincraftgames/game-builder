import { z, ZodObject, ZodRecord } from "zod";

import { SchemaField, buildStateSchema } from "#chaincraft/ai/simulate/schemaBuilder.js";
import { SimulationStateType } from "#chaincraft/ai/simulate/simulate-state.js";
import { zodToJsonSchema } from "zod-to-json-schema";

// Runtime version - bump when extensions change
export const RUNTIME_VERSION = "1.0";

// Runtime extensions for game and player state
const runtimeGameStateSchemaExtension = z.object({
  gameEnded: z.boolean().default(false),
});

const runtimePlayerStateSchemaExtension = z.object({
  illegalActionCount: z.number().default(0),
  messageToPlayer: z.string().optional(),
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