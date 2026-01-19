/**
 * Instructions Utility Functions
 */

import { InstructionsArtifact } from "#chaincraft/ai/simulate/schema.js";

/**
 * Resolve positional player templates to concrete aliases.
 * 
 * Replaces two patterns with concrete player aliases (player1, player2, etc.):
 * 1. Template variables: {{p1id}}, {{player1id}}, {{p2Id}}, etc.
 * 2. Direct path references: players.p1.field, players.p2.field, etc.
 * 
 * @param artifact - Instructions artifact to process
 * @returns Artifact with resolved player templates
 */
export function resolvePositionalPlayerTemplates(
  artifact: InstructionsArtifact
): InstructionsArtifact {
  // Regex to match {{p<N>id}} or {{player<N>id}} (case-insensitive)
  const templatePattern = /\{\{(?:p|player)(\d+)id\}\}/gi;
  
  // Regex to match players.p<N>. in paths
  const pathPattern = /\bplayers\.p(\d+)\./g;
  
  const resolver = (str: string): string => {
    let result = str.replace(templatePattern, (match, numberStr) => {
      const number = parseInt(numberStr, 10);
      return `player${number}`;
    });
    
    result = result.replace(pathPattern, (match, numberStr) => {
      const number = parseInt(numberStr, 10);
      return `players.player${number}.`;
    });
    
    return result;
  };
  
  const resolveInObject = (obj: any): any => {
    if (typeof obj === 'string') {
      return resolver(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map(resolveInObject);
    }
    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = resolveInObject(value);
      }
      return result;
    }
    return obj;
  };
  
  return resolveInObject(artifact);
}
