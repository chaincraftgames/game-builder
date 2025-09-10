import { analyzeGameSpecification, AnalysisResult } from './analyzer.js';
import { createStateSchema, StateSchemaResult, StateSchemaError } from './schema-designer.js';
import { createRuntimePlan, RuntimePlanningResult } from './runtime-planner.js';
import { designFunctionLibrary, FunctionDesignResult } from './function-designer.js';
import { implementFunctions, ImplementationResult } from './function-implementer.js';
import { 
  // generateTests, 
  generateBlackBoxTests, 
  TestGenerationResult 
} from './test-generator.js';
import { runTests, TestResult } from './test-runner.js';
import { formatProjectResults, ProjectResults } from './reporter.js';
import { ModelWithOptions } from '../model-config.js';
import { 
  storeFunctions, 
  initializeStorage,
  storeGameState,
  storeGameMetadata
} from '../file-storage.js';
import { v4 as uuidv4 } from 'uuid';

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
  model: ModelWithOptions;
  gameSpecification: string;
  gameName: string;
  onProgress?: (progress: ProgressCallback) => void;
  debug?: boolean;
  output?: {
    showAnalysis?: boolean;
    showSchema?: boolean;
    showRuntimePlan?: boolean;
    showFunctionDesign?: boolean;
    showImplementation?: boolean;
    showTestResults?: boolean;
    showPerformance?: boolean;
  };
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
 * Format and display results based on output options
 * @param {CodeActResult} results - The generated results
 * @param {CodeActOptions['output']} outputOptions - Output configuration options
 */
function displayResults(results: CodeActResult, outputOptions: CodeActOptions['output'] = {}) {
  // Default all options to true if not specified
  const options = {
    showAnalysis: true,
    showSchema: true,
    showRuntimePlan: true,
    showFunctionDesign: true,
    showImplementation: true,
    showTestResults: true,
    showPerformance: true,
    ...outputOptions
  };
  
  console.log("\n====== CodeAct Generation Results ======");
  
  if (options.showAnalysis && results.analysis) {
    console.log("\n----- Game Analysis -----");
    console.log(results.analysis.analysis.fullText);
  }
  
  if (options.showSchema && results.stateSchema) {
    console.log("\n----- State Schema -----");
    if ('description' in results.stateSchema) {
      console.log(results.stateSchema.description);
    }
    console.log("\nSchema (JSON Schema format):");
    if ('schema' in results.stateSchema) {
      console.log(results.stateSchema.schema);
    } else if ('error' in results.stateSchema) {
      console.log("Error generating schema:", results.stateSchema.error);
    }
  }
  
  if (options.showRuntimePlan && results.runtimePlan) {
    console.log("\n----- Runtime Interaction Plan -----");
    console.log(results.runtimePlan.runtimePlan.fullText);
  }
  
  if (options.showFunctionDesign && results.functionDesign) {
    console.log("\n----- Function Library Design -----");
    console.log(results.functionDesign.functionDesign.fullText);
  }
  
  if (options.showImplementation && results.implementation) {
    console.log("\n----- Generated Functions -----");
    console.log(results.implementation.code);
  }
  
  // Always show debug files if available
  if (results.testResults?.debugFiles) {
    console.log("\n----- Debug Files (Generated Code) -----");
    if (results.testResults.debugFiles.implementation) {
      console.log(`Implementation: ${results.testResults.debugFiles.implementation}`);
    }
    if (results.testResults.debugFiles.test) {
      console.log(`Tests:          ${results.testResults.debugFiles.test}`);
    }
    if (results.testResults.debugFiles.combined) {
      console.log(`Combined:       ${results.testResults.debugFiles.combined}`);
    }
    console.log("-----------------------------------------");
  }
  
  if (options.showTestResults) {
    console.log("\n----- Test Results -----");
    if (results.testResults && results.testResults.success) {
      console.log("✅ All tests executed successfully");
    } else {
      console.log("❌ Tests failed to execute");
      console.log(`Error: ${results.testResults?.error || "Unknown error"}`);
      
      // Show detailed error information if available
      if (results.testResults?.errorDetails) {
        const { diagnosis, suggestion, snippet } = results.testResults.errorDetails;
        if (diagnosis) console.log(`\nDiagnosis: ${diagnosis}`);
        if (snippet) console.log(`\nError Context:\n${snippet}`);
        if (suggestion) console.log(`\nSuggestion: ${suggestion}`);
      }
      
      // Show error logs if available
      if (results.testResults?.logs && results.testResults.logs.length > 0) {
        console.log("\nError Logs:");
        results.testResults.logs.slice(0, 10).forEach(log => {
          console.log(`  ${log}`);
        });
        if (results.testResults.logs.length > 10) {
          console.log(`  ... and ${results.testResults.logs.length - 10} more lines (see debug files for complete logs)`);
        }
      }
    }
  }
  
  if (options.showPerformance && results.timings) {
    console.log("\n----- Performance Metrics -----");
    Object.entries(results.timings).forEach(([key, value]) => {
      if (value !== undefined) {
        console.log(`${key}: ${value}ms`);
      }
    });
  }
}

/**
 * Generate a complete game implementation based on a game specification
 * @param {CodeActOptions} options - Generator options
 * @returns {Promise<CodeActResult>} Complete game implementation and documentation
 */
export const codeActGenerator = async ({
  model,
  gameSpecification,
  gameName,
  onProgress = () => {},
  debug = false,
  output = {}
}: CodeActOptions): Promise<CodeActResult> => {
  // Validate inputs
  if (!gameSpecification) throw new Error("Game specification is required");
  
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
  results.analysis = await analyzeGameSpecification(model, gameSpecification, undefined, {
    gameName: gameName,
    discoveryStep: 'game-analysis',
    stepNumber: 1
  });
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
  }, {
    gameName: gameName,
    discoveryStep: 'schema-design',
    stepNumber: 2
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
  // COMMENTED OUT: Bypassing runtime interaction planning step (but keeping for future reference)
  /*
  log("🔄 Stage 3: Creating runtime interaction plan...");
  onProgress({ stage: 3, message: "Creating runtime interaction plan..." });
  
  const runtimePlanStartTime = Date.now();
  results.runtimePlan = await createRuntimePlan(model, {
    gameSpecification,
    analysis: results.analysis.analysis,
    stateSchema: stateSchema
  }, {
    gameName: gameName,
    discoveryStep: 'runtime-planning',
    stepNumber: 3
  });
  results.timings.runtimePlanTime = Date.now() - runtimePlanStartTime;
  
  log(`✅ Runtime plan completed in ${results.timings.runtimePlanTime}ms`);
  log("Runtime plan:", results.runtimePlan);
  */
  
  // Create a placeholder runtime plan to maintain compatibility with downstream steps
  results.timings.runtimePlanTime = 0;
  results.runtimePlan = {
    runtimePlan: {
      fullText: "Runtime planning step bypassed. Relying on game analysis and state schema directly."
    },
    runtimePlanTime: 0
  };
  log("⏭️ Runtime planning step bypassed");
  onProgress({ stage: 3, message: "Runtime planning step bypassed", isComplete: true });
  
  // Stage 4: Design functions
  log("🧩 Stage 4: Designing functions...");
  onProgress({ stage: 4, message: "Designing functions..." });
  
  const functionDesignStartTime = Date.now();
  results.functionDesign = await designFunctionLibrary(model, {
    gameSpecification,
    stateSchema: stateSchema.schema,
    runtimePlan: results.runtimePlan.runtimePlan.fullText
  }, {
    gameName: gameName,
    discoveryStep: 'function-design',
    stepNumber: 4
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
    },
    {
      gameName: gameName,
      discoveryStep: 'function-implementation',
      stepNumber: 5
    }
  );
  results.timings.implementationTime = Date.now() - implementationStartTime;
  
  log(`✅ Implementation completed in ${results.timings.implementationTime}ms`);
  log("Implementation:", results.implementation.code.substring(0, 200) + "...");
  
  // Stage 6: Generate tests
  log("🧪 Stage 6: Generating black-box tests...");
  onProgress({ stage: 6, message: "Generating black-box tests..." });
  
  const testGenerationStartTime = Date.now();
  // Use black-box tests that only rely on function design, not implementation
  results.tests = await generateBlackBoxTests(model, {
    gameSpecification,
    stateSchema: stateSchema,
    functionDesign: results.functionDesign.functionDesign,
    functionSignatures: results.implementation.signatures // Optional: use signatures if available
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
  
  // Show debug file paths prominently at the end of test execution
  if (results.testResults?.debugFiles) {
    console.log("\n----- Debug Files (Generated Code) -----");
    if (results.testResults.debugFiles.implementation) {
      console.log(`Implementation: ${results.testResults.debugFiles.implementation}`);
    }
    if (results.testResults.debugFiles.test) {
      console.log(`Tests:          ${results.testResults.debugFiles.test}`);
    }
    if (results.testResults.debugFiles.combined) {
      console.log(`Combined:       ${results.testResults.debugFiles.combined}`);
    }
    console.log("-----------------------------------------\n");
  }
  
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
  
  // Display results based on output options
  displayResults(results, output);

  // Save generated functions and initialize game storage
  try {
    // Initialize storage directories
    await initializeStorage();

    // Generate a unique game ID
    const gameId = `game-${uuidv4().slice(0, 8)}`;
    log(`🔄 Saving generated functions for game ID: ${gameId}`);

    // Store the functions and metadata
    await storeFunctions(
      gameId,
      results.implementation?.code || ''
    );

    // Store the game specification and state schema
    await storeGameMetadata(
      gameId,
      {
        gameSpecification: gameSpecification,
        stateDefinition: stateSchema.schema,
      }
    )

    // Create an initial empty state to initialize the game directory
    await storeGameState(gameId, {});

    // Log success message
    log(`✅ Functions and game structure saved to disk with game ID: ${gameId}`);
    console.log(`\n📂 Generated game saved with ID: ${gameId}`);
    console.log(`   - Functions saved to: /game-data/functions.js`);
    console.log(`   - Game state will be saved to: /game-data/games/${gameId}/state.json`);
    console.log(`   - To initialize this game, run: codeact-simulate init ${gameId}`);
  } catch (error) {
    log(`❌ Error saving functions to disk: ${error}`);
    console.error(`\nWarning: Failed to save generated code to disk: ${error}`);
  }

  return {
    ...results,
    formattedResults
  };
};