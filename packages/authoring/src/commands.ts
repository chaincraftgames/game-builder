/** Every command the CLI accepts; `templates/` may only reference these. */
export const COMMANDS = [
  "init",
  "validate",
  "compile",
  "playtest",
  "docs",
  "help",
] as const;

/** A command name accepted by the CLI. */
export type Command = (typeof COMMANDS)[number];

/** Help text printed by `help` and after usage errors. */
export const USAGE = `Usage: chaincraft <command> [options]

Commands:
  init               Scaffold a project in the current directory
  validate [--draft] Check spec/*.yaml (--draft: unresolved references become todos)
  compile            Validate strictly, then assemble the module (nothing is written)
  playtest [--games N] [--seed S] [--players 2,4] [--max-decisions N] [--replay TOKEN]
                     Compile, then play seeded games with a random legal player
                     (--games <= 100 per player count, default 20; --max-decisions <= 10000,
                     default 2000; --replay TOKEN replays one game from a diagnostic's repro)
  docs [topic [arg]] Spec reference and guides; no topic lists them (works outside a project)
  help               Show this message

Options:
  --json             Machine-readable output
  --version          Print versions
`;
