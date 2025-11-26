import { z } from 'zod';

type SchemaFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

const isValidFieldType = (type: string): type is SchemaFieldType => {
    return ['string', 'number', 'boolean', 'array', 'object'].includes(type);
};

export type SchemaField = {
    name: string;
    type: SchemaFieldType;
    description?: string;
    required?: boolean;
    properties?: Record<string, SchemaField>;  // For objects
    patternProperties?: Record<string, SchemaField>;  // For records with patterns
    items?: {
        type: SchemaFieldType;
        properties?: Record<string, SchemaField>;
    };
};

export function buildStateSchema(fields: SchemaField[]): z.ZodSchema {
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
                    if (!isValidFieldType(field.items.type)) {
                        throw new Error(`Invalid field type: ${field.items.type}`);
                    }
                    
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
                        // Make array items nullable but not the array itself
                        fieldSchema = z.array(z.union([buildStateSchema(subFields), z.null()]));
                    } else {
                        // For primitive types, create a simple array with nullable primitive items
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
                // Handle direct properties (new format) or items.properties (old format)
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
                    // Don't make the object itself nullable
                    fieldSchema = buildStateSchema(subFields);
                } else if (field.patternProperties) {
                    // Handle pattern properties (e.g., players object with dynamic keys)
                    // Take the first pattern's schema as the value schema for the record
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
                        fieldSchema = z.record(buildStateSchema(valueSubFields));
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
        
        // Make the field optional if not required (default to required if not specified)
        schemaObject[field.name] = (field.required ?? true) ? fieldSchema : fieldSchema.optional();
    }
    
    return z.object(schemaObject);
}