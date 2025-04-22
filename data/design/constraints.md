## Not Supported ##
* Visualization beyond simple text or ASCII drawings (such as an ASCII grid)
* Asynchronous actions by the game (all game actions must be player initiated).  This would pose problems for games with "random" or "spontaneous" game actions.
* Time limits or timing based gameplay.  This would include players having to take action within a certain time, although you generally can handle deciding which of a set of players took an action first.

## Limited Support ##
* Narrative generation, particularly long narratives that need to stay coherent.  Shorter, ad hoc narratives are okay.
* Scoring over multiple rounds.
* Complex state machines (nested phases).
* Gameplay that requires remembering and updating spatial locations of gamepieces, e.g. Battleship.