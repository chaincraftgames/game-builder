/**
 * Narrative Expansion Utility
 * 
 * Expands narrative markers in specifications with actual content.
 * Called at API boundary when returning specs to clients.
 * 
 * Markers are replaced with START/END wrapped sections for traceability.
 */

import type { GameDesignSpecification } from "#chaincraft/ai/design/game-design-state.js";

/**
 * Expands narrative markers in a skeleton specification.
 * 
 * Replaces: !___ NARRATIVE:KEY ___!
 * With: !___ NARRATIVE_START:KEY ___!\n[content]\n!___ NARRATIVE_END:KEY ___!
 * 
 * @param skeleton - The skeleton specification with markers
 * @param narratives - Map of marker keys to narrative content
 * @returns Expanded specification with narratives inserted
 */
export function expandNarratives(
  skeleton: string,
  narratives: Record<string, string>
): string {
  let expanded = skeleton;
  
  // Replace each marker with START/END wrapped content
  for (const [key, content] of Object.entries(narratives)) {
    const markerPattern = new RegExp(`!___ NARRATIVE:${key} ___!`, 'g');
    const replacement = `!___ NARRATIVE_START:${key} ___!\n\n${content}\n\n!___ NARRATIVE_END:${key} ___!`;
    
    expanded = expanded.replace(markerPattern, replacement);
  }
  
  return expanded;
}

/**
 * Expands a complete GameDesignSpecification with narratives.
 * Use this at the API boundary when returning specs to clients.
 * 
 * @param spec - The specification with skeleton
 * @param narratives - Map of narrative content
 * @returns New specification with expanded content
 */
export function expandSpecification(
  spec: GameDesignSpecification,
  narratives: Record<string, string> | undefined
): GameDesignSpecification {
  // If no narratives, return original spec
  if (!narratives || Object.keys(narratives).length === 0) {
    return spec;
  }
  
  return {
    ...spec,
    designSpecification: expandNarratives(spec.designSpecification, narratives),
  };
}
