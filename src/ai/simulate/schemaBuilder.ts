import { z } from 'zod';

type SchemaFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

const isValidFieldType = (type: string): type is SchemaFieldType => {
    return ['string', 'number', 'boolean', 'array', 'object'].includes(type);
};

export type SchemaField = {
    name: string;
    type: SchemaFieldType;
    description?: string;
    required: boolean;
    items?: {
        type: SchemaFieldType;
        properties: Record<string, SchemaField>;
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
                        // For primitive types, create a simple array with nullable items
                        fieldSchema = z.array(z.union([buildStateSchema([{
                            name: 'item',
                            type: field.items.type,
                            required: true,
                            description: field.description
                        }]), z.null()]));
                    }
                } else {
                    fieldSchema = z.array(z.any().nullable());
                }
                break;
            case 'object':
                if (field.items?.properties) {
                    const subFields = Object.entries(field.items.properties).map(
                        ([key, fieldDef]) => ({
                            name: key,
                            type: fieldDef.type,
                            required: fieldDef.required,
                            description: fieldDef.description,
                            items: fieldDef.items
                        })
                    );
                    // Don't make the object itself nullable
                    fieldSchema = buildStateSchema(subFields);
                } else {
                    fieldSchema = z.record(z.any().nullable());
                }
                break;
            default:
                fieldSchema = z.any().nullable();
        }
        
        // Make the field optional if not required
        schemaObject[field.name] = field.required ? fieldSchema : fieldSchema.optional();
    }
    
    return z.object(schemaObject);
}