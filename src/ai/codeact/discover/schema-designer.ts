import { invokeModel } from '../utils.js';
import { GameAnalysis } from '../analyzer.js';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * StateSchema creation options interface
 */
export interface StateSchemaOptions {
  gameSpecification: string;
  analysis: {
    analysis: GameAnalysis;
    [key: string]: any;
  };
}

/**
 * StateSchema error interface
 */
export interface StateSchemaError {
  error: string;
  rawResponse?: string;
  errorMessage?: string;
  partialSchema?: any;
}

/**
 * StateSchema result interface
 */
export interface StateSchemaResult {
  description: string;
  schema: string;
  initialState: string;
  validations: any[];
  fullText: string;
  error?: string;
  errorMessage?: string;
}

/**
 * Create a state schema for the game based on analysis
 * @param {BaseChatModel} model - The language model to use
 * @param {StateSchemaOptions} options - Options object
 * @returns {Promise<StateSchemaResult | StateSchemaError>} State schema definition or error
 */
export const createStateSchema = async (
  model: BaseChatModel, 
  { gameSpecification, analysis }: StateSchemaOptions
): Promise<StateSchemaResult | StateSchemaError> => {
  const prompt = `
You are an expert game programmer designing the state schema for a game. Based on the game specification 
and analysis provided, create a comprehensive JSON schema that will represent the game state.

GAME SPECIFICATION:
${gameSpecification}

GAME ANALYSIS:
${analysis.analysis.fullText}

Design a complete state schema for this game. The schema should:
1. Include all necessary game entities identified in the analysis
2. Define the structure of each entity with appropriate properties and types
3. Consider player state, game world state, and game progress tracking
4. Include any constant values/parameters needed for game mechanics
5. Consider how the state will be updated as the game progresses

IMPORTANT: Your response must include three sections, cleanly separated with specific XML tags:

<SchemaDescription>
A brief description of your schema design approach and key components
</SchemaDescription>

<JsonSchema>
{
  // Your complete JSON Schema definition here
  "type": "object",
  "properties": {
    // All required properties
  }
}
</JsonSchema>

<InitialState>
{
  // An example of the initial state object following your schema
}
</InitialState>

Make sure the JSON within the tags is valid, well-formed, and complete.
Do not include backticks or language identifiers in your JSON sections.
`;

  try {
    const response = await invokeModel(model, prompt);
    const responseText = response.content;
    
    // Extract the three sections using regex
    const descriptionMatch = responseText.match(/<SchemaDescription>([\s\S]*?)<\/SchemaDescription>/);
    const schemaMatch = responseText.match(/<JsonSchema>([\s\S]*?)<\/JsonSchema>/);
    const initialStateMatch = responseText.match(/<InitialState>([\s\S]*?)<\/InitialState>/);
    
    // Prepare variables to store extracted content
    let description = "";
    let schemaStr = "";
    let initialStateStr = "";
    let schema: any = null;
    let initialState: any = null;
    
    // Extract description if found
    if (descriptionMatch && descriptionMatch[1]) {
      description = descriptionMatch[1].trim();
    } else {
      // Fallback: try to find any text that looks like a description
      const potentialDescription = responseText.split(/<JsonSchema>|```json/)[0];
      if (potentialDescription) {
        description = potentialDescription.trim();
      }
    }
    
    // Extract schema JSON if found in XML tags
    if (schemaMatch && schemaMatch[1]) {
      schemaStr = schemaMatch[1].trim();
    } else {
      // Fallback: try to extract JSON from code blocks
      const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        schemaStr = codeBlockMatch[1].trim();
      }
    }
    
    // Extract initial state if found
    if (initialStateMatch && initialStateMatch[1]) {
      initialStateStr = initialStateMatch[1].trim();
    } else {
      // Try to find a second JSON block that might be the initial state
      const allCodeBlocks = responseText.match(/```(?:json)?\s*([\s\S]*?)```/g);
      if (allCodeBlocks && allCodeBlocks.length > 1) {
        initialStateStr = allCodeBlocks[1].replace(/```(?:json)?|```/g, '').trim();
      }
    }
    
    // If we still don't have a schema, try to find a standalone JSON object
    if (!schemaStr) {
      // Look for text that resembles a JSON object starting with { and ending with }
      const jsonMatch = responseText.match(/{[\s\S]*?}/);
      if (jsonMatch) {
        schemaStr = jsonMatch[0];
      }
    }
    
    // Parse the schema JSON
    if (schemaStr) {
      try {
        // Clean potential formatting issues 
        schemaStr = schemaStr.replace(/^\s*```json\s*/, '').replace(/\s*```\s*$/, '');
        schema = JSON.parse(schemaStr);
      } catch (error) {
        console.log("Error parsing schema JSON:", (error as Error).message);
        console.log("Schema text that failed to parse:", schemaStr);
        return {
          error: "Failed to parse schema JSON",
          rawResponse: responseText,
          errorMessage: (error as Error).message
        };
      }
    } else {
      return {
        error: "No valid JSON schema found in the response",
        rawResponse: responseText
      };
    }
    
    // Parse the initial state JSON if available
    if (initialStateStr) {
      try {
        // Clean potential formatting issues
        initialStateStr = initialStateStr.replace(/^\s*```json\s*/, '').replace(/\s*```\s*$/, '');
        initialState = JSON.parse(initialStateStr);
      } catch (error) {
        console.log("Error parsing initial state JSON:", (error as Error).message);
        // Non-critical error, can proceed without initial state
        initialState = { 
          error: "Failed to parse initial state JSON",
          errorMessage: (error as Error).message
        };
      }
    } else {
      // If no initial state found, create a minimal one
      initialState = { 
        message: "No initial state example provided" 
      };
    }
    
    // Basic validation of schema structure
    if (!schema || !schema.type || schema.type !== 'object' || !schema.properties) {
      return {
        error: "Schema does not follow the required structure",
        partialSchema: schema,
        rawResponse: responseText
      };
    }
    
    // Return the complete schema object with required properties for the next stages
    return {
      description: description || "Game state schema for tracking game state",
      schema: JSON.stringify(schema, null, 2),
      initialState: JSON.stringify(initialState || {}, null, 2),
      validations: [],
      fullText: responseText
    };
    
  } catch (error) {
    console.error("Error in createStateSchema:", error);
    return {
      error: "Failed to create state schema",
      errorMessage: (error as Error).message
    };
  }
};