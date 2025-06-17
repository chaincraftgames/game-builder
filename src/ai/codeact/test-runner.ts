import { safeExecute, ExecutionResult } from './utils.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Code validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  lineNumber?: number | null;
  codeContext?: string;
  codeSection?: 'implementation' | 'tests' | 'combined';
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
  codeSection?: 'implementation' | 'tests' | 'combined';
  relevantCode?: string;
  debugFilePath?: string; // Path to the debug file where the code is saved
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
  codeInfo?: {
    implementationLength: number;
    testLength: number;
    implementationFirstLines?: string;
    testFirstLines?: string;
  };
  debugFiles?: {
    implementation?: string;
    test?: string;
    combined?: string;
  };
}

/**
 * Writes code to a temporary file for debugging
 * @param {string} code - The code to write to a file
 * @param {string} prefix - File name prefix
 * @returns {string} The path to the created temp file
 */
function writeToDebugFile(code: string, prefix: string): string {
  try {
    // Create a timestamped directory to store debug files
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const debugDir = path.join(os.tmpdir(), 'chaincraft-debug', timestamp);
    
    // Ensure the directory exists
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    
    // Create the file path with timestamp
    const filePath = path.join(debugDir, `${prefix}.js`);
    
    // Write the code to the file
    fs.writeFileSync(filePath, code);
    
    console.log(`Debug file written to: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error(`Error writing debug file: ${(error as Error).message}`);
    return '';
  }
}

/**
 * Validates the syntax of JavaScript code without executing it
 * @param {string} code - The code to validate
 * @param {'implementation' | 'tests' | 'combined'} codeSection - Identifies which section of code is being validated
 * @returns {ValidationResult} Validation result with success flag and error details
 */
export const validateCodeSyntax = (code: string, codeSection: 'implementation' | 'tests' | 'combined'): ValidationResult => {
  try {
    // Use Function constructor to check syntax without executing
    new Function(code);
    return { valid: true, codeSection };
  } catch (error) {
    // Extract line number and location from error message
    const errorMessage = (error as Error).message;
    const lineMatch = errorMessage.match(/line\s+(\d+)/i);
    const lineNumber = lineMatch ? parseInt(lineMatch[1]) : null;
    
    // Get code snippet around the error
    let codeContext = "";
    if (lineNumber) {
      const lines = code.split('\n');
      const start = Math.max(0, lineNumber - 5);
      const end = Math.min(lines.length, lineNumber + 5);
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
      codeContext,
      codeSection
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
  
  // Write implementation and test code to debug files
  const implementationFilePath = writeToDebugFile(implementation, 'implementation');
  const testFilePath = writeToDebugFile(testCode, 'tests');
  
  // Generate some basic code info to help with debugging
  const codeInfo = {
    implementationLength: implementation.split('\n').length,
    testLength: testCode.split('\n').length,
    implementationFirstLines: undefined, // Don't include code snippets in output
    testFirstLines: undefined
  };
  
  // Debug files info
  const debugFiles = {
    implementation: implementationFilePath,
    test: testFilePath,
    combined: '' // Initialize the combined property
  };
  
  // Validate implementation code syntax
  const implValidation = validateCodeSyntax(implementation, 'implementation');
  if (!implValidation.valid) {
    console.error("❌ Syntax error in implementation code:", implValidation.error);
    if (implValidation.codeContext) {
      console.error("Context around error:");
      console.error(implValidation.codeContext);
    }
    console.error(`Full implementation code available at: ${implementationFilePath}`);
    
    // Get detailed error diagnosis
    const errorDetails = diagnoseSyntaxError(
      implementation, 
      implValidation.error || 'Unknown syntax error', 
      'implementation'
    );
    
    // Add debug file path to error details
    errorDetails.debugFilePath = implementationFilePath;
    
    return {
      success: false,
      error: `Syntax error in implementation: ${implValidation.error}`,
      errorDetails,
      testResults: null,
      testRuntime: Date.now() - startTime,
      codeInfo,
      debugFiles
    };
  }
  
  // Validate test code syntax
  const testValidation = validateCodeSyntax(testCode, 'tests');
  if (!testValidation.valid) {
    console.error("❌ Syntax error in test code:", testValidation.error);
    if (testValidation.codeContext) {
      console.error("Context around error:");
      console.error(testValidation.codeContext);
    }
    console.error(`Full test code available at: ${testFilePath}`);
    
    // Get detailed error diagnosis for test code
    const errorDetails = diagnoseSyntaxError(
      testCode, 
      testValidation.error || 'Unknown syntax error',
      'tests'
    );
    
    // Add debug file path to error details
    errorDetails.debugFilePath = testFilePath;
    
    return {
      success: false, 
      error: `Syntax error in tests: ${testValidation.error}`,
      errorDetails,
      testResults: null,
      testRuntime: Date.now() - startTime,
      codeInfo,
      debugFiles
    };
  }
  
  // Combine implementation and test code
  const combinedCode = `
    ${implementation}
    
    // Begin test code
    ${testCode}
  `;
  
  // Write combined code to a debug file
  const combinedFilePath = writeToDebugFile(combinedCode, 'combined');
  debugFiles.combined = combinedFilePath;
  
  // Final validation of combined code
  const combinedValidation = validateCodeSyntax(combinedCode, 'combined');
  if (!combinedValidation.valid) {
    console.error("❌ Syntax error in combined code:", combinedValidation.error);
    if (combinedValidation.codeContext) {
      console.error("Context around error:");
      console.error(combinedValidation.codeContext);
    }
    console.error(`Full combined code available at: ${combinedFilePath}`);
    
    // Figure out if error occurs in implementation or tests section based on line number
    const errorSection = determineErrorSection(combinedValidation.lineNumber, implementation.split('\n').length);
    
    // Try to diagnose the error in more detail
    const errorDetails = diagnoseSyntaxError(
      combinedCode, 
      combinedValidation.error || 'Unknown syntax error',
      errorSection
    );
    
    // Add debug file path to error details
    errorDetails.debugFilePath = combinedFilePath;
    
    return {
      success: false,
      error: `Syntax error in ${errorSection} code: ${combinedValidation.error} (see ${errorSection === 'implementation' ? implementationFilePath : testFilePath})`,
      errorDetails,
      testResults: null,
      testRuntime: Date.now() - startTime,
      codeInfo,
      debugFiles
    };
  }
  
  // Execute the tests
  try {
    console.log("Executing tests from files:");
    console.log(`- Implementation: ${implementationFilePath}`);
    console.log(`- Tests: ${testFilePath}`);
    console.log(`- Combined: ${combinedFilePath}`);
    
    const result = await safeExecute(combinedCode, {}, 30000);  // 30-second timeout
    
    if (result.error) {
      console.error("❌ Error running tests:", result.error);
      console.error(`Check debug files for more details: ${combinedFilePath}`);
      
      // Attempt to diagnose runtime errors
      const errorSection = determineRuntimeErrorSection(result.error, implementation.split('\n').length);
      const errorDetails = diagnoseRuntimeError(
        result.error, 
        combinedCode, 
        errorSection
      );
      
      // Add debug file path to error details
      errorDetails.debugFilePath = combinedFilePath;
      
      // Only show essential logs
      const relevantLogs = result.logs && result.logs.length > 0 
        ? result.logs.filter(log => log.includes('FAIL') || log.includes('Error:'))
        : ['No test output available before error occurred'];
      
      if (relevantLogs.length > 0) {
        console.error("Test error logs:");
        relevantLogs.forEach(log => console.error(`  ${log}`));
      }
      
      return {
        success: false,
        error: `Runtime error in ${errorSection}: ${result.error} (see ${errorSection === 'implementation' ? implementationFilePath : testFilePath})`,
        errorDetails,
        logs: result.logs, // Keep all logs in the result object
        testRuntime: Date.now() - startTime,
        codeInfo,
        debugFiles
      };
    }
    
    // Check if there are logs that might indicate test failures
    if (result.logs && result.logs.length > 0) {
      const failedTestCount = countFailedTests(result.logs);
      if (failedTestCount > 0) {
        console.log(`⚠️ ${failedTestCount} test failures detected. See logs for details.`);
      }
      
      // Print only summary lines from test results
      const summaryLines = result.logs.filter(log => 
        log.includes('total tests passed') || 
        log.includes('tests passed for') ||
        log.includes('=== Test Summary ===')
      );
      
      if (summaryLines.length > 0) {
        console.log("Test Summary:");
        summaryLines.forEach(line => console.log(`  ${line}`));
      }
    }
    
    const testRuntime = Date.now() - startTime;
    console.log(`✅ Test execution completed in ${testRuntime}ms`);
    
    return {
      success: true,
      testResults: result.result,
      logs: result.logs,
      testRuntime,
      debugFiles
    };
  } catch (error) {
    console.error("❌ Exception during test execution:", error);
    console.error(`Check debug files for more details: ${combinedFilePath}`);
    
    // Create more descriptive error details
    const errorDetails: ErrorDetails = {
      diagnosis: "Unhandled exception during test execution",
      suggestion: "Check for asynchronous code that might be failing or uncaught promise rejections",
      errorLocation: (error as Error).stack || "Unknown location",
      debugFilePath: combinedFilePath
    };
    
    return {
      success: false,
      error: `Exception during test execution: ${(error as Error).message} (see ${combinedFilePath})`,
      errorDetails,
      testResults: null,
      testRuntime: Date.now() - startTime,
      codeInfo,
      debugFiles
    };
  }
};

/**
 * Determines which section of the code contains the error based on line number
 * @param {number|null|undefined} lineNumber - Error line number
 * @param {number} implementationLineCount - Number of lines in implementation code
 * @returns {'implementation'|'tests'|'combined'} Which section contains the error
 */
function determineErrorSection(
  lineNumber: number | null | undefined, 
  implementationLineCount: number
): 'implementation' | 'tests' | 'combined' {
  if (!lineNumber) return 'combined'; // Can't determine if no line number
  
  // Account for the separation and comment line between implementation and test code
  const separatorLines = 3;
  
  if (lineNumber <= implementationLineCount + separatorLines) {
    return 'implementation';
  } else {
    return 'tests';
  }
}

/**
 * Analyzes runtime error stack trace to estimate which code section has the error
 * @param {string} errorMessage - The runtime error message or stack trace
 * @param {number} implementationLineCount - Number of lines in implementation code
 * @returns {'implementation'|'tests'|'combined'} Which section likely contains the error
 */
function determineRuntimeErrorSection(errorMessage: string, implementationLineCount: number): 'implementation' | 'tests' | 'combined' {
  // Try to extract line numbers from stack trace
  const lineMatches = errorMessage.match(/(?:line\s+|:)(\d+)(?::\d+)?/ig);
  if (lineMatches && lineMatches.length > 0) {
    // Extract the first line number reference
    const firstMatch = lineMatches[0];
    const lineNumber = parseInt(firstMatch.replace(/[^0-9]/g, ''));
    
    // Allow for extra lines added during combining
    const separatorLines = 3;
    
    if (lineNumber <= implementationLineCount + separatorLines) {
      return 'implementation';
    } else {
      return 'tests';
    }
  }
  
  // If we can't determine based on line numbers, analyze the error text
  if (errorMessage.includes('test') || 
      errorMessage.includes('assert') || 
      errorMessage.includes('expect') ||
      errorMessage.includes('should')) {
    return 'tests';
  }
  
  // Default to combined if we can't determine with confidence
  return 'combined';
}

/**
 * Counts the number of failed tests based on test output logs
 * @param {string[]} logs - Test output logs
 * @returns {number} Number of failed tests
 */
function countFailedTests(logs: string[]): number {
  const failIndicators = [
    '✗ FAIL', 
    'FAILED', 
    'not ok', 
    'fail', 
    'Error:', 
    'AssertionError',
    'does not equal',
    'Expected:',
    'Actual:'
  ];
  
  return logs.filter(log => 
    failIndicators.some(indicator => log.includes(indicator))
  ).length;
}

/**
 * Diagnose syntax error in more detail
 * @param {string} code - The code with syntax error
 * @param {string} errorMessage - The error message
 * @param {'implementation'|'tests'|'combined'} codeSection - Which section has the error
 * @returns {ErrorDetails} Detailed error information
 */
export const diagnoseSyntaxError = (
  code: string, 
  errorMessage: string,
  codeSection: 'implementation' | 'tests' | 'combined' = 'combined'
): ErrorDetails => {
  // Extract line number if available
  const lineMatch = errorMessage.match(/line\s+(\d+)/i);
  const lineNumber = lineMatch ? parseInt(lineMatch[1]) : null;
  
  let diagnosis = "Syntax error detected";
  let snippet = "";
  let suggestion = "";
  let relevantCode = "";
  
  // Common syntax errors and suggestions
  if (errorMessage.includes("Unexpected token")) {
    diagnosis = "Unexpected token or character in your code";
    suggestion = "Check for mismatched brackets, quotes, or invalid syntax near this line";
    
    // Check for common bracket mismatches
    if (countChars(code, '{') !== countChars(code, '}')) {
      suggestion += "\n- Mismatched curly braces: " + countChars(code, '{') + " opening '{' vs " + countChars(code, '}') + " closing '}'";
    }
    if (countChars(code, '(') !== countChars(code, ')')) {
      suggestion += "\n- Mismatched parentheses: " + countChars(code, '(') + " opening '(' vs " + countChars(code, ')') + " closing ')'";
    }
    if (countChars(code, '[') !== countChars(code, ']')) {
      suggestion += "\n- Mismatched square brackets: " + countChars(code, '[') + " opening '[' vs " + countChars(code, ']') + " closing ']'";
    }
    
  } else if (errorMessage.includes("Unexpected end of input")) {
    diagnosis = "Unexpected end of code - your code ends abruptly";
    suggestion = "Check for missing closing brackets, parentheses, or braces at the end of your code";
    
    // Check for unclosed blocks
    const lastFewLines = code.split('\n').slice(-20).join('\n');
    relevantCode = "Last few lines of code:\n" + lastFewLines;
    
  } else if (errorMessage.includes("Invalid or unexpected token")) {
    diagnosis = "Invalid character or token detected";
    suggestion = "Check for special characters, invalid Unicode characters, or mismatched quotes";
    
    // Check specifically for UTF-8 encoding issues
    if (code.includes('�') || code.includes('\uFFFD')) {
      suggestion += "\n- Found replacement characters (�) which indicate encoding issues";
    }
    
    // Check for common quote issues
    const singleQuotes = countChars(code, "'");
    const doubleQuotes = countChars(code, '"');
    const backTicks = countChars(code, '`');
    
    if (singleQuotes % 2 !== 0) {
      suggestion += "\n- Odd number of single quotes (') which suggests unclosed string";
    }
    if (doubleQuotes % 2 !== 0) {
      suggestion += "\n- Odd number of double quotes (\") which suggests unclosed string";
    }
    if (backTicks % 2 !== 0) {
      suggestion += "\n- Odd number of backticks (`) which suggests unclosed template literal";
    }
  } else if (errorMessage.includes("Identifier has already been declared")) {
    diagnosis = "Duplicate variable declaration";
    suggestion = "You've declared the same variable multiple times. Check for duplicate 'let', 'const', or 'var' declarations";
  } else if (errorMessage.includes("Missing initializer")) {
    diagnosis = "Missing value assignment for constant";
    suggestion = "You must assign a value when using 'const'. Change to 'let' or add an initial value";
  }
  
  // If we have a line number, extract the relevant code snippet
  if (lineNumber) {
    const lines = code.split('\n');
    const startLine = Math.max(0, lineNumber - 7);
    const endLine = Math.min(lines.length, lineNumber + 7);
    
    snippet = "Code context around error:\n";
    for (let i = startLine; i < endLine; i++) {
      // Add a marker for the problematic line
      const lineIndicator = i === lineNumber - 1 ? " >>> " : "     ";
      snippet += `${lineIndicator}${i + 1}: ${lines[i]}\n`;
      
      // For the error line, add more detailed markers if possible
      if (i === lineNumber - 1) {
        // Try to pinpoint column if available
        const columnMatch = errorMessage.match(/column\s+(\d+)/i);
        const column = columnMatch ? parseInt(columnMatch[1]) : null;
        
        if (column) {
          const pointerSpaces = Math.min(column + 9, 70); // Don't go too far right
          const pointer = " ".repeat(pointerSpaces) + "^--- Possible error location";
          snippet += pointer + "\n";
        }
      }
    }
    
    // Look for specific patterns near the error line
    if (lineNumber <= lines.length) {
      const errorLineContent = lines[lineNumber - 1];
      
      // Check for incomplete JSON/object issues
      if (errorLineContent.includes(':') && !errorLineContent.includes(',') && !errorLineContent.endsWith('{')) {
        suggestion += "\n- This might be a missing comma after a property in an object";
      }
      
      // Check for template literal issues
      if (errorLineContent.includes('${') && !errorLineContent.includes('`')) {
        suggestion += "\n- You seem to be using template syntax ${} without surrounding backticks (`)";
      }
      
      // Check for missing semicolons only if it seems to be an issue
      if (errorMessage.includes('semicolon') || errorLineContent.trim().endsWith('{')) {
        suggestion += "\n- Check if you're missing a semicolon or have an unexpected character";
      }
    }
  }
  
  // Add black-box test specific suggestions for test errors
  if (codeSection === 'tests') {
    suggestion += "\n\nFor black-box tests specifically, check for:";
    suggestion += "\n- Are you testing against function signatures and not implementation details?";
    suggestion += "\n- Are function names and parameters matching exactly what's in the implementation?";
    suggestion += "\n- Are you properly handling asynchronous functions with await/then?";
  }
  
  // Add section-specific diagnosis
  diagnosis = `${diagnosis} in ${codeSection} code section`;
  
  return {
    diagnosis,
    lineNumber,
    snippet,
    suggestion,
    codeSection,
    relevantCode
  };
};

/**
 * Helper function to count character occurrences in code
 */
function countChars(str: string, char: string): number {
  return (str.match(new RegExp(escapeRegExp(char), 'g')) || []).length;
}

/**
 * Helper function to escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Diagnose runtime error in more detail
 * @param {string} errorMessage - The error message
 * @param {string} code - The code with runtime error
 * @param {'implementation'|'tests'|'combined'} codeSection - Which section has the error
 * @returns {ErrorDetails} Detailed error information
 */
export const diagnoseRuntimeError = (
  errorMessage: string, 
  code: string,
  codeSection: 'implementation' | 'tests' | 'combined' = 'combined'
): ErrorDetails => {
  let diagnosis = `Runtime error detected in ${codeSection} code`;
  let suggestion = "";
  let relevantCode = "";
  let lineNumber: number | null = null;
  
  // Try to extract line number from error message
  const lineMatch = errorMessage.match(/(?:line\s+|:)(\d+)(?::\d+)?/);
  if (lineMatch) {
    lineNumber = parseInt(lineMatch[1]);
    
    // Extract relevant code around this line number
    const lines = code.split('\n');
    if (lineNumber <= lines.length) {
      const startLine = Math.max(0, lineNumber - 5);
      const endLine = Math.min(lines.length, lineNumber + 5);
      relevantCode = lines.slice(startLine, endLine).map((line, i) => 
        `${startLine + i + 1}${startLine + i + 1 === lineNumber ? ' > ' : ':  '}${line}`
      ).join('\n');
    }
  }
  
  // Common runtime errors and suggestions
  if (errorMessage.includes("is not defined")) {
    const varMatch = errorMessage.match(/(\w+) is not defined/);
    const varName = varMatch ? varMatch[1] : "A variable";
    diagnosis = `Reference Error: '${varName}' is not defined`;
    
    suggestion = `The variable or function '${varName}' is being used but was never declared.`;
    suggestion += "\nCheck for:";
    suggestion += `\n- Typos in the name '${varName}'`;
    suggestion += "\n- Missing import or declaration";
    suggestion += "\n- Case sensitivity issues (JavaScript is case-sensitive)";
    
    // Black-box test specific suggestions
    if (codeSection === 'tests') {
      suggestion += `\n\nFor black-box tests: Verify that '${varName}' matches exactly with the function name in the implementation.`;
      suggestion += `\nAre you using a function that isn't exported by the implementation?`;
    }
    
  } else if (errorMessage.includes("is not a function")) {
    const fnMatch = errorMessage.match(/(\w+) is not a function/);
    const fnName = fnMatch ? fnMatch[1] : "A function";
    diagnosis = `Type Error: Tried to call '${fnName}' which is not a function`;
    
    suggestion = `You're trying to call '${fnName}' as a function, but it's not a function.`;
    suggestion += "\nCheck for:";
    suggestion += `\n- Did you misspell the function name '${fnName}'?`;
    suggestion += `\n- Is '${fnName}' being assigned correctly?`;
    suggestion += `\n- Are you using a property or variable as if it were a function?`;
    
    // For black-box tests
    if (codeSection === 'tests') {
      suggestion += `\n\nFor black-box tests: Make sure the function name '${fnName}' exactly matches what's defined in the implementation.`;
    }
    
  } else if (errorMessage.includes("cannot read property") || errorMessage.includes("Cannot read properties")) {
    // Extract property and object from the error
    const propertyMatch = errorMessage.match(/(?:property|properties of)\s+['"]?([^'".\s]+)['"]?\s+(?:of|from)\s+(\w+)/);
    const property = propertyMatch ? propertyMatch[1] : "a property";
    const objectName = propertyMatch ? propertyMatch[2] : "null or undefined";
    
    diagnosis = `TypeError: Cannot read property '${property}' of ${objectName}`;
    suggestion = `You're trying to access the property '${property}' of ${objectName}, but ${objectName} is not an object or is not defined.`;
    suggestion += "\nCheck for:";
    suggestion += `\n- Is '${objectName}' initialized before using it?`;
    suggestion += `\n- Should you add a null/undefined check before accessing '${property}'?`;
    suggestion += `\n- Is the property name spelled correctly?`;
    
  } else if (errorMessage.includes("Unexpected token")) {
    // Likely a syntax error at runtime (e.g., eval or JSON.parse)
    diagnosis = "Syntax error in runtime code evaluation";
    suggestion = "There's a syntax error in code that's being evaluated at runtime:";
    suggestion += "\n- Check for invalid JSON format if using JSON.parse()";
    suggestion += "\n- Check for syntax errors in dynamically evaluated code";
    suggestion += "\n- Verify string templates or expressions being evaluated";
    
  } else if (errorMessage.includes("Maximum call stack size exceeded")) {
    diagnosis = "Stack overflow error - infinite recursion";
    suggestion = "Your code has an infinite loop or recursion without a proper exit condition:";
    suggestion += "\n- Check recursive function calls to ensure they have a base case";
    suggestion += "\n- Look for mutual recursion between functions";
    suggestion += "\n- Ensure loops have proper termination conditions";
    
  } else if (errorMessage.includes("async") || errorMessage.includes("await") || errorMessage.includes("Promise")) {
    diagnosis = "Asynchronous code error";
    suggestion = "There's an issue with asynchronous code execution:";
    suggestion += "\n- Are you using 'await' without an 'async' function?";
    suggestion += "\n- Are you handling Promise rejections properly?";
    suggestion += "\n- Are you awaiting asynchronous functions?";
    suggestion += "\n- Check for unhandled promise rejections";
  }
  
  // Add black-box testing specific advice
  if (codeSection === 'tests') {
    suggestion += "\n\nBlack-box test specific troubleshooting:";
    suggestion += "\n- Are your tests making assumptions about implementation details they shouldn't know?";
    suggestion += "\n- Are function signatures in tests matching exactly with implementations?";
    suggestion += "\n- Are you properly mocking dependencies that the functions need?";
    suggestion += "\n- For async functions, are you properly awaiting results?";
  }
  
  // Stack trace or error line extraction
  let errorLocation = "";
  const stackLines = errorMessage.split('\n').filter(line => line.includes('at '));
  if (stackLines.length > 0) {
    errorLocation = stackLines[0].trim();
    
    // Add more stack context for complex errors
    if (stackLines.length > 1) {
      errorLocation += "\n" + stackLines.slice(1, 4).join("\n");
    }
  }
  
  return {
    diagnosis,
    suggestion,
    errorLocation,
    codeSection,
    lineNumber,
    relevantCode
  };
};