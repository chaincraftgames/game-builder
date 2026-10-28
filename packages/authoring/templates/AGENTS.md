# ChainCraft game project

You are helping build a turn-based game for the ChainCraft engine. The game is defined by
YAML spec files that the `chaincraft` CLI validates and compiles. You do not write engine
code.

## Where you may edit
- `spec/*.yaml` – the game specification (one module per file)
- `brief.md` – design intent and decisions

Do not read or modify `node_modules/`, `.chaincraft/`, or any engine source. If you think
the engine needs to behave differently, that is a gap: report it, don't work around it by
reading internals.

## Workflow
1. Read `brief.md` (at least the Overview) if it exists, then the user's request. Record new
   design intent and decisions in `brief.md` so they carry over to later sessions; create it
   on the first session. Ask the user only for decisions you cannot infer.
2. Build in this order: shape (players, win condition, flow skeleton) → material (piece
   types, inventories, visibility) → rules, one flow node at a time → cross-cutting
   (mechanics, passives, messages).
3. After every meaningful edit run `chaincraft validate` (use `--draft` while modules are
   still being written: unresolved references show as TODOs). Don't guess ids; use the
   known-ids list it prints.
4. Run `chaincraft compile` when validate is clean.
5. Stop when compile passes, or when blocked on a decision from the user.

## Rules
- Never silence or weaken a validation error or test to make it pass.
- Don't rely on memory of other game engines.
- Don't put design rationale in YAML comments; put it in `brief.md` (Decisions) or the
  element's `description`.
- If the engine can't express something, record what you needed and the workaround you
  chose in `brief.md` (Decisions), and continue.
