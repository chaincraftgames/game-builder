/** A schema issue with its union noise removed. */
export interface SchemaIssue {
  path: PropertyKey[];
  code: string;
  message: string;
}

interface RawIssue extends SchemaIssue {
  /** Per-branch issues of an `invalid_union` (Zod v4). */
  errors?: RawIssue[][];
}

// A branch that fails at the root with a type/value mismatch was never the intended one.
const isRootMismatch = (issue: RawIssue): boolean =>
  issue.path.length === 0 && (issue.code === "invalid_type" || issue.code === "invalid_value");

function flatten(issues: readonly RawIssue[], prefix: PropertyKey[]): SchemaIssue[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    if (issue.code === "invalid_union" && issue.errors?.length) {
      const candidates = issue.errors.filter((branch) => !branch.some(isRootMismatch));
      if (candidates.length === 1) return flatten(candidates[0], path);
      // A unique closest branch (a stray key beside otherwise-valid fields) is the intended one; a tie stays ambiguous.
      const fewest = Math.min(...candidates.map((branch) => branch.length));
      const closest = candidates.filter((branch) => branch.length === fewest);
      if (closest.length === 1) return flatten(closest[0], path);
    }
    return [{ path, code: issue.code, message: issue.message }];
  });
}

/**
 * The issues of a failed schema parse. Where one union branch is the only or the uniquely closest
 * match for the input, reports that branch's issues instead of a bare `invalid_union`.
 */
export function schemaIssues(error: { issues: readonly unknown[] }): SchemaIssue[] {
  return flatten(error.issues as RawIssue[], []);
}
