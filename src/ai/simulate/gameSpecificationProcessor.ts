import { Runnable } from "@langchain/core/runnables";
import { StructuredOutputParser } from "langchain/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";

import { SchemaField } from "#chaincraft/ai/simulate/schemaBuilder.js";
import { getModel } from "#chaincraft/ai/model.js";
import { processGameSpecificationTemplate } from "#chaincraft/ai/simulate/simulate-prompts.js";

let processingChain: Runnable | undefined;

export type GameDefinition = {
  gameRules: string;
  schemaFields: SchemaField[];
};

export async function processGameSpecification(
  gameSpecification: string
): Promise<GameDefinition> {
  await initialize();

  const response = await processingChain?.invoke({ gameSpecification });

  return {
    gameRules: response.gameRules,
    schemaFields: response.stateSchema.fields,
  }
};

async function initialize() {
  if (processingChain) {
    return;
  }

  const prompt = ChatPromptTemplate.fromTemplate(processGameSpecificationTemplate);

  const responseSchema = z.object({
    gameRules: z
      .string()
      .describe("A description of the game rules. e.g. how to play the game, what are the game phases, states, ...etc, what you can do on your turn, how a winner is determined."),
    state: z.object({
      game: z.record(z.any())
          .describe(`Game-level state containing all shared game progress fields`),
      players: z.record(z.any())
          .describe(`Map of player IDs to player state objects`)
    }), 
    stateSchema: z.object({
      fields: z.array(
        z.object({
          name: z.string(),
          type: z.enum(["string", "number", "boolean", "array", "object"]),
          description: z.string(),
          required: z.boolean(),
          items: z.object({
            type: z.string(),
            properties: z.record(
              z.object({
                name: z.string(),
                type: z.enum(["string", "number", "boolean", "array", "object"]),
                description: z.string(),
                required: z.boolean(),
                items: z.object({
                  type: z.string(),
                  properties: z.record(z.any()).optional(),
                }).optional(),
              })
            ).optional(),
          }).optional(),
        })
      )
      .describe("Schema definition that matches the nested structure of the state object")
    })
  });

  const parser = StructuredOutputParser.fromZodSchema(responseSchema);
  console.debug('[gameSpecificationProcessor] Initializing chain with model: %s', process.env.CHAINCRAFT_GAME_DESIGN_MODEL_NAME);
  const model = await getModel(process.env.CHAINCRAFT_GAME_DESIGN_MODEL_NAME);

  const partialChain = await prompt.partial({
    formattingInstructions: parser.getFormatInstructions(),
  });

  processingChain = partialChain.pipe(model).pipe(parser);
};


