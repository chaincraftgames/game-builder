import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { invokeModel, extractImplementedFunctions } from './utils.js';
import { StateSchemaResult } from './schema-designer.js';

/**
 * Test generation parameters interface
 */
export interface TestGenerationParams {
  gameSpecification: string;
  stateSchema: StateSchemaResult;
  implementation: string;
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
export const generateTests = async (
  model: BaseChatModel, 
  params: TestGenerationParams
): Promise<TestGenerationResult> => {
  const { gameSpecification, stateSchema, implementation } = params;
  console.log("🧪 Stage 6: Generating tests...");
  const startTime = Date.now();
  
  // Create a prompt to generate tests for the implemented functions
  const prompt = `
    You are a test engineer creating comprehensive tests for a ${gameSpecification} game library.
    
    Here's the state schema for the game:
    ${stateSchema.schema}
    
    And here are the implemented functions:
    ${implementation}
    
    Please write complete JavaScript test code that verifies:
    1. Each function works correctly with valid inputs
    2. Error handling works correctly with invalid inputs
    3. Edge cases are properly handled
    4. Functions interact correctly when used together

    Your tests should:
    - Test each function independently
    - Include integration tests for function combinations
    - Use descriptive test names that explain what's being tested
    - Log test results clearly
    - Consider all possible edge cases

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
      console.log("Warning: Generated tests don't seem comprehensive. Trying to improve...");
      return generateImprovedTests(model, gameSpecification, stateSchema, implementation);
    }
  } catch (error) {
    // If there's a syntax error in the test code, try to regenerate with better instructions
    console.log(`Warning: Generated test code has syntax error: ${(error as Error).message}. Regenerating...`);
    return generateImprovedTests(model, gameSpecification, stateSchema, implementation);
  }
  
  const testGenerationTime = Date.now() - startTime;
  console.log(`✅ Test generation completed in ${testGenerationTime}ms`);
  
  return {
    testCode,
    testGenerationTime
  };
};

/**
 * Generate improved tests with more explicit instructions
 * @param {BaseChatModel} model - The language model to use
 * @param {string} gameSpecification - The game specification
 * @param {StateSchemaResult} stateSchema - The state schema object
 * @param {string} implementation - The implemented functions code
 * @returns {Promise<TestGenerationResult>} Improved test code and timing information
 */
export const generateImprovedTests = async (
  model: BaseChatModel, 
  gameSpecification: string, 
  stateSchema: StateSchemaResult, 
  implementation: string
): Promise<TestGenerationResult> => {
  console.log("🔄 Generating improved tests...");
  const startTime = Date.now();
  
  // Extract function names to explicitly test each one
  const functionNames = extractImplementedFunctions(implementation);
  const functionList = functionNames.join(', ');
  
  const prompt = `
    You are a test engineer creating comprehensive tests for a ${gameSpecification} game library.
    The implementation has these functions: ${functionList}
    
    Here's the state schema for the game:
    ${stateSchema.schema}
    
    And here are the implemented functions:
    ${implementation}
    
    Please write simple, valid JavaScript test code that:
    1. Creates a test runner that logs results clearly
    2. Tests each function individually with multiple test cases
    3. Includes basic integration tests showing functions working together
    
    IMPORTANT:
    - Use ONLY standard JavaScript (no testing frameworks like Jest/Mocha)
    - Make sure your code has NO syntax errors
    - Use simple if/else assertions with console.log output
    - Wrap your test code in a function that runs all tests
    - DO NOT use template literals with backticks for multi-line strings
    - DO NOT use any unusual JavaScript features that might cause parsing errors
    
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
      
      // Test case 1
      total++;
      try {
        result = functionName(params);
        if (assertEqual(result, expectedResult, "Should return expected result")) {
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
    console.log("✓ Improved test code syntax is valid");
  } catch (error) {
    console.log(`Warning: Improved test code still has syntax issues: ${(error as Error).message}`);
    
    // Last resort - create extremely basic tests
    testCode = createBasicTests(functionNames);
  }
  
  const testGenerationTime = Date.now() - startTime;
  console.log(`✅ Improved test generation completed in ${testGenerationTime}ms`);
  
  return {
    testCode,
    testGenerationTime
  };
};

/**
 * Create extremely basic tests as a fallback when generated tests fail
 * @param {string[]} functionNames - List of function names to test
 * @returns {string} Basic test code that should execute without errors
 */
export const createBasicTests = (functionNames: string[]): string => {
  console.log("⚠️ Creating basic fallback tests...");
  
  // Generate a test stub for each function
  const functionTests = functionNames.map(fnName => {
    return `
function test${fnName}() {
  console.log("Testing ${fnName}...");
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