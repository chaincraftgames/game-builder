/**
 * Actions Module Schema
 *
 * Depends on: effects (EffectSchema, EffectCallRefSchema).
 * Referenced by: flow (phases list available actions by ID),
 *                gamepiece-types (actionSlots reference action IDs via catalog),
 *                mechanics (mechanic patterns may trigger actions).
 *
 * An action is a named, player-initiatable operation. Actions declare WHAT a player
 * does; effects declare HOW the game state changes. Every action carries an ordered
 * steps list — input steps (player-provided values), inline effect steps, and
 * named-effect refs.
 *
 * Key design decisions:
 * - No pattern discriminator. Every action has the same shape: id + steps.
 *   The effect steps determine what actually happens.
 * - Prose logic belongs in a prose effect, not a special action kind.
 * - Resource conversions are expressed as move effects (take from source, add to dest).
 *   If the engine needs to validate availability first, that's a prose effect.
 * - Each step has exactly one of 'input: <id>' (a typed, player-provided value),
 *   'effect: <kind>' (an inline effect), or 'effectRef: <id>' (a named effect).
 *   Inline effects can use { param: id } in PropertyValue to reference an input step's
 *   value. Engine resolves by name — no bind map. Every action needs at least one
 *   effect step, and must end with an effect.  It can have multiple input and effect 
 *   steps in between.
 * - 'preconditions' is an infix expression evaluated against runtime state before
 *   the action is offered. State paths: 'actor.id', 'actor.property.<id>',
 *   'game.property.<id>'; inventories via 'count(actor.inventory.<id>)' / 'count(game.inventory.<id>)'.
 *   Inputs are not yet collected, so 'input.<id>' is unavailable here; rules about
 *   input values go in 'ActionInput.validation' (or a selection input's 'filter').
 * - 'interrupt' names the subflows during which this action may be taken outside turn
 *   order. The flow module declares the interrupt window node; the action signals which
 *   subflows it is eligible for.
 * - 'reactive' declares that this action fires in response to a specific named effect.
 *   'timing: before' = fires before the triggering effect resolves. Use 'cancel-effect'
   *   to void it entirely, 'adjust' to modify its numeric value, or neither to let it
 *   proceed after the reaction completes.
 *   'timing: after' = reaction: effect resolves normally, then this action fires to
 *   counter-attack, heal, or apply secondary consequences.
 *   Games that use reactive actions should define the triggering effects as named effects
 *   in the effects module so they can be referenced here.
 * - 'effect-originator' input type: engine auto-populates this input with the player ID
 *   of the player who executed the triggering action. Inline effects can target it
 *   via { param: id } in PropertyValue — e.g., to strike back at the attacker.
 * - 'trigger-input' input type: engine auto-populates this input with the resolved value
 *   of a specific input from the triggering action. Use to access the gamepiece or player
 *   that the triggering player selected — e.g., damage the creature that attacked you.
 *
 * @example Full actions module (Liar's Dice excerpt)
 * ```yaml
 * actions:
 *   - id: makeBid
 *     label: Make Bid
 *     steps:
 *       - input: quantity
 *         type: { kind: number, min: 1, max: 30 }
 *         label: Quantity
 *       - input: faceValue
 *         type: { kind: number, min: 1, max: 6 }
 *         label: Face Value
 *         validation: >-
 *           input.quantity > game.property.bidQuantity or
 *           (input.quantity == game.property.bidQuantity and input.faceValue > game.property.bidFace)
 *         validationMessage: Bid a higher quantity, or the same quantity with a higher face
 *       - effect: update
 *         pieces: { inventory: currentBid, select: top }
 *         property: quantity
 *         value: { param: quantity }
 *       - effect: update
 *         pieces: { inventory: currentBid, select: top }
 *         property: faceValue
 *         value: { param: faceValue }
 *
 *   - id: drawCard
 *     label: Draw Card
 *     steps:
 *       - effectRef: drawFromDeck
 *     oncePerTurn: true
 *
 *   - id: discardChosen
 *     label: Discard
 *     steps:
 *       - input: card
 *         type: { kind: gamepiece-select, inventory: playerHand }
 *         label: Choose card to discard
 *       - effect: move
 *         from: { inventory: playerHand, select: { id: { param: card } } }
 *         to: { inventory: discardPile, at: { kind: stack-top } }
 *
 *   - id: resolveBattle
 *     label: Resolve Battle
 *     steps:
 *       - effect: custom
 *         description: >
 *           Compare power totals of all face-up cards in each player's combat zone.
 *           The player with the higher total wins the round and scores 1 point.
 *           On a tie, no points are scored and both players draw one card.
 * ```
 */

import { z } from "zod";
import { EffectCallRefSchema, EffectSchema } from "./effects.js";
import { ConditionExpressionSchema, IdentifierSchema, keyedUnion } from "./common.js";

// ---------------------------------------------------------------------------
// Input step (player-provided value collected when action is taken)
// ---------------------------------------------------------------------------

/**
 * @example
 * ```yaml
 * steps:
 *   - input: quantity
 *     type: { kind: number, min: 1, max: 30 }
 *     label: Quantity
 *   - input: faceValue
 *     type: { kind: number, min: 1, max: 6 }
 *     label: Face Value
 *     validation: >-
 *       input.quantity > game.property.bidQuantity or
 *       (input.quantity == game.property.bidQuantity and input.faceValue > game.property.bidFace)
 *     validationMessage: Bid a higher quantity, or the same quantity with a higher face
 *   - input: targetPlayer
 *     type: { kind: enum, values: [player1, player2, player3, player4] }
 *     label: Target Player
 *   - input: attacker
 *     type: { kind: effect-originator }
 *     label: Attacker
 *     # engine auto-populates; effects reference via { param: attacker }
 *   - input: chosenCard
 *     type: { kind: gamepiece-select, inventory: playerHand }
 *     label: Choose Card to Play
 *   - input: targetCreature
 *     type: { kind: gamepiece-select, inventory: battlefield, ofType: creature, fromPlayer: { param: targetPlayer } }
 *     label: Choose Creature to Attack
 *   - input: opponent
 *     type: { kind: player-select, excludeSelf: true }
 *     label: Choose Opponent
 *   - input: targetCell
 *     type: { kind: inventory-position, inventory: battleGrid }
 *     label: Choose Placement
 * ```
 */
export const ActionInputSchema = z
  .object({
    input: IdentifierSchema.describe(
        "Unique identifier for this input within the action. " +
          "Inline effects in the same action reference it via { param: id } in PropertyValue.",
      ),
    type: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("number"), min: z.number().optional(), max: z.number().optional(), integer: z.boolean().optional().describe("If true, only whole numbers are accepted. Defaults to true.") }),
        z.object({ kind: z.literal("string") }),
        z.object({ kind: z.literal("boolean") }),
        z.object({ kind: z.literal("enum"), values: z.array(z.string()).min(2) }),
        z.object({ kind: z.literal("effect-originator") }).describe(
          "Engine auto-populates with the player ID of the player who executed the action " +
            "that triggered this reactive window. Only valid in reactive actions.",
        ),
        z.object({
          kind: z.literal("trigger-input"),
          inputId: z.string().describe(
            "Input ID from the triggering action whose resolved value to inject. " +
              "Forward reference to an input declared on the action that caused the trigger effect.",
          ),
        }).describe(
          "Engine auto-populates with the resolved value of a specific input from the " +
            "triggering action. Use to access the gamepiece, player, or other value that " +
            "the triggering player selected. Only valid in reactive actions.",
        ),
        z.object({
          kind: z.literal("gamepiece-select"),
          inventory: z.string().describe(
            "Inventory type ID to select from. Forward reference to inventories module.",
          ),
          ofType: z.string().optional().describe(
            "Restrict selection to pieces of this gamepiece type ID.",
          ),
          count: z.number().int().min(1).optional().describe(
            "How many pieces the player must select. Defaults to 1.",
          ),
          fromPlayer: z
            .union([
              z.literal("self").describe("Acting player's own inventory instance (default)."),
              z.object({ param: z.string() }).describe(
                "Player identified by a prior player-select input. " +
                  "References the input id of a player-select input step declared earlier in the action.",
              ),
            ])
            .optional()
            .describe(
              "Whose inventory instance to select from. Only relevant for player-scoped inventories. " +
                "Defaults to 'self'. Use { param: inputId } to select from another player's inventory " +
                "based on a prior player-select input.",
            ),
          filter: ConditionExpressionSchema.optional().describe(
            "Infix expression to filter eligible pieces. " +
              "Evaluated per-piece. Available paths: 'piece.id', 'piece.property.<id>', 'piece.typeId', " +
              "'input.<id>' (an EARLIER input of this action). " +
              "Example: 'piece.property.charges > 0', 'piece.property.cost <= input.budget', " +
              "or 'piece.id != input.attacker'. " +
              "Runtime computes valid options and sends them to UX.",
          ),
        }).describe(
          "Player selects one or more gamepieces from an inventory. " +
            "Runtime computes valid piece IDs based on constraints and sends them to UX. " +
            "Resolves to piece ID (or array of IDs if count > 1).",
        ),
        z.object({
          kind: z.literal("player-select"),
          excludeSelf: z.boolean().optional().describe(
            "If true, the acting player cannot select themselves. Defaults to false.",
          ),
          filter: ConditionExpressionSchema.optional().describe(
            "Infix expression to filter eligible players. " +
              "Evaluated per-player. Available paths: 'player.id', 'player.property.<id>', " +
              "'count(player.inventory.<id>)', 'input.<id>' (an EARLIER input of this action). " +
              "Example: 'not player.property.eliminated and count(player.inventory.hand) > 0'. " +
              "Runtime computes valid options and sends them to UX.",
          ),
        }).describe(
          "Player selects another player. Runtime computes valid player IDs " +
            "based on constraints and sends them to UX. Resolves to player ID.",
        ),
        z.object({
          kind: z.literal("inventory-position"),
          inventory: z.string().describe(
            "Inventory type ID to select a position within. " +
              "Forward reference to inventories module.",
          ),
          fromPlayer: z
            .union([
              z.literal("self").describe("Acting player's own inventory instance (default)."),
              z.object({ param: z.string() }).describe(
                "Player identified by a prior player-select input.",
              ),
            ])
            .optional()
            .describe(
              "Whose inventory instance to select a position from. " +
                "Only relevant for player-scoped inventories. Defaults to 'self'.",
            ),
        }).describe(
          "Player selects a position within an inventory (grid cell, line index, graph node). " +
            "Runtime computes valid positions and sends them to UX. " +
            "Resolves to an InventoryPlacement descriptor.",
        ),
      ])
      .describe(
        "Type and structural bounds for this input. The engine enforces these before " +
          "the action resolves. Inputs are collected sequentially — later inputs can " +
          "depend on earlier ones via { param: inputId } references. " +
          "Runtime computes valid options for selection inputs and sends them to UX. " +
          "'effect-originator': engine auto-populates with the triggering player ID (reactive only). " +
          "'trigger-input': engine auto-populates with a resolved input from the triggering action (reactive only).",
      ),
    label: z
      .string()
      .optional()
      .describe("Human-readable label shown in the action UI prompt."),
    validation: ConditionExpressionSchema.optional().describe(
      "Infix expression that must be true for an answer to this input to be legal. " +
        "For value inputs only (number, enum, boolean, string); selection inputs use 'filter'. " +
        "'input.<thisId>' is the candidate answer; 'input.<id>' of an EARLIER input is its answer. " +
        "Also available: 'actor.*', 'game.*' paths. For inputs with a finite option list " +
        "(enum, boolean, small whole-number ranges) it narrows the options offered; " +
        "otherwise it is checked on submit. Put a rule on the LAST input it reads. " +
        "Example on faceValue: 'input.quantity > game.property.bidQuantity or " +
        "(input.quantity == game.property.bidQuantity and input.faceValue > game.property.bidFace)'.",
    ),
    validationMessage: z
      .string()
      .optional()
      .describe(
        "Short player-facing explanation shown when an answer fails 'validation'. " +
          "Static text only; must not reveal hidden state.",
      ),
  })
  .describe(
    "A typed, player-supplied input collected when an action is taken. " +
      "Inline effects in the same action can reference these by id via { param: id } in PropertyValue.",
  );

// ---------------------------------------------------------------------------
// Action step
// ---------------------------------------------------------------------------

/**
 * One step of an action: an input step (`input: <id>`), an inline effect step
 * (`effect: <kind>`), or a named-effect step (`effectRef: <id>`).
 */
export const ActionStepSchema = keyedUnion({
  input: ActionInputSchema,
  effect: EffectSchema,
  effectRef: EffectCallRefSchema,
}).describe(
  "One action step. Exactly one of: 'input: <id>' (player-supplied value), " +
    "'effect: <kind>' (inline effect), or 'effectRef: <id>' (named effect).",
);

// ---------------------------------------------------------------------------
// Action schema
// ---------------------------------------------------------------------------

/**
 * @example Draw a card once per turn (named-effect ref)
 * ```yaml
 * id: drawCard
 * label: Draw Card
 * steps:
 *   - effectRef: drawFromDeck
 * oncePerTurn: true
 * ```
 * @example Discard a chosen card (gamepiece-select input)
 * ```yaml
 * id: discardChosen
 * label: Discard
 * steps:
 *   - input: card
 *     type: { kind: gamepiece-select, inventory: playerHand }
 *     label: Choose card to discard
 *   - effect: move
 *     from: { inventory: playerHand, select: { id: { param: card } } }
 *     to: { inventory: discardPile, at: { kind: stack-top } }
 * ```
 * @example Place a piece on a grid (two inputs: piece + position)
 * ```yaml
 * id: deployUnit
 * label: Deploy Unit
 * steps:
 *   - input: unit
 *     type: { kind: gamepiece-select, inventory: reserves, ofType: soldier }
 *     label: Choose unit to deploy
 *   - input: cell
 *     type: { kind: inventory-position, inventory: battleGrid }
 *     label: Choose deployment position
 *   - effect: move
 *     from: { inventory: reserves, select: { id: { param: unit } } }
 *     to: { inventory: battleGrid, at: { param: cell } }
 * ```
 * @example Steal from opponent (two inputs: player + piece)
 * ```yaml
 * id: stealCard
 * label: Steal Card
 * steps:
 *   - input: target
 *     type: { kind: player-select, excludeSelf: true }
 *     label: Choose opponent
 *   - input: card
 *     type: { kind: gamepiece-select, inventory: playerHand, fromPlayer: { param: target } }
 *     label: Choose card to steal
 *   - effect: move
 *     from: { player: { param: target }, inventory: playerHand, select: { id: { param: card } } }
 *     to: { inventory: playerHand }
 * ```
 * @example Liar's Dice bid — player inputs, inline { param } effects
 * ```yaml
 * id: makeBid
 * label: Make Bid
 * steps:
 *   - input: quantity
 *     type: { kind: number, min: 1, max: 30 }
 *   - input: faceValue
 *     type: { kind: number, min: 1, max: 6 }
 *     validation: >-
 *       input.quantity > game.property.bidQuantity or
 *       (input.quantity == game.property.bidQuantity and input.faceValue > game.property.bidFace)
 *     validationMessage: Bid a higher quantity, or the same quantity with a higher face
 *   - effect: update
 *     pieces: { inventory: currentBid, select: top }
 *     property: quantity
 *     value: { param: quantity }
 *   - effect: update
 *     pieces: { inventory: currentBid, select: top }
 *     property: faceValue
 *     value: { param: faceValue }
 * ```
 * @example Complex resolution — custom effect as escape hatch
 * ```yaml
 * id: resolveBattle
 * label: Resolve Battle
 * steps:
 *   - effect: custom
 *     description: >
 *       Compare power totals of all face-up cards in each player's combat zone.
 *       Higher total wins and scores 1 point. On a tie no points scored; both draw.
 * ```
 * @example Reactive negate — cancel incoming damage before it resolves
 * ```yaml
 * id: blockDamage
 * label: Block
 * interrupt: [responseWindow]
 * reactive:
 *   trigger: dealDamage      # named effect ID in effects module
 *   timing: before            # fires before the effect resolves
 * steps:
 *   - input: attacker
 *     type: { kind: effect-originator }  # engine auto-populates with triggering player
 *     label: Attacker
 *   - effect: cancel-effect   # void the triggering effect entirely
 * ```
 * @example Reactive adjust — reduce incoming damage by armor rating (var delta)
 * ```yaml
 * id: armorAbsorb
 * label: Armor Absorb
 * reactive:
 *   trigger: dealDamage
 *   timing: before
 * steps:
 *   - effect: adjust
 *     adjustment: { delta: { var: "player.property.armorRating" } }
 * ```
 * @example Reactive adjust — halve incoming damage (literal mult)
 * ```yaml
 * id: shieldBlock
 * label: Shield Block
 * reactive:
 *   trigger: dealDamage
 *   timing: before
 * steps:
 *   - effect: adjust
 *     adjustment: { mult: 0.5 }
 * ```
 * @example Reactive counter-attack — damage the creature that attacked you
 * ```yaml
 * id: thorns
 * label: Thorns
 * reactive:
 *   trigger: dealDamage
 *   timing: after
 * steps:
 *   - input: attacker
 *     type: { kind: effect-originator }
 *   - input: attackingCreature
 *     type: { kind: trigger-input, inputId: creature }  # piece from triggering action's "creature" input
 *   - effect: update
 *     pieces: { inventory: battlefield, select: { id: { param: attackingCreature } } }
 *     property: hp
 *     value: { delta: -2 }
 * ```
 * @example Reactive reaction — heal after taking damage
 * ```yaml
 * id: resilience
 * label: Resilience
 * reactive:
 *   trigger: takeDamage      # named effect ID in effects module
 *   timing: after             # fires after effect resolves
 * steps:
 *   - effectRef: healOneHp
 * ```
 * @example Precondition — can only challenge if a bid has been made
 * ```yaml
 * id: challenge
 * label: Challenge
 * preconditions: "count(game.inventory.currentBid) != 0"
 * steps:
 *   - effectRef: resolveChallenge
 * ```
 * @example Precondition — can only buy if actor can afford it
 * ```yaml
 * id: buyCard
 * label: Buy Card
 * preconditions: "actor.property.coins >= 3"
 * steps:
 *   - effectRef: purchaseCard
 * ```
 */
export const ActionSchema = z
  .object({
    id: IdentifierSchema.describe(
        "Unique identifier for this action. Referenced by flow phases and action slots.",
      ),
    label: z
      .string()
      .optional()
      .describe("Human-readable display name shown to the player. Omit if id is sufficient."),
    description: z
      .string()
      .optional()
      .describe("Human-readable description of what this action does. Shown in game UI."),
    oncePerTurn: z
      .boolean()
      .optional()
      .describe(
        "If true, a player may only take this action once per turn. " +
          "Engine tracks usage and prevents repeats within the same turn.",
      ),
    requiredRoles: z
      .array(z.string())
      .min(1)
      .optional()
      .describe(
        "Role IDs that the acting player must hold at least one of to take this action. " +
          "Forward references to role IDs in the players module. " +
          "Any-of semantics: player qualifies if they hold at least one listed role. " +
          "Omit if any player may act regardless of role.",
      ),
    availableInSubflows: z
      .array(z.string())
      .optional()
      .describe(
        "Subflow IDs during which this action is available. Forward references to flow subflow IDs. " +
          "Prefer declaring availability in the flow module. Use this only when the action " +
          "spans many subflows and listing them all in flow would be excessively verbose. " +
          "Omit when availability is fully determined by slot definitions or flow declarations.",
      ),
    preconditions: ConditionExpressionSchema.optional().describe(
      "Infix expression evaluated before the action is offered. " +
        "If false, the action is unavailable regardless of flow context. " +
        "Available paths: 'actor.id', 'actor.property.<id>', 'count(actor.inventory.<id>)', " +
        "'game.property.<id>', 'count(game.inventory.<id>)'. " +
        "Example: 'actor.property.coins >= 3 and game.property.roundStarted == true'. " +
        "Inputs are not collected yet, so rules about input values (e.g., bid must exceed " +
        "current bid) belong in ActionInput.validation instead.",
    ),
    interrupt: z
      .array(z.string())
      .min(1)
      .optional()
      .describe(
        "Subflow IDs during which this action may be taken outside turn order. " +
          "Forward references to flow subflow IDs. The flow module declares the interrupt " +
          "window node (timing, eligible players, timeout); this field signals which " +
          "subflows the action is eligible for. Omit if the action is never interrupt-eligible.",
      ),
    reactive: z
      .object({
        trigger: z
          .string()
          .describe(
            "Named effect ID that triggers this action. Forward reference to the effects module. " +
              "The referenced effect should be defined as a named effect so it can be cited here. " +
              "When the engine executes that named effect anywhere in the game, it opens a " +
              "reactive response window for eligible players.",
          ),
        timing: z
          .enum(["before", "after"])
          .describe(
            "'before': this action fires before the triggering effect resolves. " +
              "The reactive action's effects execute first — use 'cancel-effect' to void " +
              "the trigger entirely, 'adjust' to modify its numeric value, or neither " +
              "to let it proceed unchanged after the reaction completes. " +
              "'after': reaction — the triggering effect resolves normally, then this action " +
              "fires. Use for counter-attacks, healing, or secondary responses.",
          ),
      })
      .optional()
      .describe(
        "Declares this action as a reactive response to a specific named effect. " +
          "The engine opens a response window when the trigger effect is about to fire " +
          "(timing: before) or has just fired (timing: after). " +
          "The player CHOOSES whether to take this action — for automatic responses " +
          "that require no player choice, use passives on gamepiece types or roles instead. " +
          "Games using reactive actions should define triggering effects as named effects " +
          "in the effects module so they can be referenced here.",
      ),
    steps: z
      .array(ActionStepSchema)
      .min(1)
      .refine((steps) => steps.some((s) => !("input" in s)), {
        message: "An action needs at least one effect or effectRef step.",
      })
      .describe(
        "Ordered steps executed when this action is taken. Input steps ('input: <id>') " +
          "collect typed player-supplied values; inline effects reference them via " +
          "{ param: id } in PropertyValue. Effect steps ('effect: <kind>' inline, or " +
          "'effectRef: <id>' named) change game state. At least one effect step is required. " +
          "An input step after an effect step is asked only once those effects have run; the " +
          "last step must be an effect.",
      ),
  })
  .describe(
    "A named, player-initiatable game operation. Input steps declare what the player supplies; " +
      "effect steps declare how the game state changes. " +
      "Referenced by flow phases (which actions are available) and gamepiece action slots.",
  );

export const ActionsModuleSchema = z
  .object({
    actions: z
      .array(ActionSchema)
      .min(1)
      .describe(
        "All named actions in this game. Each action is a reusable, named player operation. " +
          "Flow phases reference actions by their id to declare what players may do.",
      ),
  })
  .describe(
    "The actions module — a named library of all player-initiatable operations. " +
      "Depends on effects (effect IDs) and gamepiece-types (conversion type IDs). " +
      "Referenced by flow (phase availability) and the catalog (action slot assignments).",
  );

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionInput = z.infer<typeof ActionInputSchema>;
export type ActionStep = z.infer<typeof ActionStepSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type ActionsModule = z.infer<typeof ActionsModuleSchema>;
