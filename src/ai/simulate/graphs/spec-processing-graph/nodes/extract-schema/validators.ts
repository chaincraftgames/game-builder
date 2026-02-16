/**
 * Validation functions for schema extraction
 */

import { PlannerField } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/schema.js";
import { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { getFromStore } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";
import { BaseStore } from "@langchain/langgraph";

/**
 * Parse executor output to extract field definitions
 * Preserves all field properties from executor output
 */
export function extractExecutorFields(executorOutput: string): PlannerField[] {
  const fields: PlannerField[] = [];
  
  try {
    // Look for Fields: ```json [...] ``` markdown code block in executor output
    const fieldsMatch = executorOutput.match(/Fields:\s*```json\s*([\s\S]*?)```/i);
    if (!fieldsMatch) return fields;
    
    const fieldsJson = fieldsMatch[1].trim();
    const parsed = JSON.parse(fieldsJson);
    
    if (Array.isArray(parsed)) {
      parsed.forEach((field: any) => {
        if (field.name && field.path) {
          // Preserve all field properties
          fields.push({
            name: field.name,
            path: field.path,
            type: field.type,
            source: field.source,
            purpose: field.purpose,
            constraints: field.constraints,
          });
        }
      });
    }
  } catch (error) {
    console.warn("[validator] Failed to parse executor fields:", error);
  }
  
  return fields;
}

/**
 * Validate executor output completeness
 */
export async function validateExecutionCompleteness(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];
  
  const executorOutput = await getFromStore(store, ["schema", "execution", "output"], threadId);
  
  console.log("[validateExecutionCompleteness] executorOutput type:", typeof executorOutput);
  console.log("[validateExecutionCompleteness] executorOutput value:", JSON.stringify(executorOutput).substring(0, 200));
  
  if (!executorOutput || (typeof executorOutput === 'string' && executorOutput.trim().length === 0)) {
    errors.push("Executor output is empty");
    return errors;
  }
  
  // Handle if it's still wrapped
  const outputString = typeof executorOutput === 'string' ? executorOutput : JSON.stringify(executorOutput);
  
  // Check for natural summary
  if (!outputString.match(/Natural summary:/i)) {
    errors.push("Missing natural summary section");
  }
  
  // Check for fields section
  if (!outputString.match(/Fields:/i)) {
    errors.push("Missing fields section");
  }
  
  return errors;
}

/**
 * Validate executor identified required fields
 */
export async function validateExecutionFieldCoverage(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];
  
  const executorOutput = await getFromStore(store, ["schema", "execution", "output"], threadId);
  
  if (!executorOutput) {
    errors.push("No executor output found");
    return errors;
  }
  
  const fields = extractExecutorFields(executorOutput);
  
  // It's okay to have zero fields if game is very simple
  // But log a warning
  if (fields.length === 0) {
    console.warn("[validator] Executor identified zero custom fields - game uses only base schema");
  }
  
  return errors;
}

/**
 * Validate executor output is valid JSON
 */
export async function validateJsonParseable(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];
  
  const executionOutput = await getFromStore(store, ["schema", "execution", "output"], threadId);
  
  if (!executionOutput) {
    errors.push("No execution output found");
    return errors;
  }
  
  try {
    JSON.parse(executionOutput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Executor output is not valid JSON: ${message}`);
  }
  
  return errors;
}

/**
 * Validate schema structure has required top-level fields
 */
export async function validateSchemaStructure(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];
  
  const executionOutput = await getFromStore(store, ["schema", "execution", "output"], threadId);
  
  if (!executionOutput) {
    errors.push("No execution output found");
    return errors;
  }
  
  try {
    const response = JSON.parse(executionOutput);
    
    if (!response.stateSchema) {
      errors.push("Missing stateSchema field in executor output");
    }
    
    if (!response.state) {
      errors.push("Missing state field in executor output");
    }
    
    if (!response.gameRules) {
      errors.push("Missing gameRules field in executor output");
    }
    
    // Validate state structure
    if (response.state) {
      if (!response.state.game) {
        errors.push("State missing game object");
      }
      if (!response.state.players) {
        errors.push("State missing players object");
      }
    }
    
  } catch (error) {
    // JSON parse error already caught by validateJsonParseable
    return errors;
  }
  
  return errors;
}

/**
 * Validate required base fields are present in schema
 */
export async function validateRequiredFields(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];
  
  const executionOutput = await getFromStore(store, ["schema", "execution", "output"], threadId);
  
  if (!executionOutput) {
    errors.push("No execution output found");
    return errors;
  }
  
  try {
    const response = JSON.parse(executionOutput);
    const schema = response.stateSchema;
    
    if (!schema) return errors; // Already caught by validateSchemaStructure
    
    // Check game required fields
    const gameProps = schema?.properties?.game?.properties;
    if (gameProps) {
      const requiredGameFields = ['currentPhase', 'gameEnded', 'publicMessage'];
      for (const field of requiredGameFields) {
        if (!gameProps[field]) {
          errors.push(`Schema missing required game field: ${field}`);
        }
      }
    }
    
    // Check player required fields
    const playerProps = schema?.properties?.players?.additionalProperties?.properties;
    if (playerProps) {
      const requiredPlayerFields = ['actionRequired', 'illegalActionCount'];
      for (const field of requiredPlayerFields) {
        if (!playerProps[field]) {
          errors.push(`Schema missing required player field: ${field}`);
        }
      }
    }
    
  } catch (error) {
    // JSON parse error already caught
    return errors;
  }
  
  return errors;
}

/**
 * Validate field types are appropriate
 */
export async function validateFieldTypes(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];
  
  const executionOutput = await getFromStore(store, ["schema", "execution", "output"], threadId);
  
  if (!executionOutput) {
    errors.push("No execution output found");
    return errors;
  }
  
  try {
    const response = JSON.parse(executionOutput);
    const schema = response.stateSchema;
    
    if (!schema) return errors;
    
    // Check that currentPhase is string (not enum)
    const currentPhaseType = schema?.properties?.game?.properties?.currentPhase?.type;
    if (currentPhaseType && currentPhaseType !== 'string') {
      errors.push(`currentPhase must be type 'string', found: ${currentPhaseType}`);
    }
    
  } catch (error) {
    return errors;
  }
  
  return errors;
}

/**
 * Validate that all planner-identified fields are present in executor schema
 */
export async function validatePlannerFieldsInSchema(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];
  
  const plannerOutput = await getFromStore(store, ["schema", "plan", "output"], threadId);
  
  const executionOutput = await getFromStore(store, ["schema", "execution", "output"], threadId);
  
  if (!plannerOutput || !executionOutput) {
    return errors; // Other validators will catch missing outputs
  }
  
  try {
    const plannerFields = extractExecutorFields(plannerOutput);
    const response = JSON.parse(executionOutput);
    const executorSchema = response.stateSchema;
    
    if (!executorSchema || plannerFields.length === 0) {
      return errors;
    }
    
    for (const field of plannerFields) {
      const fieldPath = field.path === 'game' ? 'game' : 'player';
      
      // Extract bare field name by stripping path prefix if present
      let bareFieldName = field.name;
      if (fieldPath === 'game' && field.name.startsWith('game.')) {
        bareFieldName = field.name.substring('game.'.length);
      } else if (fieldPath === 'player' && (field.name.startsWith('players.') || field.name.startsWith('player.'))) {
        // Handle patterns like "players.<id>.fieldName" or "player.fieldName"
        const lastDotIndex = field.name.lastIndexOf('.');
        bareFieldName = field.name.substring(lastDotIndex + 1);
      }
      
      if (fieldPath === 'game') {
        // Check game.properties[bareFieldName] exists
        if (!executorSchema?.properties?.game?.properties?.[bareFieldName]) {
          errors.push(`Planner identified field '${field.name}' but executor did not add it to schema`);
        }
      } else {
        // Check players.additionalProperties.properties[bareFieldName] exists
        if (!executorSchema?.properties?.players?.additionalProperties?.properties?.[bareFieldName]) {
          errors.push(`Planner identified field '${field.name}' but executor did not add it to schema`);
        }
      }
    }
    
  } catch (error) {
    console.warn("[validator] Error validating planner fields in schema:", error);
  }
  
  return errors;
}
