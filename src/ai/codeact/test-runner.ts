import { safeExecute, ExecutionResult } from './utils.js';

/**
 * Code validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  lineNumber?: number | null;
  codeContext?: string;
}

/**
 * Error details interface
 */
export interface ErrorDetails {
  diagnosis: string;
  lineNumber?: number | null;
  snippet?: string;
  suggestion?: string;
  errorLocation?: string;
}

/**
 * Test result interface
 */
export interface TestResult {
  success: boolean;
  error?: string;
  errorDetails?: ErrorDetails;
  testResults?: any;
  logs?: string[];
  testRuntime: number;
}

/**
 * Validates the syntax of JavaScript code without executing it
 * @param {string} code - The code to validate
 * @returns {ValidationResult} Validation result with success flag and error details
 */
export const validateCodeSyntax = (code: string): ValidationResult => {
  try {
    // Use Function constructor to check syntax without executing
    new Function(code);
    return { valid: true };
  } catch (error) {
    // Extract line number and location from error message
    const errorMessage = (error as Error).message;
    const lineMatch = errorMessage.match(/line\s+(\d+)/i);
    const lineNumber = lineMatch ? parseInt(lineMatch[1]) : null;
    
    // Get code snippet around the error
    let codeContext = "";
    if (lineNumber) {
      const lines = code.split('\n');
      const start = Math.max(0, lineNumber - 3);
      const end = Math.min(lines.length, lineNumber + 2);
      const contextLines = lines.slice(start, end);
      codeContext = contextLines.map((line, i) => {
        const currentLineNumber = start + i + 1;
        const marker = currentLineNumber === lineNumber ? '> ' : '  ';
        return `${marker}${currentLineNumber}: ${line}`;
      }).join('\n');
    }
    
    return {
      valid: false,
      error: errorMessage,
      lineNumber,
      codeContext
    };
  }
};

/**
 * Stage 7: Run tests for implemented functions
 * @param {string} implementation - The implemented functions code
 * @param {string} testCode - The test code to execute
 * @returns {Promise<TestResult>} Test results and timing information
 */
export const runTests = async (implementation: string, testCode: string): Promise<TestResult> => {
  console.log("🧪 Stage 7: Running tests...");
  const startTime = Date.now();
  
  // Validate both implementation and test code syntax before combining
  const implValidation = validateCodeSyntax(implementation);
  if (!implValidation.valid) {
    console.error("Syntax error in implementation code:", implValidation.error);
    console.error(implValidation.codeContext);
    return {
      success: false,
      error: `Syntax error in implementation: ${implValidation.error}`,
      testResults: null,
      testRuntime: Date.now() - startTime
    };
  }
  
  const testValidation = validateCodeSyntax(testCode);
  if (!testValidation.valid) {
    console.error("Syntax error in test code:", testValidation.error);
    console.error(testValidation.codeContext);
    return {
      success: false, 
      error: `Syntax error in tests: ${testValidation.error}`,
      testResults: null,
      testRuntime: Date.now() - startTime
    };
  }
  
  // Combine implementation and test code
  const combinedCode = `
    ${implementation}
    
    // Begin test code
    ${testCode}
  `;
  
  // Final validation of combined code
  const combinedValidation = validateCodeSyntax(combinedCode);
  if (!combinedValidation.valid) {
    console.error("Syntax error in combined code:", combinedValidation.error);
    console.error(combinedValidation.codeContext);
    
    // Try to diagnose the error in more detail
    const errorDetails = diagnoseSyntaxError(combinedCode, combinedValidation.error as string);
    
    return {
      success: false,
      error: `Syntax error in combined code: ${combinedValidation.error}`,
      errorDetails,
      testResults: null,
      testRuntime: Date.now() - startTime
    };
  }
  
  // Execute the tests
  try {
    console.log("Executing tests...");
    const result = await safeExecute(combinedCode, {}, 30000);  // 30-second timeout
    
    if (result.error) {
      console.error("Error running tests:", result.error);
      
      // Attempt to diagnose runtime errors
      const errorDetails = diagnoseRuntimeError(result.error, combinedCode);
      
      return {
        success: false,
        error: `Runtime error: ${result.error}`,
        errorDetails,
        logs: result.logs,
        testRuntime: Date.now() - startTime
      };
    }
    
    const testRuntime = Date.now() - startTime;
    console.log(`✅ Test execution completed in ${testRuntime}ms`);
    
    return {
      success: true,
      testResults: result.result,
      logs: result.logs,
      testRuntime
    };
  } catch (error) {
    console.error("Exception during test execution:", error);
    return {
      success: false,
      error: `Exception: ${(error as Error).message}`,
      testResults: null,
      testRuntime: Date.now() - startTime
    };
  }
};

/**
 * Diagnose syntax error in more detail
 * @param {string} code - The code with syntax error
 * @param {string} errorMessage - The error message
 * @returns {ErrorDetails} Detailed error information
 */
export const diagnoseSyntaxError = (code: string, errorMessage: string): ErrorDetails => {
  // Extract line number if available
  const lineMatch = errorMessage.match(/line\s+(\d+)/i);
  const lineNumber = lineMatch ? parseInt(lineMatch[1]) : null;
  
  let diagnosis = "Syntax error detected";
  let snippet = "";
  let suggestion = "";
  
  // Common syntax errors and suggestions
  if (errorMessage.includes("Unexpected token")) {
    diagnosis = "Unexpected token or character";
    suggestion = "Check for mismatched brackets, quotes, or invalid syntax";
  } else if (errorMessage.includes("Unexpected end of input")) {
    diagnosis = "Unexpected end of code";
    suggestion = "Check for missing closing brackets, parentheses, or braces";
  } else if (errorMessage.includes("Invalid or unexpected token")) {
    diagnosis = "Invalid character or token";
    suggestion = "Check for special characters, invalid Unicode, or mismatched quotes";
  }
  
  // If we have a line number, extract the relevant code snippet
  if (lineNumber) {
    const lines = code.split('\n');
    const startLine = Math.max(0, lineNumber - 5);
    const endLine = Math.min(lines.length, lineNumber + 5);
    
    for (let i = startLine; i < endLine; i++) {
      // Add a marker for the problematic line
      const lineIndicator = i === lineNumber - 1 ? " >>> " : "     ";
      snippet += `${lineIndicator}${i + 1}: ${lines[i]}\n`;
    }
    
    // Try to pinpoint column if possible
    const columnMatch = errorMessage.match(/column\s+(\d+)/i);
    const column = columnMatch ? parseInt(columnMatch[1]) : null;
    
    if (column && lineNumber <= lines.length) {
      const errorLine = lines[lineNumber - 1];
      const pointerLine = " ".repeat(column + 10) + "^--- Possible error here";
      snippet += pointerLine + "\n";
    }
  }
  
  return {
    diagnosis,
    lineNumber,
    snippet,
    suggestion
  };
};

/**
 * Diagnose runtime error in more detail
 * @param {string} errorMessage - The error message
 * @param {string} code - The code with runtime error
 * @returns {ErrorDetails} Detailed error information
 */
export const diagnoseRuntimeError = (errorMessage: string, code: string): ErrorDetails => {
  let diagnosis = "Runtime error detected";
  let suggestion = "";
  
  // Common runtime errors and suggestions
  if (errorMessage.includes("is not defined")) {
    const varMatch = errorMessage.match(/(\w+) is not defined/);
    const varName = varMatch ? varMatch[1] : "A variable";
    diagnosis = `Reference Error: ${varName} is not defined`;
    suggestion = `Check that ${varName} is declared before use, or check for typos`;
  } else if (errorMessage.includes("is not a function")) {
    const fnMatch = errorMessage.match(/(\w+) is not a function/);
    const fnName = fnMatch ? fnMatch[1] : "A function";
    diagnosis = `Type Error: Tried to call ${fnName} which is not a function`;
    suggestion = `Check if ${fnName} is defined correctly and is actually a function`;
  } else if (errorMessage.includes("cannot read property") || errorMessage.includes("Cannot read properties")) {
    diagnosis = "Trying to access a property of null or undefined";
    suggestion = "Check for null/undefined values before accessing their properties";
  }
  
  // Stack trace or error line extraction
  let errorLocation = "";
  const stackLines = errorMessage.split('\n').filter(line => line.includes('at '));
  if (stackLines.length > 0) {
    errorLocation = stackLines[0].trim();
  }
  
  return {
    diagnosis,
    suggestion,
    errorLocation
  };
};