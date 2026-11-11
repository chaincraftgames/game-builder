# Known gaps

Things the schema or a brief suggests you can do, but the engine does not support. Each entry
says what happens instead and what to do.

## Message templates have no winner or actor token

A `message` template substitutes only `{{input.<id>}}`, `{{state.game.property.<id>}}` and
`{{state.players.<playerId>.property.<id>}}`. There is no token for "the winner" or "the acting
player", and `<playerId>` is a runtime id a spec cannot know. `validate` rejects any other token.

**Do:** don't announce winners in the spec. Game clients display the winners and the outcome, so
a win message is not needed. If a brief asks for one, leave it out and record the decision in
`brief.md` under Decisions.

## Message templates do not read computed properties

`{{state.game.property.<id>}}` and `{{state.players.<playerId>.property.<id>}}` read stored
values only. For a computed property (one with `computed:`) the token is not replaced and appears
as written in the message. `validate` cannot tell, because the property exists.

**Do:** write the value into a stored property with `set-state` (a `{ expr: ... }` value can read
the computed one) and put that property in the template.
