/** Every command the CLI accepts; `templates/` may only reference these. */
export const COMMANDS = ["init", "validate", "compile", "help"] as const;

/** A command name accepted by the CLI. */
export type Command = (typeof COMMANDS)[number];

/** Help text printed by `help` and after usage errors. */
export const USAGE = `Usage: chaincraft <command> [options]

Commands:
  init               Scaffold a project in the current directory
  validate [--draft] Check spec/*.yaml (--draft: unresolved references become todos)
  compile            Validate strictly, then assemble the module (nothing is written)
  help               Show this message

Options:
  --json             Machine-readable output
  --version          Print versions
`;
