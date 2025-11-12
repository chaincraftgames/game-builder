/**
 * Diff Spec Node
 * 
 * Generates a human-readable diff of specification changes.
 * Compares currentGameSpec with the new spec and creates a markdown summary.
 */

import { GameDesignState } from "../../../../game-design-state.js";

/**
 * Extracts markdown sections from a spec for detailed comparison.
 * Returns sections as a Map of heading -> content.
 */
function extractSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = markdown.split('\n');
  let currentHeading = '(Introduction)';
  let currentContent: string[] = [];
  
  for (const line of lines) {
    // Check if this is a heading (# or ##)
    const headingMatch = line.match(/^(#{1,2})\s+(.+)$/);
    if (headingMatch) {
      // Save previous section
      if (currentContent.length > 0) {
        sections.set(currentHeading, currentContent.join('\n').trim());
      }
      // Start new section
      currentHeading = headingMatch[2];
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  
  // Save final section
  if (currentContent.length > 0) {
    sections.set(currentHeading, currentContent.join('\n').trim());
  }
  
  return sections;
}

/**
 * Generates a concise diff summary focusing on high-level changes.
 */
function generateDiffSummary(
  oldSpec: string | undefined,
  oldVersion: number | undefined,
  newSpec: string,
  newVersion: number,
  summary: string,
  playerCount: { min: number; max: number }
): string {
  // First spec generation
  if (!oldSpec) {
    return `## 📝 New Specification Created

**Game:** ${summary}
**Players:** ${playerCount.min === playerCount.max ? playerCount.min : `${playerCount.min}-${playerCount.max}`}
**Version:** ${newVersion}

A complete game specification has been generated based on our conversation. The specification includes:
- Game overview and objectives
- Initial setup instructions
- Detailed gameplay flow
- Player actions and mechanics
- Winning conditions

You can review the full specification below.`;
  }
  
  // Extract sections for comparison
  const oldSections = extractSections(oldSpec);
  const newSections = extractSections(newSpec);
  
  // Identify changes
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  
  // Check for new and modified sections
  for (const [heading, content] of newSections) {
    if (!oldSections.has(heading)) {
      added.push(heading);
    } else if (oldSections.get(heading) !== content) {
      modified.push(heading);
    }
  }
  
  // Check for removed sections
  for (const heading of oldSections.keys()) {
    if (!newSections.has(heading)) {
      removed.push(heading);
    }
  }
  
  // Build diff summary
  const versionInfo = oldVersion ? ` (v${oldVersion} → v${newVersion})` : ` (v${newVersion})`;
  let diff = `## 🔄 Specification Updated${versionInfo}

**Game:** ${summary}
**Players:** ${playerCount.min === playerCount.max ? playerCount.min : `${playerCount.min}-${playerCount.max}`}

`;
  
  if (added.length > 0) {
    diff += `### ✨ New Sections Added\n`;
    added.forEach(h => diff += `- ${h}\n`);
    diff += '\n';
  }
  
  if (modified.length > 0) {
    diff += `### 📝 Sections Modified\n`;
    modified.forEach(h => diff += `- ${h}\n`);
    diff += '\n';
  }
  
  if (removed.length > 0) {
    diff += `### 🗑️ Sections Removed\n`;
    removed.forEach(h => diff += `- ${h}\n`);
    diff += '\n';
  }
  
  if (added.length === 0 && modified.length === 0 && removed.length === 0) {
    diff += `No structural changes detected. Minor refinements may have been made to wording or formatting.\n\n`;
  }
  
  diff += `You can review the updated specification below.`;
  
  return diff;
}

/**
 * Generates a diff of specification changes for user review.
 * 
 * @param state - Current graph state
 * @returns State updates with diff summary
 */
export async function diffSpec(state: typeof GameDesignState.State) {
  const { updatedSpec, currentGameSpec } = state;
  
  if (!updatedSpec) {
    throw new Error(
      "[diff-spec] No updatedSpec in state. This node should only be called " +
      "after spec-execute has generated a specification."
    );
  }
  
  // Generate diff summary by comparing updatedSpec against currentGameSpec
  const diffSummary = generateDiffSummary(
    currentGameSpec?.designSpecification,
    currentGameSpec?.version,
    updatedSpec.designSpecification,
    updatedSpec.version,
    updatedSpec.summary,
    updatedSpec.playerCount
  );
  
  // Move updatedSpec to currentGameSpec now that diff is generated
  return {
    specDiff: diffSummary,
    currentGameSpec: updatedSpec,
  };
}
