import { z } from 'zod';

/**
 * Simplified JSON Schema types for game state schemas
 * Supports a constrained subset of JSON Schema Draft 7
 */
export type JSONSchemaType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'integer' | 'null';

export interface JSONSchemaObject {
  // Type can be single or array (for nullable types like ["string", "null"])
  type?: JSONSchemaType | JSONSchemaType[];
  properties?: Record<string, JSONSchemaObject>;
  additionalProperties?: JSONSchemaObject | boolean;
  items?: JSONSchemaObject;
  required?: string[];
  // Enum can contain strings, numbers, or null
  enum?: (string | number | null)[];
  description?: string;
  // Note: anyOf, allOf, oneOf are in the type but NOT implemented in buildFromJsonSchema
  // They're here for TypeScript compatibility but will be ignored by converter
  anyOf?: JSONSchemaObject[];
  allOf?: JSONSchemaObject[];
  oneOf?: JSONSchemaObject[];
}

/**
 * Legacy custom format type for backwards compatibility
 * @deprecated Use JSONSchemaObject instead
 */
export type SchemaField = {
    name: string;
    type: string;
    description?: string;
    required?: boolean;
    properties?: Record<string, SchemaField>;
    patternProperties?: Record<string, SchemaField>;
    additionalProperties?: SchemaField;
    items?: {
        type: string;
        properties?: Record<string, SchemaField>;
    };
};

/**
 * Convert JSON Schema to Zod schema
 * 
 * Supports a constrained subset of JSON Schema Draft 7 suitable for game state schemas.
 * This function handles BOTH:
 * 1. Standard JSON Schema objects (current format)
 * 2. Legacy custom format arrays (backwards compatibility)
 * 
 * SUPPORTED JSON SCHEMA CONSTRUCTS:
 * - Primitives: string, number, integer, boolean
 * - Objects: properties (fixed), additionalProperties (dynamic maps)
 * - Arrays: items
 * - Enums: string[], number[], or mixed with null
 * - Required fields: via required array
 * - Nullable types: via type array ["string", "null"]
 * 
 * INTENTIONALLY NOT SUPPORTED (for simplicity):
 * - $ref and definitions (prefer inlining)
 * - allOf, anyOf, oneOf (prefer explicit properties)
 * - patternProperties (use additionalProperties)
 * - Validation keywords: minLength, maxLength, pattern, format, etc.
 * 
 * ALL FIELDS ARE MADE NULLABLE by default for game state flexibility.
 * Required vs optional is controlled by the required array in parent object.
 * 
 * See schema-validator-alignment.test.ts for comprehensive test coverage
 * of supported constructs.
 */
export function buildStateSchema(input: JSONSchemaObject | SchemaField[]): z.ZodSchema {
    // Handle legacy custom format (array of SchemaField)
    if (Array.isArray(input)) {
        return buildFromLegacyFormat(input);
    }
    
    // Handle JSON Schema format
    return buildFromJsonSchema(input);
}

/**
 * Build Zod schema from JSON Schema
 * Internal implementation - use buildStateSchema() as public API
 */
function buildFromJsonSchema(schema: JSONSchemaObject): z.ZodTypeAny {
    // Handle enum
    if (schema.enum && schema.enum.length > 0) {
        return z.enum(schema.enum as [string, ...string[]]).nullable();
    }
    
    // Handle type-based schemas
    switch (schema.type) {
        case 'string':
            return z.string().nullable();
        
        case 'number':
        case 'integer':
            return z.number().nullable();
        
        case 'boolean':
            return z.boolean().nullable();
        
        case 'array':
            if (schema.items) {
                const itemSchema = buildFromJsonSchema(schema.items);
                return z.array(z.union([itemSchema, z.null()]));
            }
            return z.array(z.any().nullable());
        
        case 'object':
            // Handle records/maps with additionalProperties
            if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
                const valueSchema = buildFromJsonSchema(schema.additionalProperties);
                return z.record(valueSchema);
            }
            
            // Handle fixed objects with properties
            if (schema.properties) {
                const schemaObject: Record<string, z.ZodTypeAny> = {};
                const requiredFields = new Set(schema.required || []);
                
                for (const [key, propSchema] of Object.entries(schema.properties)) {
                    let fieldSchema = buildFromJsonSchema(propSchema);
                    
                    // Make optional if not in required array
                    if (!requiredFields.has(key)) {
                        fieldSchema = fieldSchema.optional();
                    }
                    
                    schemaObject[key] = fieldSchema;
                }
                
                return z.object(schemaObject);
            }
            
            // Default: any record
            return z.record(z.any().nullable());
        
        default:
            return z.any().nullable();
    }
}

/**
 * Legacy support for custom format
 * @deprecated Will be removed once all fixtures use JSON Schema
 */
function buildFromLegacyFormat(fields: SchemaField[]): z.ZodSchema {
    const schemaObject: Record<string, z.ZodTypeAny> = {};
    
    for (const field of fields) {
        let fieldSchema: z.ZodTypeAny;
        
        switch (field.type) {
            case 'string':
                fieldSchema = z.string().nullable();
                break;
            case 'number':
                fieldSchema = z.number().nullable();
                break;
            case 'boolean':
                fieldSchema = z.boolean().nullable();
                break;
            case 'array':
                if (field.items) {
                    // Handle array items based on their type
                    if (field.items.type === 'object' && field.items.properties) {
                        const subFields = Object.entries(field.items.properties).map(
                            ([key, fieldDef]) => ({
                                name: key,
                                type: fieldDef.type,
                                required: fieldDef.required,
                                description: fieldDef.description,
                                items: fieldDef.items
                            })
                        );
                        fieldSchema = z.array(z.union([buildFromLegacyFormat(subFields), z.null()]));
                    } else {
                        let primitiveSchema: z.ZodTypeAny;
                        switch (field.items.type) {
                            case 'string':
                                primitiveSchema = z.string();
                                break;
                            case 'number':
                                primitiveSchema = z.number();
                                break;
                            case 'boolean':
                                primitiveSchema = z.boolean();
                                break;
                            default:
                                primitiveSchema = z.any();
                        }
                        fieldSchema = z.array(z.union([primitiveSchema, z.null()]));
                    }
                } else {
                    fieldSchema = z.array(z.any().nullable());
                }
                break;
            case 'object':
                const objectProperties = field.properties || field.items?.properties;
                
                if (objectProperties) {
                    const subFields = Object.entries(objectProperties).map(
                        ([key, fieldDef]) => ({
                            name: key,
                            type: fieldDef.type,
                            required: fieldDef.required ?? false,
                            description: fieldDef.description,
                            properties: fieldDef.properties,
                            patternProperties: fieldDef.patternProperties,
                            items: fieldDef.items
                        })
                    );
                    fieldSchema = buildFromLegacyFormat(subFields);
                } else if (field.additionalProperties) {
                    if (field.additionalProperties.type === 'object' && field.additionalProperties.properties) {
                        const valueSubFields = Object.entries(field.additionalProperties.properties).map(
                            ([key, fieldDef]) => ({
                                name: key,
                                type: fieldDef.type,
                                required: fieldDef.required ?? false,
                                description: fieldDef.description,
                                properties: fieldDef.properties,
                                items: fieldDef.items
                            })
                        );
                        fieldSchema = z.record(buildFromLegacyFormat(valueSubFields));
                    } else {
                        fieldSchema = z.record(z.any().nullable());
                    }
                } else if (field.patternProperties) {
                    const patterns = Object.values(field.patternProperties);
                    if (patterns.length > 0 && patterns[0].properties) {
                        const valueSubFields = Object.entries(patterns[0].properties).map(
                            ([key, fieldDef]) => ({
                                name: key,
                                type: fieldDef.type,
                                required: fieldDef.required ?? false,
                                description: fieldDef.description,
                                properties: fieldDef.properties,
                                items: fieldDef.items
                            })
                        );
                        fieldSchema = z.record(buildFromLegacyFormat(valueSubFields));
                    } else {
                        fieldSchema = z.record(z.any().nullable());
                    }
                } else {
                    fieldSchema = z.record(z.any().nullable());
                }
                break;
            default:
                fieldSchema = z.any().nullable();
        }
        
        schemaObject[field.name] = (field.required ?? true) ? fieldSchema : fieldSchema.optional();
    }
    
    return z.object(schemaObject);
}