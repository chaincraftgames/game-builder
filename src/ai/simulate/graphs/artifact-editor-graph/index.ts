/**
 * Artifact Editor Graph
 *
 * Subgraph that receives validation errors + current artifacts, diagnoses
 * issues via a coordinator, then routes through per-artifact-type editor
 * nodes to apply patches. Supports a retry loop if errors remain.
 *
 * Flow:
 *   START → coordinator → edit_schema → edit_transitions → edit_instructions → revalidate
 *                                                                                 ↓
 *                                                                           coordinator (retry)
 *                                                                           or END (done)
 *
 * Each edit node is skippable — if the coordinator's ChangePlan has no
 * changes for that artifact type, the node returns {} (no state change).
 *
 * Follows the same StateGraph + Annotation.Root + node factory pattern
 * as spec-processing-graph.
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import {
  setupArtifactEditorCoordinatorModel,
  setupArtifactEditorModel,
} from '#chaincraft/ai/model-config.js';
import { ArtifactEditorState } from './artifact-editor-state.js';
import { MAX_EDIT_ATTEMPTS } from './node-shared.js';
import { createCoordinatorNode } from './nodes/coordinator/index.js';
import { createEditSchemaNode } from './nodes/edit-schema/index.js';
import { createEditTransitionsNode } from './nodes/edit-transitions/index.js';
import { createEditInstructionsNode } from './nodes/edit-instructions/index.js';
import { createRevalidateNode } from './nodes/revalidate/index.js';

/**
 * Creates and compiles the artifact editor subgraph.
 *
 * @returns Compiled graph ready for invocation
 */
export async function createArtifactEditorGraph() {
  const workflow = new StateGraph(ArtifactEditorState);

  // Setup models — coordinator and editors can use different model tiers
  // Currently both Haiku; coordinator can be bumped to Sonnet if diagnostics need it
  const coordinatorModel = await setupArtifactEditorCoordinatorModel();
  const editorModel = await setupArtifactEditorModel();

  // Create node functions
  const coordinatorNode = createCoordinatorNode(coordinatorModel);
  const editSchemaNode = createEditSchemaNode();
  const editTransitionsNode = createEditTransitionsNode(editorModel);
  const editInstructionsNode = createEditInstructionsNode(editorModel);
  const revalidateNode = createRevalidateNode();

  // Add nodes
  workflow.addNode('coordinator', coordinatorNode);
  workflow.addNode('edit_schema', editSchemaNode);
  workflow.addNode('edit_transitions', editTransitionsNode);
  workflow.addNode('edit_instructions', editInstructionsNode);
  workflow.addNode('revalidate', revalidateNode);

  // ─── Edges ───

  // START → coordinator
  workflow.addEdge(START, 'coordinator' as any);

  // coordinator → route based on what needs editing
  // Always flow through schema → transitions → instructions in dependency order.
  // Each node self-skips if it has no changes, so we use a linear chain.
  workflow.addEdge('coordinator' as any, 'edit_schema' as any);
  workflow.addEdge('edit_schema' as any, 'edit_transitions' as any);
  workflow.addEdge('edit_transitions' as any, 'edit_instructions' as any);
  workflow.addEdge('edit_instructions' as any, 'revalidate' as any);

  // revalidate → END (if succeeded or max attempts), coordinator (retry)
  workflow.addConditionalEdges(
    'revalidate' as any,
    (state: typeof ArtifactEditorState.State) => {
      if (state.editSucceeded) {
        console.log('[ArtifactEditor] Editing succeeded, exiting graph');
        return 'done';
      }
      if (state.attemptNumber >= MAX_EDIT_ATTEMPTS) {
        console.log(`[ArtifactEditor] Max attempts (${MAX_EDIT_ATTEMPTS}) reached, exiting graph`);
        return 'done';
      }
      console.log(`[ArtifactEditor] ${state.remainingErrors.length} errors remain, retrying (attempt ${state.attemptNumber + 1})`);
      return 'retry';
    },
    {
      done: END,
      retry: 'coordinator' as any,
    },
  );

  console.log('[ArtifactEditorGraph] Graph compiled successfully');
  return workflow.compile();
}

// Re-export state type for consumers
export { ArtifactEditorState, type ArtifactEditorStateType } from './artifact-editor-state.js';
