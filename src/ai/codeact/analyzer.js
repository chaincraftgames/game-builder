import { invokeModel } from './utils.js';

/**
 * Stage 1: Analyze a game specification in depth
 * @param {Object} model - The language model to use
 * @param {string} gameSpecification - The game specification to analyze
 * @returns {Object} Analysis results and timing information
 */
export const analyzeGameSpecification = async (model, gameSpecification) => {
  console.log("🔍 Stage 1: Analyzing game specification...");
  const startTime = Date.now();
  
  const prompt = `
    You are an expert game designer analyzing a game specification.
    
    Game Specification:
    ${gameSpecification}
    
    Analyze this specification by answering these questions:
    
    1. Core Game Mechanics:
       - What are the fundamental rules that govern gameplay?
       - What actions can players take?
       - How do these actions interact with each other?
    
    2. Game State:
       - What information needs to be tracked throughout the game?
       - Which state elements are global vs. player-specific?
       - What state transitions occur during gameplay?
    
    3. Game Flow:
       - How does a typical gameplay session progress?
       - What are the distinct phases or stages?
       - What conditions trigger transitions between phases?
    
    4. Win Conditions:
       - How is the winner determined?
       - What scoring mechanisms exist?
    
    5. Edge Cases:
       - What special situations might arise?
       - How should ties or unusual situations be handled?
    
    Provide a detailed analysis for each section. Use markdown formatting to structure your response.
    Make sure to include:
    - Core mechanics and rules in markdown format
    - A list of player actions
    - A list of global state elements with name, purpose and type
    - A list of player state elements with name, purpose and type
    - A description of game flow and phases
    
    The next stage will use this analysis to create a structured state schema.
  `;
  
  const response = await invokeModel(model, prompt);
  
  const analysisTime = Date.now() - startTime;
  console.log(`✅ Game analysis completed in ${analysisTime}ms`);
  
  // Parse the response to extract key information for the next stage
  const analysisText = response.content;
  
  // Extract the list of state elements for the next stage
  // This is a simple extraction to pass structured data to the next stage
  let globalStateElements = [];
  let playerStateElements = [];
  
  try {
    // Simple regex matching to extract state elements from markdown lists
    const globalStateRegex = /Global State Elements[:\s]*\n((?:-[^\n]+\n)+)/i;
    const playerStateRegex = /Player State Elements[:\s]*\n((?:-[^\n]+\n)+)/i;
    
    const globalStateMatch = analysisText.match(globalStateRegex);
    const playerStateMatch = analysisText.match(playerStateRegex);
    
    if (globalStateMatch && globalStateMatch[1]) {
      const elements = globalStateMatch[1].split('\n').filter(line => line.trim().startsWith('-'));
      globalStateElements = elements.map(element => {
        const parts = element.replace('-', '').trim().split(':');
        return {
          name: parts[0]?.trim() || "Unknown",
          purpose: parts[1]?.trim() || "Not specified",
          type: parts[1]?.includes('(') ? 
            parts[1].match(/\(([^)]+)\)/)?.[1] || "Unknown" : "Unknown"
        };
      });
    }
    
    if (playerStateMatch && playerStateMatch[1]) {
      const elements = playerStateMatch[1].split('\n').filter(line => line.trim().startsWith('-'));
      playerStateElements = elements.map(element => {
        const parts = element.replace('-', '').trim().split(':');
        return {
          name: parts[0]?.trim() || "Unknown",
          purpose: parts[1]?.trim() || "Not specified",
          type: parts[1]?.includes('(') ? 
            parts[1].match(/\(([^)]+)\)/)?.[1] || "Unknown" : "Unknown"
        };
      });
    }
  } catch (error) {
    console.log("Warning: Could not extract structured state elements from analysis, but proceeding anyway.");
  }
  
  // Create a simplified analysis object with the extracted information
  const analysis = {
    fullText: analysisText,
    gameState: {
      globalState: globalStateElements,
      playerState: playerStateElements
    }
  };
  
  return { 
    analysis,
    analysisTime
  };
};