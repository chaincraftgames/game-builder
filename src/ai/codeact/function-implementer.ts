import { invokeModel } from './utils.js';
import { extractAICapabilitiesSection, extractFunctionDescription, FunctionDefinition } from './function-designer.js';
import { StateSchemaResult } from './schema-designer.js';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * Implementation validation result interface
 */
export interface ValidationResult {
  success: boolean;
  message: string;
  missingFunctions: FunctionDefinition[];
}

/**
 * Function recovery result interface
 */
export interface FunctionRecoveryResult {
  success: boolean;
  code?: string;
}

/**
 * Implementation result interface
 */
export interface ImplementationResult {
  code: string;
  implementationTime: number;
  signatures: string; // Function signatures extracted from implementation or design
}

/**
 * Implementation options interface
 */
export interface ImplementationOptions {
  gameSpecification: string;
  stateSchema: StateSchemaResult;
  functionDesign: {
    fullText: string;
    functions: FunctionDefinition[];
  };
}

/**
 * Validates that the implementation includes the expected functions
 * @param {string} code - The implemented code
 * @param {FunctionDefinition[]} expectedFunctions - List of expected function objects
 * @returns {ValidationResult} Validation result with success flag, message and missing functions
 */
export const validateImplementation = (
  code: string, 
  expectedFunctions: FunctionDefinition[]
): ValidationResult => {
  const result: ValidationResult = { 
    success: true, 
    message: "All functions implemented successfully",
    missingFunctions: []
  };
  
  for (const func of expectedFunctions) {
    const functionRegex = new RegExp(`function\\s+${func.name}\\s*\\(`, 'i');
    if (!functionRegex.test(code)) {
      result.missingFunctions.push(func);
    }
  }
  
  if (result.missingFunctions.length > 0) {
    result.success = false;
    result.message = `Missing expected functions: ${result.missingFunctions.map(f => f.name).join(', ')}`;
  }
  
  return result;
};

/**
 * Attempt to recover a missing function by requesting it specifically
 * @param {BaseChatModel} model - The language model to use
 * @param {string} functionName - The name of the missing function
 * @param {string} gameSpecification - The game specification
 * @param {StateSchemaResult} stateSchema - The state schema object
 * @param {string} designText - The full function design text
 * @param {string} implementedCode - Already implemented functions
 * @returns {Promise<FunctionRecoveryResult>} Result containing success flag and code
 */
export const recoverMissingFunction = async (
  model: BaseChatModel, 
  functionName: string, 
  gameSpecification: string, 
  stateSchema: StateSchemaResult, 
  designText: string, 
  implementedCode: string
): Promise<FunctionRecoveryResult> => {
  console.log(`Attempting to recover missing function: ${functionName}`);
  
  const functionDescription = extractFunctionDescription(functionName, designText) ||
    `Implement the ${functionName} function as described in the function design document.`;
  
  const prompt = `
    You need to implement a missing function for the ${gameSpecification} game.
    
    State Schema:
    ${stateSchema.schema}
    
    Previously implemented code:
    ${implementedCode}
    
    Please implement ONLY the following function:
    
    ${functionName}: ${functionDescription}
    
    Return ONLY the JavaScript implementation for this specific function, without any markdown formatting or explanations outside the code.
  `;
  
  try {
    const response = await invokeModel(model, prompt);
    
    // Extract the code from the response
    let code = response.content.trim();
    
    // Remove any markdown code block markers if present
    code = code.replace(/^```(?:javascript|js)?|```$/gm, '').trim();
    
    // Verify that the function was actually implemented
    const functionRegex = new RegExp(`function\\s+${functionName}\\s*\\(`, 'i');
    if (!functionRegex.test(code)) {
      return { success: false };
    }
    
    return { 
      success: true,
      code
    };
  } catch (error) {
    console.error(`Error recovering function ${functionName}:`, error);
    return { success: false };
  }
};

/**
 * Extracts function signatures from function design information 
 * @param {FunctionDefinition[]} functions - Array of function definitions
 * @returns {string} Extracted function signatures as a string
 */
export const extractFunctionSignatures = (functions: FunctionDefinition[]): string => {
  return functions
    .map(fn => {
      // If the signature is already available in the function design, use it
      if (fn.signature) {
        return fn.signature;
      }
      
      // Otherwise construct a basic signature from the name and purpose
      const params = "/* params determined from purpose */";
      const returnType = "/* return type determined from purpose */";
      return `/**
 * ${fn.purpose || 'No description available'}
 */
function ${fn.name}(${params}): ${returnType};`;
    })
    .join('\n\n');
};

/**
 * Stage 5: Implement the function library using a streaming approach
 * @param {BaseChatModel} model - The language model to use
 * @param {ImplementationOptions} options - Options object
 * @returns {Promise<ImplementationResult>} Implementation results and timing information
 */
export const implementFunctions = async (
  model: BaseChatModel, 
  { gameSpecification, stateSchema, functionDesign }: ImplementationOptions
): Promise<ImplementationResult> => {
  console.log("⌨️ Stage 5: Implementing functions...");
  const startTime = Date.now();
  
  // Parse the function design to get a list of functions to implement
  const functionsToImplement = functionDesign.functions;
  
  console.log(`Found ${functionsToImplement.length} functions to implement`);
  
  // Extract function signatures for black-box testing
  const signatures = extractFunctionSignatures(functionsToImplement);
  console.log(`Extracted ${functionsToImplement.length} function signatures for black-box testing`);
  
  // Track implementation progress
  let implementedCode = "";
  let batchSize = 2; // Number of functions to implement per batch
  
  // Extract AI's reasoning for handling certain aspects directly
  const aiCapabilitiesSection = extractAICapabilitiesSection(functionDesign.fullText);
  
  // Implement functions in batches
  for (let i = 0; i < functionsToImplement.length; i += batchSize) {
    const batchEnd = Math.min(i + batchSize, functionsToImplement.length);
    const currentBatch = functionsToImplement.slice(i, batchEnd);
    
    console.log(`Implementing batch ${Math.floor(i/batchSize) + 1}: Functions ${i+1}-${batchEnd} of ${functionsToImplement.length}`);
    
    const prompt = `
      You are implementing a focused, minimal function library for the ${gameSpecification} game.
      
      State Schema:
      ${stateSchema.schema}
      
      Initial State Example:
      ${stateSchema.initialState}
      
      ${aiCapabilitiesSection ? `AI-Handled Capabilities:\n${aiCapabilitiesSection}\n` : ''}
      
      Function Design Context:
      ${functionDesign.fullText}
      
      ${implementedCode ? 'Previously implemented functions:\n' + implementedCode : ''}
      
      Now implement these critical functions:
      ${currentBatch.map(fn => 
        `- ${fn.name} (${fn.importance || 'unknown'}): ${extractFunctionDescription(fn.name, functionDesign.fullText)}`
      ).join('\n')}
      
      Implementation guidelines:
      1. Focus on pure, immutable state handling (create new state objects, don't mutate)
      2. Implement thorough input validation and error handling
      3. Use thorough JSDoc comments for each function
      4. Maintain consistency with previously implemented functions
      5. Remember that these are the minimal, essential functions - don't add extra utility functions
      6. Write robust code that handles edge cases and maintains game integrity
      
      Return ONLY the clean JavaScript implementations for these functions, without any markdown formatting or explanations outside the code.
    `;
    
    const response = await invokeModel(model, prompt);
    
    // Extract the code from the response
    let batchCode = response.content.trim();
    
    // Remove any markdown code block markers if present
    batchCode = batchCode.replace(/^```(?:javascript|js)?|```$/gm, '').trim();
    
    // Add the batch code to our implemented code
    implementedCode += (implementedCode ? '\n\n' : '') + batchCode;
    
    // Validate the batch implementation
    const validationResult = validateImplementation(batchCode, currentBatch);
    if (!validationResult.success) {
      console.log(`Warning: Some functions in batch ${Math.floor(i/batchSize) + 1} may have issues: ${validationResult.message}`);
      
      // Try to recover missing functions individually
      for (const missingFn of validationResult.missingFunctions) {
        const recoveryResult = await recoverMissingFunction(
          model,
          missingFn.name,
          gameSpecification,
          stateSchema,
          functionDesign.fullText,
          implementedCode
        );
        
        if (recoveryResult.success && recoveryResult.code) {
          implementedCode += '\n\n' + recoveryResult.code;
          console.log(`✅ Successfully recovered function: ${missingFn.name}`);
        } else {
          console.log(`❌ Failed to recover function: ${missingFn.name}`);
        }
      }
    }
  }
  
  const implementationTime = Date.now() - startTime;
  console.log(`✅ Function implementation completed in ${implementationTime}ms`);
  
  return { 
    code: implementedCode,
    implementationTime,
    signatures // Return extracted signatures for black-box testing
  };
};