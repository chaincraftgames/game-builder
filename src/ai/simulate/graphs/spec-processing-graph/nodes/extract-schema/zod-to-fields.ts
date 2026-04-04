/**
 * Convert Zod schema to condensed field format
 * 
 * Extracts field definitions from Zod schema for AI prompts and validation.
 * Produces the enriched GameStateField format with FieldType union and
 * structured optional fields (enumValues, valueType).
 */

import { z } from "zod";
import type { GameStateField, FieldType } from "./schema.js";

/**
 * Convert Zod schema to field definitions
 * Recursively walks the schema and extracts field metadata
 */
export function zodSchemaToFields(schema: z.ZodObject<any>): GameStateField[] {
  const fields: GameStateField[] = [];
  
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
 * Convert a single Zod field to GameStateField format
 */
function zodFieldToField(
  name: string,
  schema: z.ZodTypeAny,
  path: 'game' | 'player'
): GameStateField | null {
  // Unwrap optional, nullable, default wrappers
  let unwrapped = schema;
  let isOptional = false;
  while (
    unwrapped instanceof z.ZodOptional ||
    unwrapped instanceof z.ZodNullable ||
    unwrapped instanceof z.ZodDefault
  ) {
    if (unwrapped instanceof z.ZodOptional) isOptional = true;
    unwrapped = (unwrapped as any)._def.innerType || (unwrapped as any)._def.type;
  }
  
  // Get description from schema
  const description = (schema as any)._def?.description || '';
  
  // Determine type and structured optional fields
  let type: FieldType = 'string'; // fallback
  let enumValues: string[] | undefined;
  let valueType: FieldType | undefined;
  
  if (unwrapped instanceof z.ZodString) {
    type = 'string';
  } else if (unwrapped instanceof z.ZodNumber) {
    type = 'number';
  } else if (unwrapped instanceof z.ZodBoolean) {
    type = 'boolean';
  } else if (unwrapped instanceof z.ZodArray) {
    type = 'array';
    const elementSchema = (unwrapped as any)._def.type;
    valueType = zodTypeToFieldType(elementSchema);
    if (valueType === 'enum') {
      enumValues = extractEnumValues(elementSchema);
    }
  } else if (unwrapped instanceof z.ZodEnum) {
    type = 'enum';
    enumValues = (unwrapped as any)._def.values as string[];
  } else if (unwrapped instanceof z.ZodObject) {
    type = 'record';
  } else if (unwrapped instanceof z.ZodRecord) {
    type = 'record';
    const valSchema = (unwrapped as any)._def.valueType;
    valueType = zodTypeToFieldType(valSchema);
    if (valueType === 'enum') {
      enumValues = extractEnumValues(valSchema);
    }
  }
  
  const field: GameStateField = {
    name,
    type,
    path,
    purpose: description || `Base schema field: ${name}`,
  };

  if (enumValues) field.enumValues = enumValues;
  if (valueType) field.valueType = valueType;
  if (isOptional) field.required = false;
  
  return field;
}

/**
 * Map a Zod type instance to a FieldType value.
 */
function zodTypeToFieldType(schema: z.ZodTypeAny): FieldType {
  let unwrapped = schema;
  while (
    unwrapped instanceof z.ZodOptional ||
    unwrapped instanceof z.ZodNullable ||
    unwrapped instanceof z.ZodDefault
  ) {
    unwrapped = (unwrapped as any)._def.innerType || (unwrapped as any)._def.type;
  }
  if (unwrapped instanceof z.ZodString) return 'string';
  if (unwrapped instanceof z.ZodNumber) return 'number';
  if (unwrapped instanceof z.ZodBoolean) return 'boolean';
  if (unwrapped instanceof z.ZodEnum) return 'enum';
  if (unwrapped instanceof z.ZodArray) return 'array';
  if (unwrapped instanceof z.ZodRecord) return 'record';
  if (unwrapped instanceof z.ZodObject) return 'record';
  return 'string';
}

/**
 * Extract enum values from a Zod enum schema (unwrap wrappers first).
 */
function extractEnumValues(schema: z.ZodTypeAny): string[] | undefined {
  let unwrapped = schema;
  while (
    unwrapped instanceof z.ZodOptional ||
    unwrapped instanceof z.ZodNullable ||
    unwrapped instanceof z.ZodDefault
  ) {
    unwrapped = (unwrapped as any)._def.innerType || (unwrapped as any)._def.type;
  }
  if (unwrapped instanceof z.ZodEnum) {
    return (unwrapped as any)._def.values as string[];
  }
  return undefined;
}
