import { analyzeGameSpecification, AnalysisResult } from './analyzer.js';
import { createStateSchema, StateSchemaResult, StateSchemaError } from './schema-designer.js';
import { createRuntimePlan, RuntimePlanningResult } from './runtime-planner.js';
import { designFunctionLibrary, FunctionDesignResult } from './function-designer.js';
import { implementFunctions, ImplementationResult } from './function-implementer.js';
import { generateTests, TestGenerationResult } from './test-generator.js';
import { runTests, TestResult } from './test-runner.js';
import { formatProjectResults, ProjectResults } from './reporter.js';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * Progress callback interface
 */
export interface ProgressCallback {
  stage: number;
  message: string;
  isComplete?: boolean;
  error?: boolean;
}

/**
 * Generator options interface
 */
export interface CodeActOptions {
  gameSpecification: string;
  model: BaseChatModel;
  onProgress?: (progress: ProgressCallback) => void;
  debug?: boolean;
}

/**
 * Generator result interface
 */
export interface CodeActResult extends ProjectResults {
  gameSpecification: string;
  timings: Record<string, number | undefined>;
  analysis?: AnalysisResult;
  stateSchema?: StateSchemaResult | StateSchemaError;
  runtimePlan?: RuntimePlanningResult;
  functionDesign?: FunctionDesignResult;
  implementation?: ImplementationResult;
  tests?: TestGenerationResult;
  testResults?: TestResult;
  error?: {
    stage: string;
    message: string;
    details: any;
  };
  formattedResults?: string;
}

/**
 * Type guard to check if stateSchema is a StateSchemaResult
 * @param stateSchema - The state schema to check
 * @returns True if stateSchema is a StateSchemaResult
 */
function isStateSchemaResult(stateSchema: StateSchemaResult | StateSchemaError | undefined): stateSchema is StateSchemaResult {
  return stateSchema !== undefined && 
    'schema' in stateSchema && 
    'description' in stateSchema && 
    !('error' in stateSchema);
}

/**
 * Generate a complete game implementation based on a game specification
 * @param {CodeActOptions} options - Generator options
 * @returns {Promise<CodeActResult>} Complete game implementation and documentation
 */
export const codeActGenerator = async ({
  gameSpecification,
  model,
  onProgress = () => {},
  debug = false
}: CodeActOptions): Promise<CodeActResult> => {
  // Validate inputs
  if (!gameSpecification) throw new Error("Game specification is required");
  if (!model) throw new Error("Language model is required");
  
  // Initialize results object to store all artifacts
  const results: CodeActResult = {
    gameSpecification,
    timings: {},
  };
  
  // Helper to log debug messages
  const log = (...args: any[]) => {
    if (debug) console.log(...args);
  };
  
  // Stage 1: Analyze the game specification
  log("🔍 Stage 1: Analyzing game specification...");
  onProgress({ stage: 1, message: "Analyzing game specification..." });
  
  const analysisStartTime = Date.now();
  results.analysis = await analyzeGameSpecification(model, gameSpecification);
  results.timings.analysisTime = Date.now() - analysisStartTime;
  
  log(`✅ Analysis completed in ${results.timings.analysisTime}ms`);
  log("Analysis results:", results.analysis);
  
  // Stage 2: Design the state schema
  log("📊 Stage 2: Designing state schema...");
  onProgress({ stage: 2, message: "Designing state schema..." });
  
  const schemaStartTime = Date.now();
  results.stateSchema = await createStateSchema(model, {
    gameSpecification,
    analysis: results.analysis
  });
  results.timings.schemaTime = Date.now() - schemaStartTime;
  
  log(`✅ Schema design completed in ${results.timings.schemaTime}ms`);
  log("Schema:", results.stateSchema);
  
  // Check if the schema design failed - if so, abort the process
  if (!isStateSchemaResult(results.stateSchema)) {
    const errorMessage = results.stateSchema && 'error' in results.stateSchema 
      ? results.stateSchema.error 
      : "Invalid schema structure returned";
      
    log(`❌ Schema design failed: ${errorMessage}`);
    onProgress({ stage: 2, message: `Schema design failed: ${errorMessage}`, isComplete: true, error: true });
    
    // Return the results collected so far with the error details
    return {
      ...results,
      error: {
        stage: 'schema-design',
        message: errorMessage as string,
        details: results.stateSchema
      }
    };
  }
  
  // At this point, we know results.stateSchema is StateSchemaResult type
  const stateSchema = results.stateSchema;
  
  // Stage 3: Create runtime interaction plan
  log("🔄 Stage 3: Creating runtime interaction plan...");
  onProgress({ stage: 3, message: "Creating runtime interaction plan..." });
  
  const runtimePlanStartTime = Date.now();
  results.runtimePlan = await createRuntimePlan(model, {
    gameSpecification,
    analysis: results.analysis.analysis,
    stateSchema: stateSchema
  });
  results.timings.runtimePlanTime = Date.now() - runtimePlanStartTime;
  
  log(`✅ Runtime plan completed in ${results.timings.runtimePlanTime}ms`);
  log("Runtime plan:", results.runtimePlan);
  
  // Stage 4: Design functions
  log("🧩 Stage 4: Designing functions...");
  onProgress({ stage: 4, message: "Designing functions..." });
  
  const functionDesignStartTime = Date.now();
  results.functionDesign = await designFunctionLibrary(model, {
    gameSpecification,
    stateSchema: stateSchema.schema,
    runtimePlan: results.runtimePlan.runtimePlan.fullText
  });
  results.timings.functionDesignTime = Date.now() - functionDesignStartTime;
  
  log(`✅ Function design completed in ${results.timings.functionDesignTime}ms`);
  log("Function design:", results.functionDesign);
  
  // Stage 5: Implement functions
  log("💻 Stage 5: Implementing functions...");
  onProgress({ stage: 5, message: "Implementing functions..." });
  
  const implementationStartTime = Date.now();
  results.implementation = await implementFunctions(
    model,
    {
        gameSpecification,
        stateSchema: stateSchema,
        functionDesign: results.functionDesign.functionDesign
    }
  );
  results.timings.implementationTime = Date.now() - implementationStartTime;
  
  log(`✅ Implementation completed in ${results.timings.implementationTime}ms`);
  log("Implementation:", results.implementation.code.substring(0, 200) + "...");
  
  // Stage 6: Generate tests
  log("🧪 Stage 6: Generating tests...");
  onProgress({ stage: 6, message: "Generating tests..." });
  
  const testGenerationStartTime = Date.now();
  results.tests = await generateTests(model, {
    gameSpecification,
    stateSchema: stateSchema,
    implementation: results.implementation.code
  });
  results.timings.testGenerationTime = Date.now() - testGenerationStartTime;
  
  log(`✅ Test generation completed in ${results.timings.testGenerationTime}ms`);
  log("Tests:", results.tests.testCode.substring(0, 200) + "...");
  
  // Stage 7: Run tests
  log("🧪 Stage 7: Running tests...");
  onProgress({ stage: 7, message: "Running tests..." });
  
  const testRunStartTime = Date.now();
  results.testResults = await runTests(results.implementation.code, results.tests.testCode);
  results.timings.testRuntime = Date.now() - testRunStartTime;
  
  log(`✅ Test execution completed in ${results.timings.testRuntime}ms`);
  log("Test results:", results.testResults);
  
  // Generate final report
  log("📃 Generating final report...");
  onProgress({ stage: 8, message: "Generating final report..." });
  
  const formattedResults = formatProjectResults(results);
  
  // Calculate total execution time
  const totalTime = Object.values(results.timings).reduce(
    (sum: number, time) => sum + (time || 0), 0
  );
  log(`🎉 Code generation completed in ${totalTime}ms`);
  
  onProgress({ stage: 9, message: "Code generation completed!", isComplete: true });
  
  return {
    ...results,
    formattedResults
  };
};