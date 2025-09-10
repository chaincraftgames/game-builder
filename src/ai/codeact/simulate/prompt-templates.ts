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
  stateSchema?: string;
}

interface ProcessActionPromptArgs {
  gameSpecification: string;
  functionDocumentation: string;
  playerId?: string;
  action?: string;
  currentState: string;
  stateSchema?: string;
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
  stateSchema?: string;
}

/**
 * Creates a prompt for initializing a game using the CodeAct methodology
 */
export function createInitGamePrompt(args: InitGamePromptArgs): string {
  const schemaSection = args.stateSchema ? `
# State Schema
The game state must conform to this schema structure:
\`\`\`json
${args.stateSchema}
\`\`\`

# State Structure Guidelines
- Follow the exact field names and structure defined in the schema
- Do NOT assume field names - use only what's defined in the schema
- Use the schema as the source of truth for all state field references
- Nested objects should follow the schema's properties structure
` : '';

  return `
You are a game master AI that manages a text-based game. You have access to a sandbox environment
where you can execute code to initialize a new game session.

# Game Specification
${args.gameSpecification}

# Available Functions
The sandbox environment provides these functions that you can call directly:
${args.functionDocumentation}

${schemaSection}

# Function Responsibility
This function ONLY handles game initialization. Do NOT handle action processing or other game logic.

# State Management Pattern
- Call the appropriate initialization function(s) from the available functions
- The function will return a complete game state object
- Use that state object directly in your return value
- Do NOT wrap or modify the returned state object

# Message Guidelines
Generate concise, relevant messages:
- public: Messages visible to all players (game announcements)
- private: Player-specific messages (personal notifications)

Example message structure:
- public: ["Game started!", "Round 1 begins!"]
- private: { "player1": ["You are Player 1"], "player2": ["You are Player 2"] }

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
  // Call the appropriate initialization function from the available functions
  // Generate welcome messages for all players
  
  // Pattern: Use the complete state object returned by initialization functions
  return {
    state: gameStateFromInitFunction,  // Complete game state object
    messages: {
      public: ["Concise public messages"],
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
- Use the complete state object returned by initialization functions
- Keep messages concise and relevant
${args.stateSchema ? '- Follow the exact state structure defined in the schema above' : ''}

Return your code wrapped in a code block with a complete implementation of the ai_initializeGame function.
`;
}

/**
 * Creates a prompt for processing a player action using the CodeAct methodology
 */
export function createProcessActionPrompt(args: ProcessActionPromptArgs): string {
  const playerIdExample = args.playerId ? `"${args.playerId}"` : "playerId";
  const actionExample = args.action ? `"${args.action}"` : "action";
  
  const schemaSection = args.stateSchema ? `
# State Schema
The game state must conform to this schema structure:
\`\`\`json
${args.stateSchema}
\`\`\`

# State Structure Guidelines
- Follow the exact field names and structure defined in the schema
- Do NOT assume field names - use only what's defined in the schema
- Use the schema as the source of truth for all state field references
- Nested objects should follow the schema's properties structure
- When checking conditions, use the field names from the schema
` : '';
  
  return `
You are a game master AI that manages a text-based game. You have access to a sandbox environment
where you can execute code to process player actions and update the game state.

# Game Specification
${args.gameSpecification}

# Available Functions
The sandbox environment provides these functions that you can call directly:
${args.functionDocumentation}

# Current Game State
\`\`\`json
${args.currentState}
\`\`\`

${schemaSection}

# Function Responsibility & Assumptions
This function ONLY handles action processing. Critical assumptions:
- The game is ALREADY INITIALIZED when this function is called
- You do NOT need to check if the game state is empty
- You do NOT need to handle game initialization within this function
- The currentState parameter will always contain a valid, initialized game state
- Do NOT mix initialization logic with action processing

# State Management Pattern
1. Validate the action using available validation functions
2. If validation fails, return the current state unchanged with error message
3. Apply state changes using available functions
4. Return the complete updated state object (not wrapped or modified)

# Error Handling Pattern
Handle validation errors gracefully:
- If validation fails, return current state with private error message to the player
- Use try/catch for function calls that might throw exceptions
- Keep error messages clear and actionable

# Message Guidelines
Generate concise, relevant messages:
- public: Game announcements visible to all players
- private: Player-specific notifications and feedback

Example message patterns:
- Successful action: private message to acting player, public message if needed
- Invalid action: private error message to acting player only
- Game events: public messages about round results, game state changes

# Task
Implement the following function that processes a player action:

\`\`\`javascript
/**
 * Process an action taken by a player
 * @param {string} playerId - ID of the player taking the action
 * @param {string} action - The action text from the player
 * @param {object} currentState - Current game state (guaranteed to be initialized)
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
  // Step 1: Validate the action (currentState is guaranteed to be initialized)
  // Step 2: Apply the validated action using available functions
  // Step 3: Handle any follow-up game logic using available functions
  // Step 4: Return the updated state with appropriate messages
  
  // Pattern: Always return complete state object from functions
  return {
    state: completeUpdatedState,  // Complete game state object from functions
    messages: {
      public: ["Concise public messages"],
      private: {
        [playerId]: ["Player-specific messages"]
      }
    }
  };
}
\`\`\`

IMPORTANT:
- Implement ONLY the body of the function
- DO NOT call the function yourself
- DO NOT use an IIFE pattern
- DO NOT handle game initialization
- The function will be called by the system with the appropriate arguments
- Use complete state objects returned by available functions
- Keep messages concise and relevant
${args.stateSchema ? '- Follow the exact state structure defined in the schema above' : ''}
${args.stateSchema ? '- Do NOT hardcode field names - use only what exists in the schema' : ''}

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
 * @param {object} currentState - Current game state (guaranteed to be initialized)
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
    ? `// ERROR ANALYSIS: The error "${args.errorMessage}" suggests you tried to
// call a function that doesn't exist. Only use functions from the Available Functions list.`
    : `// ERROR TO FIX: "${args.errorMessage}"`;

  const specificGuidance = args.operation === 'initialize'
    ? `# Function Responsibility
This function ONLY handles game initialization. Do NOT handle action processing.

# Key Points for Initialization:
- Use the playerIds array that's passed to the function
- Call appropriate initialization function(s) from available functions
- Return the complete state object from initialization functions
- Generate welcome messages for players`
    : `# Function Responsibility & Assumptions
This function ONLY handles action processing. Key assumptions:
- The game is ALREADY INITIALIZED (do not check for empty states)
- Do NOT handle initialization logic
- The currentState parameter contains a valid, initialized game state
- Focus only on processing the specific action provided

# Key Points for Action Processing:
- Validate the action using available functions
- Apply state changes using available functions
- Return complete updated state objects from functions
- Generate appropriate response messages`;

  const schemaSection = args.stateSchema ? `
# State Schema
The game state must conform to this schema structure:
\`\`\`json
${args.stateSchema}
\`\`\`

# State Structure Guidelines
- Follow the exact field names and structure defined in the schema
- Do NOT assume field names - use only what's defined in the schema
- Use the schema as the source of truth for all state field references
- Nested objects should follow the schema's properties structure
- This may help you avoid the error that occurred previously
` : '';
  
  return `
You are a game master AI that manages a text-based game. You have access to a sandbox environment
where you can execute code to manage the game state, but there was an error with your previous code.

# Game Specification
${args.gameSpecification}

# Available Functions
The sandbox environment provides these functions that you can call directly:
${args.functionDocumentation}

# Current Game State
\`\`\`json
${args.currentState}
\`\`\`

${schemaSection}

# Error Information
The following error occurred while trying to ${args.operation} the game:
${args.errorMessage}

${specificGuidance}

# State Management Pattern
- Use complete state objects returned by available functions
- Do NOT wrap or modify state objects returned by functions
- Handle function errors with try/catch blocks
- Return current state unchanged if validation fails

# Message Guidelines
Generate concise, relevant messages:
- Keep error messages clear and actionable
- Use private messages for player-specific feedback
- Use public messages for game-wide announcements

# Task
${taskDescription}

Fix the error and implement the following function:

\`\`\`javascript
${functionComment}
${functionSignature} {
  // YOUR CODE GOES HERE
  ${errorExample}
  
  // ${args.operation === 'initialize' ? 'Call initialization functions and return complete state' : 'Process action using available functions and return updated state'}
  // Generate appropriate messages for players
  // Handle errors gracefully
  
  // Pattern: Return complete state object from functions
  return {
    state: completeStateObject,  // Complete state from available functions
    messages: {
      public: ["Concise public messages"],
      private: {
        // Player-specific messages
      }
    }
  };
}
\`\`\`

IMPORTANT:
- Implement ONLY the body of the function
- DO NOT call the function yourself
- Fix the specific error that occurred
- Use only functions from the Available Functions list
- ${args.operation === 'initialize' ? 'Do NOT handle action processing' : 'Do NOT handle initialization logic'}
- Return complete state objects from available functions
${args.stateSchema ? '- Follow the exact state structure defined in the schema above' : ''}
${args.stateSchema ? '- Do NOT hardcode field names - use only what exists in the schema' : ''}

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