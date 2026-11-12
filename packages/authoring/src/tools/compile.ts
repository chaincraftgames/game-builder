import {
  assembleModule,
  CompileError,
  ExpressionError,
} from "@chaincraft/compiler";
import type { ModularGameSpec } from "@chaincraft/gamedef";
import type { CompiledGameModule, FlowNode } from "@chaincraft/runtime";
import {
  AuthoringCode,
  mapFile,
  type Diagnostic,
} from "#authoring/diagnostics.js";
import { readManifest } from "#authoring/project.js";
import { validate } from "#authoring/tools/validate.js";

/** Size of a successfully compiled module. */
export interface CompileSummary {
  actions: number;
  effectDefs: number;
  /** Includes the root node. */
  flowNodes: number;
}

/** Outcome of {@link compile}. */
export interface CompileResult {
  /** True when the spec validated strictly and assembled without error. */
  ok: boolean;
  diagnostics: Diagnostic[];
  /** Only present when `ok` is true. */
  summary?: CompileSummary;
  /** The assembled module; only present when `ok` is true. */
  module?: CompiledGameModule;
  /** The validated spec the module was assembled from; only present when `ok` is true. */
  spec?: ModularGameSpec;
  /** Module key to project-relative file; only present when `ok` is true. */
  moduleFiles?: Record<string, string>;
}

/** Counts `node` and all of its descendants. */
function countFlowNodes(node: FlowNode): number {
  const children = (node as { children?: FlowNode[] }).children ?? [];
  return 1 + children.reduce((n, child) => n + countFlowNodes(child), 0);
}

/**
 * Strictly validates the project, then dry-runs `assembleModule`; nothing is written to disk.
 * Non-spec failures are reported as `internal` so engine bugs can be told apart from spec errors.
 *
 * @param root - Project root containing `chaincraft.yaml`.
 */
export function compile(root: string): CompileResult {
  const validation = validate(root, { draft: false });
  if (!validation.ok || !validation.spec) {
    return { ok: false, diagnostics: validation.diagnostics.filter((d) => d.severity !== "warning") };
  }

  const { id } = readManifest(root);
  try {
    const module = assembleModule(validation.spec, id);
    return {
      ok: true,
      diagnostics: [],
      summary: {
        actions: Object.keys(module.actions).length,
        effectDefs: Object.keys(module.effectDefs).length,
        flowNodes: countFlowNodes(module.flow),
      },
      module,
      spec: validation.spec,
      moduleFiles: validation.moduleFiles ?? {},
    };
  } catch (err) {
    if (err instanceof CompileError) {
      return {
        ok: false,
        diagnostics: err.issues.map((issue) => ({
          severity: "error",
          code: issue.code,
          message: issue.message,
          ...(issue.path !== undefined && {
            path: issue.path,
            file: mapFile(issue.path, validation.moduleFiles ?? {}),
          }),
          ...(issue.knownIds ? { knownIds: issue.knownIds } : {}),
        })),
      };
    }
    if (err instanceof ExpressionError) {
      return {
        ok: false,
        diagnostics: [
          {
            severity: "error",
            code: AuthoringCode.Expression,
            message: err.message,
          },
        ],
      };
    }
    return {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: AuthoringCode.Internal,
          message: `Internal compiler error (likely an engine bug, not your spec): ${(err as Error).message}`,
        },
      ],
    };
  }
}
