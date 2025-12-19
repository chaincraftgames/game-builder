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
import { baseGameStateSchemaJson } from "#chaincraft/ai/simulate/schema.js";
import { extractSchemaResponseSchema } from "./schema.js";

/**
 * Parse planner output to extract field definitions
 */
function extractPlannerFields(plannerOutput: string): Array<{name: string, path: string}> {
  const fields: Array<{name: string, path: string}> = [];
  
  try {
    // Look for Fields: [...] JSON array in planner output
    const fieldsMatch = plannerOutput.match(/Fields:\s*\[(.*?)\]/s);
    if (!fieldsMatch) return fields;
    
    const fieldsJson = '[' + fieldsMatch[1] + ']';
    const parsed = JSON.parse(fieldsJson);
    
    if (Array.isArray(parsed)) {
      parsed.forEach((field: any) => {
        if (field.name && field.path) {
          fields.push({ name: field.name, path: field.path });
        }
      });
    }
  } catch (error) {
    console.warn("[extract_schema] Failed to parse planner fields:", error);
  }
  
  return fields;
}

/**
 * Validate that all planner-identified fields are present in executor schema
 */
function validatePlannerFieldsInSchema(
  plannerFields: Array<{name: string, path: string}>,
  executorSchema: any
): { valid: boolean; missingFields: string[] } {
  const missingFields: string[] = [];
  
  for (const field of plannerFields) {
    const fieldPath = field.path === 'game' ? 'game' : 'player';
    
    // Extract bare field name by stripping path prefix if present
    let bareFieldName = field.name;
    if (fieldPath === 'game' && field.name.startsWith('game.')) {
      bareFieldName = field.name.substring('game.'.length);
    } else if (fieldPath === 'player' && field.name.includes('.')) {
      // Handle patterns like "players.<id>.fieldName" or "player.fieldName"
      const lastDotIndex = field.name.lastIndexOf('.');
      bareFieldName = field.name.substring(lastDotIndex + 1);
    }
    
    if (fieldPath === 'game') {
      // Check game.properties[bareFieldName] exists
      if (!executorSchema?.properties?.game?.properties?.[bareFieldName]) {
        missingFields.push(field.name);
      }
    } else {
      // Check players.additionalProperties.properties[bareFieldName] exists
      if (!executorSchema?.properties?.players?.additionalProperties?.properties?.[bareFieldName]) {
        missingFields.push(field.name);
      }
    }
  }
  
  return {
    valid: missingFields.length === 0,
    missingFields
  };
}

export function extractSchema(model: ModelWithOptions) {
  return async (state: SpecProcessingStateType): Promise<Partial<SpecProcessingStateType>> => {
    console.debug("[extract_schema] Extracting schema from specification");

    // Step 1: Planner analyzes spec and identifies game state structure
    const plannerPrompt = SystemMessagePromptTemplate.fromTemplate(planSchemaTemplate);
    const plannerSystemMessage = await plannerPrompt.format({
      gameSpecification: state.gameSpecification,
      schema: baseGameStateSchemaJson,
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
    const executorPrompt = SystemMessagePromptTemplate.fromTemplate(executeSchemaTemplate);
    
    try {
      const executorSystemMessage = await executorPrompt.format({
        plannerAnalysis: plannerAnalysis.content,
        schema: baseGameStateSchemaJson,
      });
      
      const response = await model.invokeWithSystemPrompt(
        executorSystemMessage.content as string,
        undefined,
        {
          agent: "extract-schema-executor",
          workflow: "spec-processing",
        },
        extractSchemaResponseSchema
      ) as z.infer<typeof extractSchemaResponseSchema>;

      console.debug("[extract_schema] Executor response: %o", {
        hasGameRules: !!response.gameRules,
        hasState: !!response.state,
        hasStateSchema: !!response.stateSchema,
        stateSchemaFields: response.stateSchema?.fields?.length
      });

      // Validate the response has all required fields
      if (!response.stateSchema) {
        console.error("[extract_schema] Missing stateSchema in response");
        throw new Error("Executor failed to generate stateSchema field");
      }

      if (!response.state || !response.state.game || !response.state.players) {
        console.error("[extract_schema] Incomplete state in response");
        throw new Error("Executor failed to generate complete state structure");
      }

      // Validate planner fields are in executor schema
      const plannerFields = extractPlannerFields(String(plannerAnalysis.content));
      if (plannerFields.length > 0) {
        const validation = validatePlannerFieldsInSchema(plannerFields, response.stateSchema);
        if (!validation.valid) {
          const errorMsg = `Executor dropped fields from planner output: ${validation.missingFields.join(', ')}\n` +
            `The planner identified these fields as required, but the executor did not add them to the schema.\n` +
            `Check LangSmith trace for extract_schema to see planner output.`;
          console.error("[extract_schema] Validation failed:", errorMsg);
          throw new Error(errorMsg);
        }
        console.debug(`[extract_schema] Validated ${plannerFields.length} planner fields are present in schema`);
      }

      return {
        gameRules: response.gameRules,
        stateSchema: JSON.stringify(response.stateSchema),
        exampleState: JSON.stringify(response.state),
      };
    } catch (error) {
      console.error("[extract_schema] Executor failed: %o", error);
      throw error;
    }
  };
}
