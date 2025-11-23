/**
 * Prompts for Spec Diff Node
 * 
 * Generates human-readable, gameplay-focused summaries of specification changes.
 * Uses completion-style interface with SystemMessagePromptTemplate.
 */

export const SYSTEM_PROMPT = `You are a technical writer creating concise release notes for game specification changes.

## TASK

{task}

## CONTEXT

Game: {summary}
Players: {playerCount}
Version: {versionInfo}
Status: {status}

{structuralChanges}

{specifications}

## OUTPUT FORMAT

Generate brief, scannable release notes in markdown:

**Header:**
- Start with emoji + game name + version
- Include player count if relevant
- One line only

**Changes List:**
- Use bullet points for each distinct change
- Lead with action verbs (Added, Changed, Removed, Fixed, Clarified)
- Be specific and factual - state WHAT changed, not WHY
- Focus on gameplay-relevant changes only
- Skip formatting, wording tweaks, or minor reorganization
- Keep each bullet to 1-2 lines maximum

## EXAMPLES

**New Spec:**
"# 🎲 Dice Quest v1 | 2-4 Players

- Initial specification created
- Core mechanic: Roll dice to collect resources
- Win condition: First to 20 points
- Turn phases: Roll, Trade, Build
- 6 card types with unique abilities"

**Update:**
"# 🎲 Dice Quest v1 → v2

- Changed victory points from 20 to 30
- Added trading phase between turns
- Removed bonus dice mechanic
- Clarified card effect timing rules"

## GUIDELINES

- **Be brief**: Release notes, not narratives
- **Be specific**: "Victory points: 20 → 30" not "Adjusted scoring"
- **Be factual**: What changed, not why it matters
- **Skip minor edits**: Only meaningful gameplay changes
- **Use bullets**: Easy to scan at a glance

The user can read the full spec for details. Your job is just to highlight what changed.`;

/**
 * Formats structural changes for inclusion in the prompt.
 */
function formatStructuralChanges(
  added: string[],
  modified: string[],
  removed: string[]
): string {
  if (added.length === 0 && modified.length === 0 && removed.length === 0) {
    return "No major structural changes detected.";
  }
  
  let changes = "Structural Changes:\n\n";
  
  if (added.length > 0) {
    changes += "Sections Added:\n";
    added.forEach(h => changes += `- ${h}\n`);
    changes += '\n';
  }
  
  if (modified.length > 0) {
    changes += "Sections Modified:\n";
    modified.forEach(h => changes += `- ${h}\n`);
    changes += '\n';
  }
  
  if (removed.length > 0) {
    changes += "Sections Removed:\n";
    removed.forEach(h => changes += `- ${h}\n`);
    changes += '\n';
  }
  
  return changes.trim();
}

/**
 * Creates template variables for the diff prompt.
 */
export function createDiffPromptVars(
  oldSpec: string | undefined,
  oldVersion: number | undefined,
  newSpec: string,
  newVersion: number,
  summary: string,
  playerCount: { min: number; max: number },
  structuralChanges: { added: string[]; modified: string[]; removed: string[] }
): Record<string, string> {
  const isNewSpec = !oldSpec;
  const versionInfo = oldVersion ? `v${oldVersion} → v${newVersion}` : `v${newVersion}`;
  const playerCountStr = playerCount.min === playerCount.max 
    ? `${playerCount.min} ${playerCount.min === 1 ? 'player' : 'players'}`
    : `${playerCount.min}-${playerCount.max} players`;
  
  const structuralChangesText = formatStructuralChanges(
    structuralChanges.added,
    structuralChanges.modified,
    structuralChanges.removed
  );
  
  if (isNewSpec) {
    return {
      task: 'Generate concise release notes introducing this first specification. List the core mechanics and key features.',
      summary,
      playerCount: playerCountStr,
      versionInfo,
      status: 'First specification generated',
      structuralChanges: '',
      specifications: `**New Specification:**\n${newSpec}`,
    };
  }
  
  return {
    task: 'Generate concise release notes listing what changed between versions. Focus on factual gameplay changes only.',
    summary,
    playerCount: playerCountStr,
    versionInfo,
    status: 'Specification updated',
    structuralChanges: structuralChangesText,
    specifications: `**Previous Specification (v${oldVersion}):**\n${oldSpec}\n\n**Updated Specification (v${newVersion}):**\n${newSpec}`,
  };
}
