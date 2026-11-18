# Guide

## Reading playtest output

`chaincraft playtest` plays seeded games with a random player that only picks what the engine
offers. It finds rules that crash, stall or never end. It does not prove the rules match the
brief: a game can play cleanly and still be the wrong game.

Errors (exit 1) must be fixed:
- `playtest-no-legal-actions`: a player had nothing to do and couldn't pass. Path = the turn.
- `playtest-no-end`: no game ended within `--max-decisions`. Check win and loop end conditions.
- `playtest-runaway`: a loop ran without prompting anyone or ending. Path = the loop.
- `playtest-ends-immediately`: a win condition is true right after setup.
- `playtest-spec-error`: a rule failed at runtime. The path is the effect, action or flow node that
  was running; the code in parentheses and the hint name what to check.
- `missing-catalog`: piece types exist but no pieces do.
- `playtest-unsupported`: playtest can't run this (custom, llm or external-data effects). Not a
  spec defect unless the hint says otherwise.
- `engine-error`: an engine bug. Report it with the repro; don't change the spec.
- `runtime-error`: unattributed. Check the named element once, then report it.

Warnings (exit 0) are worth a look, not goals: `action-forfeit` (an action started but had
nothing to choose from), `fixed-outcome` (every game ended the same way).

Each error carries a repro such as `p2-s1-g7`. Replay it with
`chaincraft playtest --replay p2-s1-g7` (pass the same `--max-decisions` if you changed it) to
see the full transcript. Re-run playtest after each fix; the same seed plays the same games.

The transcript shows everything, including every player's hidden cards. To check what one player
could see, add `--as p1`: other players' hidden pieces and answers appear as `(hidden)`, and
changes the player couldn't see are left out. Use it to verify hidden information stays hidden
and public information is visible.

"Not exercised" lists flow nodes, actions and passives that random play didn't reach. It is
not a defect. Don't raise `--games` or change `--seed` to cover them.
