/**
 * Extract Schema Node
 * 
 * Analyzes game specification and generates:
 * - State schema (Zod-compatible structure)
 * - Example state object
 * - Game rules summary
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SpecProcessingStateType } from "../../spec-processing-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { planSchemaTemplate, executeSchemaTemplate } from "./prompts.js";

export function extractSchema(model: ModelWithOptions) {
  return async (state: SpecProcessingStateType): Promise<Partial<SpecProcessingStateType>> => {
    console.debug("[extract_schema] Extracting schema from specification");
    
    // Create a base Zod schema that includes required runtime fields.
    // This will be provided to the planner/executor as a starting point they must extend.
    const baseZodSchema = z.object({
      game: z.object({
        gameEnded: z.boolean().default(false),
        publicMessage: z.string().optional(),
      }),
      players: z.record(
        z.object({
          illegalActionCount: z.number().default(0),
          privateMessage: z.string().optional(),
          actionsAllowed: z.boolean().default(true),
          actionRequired: z.boolean().default(false),
        })
      ),
    });

    const schemaJson = JSON.stringify(zodToJsonSchema(baseZodSchema, "gameState"));

    // Step 1: Planner analyzes spec and identifies game state structure
    const plannerPrompt = SystemMessagePromptTemplate.fromTemplate(planSchemaTemplate);
    const plannerSystemMessage = await plannerPrompt.format({
      gameSpecification: state.gameSpecification,
      schema: schemaJson,
    });
    
    const plannerAnalysis = await model.invokeWithSystemPrompt(
      plannerSystemMessage.content as string,
      undefined,
      {
        agent: "extract-schema-planner",
        workflow: "spec-processing",
      }
    );

    console.debug("[extract_schema] Planner analysis complete");

    // Step 2: Executor generates schema + example state
    const responseSchema = z.object({
      gameRules: z
        .string()
        .describe("A description of the game rules"),
      state: z.object({
        game: z.record(z.any())
            .describe(`Game-level state containing all shared game progress fields`),
        players: z.record(z.any())
            .describe(`Map of player IDs to player state objects`)
      }), 
      stateSchema: z.object({
        fields: z.array(z.any())
        .describe("Schema definition that matches the nested structure of the state object")
      }).describe("Schema object containing a fields array")
    });

    const executorPrompt = SystemMessagePromptTemplate.fromTemplate(executeSchemaTemplate);
    
    try {
      const executorSystemMessage = await executorPrompt.format({
        plannerAnalysis: plannerAnalysis.content,
        gameSpecification: state.gameSpecification,
        schema: schemaJson,
      });
      
      const response = await model.invokeWithSystemPrompt(
        executorSystemMessage.content as string,
        undefined,
        {
          agent: "extract-schema-executor",
          workflow: "spec-processing",
        },
        responseSchema
      ) as z.infer<typeof responseSchema>;

      console.debug("[extract_schema] Executor response: %o", {
        hasGameRules: !!response.gameRules,
        hasState: !!response.state,
        hasStateSchema: !!response.stateSchema,
        stateSchemaFields: response.stateSchema?.fields?.length
      });

      // Validate the response has all required fields
      if (!response.stateSchema || !response.stateSchema.fields) {
        console.error("[extract_schema] Missing stateSchema in response");
        throw new Error("Executor failed to generate stateSchema field");
      }

      if (!response.state || !response.state.game || !response.state.players) {
        console.error("[extract_schema] Incomplete state in response");
        throw new Error("Executor failed to generate complete state structure");
      }

      return {
        gameRules: response.gameRules,
        stateSchema: JSON.stringify(response.stateSchema.fields),
        exampleState: JSON.stringify(response.state),
      };
    } catch (error) {
      console.error("[extract_schema] Executor failed: %o", error);
      throw error;
    }
  };
}
