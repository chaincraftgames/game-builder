// filepath: /Users/ericwood/dev/projects/ChainCraft/game-builder/src/ai/codeact/reporter.ts
import { GameAnalysis, GameState } from './analyzer.js';
import { StateSchemaError, StateSchemaResult } from './schema-designer.js';
import { RuntimePlan } from './runtime-planner.js';
import { FunctionDesign } from './function-designer.js';

/**
 * Test results interface
 */
export interface TestResults {
  success: boolean;
  error?: string;
  errorDetails?: {
    diagnosis: string;
    suggestion?: string;
    snippet?: string;
    lineNumber?: number | null;
    errorLocation?: string;
    codeSection?: 'implementation' | 'tests' | 'combined';
    relevantCode?: string;
    debugFilePath?: string;
  };
  logs?: string[];
  testRuntime?: number;
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
 * Implementation interface
 */
export interface Implementation {
  code: string;
  implementationTime?: number;
}

/**
 * Project timing information interface
 */
export interface ProjectTimings {
  analysisTime?: number;
  schemaTime?: number;
  runtimePlanTime?: number;
  functionDesignTime?: number;
  implementationTime?: number;
  testGenerationTime?: number;
  testRuntime?: number;
  [key: string]: number | undefined;
}

/**
 * Project results interface
 */
export interface ProjectResults {
  gameSpecification: string;
  analysis?: {
    analysis: GameAnalysis;
    analysisTime?: number;
  };
  stateSchema?: StateSchemaResult | StateSchemaError
  runtimePlan?: {
    runtimePlan: RuntimePlan;
    runtimePlanTime?: number;
  };
  functionDesign?: {
    functionDesign: FunctionDesign;
    functionDesignTime?: number;
  };
  implementation?: Implementation;
  testResults?: TestResults;
  timings: ProjectTimings;
}

/**
 * Format the game analysis results for display
 * @param {Object} analysis - The analysis results
 * @returns {string} Formatted analysis display
 */
export const formatAnalysis = (analysis?: { analysis: GameAnalysis, analysisTime?: number }): string => {
  if (!analysis) return "No analysis data available";
  
  return `
## Game Analysis

${analysis.analysis.fullText || "No detailed analysis available"}

### State Elements Summary
${formatStateElements(analysis.analysis.gameState)}
  `;
};

/**
 * Format state elements for display
 * @param {GameState} gameState - The game state elements
 * @returns {string} Formatted state elements display
 */
const formatStateElements = (gameState?: GameState): string => {
  if (!gameState) return "No state element data available";
  
  const { globalState = [], playerState = [] } = gameState;
  
  let output = "#### Global State Elements\n";
  if (globalState.length === 0) {
    output += "- No global state elements specified\n";
  } else {
    globalState.forEach(element => {
      output += `- **${element.name}**: ${element.purpose} (${element.type})\n`;
    });
  }
  
  output += "\n#### Player State Elements\n";
  if (playerState.length === 0) {
    output += "- No player state elements specified\n";
  } else {
    playerState.forEach(element => {
      output += `- **${element.name}**: ${element.purpose} (${element.type})\n`;
    });
  }
  
  return output;
};

/**
 * Format the state schema for display
 * @param {StateSchemaResult} stateSchema - The state schema
 * @returns {string} Formatted state schema display
 */
export const formatStateSchema = (stateSchema?: StateSchemaResult | StateSchemaError): string => {
  if (!stateSchema) return "No state schema available";
  if ('error' in stateSchema) {
    return `## State Schema Error\n\n${stateSchema.error}`;
  }
  
  return `
## State Schema

### Description
${stateSchema.description || "No description available"}

### Schema Definition
\`\`\`json
${formatJson(stateSchema.schema)}
\`\`\`

### Initial State Example
\`\`\`json
${formatJson(stateSchema.initialState)}
\`\`\`

### Validations
${stateSchema.validations && stateSchema.validations.length > 0 
  ? stateSchema.validations.map(v => `- ${v}`).join('\n') 
  : "- No specific validations specified"}
  `;
};

/**
 * Format the runtime plan for display
 * @param {Object} runtimePlanResult - The runtime plan result
 * @returns {string} Formatted runtime plan display
 */
export const formatRuntimePlan = (runtimePlanResult?: { runtimePlan: RuntimePlan, runtimePlanTime?: number }): string => {
  if (!runtimePlanResult) return "No runtime plan available";
  
  return `
## Runtime Interaction Plan

${runtimePlanResult.runtimePlan.fullText || "No detailed runtime plan available"}
  `;
};

/**
 * Format the function design for display
 * @param {Object} functionDesignResult - The function design result
 * @returns {string} Formatted function design display
 */
export const formatFunctionDesign = (
  functionDesignResult?: { functionDesign: FunctionDesign, functionDesignTime?: number }
): string => {
  if (!functionDesignResult) return "No function design available";
  
  const { functionDesign } = functionDesignResult;
  const { fullText, functions = [] } = functionDesign;
  
  let output = `
## Function Design

${fullText || "No detailed function design available"}

### Function Summary
`;

  if (functions.length === 0) {
    output += "- No functions specified\n";
  } else {
    functions.forEach(func => {
      output += `- **${func.name}** (${func.importance}): ${func.purpose || "No description available"}\n`;
    });
  }
  
  return output;
};

/**
 * Format the implementation results for display
 * @param {Implementation} implementation - The implementation results
 * @returns {string} Formatted implementation display
 */
export const formatImplementation = (implementation?: Implementation): string => {
  if (!implementation || !implementation.code) return "No implementation available";
  
  return `
## Implementation

Implementation code has been saved to a temporary file for inspection.
${implementation.implementationTime ? `\nImplementation completed in ${implementation.implementationTime}ms.` : ''}
  `;
};

/**
 * Format test results for display
 * @param {TestResults} testResults - The test results
 * @returns {string} Formatted test results display
 */
export const formatTestResults = (testResults?: TestResults): string => {
  if (!testResults) return "No test results available";
  
  const { success, error, errorDetails, logs = [], codeInfo, debugFiles } = testResults;
  
  let output = `
## Test Results

${success 
  ? "✅ Tests passed successfully" 
  : "❌ Tests failed"}`;

  // Add debug files information if available
  if (debugFiles) {
    output += `\n\n### Debug Files
Files with the complete code have been saved for debugging:
${debugFiles.implementation ? `- Implementation code: \`${debugFiles.implementation}\`` : ''}
${debugFiles.test ? `- Test code: \`${debugFiles.test}\`` : ''}
${debugFiles.combined ? `- Combined code: \`${debugFiles.combined}\`` : ''}`;
  }
  
  // Show code info when there's an error to give more context
  if (!success && codeInfo) {
    output += `\n\n### Code Statistics
- Implementation code: ${codeInfo.implementationLength} lines
- Test code: ${codeInfo.testLength} lines`;
  }
  
  if (error) {
    output += `\n\n### Error Summary\n${error}`;
    
    if (errorDetails) {
      // Display which section has the error
      if (errorDetails.codeSection) {
        const sectionName = {
          'implementation': 'Implementation Code',
          'tests': 'Test Code', 
          'combined': 'Combined Code'
        }[errorDetails.codeSection];
        
        output += `\n\n### Error Location\nThe error is in the **${sectionName}** section`;
        
        if (errorDetails.lineNumber !== null && errorDetails.lineNumber !== undefined) {
          output += ` at line ${errorDetails.lineNumber}`;
        }
        
        // Add debug file path information
        if (errorDetails.debugFilePath) {
          output += `\n\nComplete code available at: \`${errorDetails.debugFilePath}\``;
        }
      }
      
      // Add detailed diagnosis section
      output += `\n\n### Error Diagnosis\n${errorDetails.diagnosis}`;
      
      // Add code snippet showing the error if available
      if (errorDetails.snippet) {
        output += `\n\n### Code Context\n\`\`\`javascript\n${errorDetails.snippet}\n\`\`\``;
      } else if (errorDetails.relevantCode) {
        output += `\n\n### Relevant Code\n\`\`\`javascript\n${errorDetails.relevantCode}\n\`\`\``;
      }
      
      // Add detailed error location from stack trace if available
      if (errorDetails.errorLocation) {
        output += `\n\n### Error Stack Trace\n\`\`\`\n${errorDetails.errorLocation}\n\`\`\``;
      }
      
      // Add suggestions for fixing the error
      if (errorDetails.suggestion) {
        output += `\n\n### Suggestions for Fixing the Error\n${errorDetails.suggestion}`;
      }

      // For black-box testing errors, add specific section for these
      if (errorDetails.codeSection === 'tests') {
        output += `\n\n### Black-Box Testing Reminders
- Black-box tests should rely only on function signatures and documentation
- Make sure test function calls match implementation function names exactly
- Validate input/output behavior without knowledge of implementation details
- Ensure tests verify the function contract rather than implementation specifics`;
      }
    }
  }

  if (logs && logs.length > 0) {
    output += `\n\n### Test Logs\n\`\`\`\n${logs.join('\n')}\n\`\`\``;
  }
  
  return output;
};

/**
 * Format the overall project results for display
 * @param {ProjectResults} results - All project results
 * @returns {string} Formatted project results display
 */
export const formatProjectResults = (results: ProjectResults): string => {
  const {
    gameSpecification,
    analysis,
    stateSchema,
    runtimePlan,
    functionDesign,
    implementation,
    testResults,
    timings = {}
  } = results;
  
  let output = `
# ${gameSpecification} Game Development Results

## Overview
This document contains the auto-generated code and documentation for the ${gameSpecification} game.

## Timings
${formatTimings(timings)}

${formatAnalysis(analysis)}

${formatStateSchema(stateSchema)}

${formatRuntimePlan(runtimePlan)}

${formatFunctionDesign(functionDesign)}

${formatImplementation(implementation)}

${formatTestResults(testResults)}
`;

  return output;
};

/**
 * Format timings for display
 * @param {ProjectTimings} timings - The timing information
 * @returns {string} Formatted timings display
 */
const formatTimings = (timings: ProjectTimings): string => {
  let output = "| Stage | Time (ms) |\n|-------|----------:|\n";
  
  if (timings.analysisTime) output += `| Analysis | ${timings.analysisTime} |\n`;
  if (timings.schemaTime) output += `| Schema Design | ${timings.schemaTime} |\n`;
  if (timings.runtimePlanTime) output += `| Runtime Planning | ${timings.runtimePlanTime} |\n`;
  if (timings.functionDesignTime) output += `| Function Design | ${timings.functionDesignTime} |\n`;
  if (timings.implementationTime) output += `| Implementation | ${timings.implementationTime} |\n`;
  if (timings.testGenerationTime) output += `| Test Generation | ${timings.testGenerationTime} |\n`;
  if (timings.testRuntime) output += `| Test Execution | ${timings.testRuntime} |\n`;
  
  const total = Object.values(timings).reduce((sum, time) => sum !== undefined && time !== undefined ? sum + time : sum, 0);
  output += `| **Total** | **${total}** |\n`;
  
  return output;
};

/**
 * Format JSON for display
 * @param {string} jsonString - JSON string to format
 * @returns {string} Formatted JSON string
 */
const formatJson = (jsonString: string): string => {
  try {
    // Try to parse and re-stringify for proper formatting
    const parsed = JSON.parse(jsonString);
    return JSON.stringify(parsed, null, 2);
  } catch (error) {
    // If it's not valid JSON, just return as is
    return jsonString;
  }
};