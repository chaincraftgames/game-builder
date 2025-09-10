/**
 * Simplified function registry focused on two core use cases:
 * 1. Providing function implementations for sandbox execution
 * 2. Providing function descriptions for AI prompts
 */

import * as doctrine from 'doctrine';
import * as acorn from 'acorn';

/**
 * Function definition with backward compatibility
 * Core fields: name, impl, description
 * Legacy fields: code, signature (computed from name for compatibility)
 */
export interface FunctionDefinition {
  name: string;        // Function name
  impl: string;        // Function body for sandbox execution
  description: string; // Human-readable description for AI prompts
}

export interface FunctionRegistry {
  getAllFunctions(): FunctionDefinition[];
}

/**
 * Parse JSDoc comment using doctrine and convert to AI-friendly format
 */
function parseJSDocForAI(jsdocText: string, functionName: string): string {
  try {
    // Parse JSDoc with doctrine
    const parsed = doctrine.parse(jsdocText, { unwrap: true, sloppy: true });
    
    // Start with function name so AI knows what to call
    let description = `${functionName}\n\n`;
    
    // Add main description
    if (parsed.description) {
      description += `${parsed.description}\n`;
    } else {
      description += `Function ${functionName}\n`;
    }
    
    // Add parameter information if available
    const params = parsed.tags?.filter(tag => tag.title === 'param') || [];
    if (params.length > 0) {
      description += '\nParameters:';
      params.forEach(param => {
        const name = param.name || 'unknown';
        const type = param.type ? getTypeString(param.type) : 'any';
        const desc = param.description || 'No description';
        description += `\n- ${name} (${type}): ${desc}`;
      });
    }
    
    // Add return information if available
    const returnTag = parsed.tags?.find(tag => tag.title === 'returns' || tag.title === 'return');
    if (returnTag) {
      const type = returnTag.type ? getTypeString(returnTag.type) : 'unknown';
      const desc = returnTag.description || 'No description';
      description += `\nReturns: ${type}: ${desc}`;
    }
    
    return description;
  } catch (error) {
    console.warn(`Failed to parse JSDoc for ${functionName}:`, error);
    return `${functionName}\n\nFunction ${functionName}`;
  }
}

/**
 * Convert doctrine type object to string
 */
function getTypeString(type: any): string {
  if (!type) return 'any';
  
  switch (type.type) {
    case 'NameExpression':
      return type.name;
    case 'UnionType':
      return type.elements?.map((e: any) => getTypeString(e)).join(' | ') || 'any';
    case 'ArrayType':
      return `${getTypeString(type.elements?.[0])}[]`;
    default:
      return type.name || 'any';
  }
}

/**
 * AST-based function parser using acorn for reliable parsing
 * Handles all JavaScript function types properly
 */
function parseFunctions(code: string): FunctionDefinition[] {
  if (!code) return [];
  
  try {
    // Track JSDoc comments separately as we parse
    const jsdocComments: any[] = [];
    
    const ast = acorn.parse(code, {
      ecmaVersion: 2022,
      sourceType: 'module',
      allowHashBang: true,
      allowReturnOutsideFunction: true,
      onComment: (isBlock: boolean, text: string, start: number, end: number) => {
        // Only collect JSDoc comments (block comments starting with *)
        if (isBlock && text.startsWith('*')) {
          jsdocComments.push({
            text: `/**${text}*/`,
            start,
            end
          });
        }
      }
    });
    
    const functions: FunctionDefinition[] = [];
    const foundFunctions: Array<{node: any, info: {name: string, start: number, end: number}}> = [];
    
    // First pass: collect all functions
    function walk(node: any, parent?: any) {
      if (!node || typeof node !== 'object') return;
      
      let functionInfo: {name: string, start: number, end: number} | null = null;
      
      // Function Declaration: function name() {}
      if (node.type === 'FunctionDeclaration' && node.id?.name) {
        functionInfo = {
          name: node.id.name,
          start: node.start,  // Include the entire function
          end: node.end       // Include the entire function
        };
      }
      // Variable Declaration with Arrow Function: const name = () => {}
      else if (node.type === 'VariableDeclaration') {
        // Look for arrow function in variable declarations
        for (const declarator of node.declarations) {
          if (declarator.id?.name && 
              declarator.init?.type === 'ArrowFunctionExpression') {
            const arrow = declarator.init;
            
            if (arrow.body.type === 'BlockStatement') {
              // Arrow with block: const name = () => { ... }
              functionInfo = {
                name: declarator.id.name,
                start: node.start,  // Include entire variable declaration
                end: node.end       // Include entire variable declaration
              };
            } else {
              // Arrow with expression: const name = () => expr
              functionInfo = {
                name: declarator.id.name,
                start: node.start,  // Include entire variable declaration
                end: node.end       // Include entire variable declaration
              };
            }
            break; // Only handle first arrow function per declaration
          }
        }
      }
      
      if (functionInfo) {
        foundFunctions.push({ node, info: functionInfo });
      }
      
      // Recursively walk child nodes
      for (const key in node) {
        if (key !== 'parent') {
          const child = node[key];
          if (Array.isArray(child)) {
            child.forEach(item => walk(item, node));
          } else if (child && typeof child === 'object') {
            walk(child, node);
          }
        }
      }
    }
    
    walk(ast);
    
    // Second pass: sort functions by position and match with JSDoc comments
    foundFunctions.sort((a, b) => a.node.start - b.node.start);
    
    let lastUsedCommentIndex = -1;
    
    for (const { node, info: functionInfo } of foundFunctions) {
      // Extract function body
      const impl = code.substring(functionInfo.start, functionInfo.end).trim();
      
      // Find the next unused JSDoc comment before this function
      let description = `${functionInfo.name}\n\nFunction ${functionInfo.name}`;
      
      for (let i = lastUsedCommentIndex + 1; i < jsdocComments.length; i++) {
        const comment = jsdocComments[i];
        
        // Comment must come before the function
        if (comment.end <= node.start) {
          // Check if there's only whitespace between comment and function
          const betweenText = code.substring(comment.end, node.start);
          if (/^\s*$/.test(betweenText)) {
            description = parseJSDocForAI(comment.text, functionInfo.name);
            lastUsedCommentIndex = i;
            break;
          }
        }
      }
      
      functions.push({
        name: functionInfo.name,
        impl: impl,
        description
      });
    }
    return functions;
    
  } catch (error) {
    console.warn('Failed to parse JavaScript with acorn:', error);
    // Fallback to empty array rather than crash
    return [];
  }
}

/**
 * Create a function registry from function code
 */
export function initializeFunctionRegistry(functionCode: string): FunctionRegistry {
  const functions = new Map<string, FunctionDefinition>();
  
  if (functionCode.trim()) {
    const parsed = parseFunctions(functionCode);
    for (const fn of parsed) {
      functions.set(fn.name, fn);
    }
  }
  
  return {
    getAllFunctions(): FunctionDefinition[] {
      return Array.from(functions.values());
    }
  };
}

