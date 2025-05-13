// filepath: /Users/ericwood/dev/projects/ChainCraft/game-builder/src/ai/codeact/function-designer.ts
import { Base } from 'discord.js';
import { invokeModel } from './utils.js';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * Function interface
 */
export interface FunctionDefinition {
  name: string;
  signature: string;
  params: string[];
  importance: string;
  purpose: string;
}

/**
 * Function design interface
 */
export interface FunctionDesign {
  fullText: string;
  functions: FunctionDefinition[];
}

/**
 * Function design result interface
 */
export interface FunctionDesignResult {
  functionDesign: FunctionDesign;
  functionDesignTime: number;
}

/**
 * Function design options interface
 */
export interface FunctionDesignOptions {
  gameSpecification: string;
  stateSchema: string;
  runtimePlan: string;
}

/**
 * Extract the section describing what aspects the AI will handle directly
 * Uses XML tags for reliable extraction
 * @param {string} designText - The full text of the function design
 * @returns {string} The extracted section about AI capabilities, or empty string if not found
 */
export const extractAICapabilitiesSection = (designText: string): string => {
  // Look for content between <AICapabilities> XML tags
  const tagPattern = /<AICapabilities>([\s\S]*?)<\/AICapabilities>/i;
  const match = designText.match(tagPattern);
  
  if (match && match[1]) {
    return match[1].trim();
  }
  
  // Fallback for backward compatibility - only used if XML tags aren't present
  console.log("Warning: <AICapabilities> XML tags not found in function design. Using fallback extraction.");
  
  // Try to find a section with a common heading pattern
  const aiCapabilityPatterns = [
    /#+\s*AI-Handled\s+Capabilities\s*\n([\s\S]*?)(?=#+|$)/i,
    /#+\s*Capabilities\s+Handled\s+Directly\s*\n([\s\S]*?)(?=#+|$)/i,
    /#+\s*What\s+I'll\s+Handle\s+Directly\s*\n([\s\S]*?)(?=#+|$)/i
  ];
  
  for (const pattern of aiCapabilityPatterns) {
    const headingMatch = designText.match(pattern);
    if (headingMatch && headingMatch[1]) {
      return headingMatch[1].trim();
    }
  }
  
  return '';
};

/**
 * Extracts function definitions from the function design text
 * @param {string} designText - The full text of the function design
 * @returns {FunctionDefinition[]} List of function objects with name, signature, and importance
 */
export const extractFunctionsFromDesign = (designText: string): FunctionDefinition[] => {
  const functions: FunctionDefinition[] = [];
  
  // Pattern to match function headers with their signatures
  // Looks for: ### X. functionName(param1, param2) - PRIORITY
  const functionHeaderPattern = /###\s*\d+\.\s*(\w+\([^)]*\))\s*-\s*(CRITICAL|IMPORTANT|critical|important)/g;
  let match;
  
  while ((match = functionHeaderPattern.exec(designText)) !== null) {
    const fullSignature = match[1].trim();
    const importance = match[2].toLowerCase();
    
    // Extract function name from signature (everything before the first parenthesis)
    const functionName = fullSignature.split('(')[0].trim();
    
    // Extract parameters
    const paramsMatch = fullSignature.match(/\(([^)]*)\)/);
    const paramString = paramsMatch ? paramsMatch[1] : '';
    const params = paramString.split(',')
      .map(param => param.trim())
      .filter(param => param.length > 0);
    
    // Extract purpose from the section
    const sectionStart = match.index;
    const sectionEnd = designText.indexOf('###', sectionStart + 1);
    const section = sectionEnd !== -1 ? 
      designText.substring(sectionStart, sectionEnd) : 
      designText.substring(sectionStart);
    
    // Extract the purpose description
    const purposeMatch = section.match(/\*\*Purpose:\*\*\s*([^\n]+)/);
    const purpose = purposeMatch ? purposeMatch[1].trim() : '';
    
    functions.push({
      name: functionName,
      signature: fullSignature,
      params,
      importance,
      purpose
    });
  }
  
  // Fallback in case the primary pattern doesn't match
  if (functions.length === 0) {
    // Simple pattern to find function names
    const simplePattern = /(\w+)\s*\([^)]*\)\s*[-:]\s*(critical|important)/gi;
    while ((match = simplePattern.exec(designText)) !== null) {
      functions.push({
        name: match[1].trim(),
        signature: `${match[1].trim()}()`,
        params: [],
        importance: match[2].toLowerCase(),
        purpose: ''
      });
    }
  }
  
  return functions;
};

/**
 * Stage 4: Design function library based on the runtime plan
 * @param {BaseChatModel} model - The language model to use
 * @param {FunctionDesignOptions} options - Options object
 * @returns {Promise<FunctionDesignResult>} Function design and timing information
 */
export const designFunctionLibrary = async (
  model: BaseChatModel, 
  { gameSpecification, stateSchema, runtimePlan }: FunctionDesignOptions
): Promise<FunctionDesignResult> => {
  console.log("📚 Stage 4: Designing function library...");
  const startTime = Date.now();
  
  const prompt = `
    You are an AI game master designing a minimalist function library for the ${gameSpecification} game.
    
    Runtime Plan:
    ${runtimePlan}
    
    State Schema:
    ${stateSchema}
    
    IMPORTANT: As an AI system, you can naturally handle many aspects of game management through your conversation, 
    like explaining rules, formatting messages, and managing basic game flow. You only need functions for operations 
    that require strict consistency, state management, or that compensate for your limitations.
    
    For this task:
    1. First analyze what parts of gameplay you can handle directly through your normal capabilities
    2. Then identify only the essential functions needed to maintain game integrity and consistent state
    3. Focus on functions that manage critical state transitions and rule enforcement
    
    For each truly necessary function:
    - Provide a name and purpose
    - Describe inputs and outputs
    - Explain why this specific function is needed rather than handling it in conversation
    - Rank the function as either "critical" (absolutely required) or "important" (strongly recommended)
    
    Prioritize functions based on:
    1. State integrity - Functions that ensure the game state remains valid and consistent
    2. Core mechanics - Functions that implement the fundamental rules that determine outcomes
    3. State transitions - Functions that manage progression through game phases
    
    Avoid creating functions for:
    - Message formatting or text generation (you can do this directly)
    - Basic validation that can be done inline
    - Helper utility functions that don't directly impact game integrity
    
    Return a markdown document with:
    1. A section describing what you'll handle directly in conversation, wrapped in <AICapabilities> XML tags like this:
       <AICapabilities>
       Description of what you'll handle in conversation...
       </AICapabilities>
    
    2. Your prioritized list of essential functions, using this exact format for each function:
    
       ### X. functionName(param1, param2) - PRIORITY
       
       **Purpose:** Brief description of what the function does
       
       **Inputs:** 
       - param1: description of parameter 1
       - param2: description of parameter 2
       
       **Outputs:** What the function returns
       
       **Justification:** Why this function needs formal implementation
       
    3. IMPORTANT: Do NOT include any code implementation whatsoever. Only provide function signatures and descriptions.
    
    Limit your design to a maximum of 8 functions total, focusing on quality over quantity.
  `;
  
  const response = await invokeModel(model, prompt);
  
  const functionDesignTime = Date.now() - startTime;
  console.log(`✅ Function library design completed in ${functionDesignTime}ms`);
  
  // Extract function names and details from the response
  const functionDesign: FunctionDesign = {
    fullText: response.content,
    functions: extractFunctionsFromDesign(response.content)
  };
  
  console.log(`Found ${functionDesign.functions.length} prioritized functions to implement`);
  return { 
    functionDesign,
    functionDesignTime
  };
};

/**
 * Extract a description for a specific function from the function design document
 * @param {string} functionName - The name of the function to find
 * @param {string} designText - The full text of the function design document
 * @returns {string} A description of the function's purpose
 */
export const extractFunctionDescription = (functionName: string, designText: string): string => {
  // Try to find a section specifically about this function
  const functionSectionPatterns = [
    // Match markdown headers with the function name followed by content
    new RegExp(`###\\s*\`?${functionName}\`?[\\s\\S]*?\\n([\\s\\S]*?)(?=###|$)`, 'i'),
    // Match function name with "Purpose:" or "Description:" label
    new RegExp(`\\b${functionName}\\b[\\s\\S]*?(?:Purpose|Description):\\s*([^\\n]+)`, 'i'),
    // Match function name in bold/code with following text
    new RegExp(`(?:\\*\\*|\`)${functionName}(?:\\*\\*|\`)[\\s\\S]*?(?:-|:)\\s*([^\\n]+)`, 'i')
  ];

  for (const pattern of functionSectionPatterns) {
    const match = designText.match(pattern);
    if (match && match[1]) {
      // Clean up the description
      let desc = match[1].trim();
      
      // If we matched a whole section, try to extract just the purpose/description line
      if (desc.length > 150) {
        const shortDescMatch = desc.match(/(?:Purpose|Description):\s*([^\n]+)/i);
        if (shortDescMatch) {
          desc = shortDescMatch[1].trim();
        } else {
          // Just take the first line if it's too long
          desc = desc.split('\n')[0].trim();
        }
      }
      
      // Remove markdown formatting
      desc = desc.replace(/\*\*/g, '').replace(/`/g, '');
      
      return desc;
    }
  }

  // If specific section not found, scan for any mention of the function name
  const lines = designText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(functionName)) {
      // Found function name in a line, grab this line and potentially the next for context
      let desc = line.trim();
      
      // If this line is just a header/title, get the next line for more context
      if (desc.length < 50 && i < lines.length - 1) {
        const nextLine = lines[i+1].trim();
        if (nextLine && !nextLine.startsWith('#') && !nextLine.includes('function')) {
          desc = nextLine;
        }
      }
      
      // Clean up the description, removing the function name and common markers
      desc = desc.replace(new RegExp(`\\b${functionName}\\b`, 'g'), '')
                 .replace(/^[-*#]+\s*/, '')  // Remove list markers
                 .replace(/^\(`[^`]*`\):\s*/, '')  // Remove function signature
                 .trim();
                 
      if (desc) return desc;
    }
  }

  // If all else fails, return a generic description
  return `Implementation for the ${functionName} function`;
};