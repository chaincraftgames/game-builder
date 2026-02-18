/**
 * Spec Diff Node
 * 
 * Generates an LLM-powered, gameplay-focused diff of specification changes.
 * Uses structural analysis to guide semantic diff generation.
 */

import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { setupSpecDiffModel } from "#chaincraft/ai/model-config.js";
import { GameDesignState } from "#chaincraft/ai/design/game-design-state.js";
import { SYSTEM_PROMPT, createDiffPromptVars } from "#chaincraft/ai/design/graphs/main-design-graph/nodes/spec-diff/prompts.js";

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
 * Generates structural change analysis (sections added/modified/removed).
 * This analysis is used as context for the LLM-based diff generation.
 */
function analyzeStructuralChanges(
  oldSpec: string | undefined,
  newSpec: string
): { added: string[]; modified: string[]; removed: string[] } {
  if (!oldSpec) {
    return { added: [], modified: [], removed: [] };
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
  
  return { added, modified, removed };
}

/**
 * Generates an LLM-powered diff summary focusing on gameplay changes.
 */
async function generateDiffSummary(
  oldSpec: string | undefined,
  oldVersion: number | undefined,
  newSpec: string,
  newVersion: number,
  summary: string,
  playerCount: { min: number; max: number }
): Promise<string> {
  // Analyze structural changes to provide context to the LLM
  const structuralChanges = analyzeStructuralChanges(oldSpec, newSpec);
  
  // Setup the diff model (uses Haiku by default)
  const model = await setupSpecDiffModel();
  
  // Create template variables
  const templateVars = createDiffPromptVars(
    oldSpec,
    oldVersion,
    newSpec,
    newVersion,
    summary,
    playerCount,
    structuralChanges
  );
  
  // Format system prompt with template
  const systemTemplate = SystemMessagePromptTemplate.fromTemplate(SYSTEM_PROMPT);
  const systemMessage = await systemTemplate.format(templateVars);
  
  // Generate semantic diff using LLM with completion-style interface
  const response = await model.invokeWithSystemPrompt(
    systemMessage.content as string,
    undefined, // No user prompt needed - everything is in system prompt
    {
      agent: "spec-diff-analyzer",
      workflow: "design",
    }
  );
  
  return response.content.trim();
}

/**
 * Generates a diff of specification changes for user review.
 * Uses LLM-powered semantic analysis for gameplay-focused summaries.
 * 
 * @param state - Current graph state
 * @returns State updates with diff summary
 */
export async function specDiff(state: typeof GameDesignState.State) {
  const { updatedSpec, currentSpec } = state;
  
  if (!updatedSpec) {
    throw new Error(
      "[spec-diff] No updatedSpec in state. This node should only be called " +
      "after spec-execute has generated a specification."
    );
  }
  
  // Generate LLM-powered diff summary comparing updatedSpec against currentSpec
  const diffSummary = await generateDiffSummary(
    currentSpec?.designSpecification,
    currentSpec?.version,
    updatedSpec.designSpecification,
    updatedSpec.version,
    updatedSpec.summary,
    updatedSpec.playerCount
  );
  
  // Move updatedSpec to currentSpec now that diff is generated
  return {
    specDiff: diffSummary,
    currentSpec: updatedSpec,
    pendingSpecChanges: [], // Clear accumulated changes only after full success
    forceSpecGeneration: false, // Reset force flag on successful completion
  };
}
