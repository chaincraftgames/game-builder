/**
 * Simplified function registry focused on two core use cases:
 * 1. Providing function implementations for sandbox execution
 * 2. Providing function descriptions for AI prompts
 */

import doctrine from 'doctrine';
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
  // Legacy compatibility fields
  code?: string;       // Complete function code (optional, for compatibility)
  signature?: string;  // Function signature (optional, computed from name)
}

/**
 * Function registry interface
 */
export interface FunctionRegistry {
  getAllFunctions(): FunctionDefinition[];
  hasFunction(name: string): boolean;
  getFunction(name: string): FunctionDefinition | undefined;
  getFunctionDocumentation(): string; // For AI prompts
}

/**
 * Parse JSDoc comment using doctrine and convert to AI-friendly format
 */
function parseJSDocForAI(jsdocText: string, functionName: string): string {
  try {
    // Parse JSDoc with doctrine
    const parsed = doctrine.parse(jsdocText, { unwrap: true, sloppy: true });
    
    let description = parsed.description || `Function ${functionName}`;
    
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
    return `Function ${functionName}`;
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
export function parseFunctions(code: string): FunctionDefinition[] {
  if (!code) return [];
  
  try {
    // Collect comments during parsing
    const comments: any[] = [];
    const ast = acorn.parse(code, {
      ecmaVersion: 2022,
      sourceType: 'module',
      allowHashBang: true,
      allowReturnOutsideFunction: true,
      onComment: comments
    });
    
    const functions: FunctionDefinition[] = [];
    
    // Walk the AST to find function declarations and expressions
    function walk(node: any, parent?: any) {
      if (!node || typeof node !== 'object') return;
      
      let functionInfo: {name: string, start: number, end: number} | null = null;
      
      // Function Declaration: function name() {}
      if (node.type === 'FunctionDeclaration' && node.id?.name) {
        functionInfo = {
          name: node.id.name,
          start: node.body.start + 1, // Skip opening brace
          end: node.body.end - 1      // Skip closing brace
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
              // Arrow with block: () => { ... }
              functionInfo = {
                name: declarator.id.name,
                start: arrow.body.start + 1,
                end: arrow.body.end - 1
              };
            } else {
              // Arrow with expression: () => expr
              functionInfo = {
                name: declarator.id.name,
                start: arrow.body.start,
                end: arrow.body.end
              };
            }
            break; // Only handle first arrow function per declaration
          }
        }
      }
      
      if (functionInfo) {
        // Extract function body
        const impl = code.substring(functionInfo.start, functionInfo.end).trim();
        
        // Find JSDoc comment for this function
        let description = `Function ${functionInfo.name}`;
        const jsdoc = findJSDocForFunction(comments, node.start, code);
        if (jsdoc) {
          description = parseJSDocForAI(jsdoc, functionInfo.name);
        }
        
        functions.push({
          name: functionInfo.name,
          impl: impl,
          description,
          // Legacy compatibility
          code: code.substring(node.start, node.end),
          signature: `${functionInfo.name}()`
        });
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
    return functions;
    
  } catch (error) {
    console.warn('Failed to parse JavaScript with acorn:', error);
    // Fallback to empty array rather than crash
    return [];
  }
}

/**
 * Find JSDoc comment for a function using collected comments
 * Returns the JSDoc comment text if found, null otherwise
 */
function findJSDocForFunction(comments: any[], functionStart: number, code: string): string | null {
  // Find the JSDoc comment immediately before this function
  // JSDoc comments are Block comments that start with /**
  const jsdocComments = comments.filter(comment => 
    comment.type === 'Block' && 
    comment.value.startsWith('*') &&
    comment.end <= functionStart
  );
  
  if (jsdocComments.length === 0) return null;
  
  // Find the closest JSDoc comment before this function
  const closest = jsdocComments.reduce((closest, current) => 
    current.end > closest.end ? current : closest
  );
  
  // Make sure there's only whitespace between the comment and function
  const betweenText = code.substring(closest.end, functionStart);
  if (!/^\s*$/.test(betweenText)) {
    return null; // There's non-whitespace content between comment and function
  }
  
  return `/**${closest.value}*/`;
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
    },
    
    hasFunction(name: string): boolean {
      return functions.has(name);
    },
    
    getFunction(name: string): FunctionDefinition | undefined {
      return functions.get(name);
    },
    
    getFunctionDocumentation(): string {
      return Array.from(functions.values())
        .map(fn => `${fn.signature || fn.name + '()'}: ${fn.description}`)
        .join('\n');
    }
  };
}

/**
 * Extract just function names from code (for compatibility with test-generator.js)
 */
export function extractFunctionNames(code: string): string[] {
  const functions = parseFunctions(code);
  return functions.map(fn => fn.name);
}
