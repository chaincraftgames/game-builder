/**
 * Convert Zod schema to condensed field format
 * 
 * Extracts field definitions from Zod schema for AI prompts and validation
 */

import { z } from "zod";
import type { PlannerField } from "./schema.js";

/**
 * Convert Zod schema to field definitions
 * Recursively walks the schema and extracts field metadata
 */
export function zodSchemaToFields(schema: z.ZodObject<any>): PlannerField[] {
  const fields: PlannerField[] = [];
  
  const shape = schema.shape;
  
  // Process game fields
  if (shape.game && shape.game instanceof z.ZodObject) {
    const gameShape = shape.game.shape;
    for (const [fieldName, fieldSchema] of Object.entries(gameShape)) {
      const field = zodFieldToField(fieldName, fieldSchema as z.ZodTypeAny, 'game');
      if (field) fields.push(field);
    }
  }
  
  // Process player fields (inside record)
  if (shape.players && shape.players instanceof z.ZodRecord) {
    const playerSchema = (shape.players as any)._def.valueType;
    if (playerSchema instanceof z.ZodObject) {
      const playerShape = playerSchema.shape;
      for (const [fieldName, fieldSchema] of Object.entries(playerShape)) {
        const field = zodFieldToField(fieldName, fieldSchema as z.ZodTypeAny, 'player');
        if (field) fields.push(field);
      }
    }
  }
  
  return fields;
}

/**
 * Convert a single Zod field to PlannerField format
 */
function zodFieldToField(
  name: string,
  schema: z.ZodTypeAny,
  path: 'game' | 'player'
): PlannerField | null {
  // Unwrap optional, nullable, default wrappers
  let unwrapped = schema;
  while (
    unwrapped instanceof z.ZodOptional ||
    unwrapped instanceof z.ZodNullable ||
    unwrapped instanceof z.ZodDefault
  ) {
    unwrapped = (unwrapped as any)._def.innerType || (unwrapped as any)._def.type;
  }
  
  // Get description from schema
  const description = (schema as any)._def?.description || '';
  
  // Determine type
  let type = 'unknown';
  let constraints: string | undefined;
  
  if (unwrapped instanceof z.ZodString) {
    type = 'string';
  } else if (unwrapped instanceof z.ZodNumber) {
    type = 'number';
  } else if (unwrapped instanceof z.ZodBoolean) {
    type = 'boolean';
  } else if (unwrapped instanceof z.ZodArray) {
    type = 'array';
    const elementType = (unwrapped as any)._def.type;
    if (elementType instanceof z.ZodString) {
      constraints = 'array of strings';
    }
  } else if (unwrapped instanceof z.ZodEnum) {
    type = 'enum';
    const values = (unwrapped as any)._def.values;
    constraints = `enum:[${values.join(',')}]`;
  } else if (unwrapped instanceof z.ZodObject) {
    type = 'object';
  } else if (unwrapped instanceof z.ZodRecord) {
    type = 'record';
  }
  
  return {
    name,
    type,
    path,
    source: 'base',
    purpose: description || `Base schema field: ${name}`,
    constraints,
  };
}
