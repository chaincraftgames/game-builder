import { invokeModel, ModelWithOptions } from '../model-config.js';
import { extractFunctionNames } from '../utils.js';
import { extractAICapabilitiesSection, extractFunctionDescription, FunctionDefinition } from './function-designer.js';
import { StateSchemaResult } from './schema-designer.js';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { validateCodeSyntax } from './test-runner.js';

/**
 * Implementation validation result interface
 */
export interface ValidationResult {
  success: boolean;
  message: string;
  missingFunctions: FunctionDefinition[];
}

/**
 * Function instantiation validation result interface
 */
export interface InstantiationResult {
  success: boolean;
  error?: string;
  missingFunctions?: string[];
}

/**
 * Incomplete function detection result interface
 */
export interface IncompletenessResult {
  isIncomplete: boolean;
  lastFunction?: string;
  incompletePattern?: string;
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
 * Estimates token count for a given text (rough approximation)
 * @param {string} text - The text to estimate tokens for
 * @returns {number} Estimated token count
 */
export const estimateTokenCount = (text: string): number => {
  // Rough estimation: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
};

/**
 * Checks if the current context should start a new batch to avoid token limits
 * @param {string} currentContext - The current accumulated context
 * @param {number} maxTokens - Maximum tokens allowed (default 8000)
 * @returns {boolean} True if a new context should be started
 */
export const shouldStartNewContext = (currentContext: string, maxTokens: number = 8000): boolean => {
  return estimateTokenCount(currentContext) > maxTokens;
};

/**
 * Detects if a function implementation is incomplete
 * @param {string} code - The code to check for completeness
 * @returns {IncompletenessResult} Detection result with incomplete status and details
 */
export const detectIncompleteFunction = (code: string): IncompletenessResult => {
  if (!code || code.trim() === '') {
    return { isIncomplete: true, incompletePattern: 'empty code' };
  }

  const lines = code.split('\n');
  const lastLine = lines[lines.length - 1].trim();
  
  // Check for common incomplete patterns
  const incompletePatterns = [
    { pattern: /[{([,]\s*$/, name: 'ends with opening brace/paren/comma' },
    { pattern: /\w+\s*:\s*$/, name: 'ends with property name' },
    { pattern: /\$\{\s*$/, name: 'ends with template literal opening' },
    { pattern: /\s*\+\s*$/, name: 'ends with concatenation operator' },
    { pattern: /\s*\.\s*$/, name: 'ends with dot accessor' },
    { pattern: /\s*=\s*$/, name: 'ends with assignment operator' },
    { pattern: /\s*\?\s*$/, name: 'ends with ternary operator' },
  ];
  
  for (const { pattern, name } of incompletePatterns) {
    if (pattern.test(lastLine)) {
      // Try to identify the incomplete function
      const functionMatches = code.match(/function\s+(\w+)\s*\(/g);
      const lastFunction = functionMatches?.[functionMatches.length - 1]?.match(/function\s+(\w+)/)?.[1];
      return { isIncomplete: true, lastFunction, incompletePattern: name };
    }
  }
  
  // Check for unclosed braces
  const openBraces = (code.match(/\{/g) || []).length;
  const closeBraces = (code.match(/\}/g) || []).length;
  if (openBraces > closeBraces) {
    return { isIncomplete: true, incompletePattern: 'unclosed braces' };
  }
  
  // Check for unclosed parentheses
  const openParens = (code.match(/\(/g) || []).length;
  const closeParens = (code.match(/\)/g) || []).length;
  if (openParens > closeParens) {
    return { isIncomplete: true, incompletePattern: 'unclosed parentheses' };
  }

  return { isIncomplete: false };
};

/**
 * Validates that functions can be instantiated and are properly defined
 * @param {string} code - The function code to validate
 * @returns {InstantiationResult} Validation result with success flag and error details
 */
export const validateFunctionInstantiation = (code: string): InstantiationResult => {
  try {
    // Try to parse and instantiate the functions
    new Function(code);
    
    // Additional check: verify function names are actually defined
    const functionNames = extractFunctionNames(code);
    if (functionNames.length === 0) {
      return { success: false, error: 'No functions found in code' };
    }
    
    // Test that each function is properly defined in the code
    const testContext = new Function('return function() { ' + code + '; return { ' + 
      functionNames.map(name => `${name}: typeof ${name} !== 'undefined' ? ${name} : null`).join(', ') + 
    '}; }')();
    
    const result = testContext();
    const missingFunctions = functionNames.filter(name => result[name] === null);
    
    if (missingFunctions.length > 0) {
      return { 
        success: false, 
        error: `Functions not properly defined: ${missingFunctions.join(', ')}`,
        missingFunctions 
      };
    }
    
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown instantiation error' 
    };
  }
};

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
 * @param {ModelWithOptions} model - The model with options to use
 * @param {string} functionName - The name of the missing function
 * @param {string} gameSpecification - The game specification
 * @param {StateSchemaResult} stateSchema - The state schema object
 * @param {string} designText - The full function design text
 * @param {string} implementedCode - Already implemented functions
 * @param {object} metadata - Optional metadata for tracing
 * @returns {Promise<FunctionRecoveryResult>} Result containing success flag and code
 */
export const recoverMissingFunction = async (
  model: ModelWithOptions, 
  functionName: string, 
  gameSpecification: string, 
  stateSchema: StateSchemaResult, 
  designText: string, 
  implementedCode: string,
  metadata?: { [key: string]: any }
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
    const response = await invokeModel(model, prompt, undefined, metadata);
    
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
 * @param {ModelWithOptions} model - The model with options to use
 * @param {ImplementationOptions} options - Options object
 * @param {object} metadata - Optional metadata for tracing
 * @returns {Promise<ImplementationResult>} Implementation results and timing information
 */
export const implementFunctions = async (
  model: ModelWithOptions, 
  { gameSpecification, stateSchema, functionDesign }: ImplementationOptions,
  metadata?: { [key: string]: any }
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
    
    // Check if we should start a new context to avoid token limits
    const currentContext = `${functionDesign.fullText}\n${implementedCode}`;
    if (shouldStartNewContext(currentContext)) {
      console.log(`Context getting large (${estimateTokenCount(currentContext)} tokens), starting fresh context for this batch`);
      // For new context, only include the most essential previous functions
      const essentialFunctions = implementedCode.split('\n\n').slice(-2).join('\n\n'); // Keep last 2 functions as context
      implementedCode = essentialFunctions;
    }
    
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
    
    const response = await invokeModel(model, prompt, undefined, metadata);
    
    // Extract the code from the response
    let batchCode = response.content.trim();
    
    // Remove any markdown code block markers if present
    batchCode = batchCode.replace(/^```(?:javascript|js)?|```$/gm, '').trim();
    
    // Immediate validation: Check for syntax errors
    console.log(`Validating syntax for batch ${Math.floor(i/batchSize) + 1}...`);
    const syntaxValidation = validateCodeSyntax(batchCode, 'implementation');
    if (!syntaxValidation.valid) {
      console.log(`❌ Syntax error in batch ${Math.floor(i/batchSize) + 1}: ${syntaxValidation.error}`);
      if (syntaxValidation.codeContext) {
        console.log("Error context:", syntaxValidation.codeContext);
      }
      
      // Try to recover by regenerating just this batch
      console.log(`🔄 Attempting to regenerate batch ${Math.floor(i/batchSize) + 1}...`);
      const recoveryResponse = await invokeModel(model, prompt + '\n\nIMPORTANT: Ensure all functions are complete and syntactically valid.', undefined, metadata);
      batchCode = recoveryResponse.content.trim().replace(/^```(?:javascript|js)?|```$/gm, '').trim();
      
      // Re-validate
      const recoveryValidation = validateCodeSyntax(batchCode, 'implementation');
      if (!recoveryValidation.valid) {
        console.log(`❌ Recovery failed for batch ${Math.floor(i/batchSize) + 1}, continuing with errors`);
      } else {
        console.log(`✅ Recovery successful for batch ${Math.floor(i/batchSize) + 1}`);
      }
    }
    
    // Check for incomplete functions
    const incompletenessCheck = detectIncompleteFunction(batchCode);
    if (incompletenessCheck.isIncomplete) {
      console.log(`⚠️  Detected incomplete function in batch ${Math.floor(i/batchSize) + 1}: ${incompletenessCheck.incompletePattern}`);
      if (incompletenessCheck.lastFunction) {
        console.log(`   Last function: ${incompletenessCheck.lastFunction}`);
      }
      
      // Try to complete the incomplete function
      const completionPrompt = `The previous code appears to be incomplete (${incompletenessCheck.incompletePattern}). Please provide the complete, syntactically correct version of this code:\n\n${batchCode}\n\nReturn ONLY the complete JavaScript code without any markdown formatting.`;
      const completionResponse = await invokeModel(model, completionPrompt, undefined, metadata);
      const completedCode = completionResponse.content.trim().replace(/^```(?:javascript|js)?|```$/gm, '').trim();
      
      const completionValidation = validateCodeSyntax(completedCode, 'implementation');
      if (completionValidation.valid && !detectIncompleteFunction(completedCode).isIncomplete) {
        console.log(`✅ Successfully completed incomplete function`);
        batchCode = completedCode;
      } else {
        console.log(`❌ Failed to complete incomplete function, using original`);
      }
    }
    
    // Instantiation validation: Test that functions can be loaded
    console.log(`Testing function instantiation for batch ${Math.floor(i/batchSize) + 1}...`);
    const instantiationResult = validateFunctionInstantiation(batchCode);
    if (!instantiationResult.success) {
      console.log(`⚠️  Function instantiation warning: ${instantiationResult.error}`);
      if (instantiationResult.missingFunctions && instantiationResult.missingFunctions.length > 0) {
        console.log(`   Missing functions: ${instantiationResult.missingFunctions.join(', ')}`);
      }
    } else {
      console.log(`✅ All functions in batch ${Math.floor(i/batchSize) + 1} instantiated successfully`);
    }
    
    // Add the batch code to our implemented code
    implementedCode += (implementedCode ? '\n\n' : '') + batchCode;
    
  }
  
  // Final validation: Check the complete implementation
  console.log("🔍 Running final validation on complete implementation...");
  
  // Syntax validation for the complete implementation
  const finalSyntaxValidation = validateCodeSyntax(implementedCode, 'implementation');
  if (!finalSyntaxValidation.valid) {
    console.log(`❌ Final syntax validation failed: ${finalSyntaxValidation.error}`);
    if (finalSyntaxValidation.codeContext) {
      console.log("Error context:", finalSyntaxValidation.codeContext);
    }
  } else {
    console.log("✅ Final syntax validation passed");
  }
  
  // Instantiation validation for the complete implementation
  const finalInstantiationResult = validateFunctionInstantiation(implementedCode);
  if (!finalInstantiationResult.success) {
    console.log(`❌ Final instantiation validation failed: ${finalInstantiationResult.error}`);
  } else {
    console.log("✅ Final instantiation validation passed");
  }
  
  // Traditional function presence validation
  const finalValidationResult = validateImplementation(implementedCode, functionsToImplement);
  if (!finalValidationResult.success) {
    console.log(`⚠️  ${finalValidationResult.message}`);
    
    // Try to recover missing functions individually
    for (const missingFn of finalValidationResult.missingFunctions) {
      console.log(`🔄 Attempting to recover missing function: ${missingFn.name}`);
      const recoveryResult = await recoverMissingFunction(
        model,
        missingFn.name,
        gameSpecification,
        stateSchema,
        functionDesign.fullText,
        implementedCode
      );
      
      if (recoveryResult.success && recoveryResult.code) {
        // Validate the recovered function before adding
        const recoveredSyntaxValidation = validateCodeSyntax(recoveryResult.code, 'implementation');
        const recoveredInstantiationResult = validateFunctionInstantiation(recoveryResult.code);
        
        if (recoveredSyntaxValidation.valid && recoveredInstantiationResult.success) {
          implementedCode += '\n\n' + recoveryResult.code;
          console.log(`✅ Successfully recovered function: ${missingFn.name}`);
        } else {
          console.log(`❌ Recovered function ${missingFn.name} failed validation`);
          if (!recoveredSyntaxValidation.valid) {
            console.log(`   Syntax error: ${recoveredSyntaxValidation.error}`);
          }
          if (!recoveredInstantiationResult.success) {
            console.log(`   Instantiation error: ${recoveredInstantiationResult.error}`);
          }
        }
      } else {
        console.log(`❌ Failed to recover function: ${missingFn.name}`);
      }
    }
  } else {
    console.log("✅ All expected functions are present");
  }
  
  const implementationTime = Date.now() - startTime;
  console.log(`✅ Function implementation completed in ${implementationTime}ms`);
  
  return { 
    code: implementedCode,
    implementationTime,
    signatures // Return extracted signatures for black-box testing
  };
};