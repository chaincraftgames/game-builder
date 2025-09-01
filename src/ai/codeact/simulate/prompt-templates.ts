/**
 * Prompt templates for the CodeAct methodology.
 * 
 * These templates instruct the model to write executable code that will be run in a sandbox
 * environment with access to the available game functions.
 */

interface InitGamePromptArgs {
  gameSpecification: string;
  functionDocumentation: string;
  playerIds: string[];
}

interface ProcessActionPromptArgs {
  gameSpecification: string;
  functionDocumentation: string;
  playerId?: string;
  action?: string;
  currentState: string;
}

interface ErrorRecoveryPromptArgs {
  gameSpecification: string;
  functionDocumentation: string;
  errorMessage: string;
  operation: 'initialize' | 'process';
  playerId: string;
  playerIds?: string[];
  action: string | null;
  currentState: string;
}

/**
 * Creates a prompt for initializing a game using the CodeAct methodology
 */
export function createInitGamePrompt(args: InitGamePromptArgs): string {
  return `
You are a game master AI that manages a text-based game. You have access to a sandbox environment
where you can execute code to initialize a new game session.

# Game Specification
${args.gameSpecification}

# Available Functions
You have access to the following functions:
${args.functionDocumentation}

# Task
Implement the following function that initializes a new game:

\`\`\`javascript
/**
 * Initialize a new game with the provided player IDs
 * @param {string[]} playerIds - Array of player IDs to include in the game
 * @param {object} gameSpec - The game specification object
 * @returns {object} Object containing state and messages
 * 
 * @example
 * // This function will be called like this:
 * // ai_initializeGame(["${args.playerIds.join('", "')}"]);
 * // You only need to implement the function, not call it.
 */
function ai_initializeGame(playerIds, gameSpec) {
  // YOUR CODE GOES HERE
  // Use the playerIds array that's passed to this function
  // Create the initial game state
  // Generate welcome messages for all players
  
  // Return the result object with this structure
  return {
    state: {
      // Your game state goes here
    },
    messages: {
      public: ["Message visible to all players"],
      private: {
        // Each player ID should have an array of messages
      }
    }
  };
}
\`\`\`

IMPORTANT:
- Implement ONLY the body of the function
- DO NOT call the function yourself
- DO NOT use an IIFE pattern
- The function will be called by the system with the appropriate arguments
- Make sure you use the playerIds parameter that's passed to the function

Return your code wrapped in a code block with a complete implementation of the ai_initializeGame function.
`;
}

/**
 * Creates a prompt for processing a player action using the CodeAct methodology
 */
export function createProcessActionPrompt(args: ProcessActionPromptArgs): string {
  const playerIdExample = args.playerId ? `"${args.playerId}"` : "playerId";
  const actionExample = args.action ? `"${args.action}"` : "action";
  
  return `
You are a game master AI that manages a text-based game. You have access to a sandbox environment
where you can execute code to process player actions and update the game state.

# Game Specification
${args.gameSpecification}

# Available Functions
You have access to the following functions:
${args.functionDocumentation}

# Current Game State
\`\`\`json
${args.currentState}
\`\`\`

# Task
Implement the following function that processes a player action:

\`\`\`javascript
/**
 * Process an action taken by a player
 * @param {string} playerId - ID of the player taking the action
 * @param {string} action - The action text from the player
 * @param {object} currentState - Current game state
 * @param {object} gameSpec - The game specification object
 * @returns {object} Object containing updated state and messages
 * 
 * @example
 * // This function will be called like this:
 * // ai_processAction(${playerIdExample}, ${actionExample}, currentState, gameSpec);
 * // You only need to implement the function, not call it.
 */
function ai_processAction(playerId, action, currentState, gameSpec) {
  // YOUR CODE GOES HERE
  // Use the parameters that are passed to this function
  // Process the action based on current game state
  // Generate appropriate messages
  
  // Return the result object with this structure
  return {
    state: {
      // Updated game state goes here
    },
    messages: {
      public: ["Message visible to all players"],
      private: {
        // Each player ID should have an array of messages
      }
    }
  };
}
\`\`\`

IMPORTANT:
- Implement ONLY the body of the function
- DO NOT call the function yourself
- DO NOT use an IIFE pattern
- The function will be called by the system with the appropriate arguments
- Make sure you use the parameters that are passed to the function
- The currentState parameter contains the game state as shown above

Return your code wrapped in a code block with a complete implementation of the ai_processAction function.
`;
}

/**
 * Creates a prompt for recovering from an error using the CodeAct methodology
 */
export function createErrorRecoveryPrompt(args: ErrorRecoveryPromptArgs): string {
  const taskDescription = args.operation === 'initialize'
    ? `Initialize a new game for these players: ${args.playerIds?.join(', ')}`
    : `Process this action from player "${args.playerId}": "${args.action}"`;
  
  const functionSignature = args.operation === 'initialize'
    ? `function ai_initializeGame(playerIds, gameSpec)`
    : `function ai_processAction(playerId, action, currentState, gameSpec)`;
  
  const functionComment = args.operation === 'initialize'
    ? `/**
 * Initialize a new game with the provided player IDs
 * @param {string[]} playerIds - Array of player IDs to include in the game
 * @param {object} gameSpec - The game specification object
 * @returns {object} Object containing state and messages
 * 
 * @example
 * // This function will be called like this:
 * // ai_initializeGame(["${args.playerIds?.join('", "')}"]);
 * // You only need to implement the function, not call it.
 */`
    : `/**
 * Process an action taken by a player
 * @param {string} playerId - ID of the player taking the action
 * @param {string} action - The action text from the player
 * @param {object} currentState - Current game state
 * @param {object} gameSpec - The game specification object
 * @returns {object} Object containing updated state and messages
 * 
 * @example
 * // This function will be called like this:
 * // ai_processAction("${args.playerId}", "${args.action}", currentState, gameSpec);
 * // You only need to implement the function, not call it.
 */`;

  // Add clear example of the error and how to access functions
  const errorExample = args.errorMessage.includes('is not defined')
    ? `// ERROR EXAMPLE: The error "${args.errorMessage}" is likely because you're trying to
// use a function that does not exist.  Make sure you only call functions provided.`
    : `// ERROR to fix: "${args.errorMessage}"`;
  
  return `
You are a game master AI that manages a text-based game. You have access to a sandbox environment
where you can execute code to manage the game state, but there was an error with your previous code.

# Game Specification
${args.gameSpecification}

# Available Functions
You have access to the following functions:
${args.functionDocumentation}

# Current Game State
\`\`\`json
${args.currentState}
\`\`\`

# Error Information
The following error occurred while trying to ${args.operation} the game:
${args.errorMessage}

# Task
${taskDescription}

Implement the following function to fix the error:

\`\`\`javascript
${functionComment}
${functionSignature} {
  // YOUR CODE GOES HERE
  // Fix the error described above
  ${errorExample}
  
  // ${args.operation === 'initialize' ? 'Create the initial game state' : 'Process the action and update the game state'}
  // Generate appropriate messages for players
  
  // Return the result object with this structure
  return {
    state: {
      // ${args.operation === 'initialize' ? 'Initial' : 'Updated'} game state goes here
    },
    messages: {
      public: ["Message visible to all players"],
      private: {
        // Each player ID should have an array of messages
      }
    }
  };
}
\`\`\`

IMPORTANT:
- Implement ONLY the body of the function
- DO NOT call the function yourself
- Make sure you use the parameters that are passed to the function
- Avoid the error that occurred previously
- The function will be called by the system with the appropriate arguments

Return your code wrapped in a code block with a complete implementation of the ${args.operation === 'initialize' ? 'ai_initializeGame' : 'ai_processAction'} function.
`;
}

/**
 * Format variables into a prompt template (legacy version)
 * @param template The prompt template string with {variable} placeholders
 * @param variables Object containing variable values to insert
 * @returns Formatted prompt string
 */
export const formatPrompt = (
  template: string,
  variables: Record<string, string | string[]>
): string => {
  let result = template;
  
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{${key}}`;
    
    if (Array.isArray(value)) {
      result = result.replace(placeholder, value.join(', '));
    } else {
      result = result.replace(placeholder, value);
    }
  }
  
  return result;
};