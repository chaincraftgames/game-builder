import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { invokeModel, extractImplementedFunctions } from './utils.js';
import { StateSchemaResult } from './schema-designer.js';
import { FunctionDesign } from './function-designer.js';

/**
 * Test generation parameters interface
 */
export interface TestGenerationParams {
  gameSpecification: string;
  stateSchema: StateSchemaResult;
  implementation?: string; // Made optional
  functionDesign?: FunctionDesign; // Function design documentation
  functionSignatures?: string; // Added to support black-box testing with just signatures
}

/**
 * Test generation result interface
 */
export interface TestGenerationResult {
  testCode: string;
  testGenerationTime: number;
}

/**
 * Stage 6: Generate test cases for the functions
 * @param {BaseChatModel} model - The language model to use
 * @param {TestGenerationParams} params - Parameters including game specification, state schema, and implementation
 * @returns {Promise<TestGenerationResult>} Test code and timing information
 */
// export const generateTests = async (
//   model: BaseChatModel, 
//   params: TestGenerationParams
// ): Promise<TestGenerationResult> => {
//   const { gameSpecification, stateSchema, implementation, functionDesign } = params;
//   console.log("🧪 Stage 6: Generating tests...");
//   const startTime = Date.now();
  
//   // Extract function specifics from the function design document if available
//   let functionRequirements = '';
//   if (functionDesign) {
//     console.log("Using function design information to generate requirement-based tests");
    
//     // Create a structured representation of function requirements from the design docs
//     functionRequirements = `
//     Function Requirements:
//     ${functionDesign.functions.map(fn => `
//       ${fn.name}:
//       - Purpose: ${fn.purpose}
//       - Signature: ${fn.signature}
//       - Importance: ${fn.importance}
//     `).join('\n')}
//     `;
//   }
  
//   // Create a prompt to generate tests for the implemented functions
//   const prompt = `
//     You are a test engineer creating comprehensive tests for a ${gameSpecification} game library.
    
//     Here's the state schema for the game:
//     ${stateSchema.schema}
    
//     ${functionDesign ? functionRequirements : ''}
    
//     Here are the implemented functions:
//     ${implementation}
    
//     ${functionDesign ? `
//     IMPORTANT: Your primary goal is to test that each function correctly implements its stated purpose
//     and meets the requirements specified in the function design document. The tests should verify that
//     the implementation follows the design, not just that the code runs without errors.
//     ` : ''}
    
//     Please write complete JavaScript test code that verifies:
//     1. Each function works correctly with valid inputs
//     2. Error handling works correctly with invalid inputs
//     3. Edge cases are properly handled
//     4. Functions interact correctly when used together
//     ${functionDesign ? '5. Each function correctly implements its stated purpose from the requirements' : ''}

//     Your tests should:
//     - Test each function independently
//     - Include integration tests for function combinations
//     - Use descriptive test names that explain what's being tested
//     - Log test results clearly
//     - Consider all possible edge cases
//     ${functionDesign ? '- Explicitly test against the function\'s stated purpose' : ''}

//     Write pure JavaScript test code - DO NOT use Jest, Mocha or any other testing framework.
//     Use a simple approach with descriptive console logs and basic assertions.
    
//     Return ONLY executable JavaScript code that can run directly. No markdown formatting or text explanations outside the code.
//   `;
  
//   const response = await invokeModel(model, prompt);
  
//   // Extract the test code from the response
//   let testCode = response.content.trim();
  
//   // Clean up code block markers if present
//   testCode = testCode.replace(/^```(?:javascript|js)?|```$/gm, '').trim();
  
//   // Validate that we have proper test code with basic syntax checking
//   try {
//     // Simple syntax check, will throw if invalid
//     new Function(testCode);
    
//     // Check if there are at least a few test sections
//     const testPattern = /function\s+test|describe|it\s*\(|assert|expect|console\.log\(\s*["']Test/g;
//     const testMatches = testCode.match(testPattern);
    
//     if (!testMatches || testMatches.length < 3) {
//       // If we don't have enough test patterns, try to regenerate with more explicit instructions
//       console.log("Warning: Generated tests don't seem comprehensive. Trying to improve...");
//       return generateImprovedTests(model, params);
//     }
//   } catch (error) {
//     // If there's a syntax error in the test code, try to regenerate with better instructions
//     console.log(`Warning: Generated test code has syntax error: ${(error as Error).message}. Regenerating...`);
//     return generateImprovedTests(model, params);
//   }
  
//   const testGenerationTime = Date.now() - startTime;
//   console.log(`✅ Test generation completed in ${testGenerationTime}ms`);
  
//   return {
//     testCode,
//     testGenerationTime
//   };
// };

/**
 * Generate improved tests with more explicit instructions
 * @param {BaseChatModel} model - The language model to use
 * @param {TestGenerationParams} params - Parameters including game specification, state schema, and implementation
 * @returns {Promise<TestGenerationResult>} Improved test code and timing information
 */
// export const generateImprovedTests = async (
//   model: BaseChatModel, 
//   params: TestGenerationParams
// ): Promise<TestGenerationResult> => {
//   const { gameSpecification, stateSchema, implementation, functionDesign } = params;
//   console.log("🔄 Generating improved tests...");
//   const startTime = Date.now();
  
//   // Extract function names to explicitly test each one
//   const functionNames = extractImplementedFunctions(implementation);
//   const functionList = functionNames.join(', ');
  
//   // Create function requirements section if function design is available
//   let functionRequirements = '';
//   if (functionDesign) {
//     console.log("Using function design information for improved tests");
//     functionRequirements = `
//     Important - Test against these function requirements:
//     ${functionDesign.functions.map(fn => `
//     ${fn.name}:
//     - Purpose: ${fn.purpose || 'Not specified'}
//     - Expected behavior: This function should correctly fulfill its purpose as described
//     `).join('\n')}
    
//     Remember to verify that each function properly implements its stated purpose, not just that it runs without errors.
//     `;
//   }
  
//   const prompt = `
//     You are a test engineer creating comprehensive tests for a ${gameSpecification} game library.
//     The implementation has these functions: ${functionList}
    
//     Here's the state schema for the game:
//     ${stateSchema.schema}
    
//     ${functionDesign ? functionRequirements : ''}
    
//     And here are the implemented functions:
//     ${implementation}
    
//     Please write simple, valid JavaScript test code that:
//     1. Creates a test runner that logs results clearly
//     2. Tests each function individually with multiple test cases
//     3. Includes basic integration tests showing functions working together
//     ${functionDesign ? '4. Verifies each function correctly implements its purpose stated in the requirements' : ''}
    
//     IMPORTANT:
//     - Use ONLY standard JavaScript (no testing frameworks like Jest/Mocha)
//     - Make sure your code has NO syntax errors
//     - Use simple if/else assertions with console.log output
//     - Wrap your test code in a function that runs all tests
//     - DO NOT use template literals with backticks for multi-line strings
//     - DO NOT use any unusual JavaScript features that might cause parsing errors
//     ${functionDesign ? '- Focus on testing against the requirements, not just that code runs' : ''}
    
//     Structure your code like this:
    
//     // Test utilities
//     function assertEqual(actual, expected, message) {
//       if (JSON.stringify(actual) === JSON.stringify(expected)) {
//         console.log("✓ PASS: " + message);
//         return true;
//       } else {
//         console.log("✗ FAIL: " + message);
//         console.log("  Expected:", expected);
//         console.log("  Actual:", actual);
//         return false;
//       }
//     }
    
//     // Function tests
//     function testFunctionName() {
//       console.log("Testing functionName...");
//       let result;
//       let passed = 0;
//       let total = 0;
      
//       // Test case 1
//       total++;
//       try {
//         result = functionName(params);
//         if (assertEqual(result, expectedResult, "Should return expected result")) {
//           passed++;
//         }
//       } catch (e) {
//         console.log("✗ FAIL: Unexpected error:", e.message);
//       }
      
//       console.log(passed + "/" + total + " tests passed for functionName");
//       return { passed, total };
//     }
    
//     // Run all tests
//     function runAllTests() {
//       const results = [];
//       results.push(testFunction1());
//       results.push(testFunction2());
      
//       const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
//       const totalTests = results.reduce((sum, r) => sum + r.total, 0);
      
//       console.log(totalPassed + "/" + totalTests + " total tests passed");
//       return { passed: totalPassed, total: totalTests };
//     }
    
//     runAllTests();
//   `;
  
//   const response = await invokeModel(model, prompt);
  
//   // Extract the test code from the response
//   let testCode = response.content.trim();
  
//   // Clean up code block markers if present
//   testCode = testCode.replace(/^```(?:javascript|js)?|```$/gm, '').trim();
  
//   // Do a quick syntax check
//   try {
//     new Function(testCode);
//     console.log("✓ Improved test code syntax is valid");
//   } catch (error) {
//     console.log(`Warning: Improved test code still has syntax issues: ${(error as Error).message}`);
    
//     // Last resort - create extremely basic tests
//     testCode = createBasicTests(functionNames, functionDesign);
//   }
  
//   const testGenerationTime = Date.now() - startTime;
//   console.log(`✅ Improved test generation completed in ${testGenerationTime}ms`);
  
//   return {
//     testCode,
//     testGenerationTime
//   };
// };

/**
 * Create extremely basic tests as a fallback when generated tests fail
 * @param {string[]} functionNames - List of function names to test
 * @param {FunctionDesign} [functionDesign] - Optional function design information
 * @returns {string} Basic test code that should execute without errors
 */
export const createBasicTests = (functionNames: string[], functionDesign?: FunctionDesign): string => {
  console.log("⚠️ Creating basic fallback tests...");
  
  // Generate a test stub for each function
  const functionTests = functionNames.map(fnName => {
    // Find the function design if available
    const designDoc = functionDesign?.functions.find(fn => fn.name === fnName);
    const purposeComment = designDoc ? 
      `\n  // Function purpose: ${designDoc.purpose}\n  // Testing if it fulfills this purpose` : '';
      
    return `
function test${fnName}() {
  console.log("Testing ${fnName}...");${purposeComment}
  try {
    // Basic existence check
    if (typeof ${fnName} === 'function') {
      console.log("✓ PASS: ${fnName} function exists");
      return { passed: 1, total: 1 };
    } else {
      console.log("✗ FAIL: ${fnName} function not found");
      return { passed: 0, total: 1 };
    }
  } catch (e) {
    console.log("✗ ERROR testing ${fnName}:", e.message);
    return { passed: 0, total: 1 };
  }
}`;
  }).join('\n');
  
  // Create a minimal test runner
  const testRunner = `
function runAllTests() {
  console.log("Running basic functionality tests");
  const results = [];
  ${functionNames.map(fnName => `results.push(test${fnName}());`).join('\n  ')}
  
  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
  const totalTests = results.reduce((sum, r) => sum + r.total, 0);
  
  console.log(totalPassed + "/" + totalTests + " basic tests passed");
  return { passed: totalPassed, total: totalTests };
}

runAllTests();
`;
  
  return functionTests + '\n' + testRunner;
};

/**
 * Generate black-box tests based only on function signatures and design requirements,
 * without knowledge of the implementation details.
 * @param {BaseChatModel} model - The language model to use
 * @param {TestGenerationParams} params - Parameters including game specification, state schema, and function signatures
 * @returns {Promise<TestGenerationResult>} Test code and timing information
 */
export const generateBlackBoxTests = async (
  model: BaseChatModel, 
  params: TestGenerationParams
): Promise<TestGenerationResult> => {
  const { gameSpecification, stateSchema, functionDesign, functionSignatures } = params;
  console.log("🧪 Stage 6: Generating black-box tests...");
  const startTime = Date.now();
  
  if (!functionDesign && !functionSignatures) {
    console.log("Error: Black-box testing requires either functionDesign or functionSignatures");
    throw new Error("Cannot generate black-box tests without function design or signatures");
  }
  
  // Extract function descriptions and signatures for testing
  let functionRequirements = '';
  let functionList = '';
  
  if (functionDesign) {
    console.log("Using function design information to generate pure black-box tests");
    
    // Extract function names for test creation
    functionList = functionDesign.functions.map(fn => fn.name).join(', ');
    
    // Create a structured representation of function requirements from the design docs
    functionRequirements = `
    Function Requirements:
    ${functionDesign.functions.map(fn => `
      ${fn.name}:
      - Purpose: ${fn.purpose}
      - Signature: ${fn.signature}
      - Importance: ${fn.importance}
      - Expected Behavior: Should fulfill its stated purpose
    `).join('\n')}
    `;
  } else if (functionSignatures) {
    console.log("Using function signatures to generate basic black-box tests");
    functionRequirements = `
    Function Signatures:
    ${functionSignatures}
    `;
    
    // Try to extract function names from signatures for function list
    const functionNameRegex = /function\s+([a-zA-Z0-9_]+)\s*\(/g;
    const matches = [...functionSignatures.matchAll(functionNameRegex)];
    functionList = matches.map(match => match[1]).join(', ');
  }
  
  // Create a prompt focused on black-box testing principles
  const prompt = `
    You are a test engineer creating comprehensive black-box tests for a ${gameSpecification} game library.
    
    Here's the state schema for the game:
    ${stateSchema.schema}
    
    ${functionRequirements}
    
    IMPORTANT: Your goal is to write true BLACK-BOX tests. You have no knowledge of the implementation
    details whatsoever. You only know the function signatures, state schema, and function requirements.
    
    Please write complete JavaScript test code that verifies:
    1. Each function correctly implements its stated purpose and requirements
    2. Functions work with expected valid inputs
    3. Error handling works correctly with invalid inputs
    4. Edge cases are properly handled
    5. Functions interact correctly when used together
    
    Your tests should:
    - Test each function independently based ONLY on its signature and stated purpose
    - Infer expected behavior from signatures, state schema, and requirements
    - Include integration tests for function combinations where it makes sense
    - Use descriptive test names that explain what's being tested
    - Log test results clearly
    - Consider all possible edge cases based on the function signatures
    
    Write pure JavaScript test code - DO NOT use Jest, Mocha or any other testing framework.
    Use a simple approach with descriptive console logs and basic assertions.
    
    Return ONLY executable JavaScript code that can run directly. No markdown formatting or text explanations outside the code.
    `;
  
  const response = await invokeModel(model, prompt);
  
  // Extract the test code from the response
  let testCode = response.content.trim();
  
  // Clean up code block markers if present
  testCode = testCode.replace(/^```(?:javascript|js)?|```$/gm, '').trim();
  
  // Validate that we have proper test code with basic syntax checking
  try {
    // Simple syntax check, will throw if invalid
    new Function(testCode);
    
    // Check if there are at least a few test sections
    const testPattern = /function\s+test|describe|it\s*\(|assert|expect|console\.log\(\s*["']Test/g;
    const testMatches = testCode.match(testPattern);
    
    if (!testMatches || testMatches.length < 3) {
      // If we don't have enough test patterns, try to regenerate with more explicit instructions
      console.log("Warning: Generated black-box tests don't seem comprehensive. Trying to improve...");
      return generateImprovedBlackBoxTests(model, params);
    }
  } catch (error) {
    // If there's a syntax error in the test code, try to regenerate with better instructions
    console.log(`Warning: Generated black-box test code has syntax error: ${(error as Error).message}. Regenerating...`);
    return generateImprovedBlackBoxTests(model, params);
  }
  
  const testGenerationTime = Date.now() - startTime;
  console.log(`✅ Black-box test generation completed in ${testGenerationTime}ms`);
  
  return {
    testCode,
    testGenerationTime
  };
};

/**
 * Generate improved black-box tests with more explicit instructions
 * @param {BaseChatModel} model - The language model to use
 * @param {TestGenerationParams} params - Parameters for test generation
 * @returns {Promise<TestGenerationResult>} Improved test code and timing information
 */
export const generateImprovedBlackBoxTests = async (
  model: BaseChatModel, 
  params: TestGenerationParams
): Promise<TestGenerationResult> => {
  const { gameSpecification, stateSchema, functionDesign, functionSignatures } = params;
  console.log("🔄 Generating improved black-box tests...");
  const startTime = Date.now();
  
  // Extract function names for test creation
  let functionNames: string[] = [];
  let functionRequirements = '';
  
  if (functionDesign) {
    functionNames = functionDesign.functions.map(fn => fn.name);
    
    // Create function requirements section
    functionRequirements = `
    Important - Test against these function requirements without knowing the implementation:
    ${functionDesign.functions.map(fn => `
    ${fn.name}:
    - Purpose: ${fn.purpose || 'Not specified'}
    - Signature: ${fn.signature || 'Not specified'}
    - Expected behavior: This function should correctly fulfill its purpose as described
    `).join('\n')}
    
    Remember: You are writing true black-box tests. You must verify that each function properly implements 
    its stated purpose WITHOUT knowledge of its implementation details.
    `;
  } else if (functionSignatures) {
    // Extract function names from signatures
    const functionNameRegex = /function\s+([a-zA-Z0-9_]+)\s*\(/g;
    const matches = [...functionSignatures.matchAll(functionNameRegex)];
    functionNames = matches.map(match => match[1]);
    
    functionRequirements = `
    Important - You only know these function signatures, not their implementation:
    ${functionSignatures}
    
    Test each function based only on what can be inferred from its signature and the game's state schema.
    `;
  }
  
  const functionList = functionNames.join(', ');
  
  const prompt = `
    You are a test engineer creating comprehensive BLACK-BOX tests for a ${gameSpecification} game library.
    You need to test these functions: ${functionList}
    
    Here's the state schema for the game:
    ${stateSchema.schema}
    
    ${functionRequirements}
    
    BLACK-BOX TESTING PRINCIPLES:
    - Tests should validate that functions meet their requirements, not how they're implemented
    - You have NO knowledge of implementation details
    - Tests should be derived from specifications and signatures only
    - Tests should check both normal operation and edge cases
    
    Please write simple, valid JavaScript test code that:
    1. Creates a test runner that logs results clearly
    2. Tests each function individually with multiple test cases
    3. Includes basic integration tests showing functions working together where appropriate
    4. Verifies each function correctly implements its purpose stated in the requirements
    
    IMPORTANT:
    - Use ONLY standard JavaScript (no testing frameworks like Jest/Mocha)
    - Make sure your code has NO syntax errors
    - Use simple if/else assertions with console.log output
    - Wrap your test code in a function that runs all tests
    - DO NOT use template literals with backticks for multi-line strings
    - DO NOT use any unusual JavaScript features that might cause parsing errors
    - Focus ONLY on testing against the requirements, not implementation details
    
    Structure your code like this:
    
    // Test utilities
    function assertEqual(actual, expected, message) {
      if (JSON.stringify(actual) === JSON.stringify(expected)) {
        console.log("✓ PASS: " + message);
        return true;
      } else {
        console.log("✗ FAIL: " + message);
        console.log("  Expected:", expected);
        console.log("  Actual:", actual);
        return false;
      }
    }
    
    // Function tests
    function testFunctionName() {
      console.log("Testing functionName...");
      let result;
      let passed = 0;
      let total = 0;
      
      // Test case 1 - Test against the function's purpose, not implementation
      total++;
      try {
        result = functionName(params);
        if (assertEqual(result, expectedResult, "Should fulfill its purpose by returning expected result")) {
          passed++;
        }
      } catch (e) {
        console.log("✗ FAIL: Unexpected error:", e.message);
      }
      
      console.log(passed + "/" + total + " tests passed for functionName");
      return { passed, total };
    }
    
    // Run all tests
    function runAllTests() {
      const results = [];
      results.push(testFunction1());
      results.push(testFunction2());
      
      const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
      const totalTests = results.reduce((sum, r) => sum + r.total, 0);
      
      console.log(totalPassed + "/" + totalTests + " total tests passed");
      return { passed: totalPassed, total: totalTests };
    }
    
    runAllTests();
  `;
  
  const response = await invokeModel(model, prompt);
  
  // Extract the test code from the response
  let testCode = response.content.trim();
  
  // Clean up code block markers if present
  testCode = testCode.replace(/^```(?:javascript|js)?|```$/gm, '').trim();
  
  // Do a quick syntax check
  try {
    new Function(testCode);
    console.log("✓ Improved black-box test code syntax is valid");
  } catch (error) {
    console.log(`Warning: Improved black-box test code still has syntax issues: ${(error as Error).message}`);
    
    // Last resort - create extremely basic tests
    testCode = createBasicTests(functionNames, functionDesign);
  }
  
  const testGenerationTime = Date.now() - startTime;
  console.log(`✅ Improved black-box test generation completed in ${testGenerationTime}ms`);
  
  return {
    testCode,
    testGenerationTime
  };
};

/**
 * Generates black-box tests for a function using only its signature and documentation
 * This version doesn't use any test frameworks and runs in the same sandbox as the functions
 * @param {string} functionSignature - The function signature to test
 * @param {string} functionDocs - The documentation for the function
 * @param {any} stateSchema - Schema defining the game state structure
 * @param {string[]} functionReferences - Optional references to how functions are used
 * @returns {Promise<string>} Generated test code
 */
export async function generateBlackBoxTestsStandalone(
  functionSignature: string,
  functionDocs: string,
  stateSchema: any,
  functionReferences: string[] = []
): Promise<string> {
  console.log("🧪 Generating standalone black-box tests for a single function...");
  const startTime = Date.now();
  
  // Extract function name from signature
  const functionName = extractFunctionName(functionSignature);
  if (!functionName) {
    throw new Error(`Could not extract function name from: ${functionSignature}`);
  }
  
  // Parse function signature to understand parameters and return type
  const { parameters, returnType } = parseFunctionSignature(functionSignature);

  // Generate test cases based on signature and docs
  const testCases = generateTestCasesFromSignature(parameters, returnType, functionDocs);
  
  // Build test code with the extracted information
  const testCode = generateStandaloneTestCode(functionName, parameters, returnType, testCases, functionDocs, stateSchema);
  
  const testGenerationTime = Date.now() - startTime;
  console.log(`✅ Black-box test generation for ${functionName} completed in ${testGenerationTime}ms`);
  
  return testCode;
}

/**
 * Extract the function name from a function signature
 * @param {string} signature - The function signature
 * @returns {string|null} The function name or null if not found
 */
function extractFunctionName(signature: string): string | null {
  // Match common function declaration patterns
  const functionMatches = signature.match(/(?:function|async function)?\s+(\w+)\s*\(/);
  if (functionMatches && functionMatches[1]) {
    return functionMatches[1];
  }
  
  // Try to match arrow functions or variable assignments
  const arrowMatches = signature.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async)?\s*\(?/);
  if (arrowMatches && arrowMatches[1]) {
    return arrowMatches[1];
  }
  
  // Try to match class methods
  const methodMatches = signature.match(/(?:public|private|protected|async)?\s*(\w+)\s*\(/);
  if (methodMatches && methodMatches[1]) {
    return methodMatches[1];
  }
  
  return null;
}

/**
 * Parse a function signature to extract parameter and return types
 * @param {string} signature - The function signature
 * @returns {{parameters: {name: string, type: string}[], returnType: string}} Parsed signature info
 */
function parseFunctionSignature(signature: string): {
  parameters: {name: string, type: string}[],
  returnType: string
} {
  // Extract parameter string between parentheses
  const paramMatch = signature.match(/\((.*?)\)/s);
  const paramString = paramMatch ? paramMatch[1] : '';
  
  // Split parameters and extract name/type pairs
  const parameters = paramString.split(',')
    .map(param => {
      const trimmed = param.trim();
      if (!trimmed) return null;
      
      // Handle complex parameter patterns
      let name, type;
      
      if (trimmed.includes(':')) {
        [name, type] = trimmed.split(':').map(p => p.trim());
        // Remove default values if present
        name = name.replace(/\s*=\s*.+$/, '');
      } else {
        name = trimmed;
        type = 'any';
      }
      
      return { 
        name: name.replace(/^readonly\s+/, ''), 
        type: type || 'any'
      };
    })
    .filter(Boolean) as {name: string, type: string}[];
  
  // Extract return type if present
  let returnType = 'any';
  const returnMatch = signature.match(/\)\s*:?\s*([^{=>]+)(?:[{=>]|$)/);
  if (returnMatch && returnMatch[1]) {
    returnType = returnMatch[1].trim();
  }
  
  return { parameters, returnType };
}

/**
 * Generate test cases based on function signature and documentation
 * @param {Array<{name: string, type: string}>} parameters - Function parameters
 * @param {string} returnType - Function return type
 * @param {string} functionDocs - Function documentation
 * @returns {Array<{description: string, inputs: Record<string, any>, expected: any}>} Generated test cases
 */
function generateTestCasesFromSignature(
  parameters: {name: string, type: string}[],
  returnType: string,
  functionDocs: string
): Array<{
  description: string,
  inputs: Record<string, any>,
  expected: any
}> {
  // Basic test cases array
  const testCases = [];
  
  // Happy path test case
  const happyPathCase = {
    description: 'should handle valid inputs correctly',
    inputs: {} as Record<string, any>,
    expected: generateSimpleMockValue(returnType)
  };
  
  // Generate basic valid inputs for each parameter
  parameters.forEach(param => {
    happyPathCase.inputs[param.name] = generateSimpleMockValue(param.type);
  });
  
  testCases.push(happyPathCase);
  
  // Add edge cases for each parameter type
  parameters.forEach(param => {
    // For strings, test empty string
    if (param.type.includes('string')) {
      testCases.push({
        description: `should handle empty string for ${param.name}`,
        inputs: { ...happyPathCase.inputs, [param.name]: '' },
        expected: generateSimpleMockValue(returnType)
      });
    }
    
    // For numbers, test 0 and negative values
    if (param.type.includes('number')) {
      testCases.push({
        description: `should handle zero value for ${param.name}`,
        inputs: { ...happyPathCase.inputs, [param.name]: 0 },
        expected: generateSimpleMockValue(returnType)
      });
      
      testCases.push({
        description: `should handle negative value for ${param.name}`,
        inputs: { ...happyPathCase.inputs, [param.name]: -1 },
        expected: generateSimpleMockValue(returnType)
      });
    }
    
    // For arrays, test empty array
    if (param.type.includes('array') || param.type.includes('[]')) {
      testCases.push({
        description: `should handle empty array for ${param.name}`,
        inputs: { ...happyPathCase.inputs, [param.name]: [] },
        expected: generateSimpleMockValue(returnType)
      });
    }
    
    // For objects, test empty object
    if (param.type.includes('object')) {
      testCases.push({
        description: `should handle empty object for ${param.name}`,
        inputs: { ...happyPathCase.inputs, [param.name]: {} },
        expected: generateSimpleMockValue(returnType)
      });
    }
    
    // Check if parameter appears optional in the documentation or signature
    const isOptional = 
      functionDocs.toLowerCase().includes(`${param.name} optional`) || 
      functionDocs.toLowerCase().includes(`${param.name}?`) ||
      param.name.includes('?');
      
    if (isOptional) {
      // Test undefined for optional parameters
      testCases.push({
        description: `should handle undefined ${param.name}`,
        inputs: { ...happyPathCase.inputs, [param.name]: undefined },
        expected: generateSimpleMockValue(returnType)
      });
    } else {
      // For required parameters, test missing parameter should cause error
      // This will be used in the test code to verify error handling
      testCases.push({
        description: `should handle missing required parameter ${param.name}`,
        inputs: Object.fromEntries(
          Object.entries(happyPathCase.inputs).filter(([key]) => key !== param.name)
        ),
        expected: 'ERROR' // Signal that we expect an error
      });
    }
  });
  
  return testCases;
}

/**
 * Generate a simple mock value for a given type
 * @param {string} type - The type to generate a value for
 * @returns {any} A mock value
 */
function generateSimpleMockValue(type: string): any {
  type = type.trim().toLowerCase();
  
  if (type.includes('void')) {
    return undefined;
  }
  
  if (type.includes('string')) {
    return 'test-value';
  }
  
  if (type.includes('number')) {
    return 42;
  }
  
  if (type.includes('boolean')) {
    return true;
  }
  
  if (type.includes('array') || type.includes('[]')) {
    // If array has specified type, try to extract it
    const itemType = type.match(/array<(.+?)>|(.+?)\[\]/i);
    if (itemType && (itemType[1] || itemType[2])) {
      const actualItemType = (itemType[1] || itemType[2]).trim();
      return [generateSimpleMockValue(actualItemType)];
    }
    return ['item1', 'item2'];
  }
  
  if (type.includes('object')) {
    return { key: 'value' };
  }
  
  if (type.includes('state') || type.includes('game')) {
    return { 
      players: { player1: { score: 0 } },
      gameState: 'active',
      turn: 1
    };
  }
  
  if (type.includes('function')) {
    return function mockFn() { return true; };
  }
  
  if (type.includes('date')) {
    return new Date('2023-01-01');
  }
  
  if (type.includes('promise')) {
    // Extract inner type if possible
    const innerType = type.match(/promise<(.+?)>/i);
    if (innerType && innerType[1]) {
      return Promise.resolve(generateSimpleMockValue(innerType[1]));
    }
    return Promise.resolve('resolved-value');
  }
  
  // Default for any type
  return 'mock-value';
}

/**
 * Generate standalone test code for a function
 * @param {string} functionName - Name of the function to test
 * @param {Array<{name: string, type: string}>} parameters - Function parameters
 * @param {string} returnType - Function return type
 * @param {Array<{description: string, inputs: Record<string, any>, expected: any}>} testCases - Test cases 
 * @param {string} functionDocs - Function documentation
 * @param {any} stateSchema - State schema for the game
 * @returns {string} Generated test code
 */
function generateStandaloneTestCode(
  functionName: string,
  parameters: {name: string, type: string}[],
  returnType: string,
  testCases: Array<{description: string, inputs: Record<string, any>, expected: any}>,
  functionDocs: string,
  stateSchema: any
): string {
  // Create a basic test framework with assertion helpers
  const testHeader = `
// Black-box tests for ${functionName}
// Generated from function signature and documentation only
// These tests verify the function's design without knowledge of its implementation

// Test utilities
function assertEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  
  if (actualStr === expectedStr) {
    console.log("✓ PASS:", message);
    return true;
  } else {
    console.log("✗ FAIL:", message);
    console.log("  Expected:", expected);
    console.log("  Actual:", actual);
    return false;
  }
}

function assertType(value, type, message) {
  let passed = false;
  
  switch(type.toLowerCase()) {
    case 'string':
      passed = typeof value === 'string';
      break;
    case 'number':
      passed = typeof value === 'number' && !isNaN(value);
      break;
    case 'boolean':
      passed = typeof value === 'boolean';
      break;
    case 'array':
    case '[]':
      passed = Array.isArray(value);
      break;
    case 'object':
      passed = typeof value === 'object' && value !== null && !Array.isArray(value);
      break;
    case 'function':
      passed = typeof value === 'function';
      break;
    default:
      // For complex types, just check it's not undefined
      passed = value !== undefined;
  }
  
  if (passed) {
    console.log("✓ PASS:", message);
    return true;
  } else {
    console.log("✗ FAIL:", message);
    console.log("  Expected type:", type);
    console.log("  Actual value:", value);
    return false;
  }
}

// Function purpose based on documentation:
// ${functionDocs.split('\n').join('\n// ')}
`;

  // Create the main test function
  const mainTestFunction = `
function test${functionName}() {
  console.log("\\n=== Testing ${functionName} ===");
  let passed = 0;
  let total = 0;
  let result;
  
  ${testCases.map(testCase => `
  // Test case: ${testCase.description}
  total++;
  try {
    ${testCase.expected === 'ERROR' ? 
      `// This test should cause an error because it's missing required parameters
    try {
      result = ${functionName}(${Object.entries(testCase.inputs).map(([key, value]) => 
        JSON.stringify(value)).join(', ')});
      console.log("✗ FAIL: Expected an error but function executed without error");
    } catch(e) {
      console.log("✓ PASS: Function correctly threw error for missing required parameter");
      passed++;
    }` : 
      `result = ${functionName}(${Object.entries(testCase.inputs).map(([key, value]) => 
        JSON.stringify(value)).join(', ')});
    
    // For this test case we expect the function to return a value matching: ${JSON.stringify(testCase.expected)}
    // Since we don't know the exact return value (black-box testing), we check the type is correct
    ${returnType.includes('void') ? 
      `if (result === undefined) {
      console.log("✓ PASS: Function correctly returns void");
      passed++;
    }` :
      `if (assertType(result, "${returnType.replace(/Promise<(.+)>/, '$1')}", "Function returns expected type")) {
      passed++;
    }`}
    `}
  } catch(e) {
    console.log("✗ FAIL: Unexpected error:", e.message);
  }
  `).join('\n  ')}
  
  console.log("\\nResults for ${functionName}: " + passed + "/" + total + " tests passed");
  return { function: "${functionName}", passed, total };
}
`;

  // Create a simple test runner
  const testRunner = `
// Run the tests
function runTests() {
  const results = [];
  results.push(test${functionName}());
  
  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
  const totalTests = results.reduce((sum, r) => sum + r.total, 0);
  
  console.log("\\n=== Test Summary ===");
  console.log(\`\${totalPassed}/\${totalTests} tests passed\`);
  return { passed: totalPassed, total: totalTests };
}

runTests();
`;

  return testHeader + mainTestFunction + testRunner;
}