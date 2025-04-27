// filepath: /Users/ericwood/dev/projects/ChainCraft/game-builder/src/ai/codeact/codeact-test.js
import dotenv from 'dotenv';
import { HumanMessage } from '@langchain/core/messages';

import { getModel } from '#chaincraft/ai/model.js'; 


// Load environment variables
dotenv.config();

/**
 * Simple CodeAct test that demonstrates:
 * 1. Using LLM to generate a function for tallying game scores
 * 2. Executing that function safely with resource limits
 * 3. Comparing performance with asking the LLM directly
 */

// Configure model
const model = await getModel(process.env.CHAINCRAFT_GAME_DESIGN_MODEL_NAME);

// Test data - player scores from multiple rounds
const testScores = [
  { player: "Alice", scores: [5, 10, 3, 8] },
  { player: "Bob", scores: [8, 2, 10, 5] },
  { player: "Charlie", scores: [3, 7, 8, 9] }
];

/**
 * Safely execute a function with timeout and memory limits
 * 
 * FIXED: Improved the function wrapping to ensure proper execution
 */
const safeExecute = async (fnCode, args, timeoutMs = 3000) => {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;
  
  // Maximum memory increase allowed (50MB)
  const maxMemoryIncrease = 50 * 1024 * 1024;
  
  // Logs capture
  const logs = [];
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  
  // Override console methods to capture logs
  console.log = (...args) => {
    logs.push(args.map(arg => String(arg)).join(' '));
  };
  
  console.error = (...args) => {
    logs.push(`ERROR: ${args.map(arg => String(arg)).join(' ')}`);
  };
  
  try {
    return await new Promise((resolve, reject) => {
      // Set timeout
      const timeout = setTimeout(() => {
        reject(new Error('Function execution timed out'));
      }, timeoutMs);
      
      // Set interval to check memory usage
      const memoryCheck = setInterval(() => {
        const currentMemory = process.memoryUsage().heapUsed;
        if (currentMemory - startMemory > maxMemoryIncrease) {
          clearInterval(memoryCheck);
          clearTimeout(timeout);
          reject(new Error('Memory limit exceeded'));
        }
      }, 100);
      
      try {
        // FIX: Properly wrap the function code to ensure it's defined correctly
        // The error was due to improperly defining the main function
        const cleanedFnCode = fnCode.replace(/^```javascript|```$/gm, '').trim();
        
        // Create a proper function that will execute the code
        const fn = new Function('args', `
          ${cleanedFnCode}
          
          // Make sure main function exists and is callable
          if (typeof main !== 'function') {
            throw new Error('No main function defined in the generated code');
          }
          
          return main(args);
        `);
        
        // Execute the function
        const result = fn(args);
        
        // Handle promises or direct return values
        if (result instanceof Promise) {
          result
            .then((value) => {
              clearTimeout(timeout);
              clearInterval(memoryCheck);
              resolve({
                result: value,
                logs,
                executionTime: Date.now() - startTime,
                error: null
              });
            })
            .catch((error) => {
              clearTimeout(timeout);
              clearInterval(memoryCheck);
              reject(error);
            });
        } else {
          clearTimeout(timeout);
          clearInterval(memoryCheck);
          resolve({
            result,
            logs,
            executionTime: Date.now() - startTime,
            error: null
          });
        }
      } catch (error) {
        clearTimeout(timeout);
        clearInterval(memoryCheck);
        reject(error);
      }
    });
  } catch (error) {
    return {
      result: null,
      logs,
      executionTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  } finally {
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }
};

/**
 * Generate a function using LLM
 */
const generateFunction = async (prompt) => {
  console.log("🤖 Asking LLM to generate a function...");
  const startTime = Date.now();
  
  const response = await model.invoke([
    new HumanMessage(prompt)
  ]);
  
  const generationTime = Date.now() - startTime;
  const codeText = response.content.trim();
  
  console.log(`✅ Function generated in ${generationTime}ms`);
  return { 
    code: codeText,
    generationTime
  };
};

/**
 * Ask LLM to tally scores directly (for comparison)
 * 
 * FIXED: Improved JSON parsing from LLM responses
 */
const tallyScoresWithLLM = async (scores) => {
  console.log("🤖 Asking LLM to tally scores directly...");
  const startTime = Date.now();
  
  const prompt = `
    Please calculate the total score for each player from the following data:
    ${JSON.stringify(scores, null, 2)}
    
    Return the results as a JSON array where each object has "player" and "totalScore" properties.
    Sort the results by totalScore in descending order.
    Do NOT include any explanations, just return the JSON array.
  `;
  
  const response = await model.invoke([
    new HumanMessage(prompt)
  ]);
  
  const processingTime = Date.now() - startTime;
  
  console.log(`✅ Scores tallied by LLM in ${processingTime}ms`);
  
  // Try to parse JSON from the response
  try {
    // FIX: Better JSON extraction with improved regex
    // First, try to extract JSON from a code block
    let jsonContent;
    const codeBlockMatch = response.content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    
    if (codeBlockMatch) {
      // Extract content from inside the code block
      jsonContent = codeBlockMatch[1].trim();
    } else {
      // If no code block, try to find an array directly
      const arrayMatch = response.content.match(/(\[\s*\{[\s\S]*\}\s*\])/);
      jsonContent = arrayMatch ? arrayMatch[1] : response.content.trim();
    }
    
    return {
      result: JSON.parse(jsonContent),
      processingTime
    };
  } catch (error) {
    console.error("Error parsing JSON from LLM response:", error);
    return {
      error: "Failed to parse JSON from response",
      response: response.content,
      processingTime
    };
  }
};

/**
 * Run the test
 */
const runTest = async () => {
  console.log("====== CodeAct Test: Score Tallying ======");
  
  // Step 1: Generate the score tallying function using LLM
  const functionPrompt = `
    Create a JavaScript function that tallies player scores from an array of player objects.
    Each player object has a 'player' property (name) and a 'scores' property (array of numbers).
    
    The function should:
    1. Calculate the sum of scores for each player
    2. Return an array of objects with player names and total scores
    3. Sort the array by total score in descending order
    
    Requirements:
    - Function must be named 'main'
    - Take a single argument called 'args' containing the scores array
    - Return a new array, don't modify the input
    - Handle edge cases like empty arrays or missing values
    
    Example input:
    [
      { player: "Alice", scores: [5, 10, 3] },
      { player: "Bob", scores: [8, 2, 10] }
    ]
    
    Example output:
    [
      { player: "Bob", totalScore: 20 },
      { player: "Alice", totalScore: 18 }
    ]
    
    Please provide only the JavaScript function without explanation. Begin with 'function main(args) {' and end with '}'.
  `;
  
  const { code, generationTime } = await generateFunction(functionPrompt);
  
  console.log("\n----- Generated Function -----");
  console.log(code);
  console.log("-----------------------------\n");
  
  // Step 2: Execute the generated function with test data
  console.log("🧪 Testing the generated function with sample data...");
  console.log("Input:", JSON.stringify(testScores, null, 2));
  
  const executionResult = await safeExecute(code, testScores);
  
  console.log("\n----- Function Execution Result -----");
  if (executionResult.error) {
    console.error("❌ Error executing function:", executionResult.error);
  } else {
    console.log("✅ Result:", JSON.stringify(executionResult.result, null, 2));
    console.log(`⏱️  Execution time: ${executionResult.executionTime}ms`);
    if (executionResult.logs.length > 0) {
      console.log("📝 Logs:", executionResult.logs);
    }
  }
  console.log("-------------------------------\n");
  
  // Step 3: For comparison, ask the LLM to tally scores directly
  const llmResult = await tallyScoresWithLLM(testScores);
  
  console.log("\n----- LLM Direct Processing Result -----");
  if (llmResult.error) {
    console.error("❌ Error with LLM processing:", llmResult.error);
    console.log("Raw response:", llmResult.response);
  } else {
    console.log("✅ Result:", JSON.stringify(llmResult.result, null, 2));
    console.log(`⏱️  Processing time: ${llmResult.processingTime}ms`);
  }
  console.log("--------------------------------------\n");
  
  // Step 4: Compare and display results
  console.log("\n====== Performance Comparison ======");
  console.log(`Function generation time: ${generationTime}ms`);
  
  if (!executionResult.error && !llmResult.error) {
    console.log(`Function execution time: ${executionResult.executionTime}ms`);
    console.log(`LLM direct processing time: ${llmResult.processingTime}ms`);
    
    const speedupFactor = llmResult.processingTime / executionResult.executionTime;
    console.log(`\n🚀 Function execution is ${speedupFactor.toFixed(2)}x faster than LLM direct processing`);
    
    // Compare results (should be the same)
    console.log("\nResults comparison:");
    const functionTopScore = executionResult.result[0]?.totalScore;
    const llmTopScore = llmResult.result[0]?.totalScore;
    
    if (functionTopScore === llmTopScore) {
      console.log("✅ Both methods produced the same top score");
    } else {
      console.log("❌ Methods produced different top scores:");
      console.log(`   - Function: ${functionTopScore}`);
      console.log(`   - LLM: ${llmTopScore}`);
    }
  }
  
  console.log("\n====== Conclusion ======");
  console.log(`
    CodeAct approch:
    1. One-time function generation cost: ${generationTime}ms
    2. Subsequent execution cost: ${executionResult.executionTime}ms per call
    3. Total for first call: ${generationTime + executionResult.executionTime}ms
    
    LLM direct processing:
    1. Processing cost: ${llmResult.processingTime}ms per call
    
    The CodeAct approach becomes more efficient after ${Math.ceil(generationTime / (llmResult.processingTime - executionResult.executionTime))} calls due to the initial generation cost.
    
    Beyond the performance benefits:
    - More deterministic results
    - No token usage for subsequent calls
    - Lower latency for end users
  `);
};

// Run the test
runTest().catch(console.error);