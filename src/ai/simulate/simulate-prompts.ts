export const processGameSpecificationTemplate = `
  You are a game design expert analyzing requirements for a text-based game.
  Your task is to:
  1. Analyze the game requirements
  2. Define the state structure
  3. Provide a formal schema

  Review the following detailed specification for a game
  <game_specification>
  {gameSpecification}
  </game_specification>

  Perform an analysis of the game description and player information to set up the game state
  according to the provided schema and provide the necessary instructions.  Conduct your analysis 
  inside a <game_analysis> tag.

  <game_analysis>
  1. Core game state:
     - Game phases (setup, playing, finished)
     - Turn/round management
     - Victory conditions
     - Shared resources or board state

  2. Player-specific state:
     - What actions players can take
     - What resources or attributes they maintain
     - How their progress is tracked
     - How their current status is represented

  3. State structure:
     - Fields at game level vs player level
     - Required types and validation
     - Optional vs required fields
  </game_analysis>

  Based on the analysis, construct a formal schema for the game state according to the following format:

  Top Level Fields:
  1. game - Contains all game-level state fields
  2. players - Defines the structure for individual player states

  Important Nesting Rules:
  - Game state fields must be nested under the game object
  - Player state fields must be nested under the players object
  - Use items.properties to define the structure of nested objects
  - Do not use dot notation (e.g. "game.phase")

  Example Schema Structure:
  {{
    "fields": [
      {{
        "name": "game",
        "type": "object",
        "description": "Core game state tracking",
        "required": true,
        "items": {{
          "type": "object",
          "properties": {{
            "phase": {{
              "name": "phase",
              "type": "string",
              "description": "Current game phase",
              "required": true
            }},
            "currentRound": {{
              "name": "currentRound",
              "type": "number",
              "description": "Current round number",
              "required": true
            }}
          }}
        }}
      }},
      {{
        "name": "players",
        "type": "object",
        "description": "Player state tracking",
        "required": true,
        "items": {{
          "type": "object",
          "properties": {{
            "status": {{
              "name": "status",
              "type": "string",
              "description": "Player's current status",
              "required": true
            }},
            "score": {{
              "name": "score",
              "type": "number",
              "description": "Player's current score",
              "required": true
            }}
          }}
        }}
      }}
    ]
  }}

  {formattingInstructions}

  Requirements:
  1. Follow the exact schema structure shown
  2. All fields must be properly typed
  3. Use null for uninitialized values
`;

export const migrateTemplate = ``;

export const runtimeInitializeTemplate = `
  You are an AI simulation expert tasked with initializing a text-based game simulation.
  You will set up the initial game state and provide welcome messages and initial instructions 
  to all players.

  The specification of the game is as follows:
  <game_specification>
  {gameSpecification}
  </game_specification>

  The players participating in the game are:
  <players>
  {players}
  </players>

  The schema for the game state is as follows:
  <schema>
  {gameStateSchema}
  </schema>

  Important State Conventions:
  - All counting for game and player state (e.g. round) starts at 1.
  - Use null for uninitialized values.

  Perform an analysis of the game specification and player information to set up the game state
  according to the provided schema and provide the necessary instructions.  Conduct your analysis 
  inside a <game_analysis> tag.

  <game_analysis>
  1. Looking at the properties in the schema and the game specification, list out starting values
     for each player and the game state.
  2. List out messages to send to the players including:
      - Welcome messages
      - The starting game state
      - Initial instructions and the actions that are valid for the players to take
        at game start.
      - Any input needed from the players to start the game.
  </game_analysis>

  Based on the analysis, initialize the game state and provide welcome messages including 
  initial instructions according to the following format:
  {formattingInstructions}
`;

export const runtimeProcessActionTemplate = `
  You are an AI game master responsible for processing and updating an EXISTING game state based on incoming 
  player actions. You do NOT initialize new games - you only process actions within an ongoing game session. 
  
  Your task is to:
  1. Process the incoming player action against the current game state
  2. Update the game state accordingly
  3. Generate appropriate messages for all players

  Here is the game specification:
  <game_specification>
  {gameSpecification}
  </game_specification>

  Here is the current game state:
  <game_state>
  {gameState}
  </game_state>

  Important State Conventions:
  - All counting for game and player state (e.g. round) starts at 1.

  Here is the action taken by a player:
  <player_action>
  {playerAction}
  </player_action>

  You MUST think carefully about the current state of the game and the player action 
  and perform a thorough analysis of the situation. Conduct your analysis inside 
  <game_analysis> tags.

  <game_analysis>
  Current State Analysis
  1. Break down the current game state, listing key information for each player.
  2. List all possible valid actions for each player in the current state.
  3. Analyze the player's action:
    - Is it valid? If not, explain why.
    - How does it affect the current round and overall game state?
  4. Write out the exact updates needed for the game state based on the player action.
  5.  List the messages that should be sent to each player based on the state updates, including
      - Informing players of their opponents actions.  IMPORTANT - never reveal the specific 
        actions of other players unless the game rules specify that the player action is public (
        e.g. by specifying that a card is played face up or a player choice is shown to other players).
      - Updates to the game state.
      - The valid actions and/or input required from each player.
  6. Check for any special game conditions or rules that might apply in the current situation.
  7. For each player, write down their current score and status, numbering each player as you go.
  8. If any player has made an illegal move, note how many illegal moves they've made so far.

  Next State Analysis
  1.  Determine if the player action should result in a transition to another phase or round.
  2.  List the required updates to the state, including:
      - Advancing to the next round if the current round is complete
      - Incrementing the round number
      - Updating the game phase
      - Resetting any temporary state for the game or players (such as actions or choices)
  3.  List the messages that should be sent to the players 
      - Informing the player that the next round, phase, etc... has begun 
      - Inform players of the legal actions and request their choice for the next round 

  End Game Analysis
  1.  Determine if the player action completes the final round, phase, etc... of the game
  2.  If end game is warranted, tally final scores.
  3.  If end game is warranted, list the messages that should be sent to the players
      - Informing players that the game has ended
      - Informing the players of the final results of the game

  Final Analysis
  1.  List out the combined state taking into account Current State Analysis, Next State Analysis, and End Game Analysis
  2.  List out the combined messages to each player taking into account Current State Analysis, Next State Analysis, and End Game Analysis
  </game_analysis>

  After your analysis, follow these steps:

  1. Process the player action and update the game state according to the Final Analysis.  Include all messages to players identified in the final analysis.

  2. If the action completes a round:
    a. Resolve the round (determine the winner)
    b. Update scores
    c. Clear player choices
    d. Advance to the next round or end the game if all rounds are complete

  3. Provide messages for all players. These messages must include:
    - What happened (results of the action and/or round)
    - What to do next (instructions for the next action or round)
    - Specific options or choices available to the player

  4. Format your response as a JSON object that adheres to the provided schema.  
  CRITICAL: Provide ALL state updates and messages in a SINGLE JSON response.

  Important Rules:
  - If a player makes an invalid move, remind them of the rules and valid actions.
  - Track illegal action count (reset on legal action).
  - End the game after 3 illegal actions or if a player attempts to circumvent the rules.
  - When the game ends, set the gameEnded flag to true and provide final results to all 
    players.
  - Always include clear instructions for the next possible actions in player messages to 
    ensure the game doesn't get stuck.
  - If the current round is complete, update the state to reflect that we are in the next 
    round within the same execution.
  
  Provide updated game state and player messages according to the following format:
  {formattingInstructions}
  
  Remember to process all updates and messaging in your single response, and ensure that 
  your output is a valid JSON object according to the provided schema. Always include 
  clear instructions for the next possible actions in player messages to keep the game 
  moving forward.
`;