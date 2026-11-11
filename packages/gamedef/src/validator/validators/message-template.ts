/**
 * MessageTemplateValidator — `message` templates may only use references the runtime resolves.
 *
 * The runtime substitutes `{{path}}` tokens and leaves any other token in the delivered text,
 * so a token it cannot resolve shows up verbatim in the player's message. Supported tokens:
 *   - `{{input.<id>}}`                               an input of the enclosing action
 *   - `{{state.game.property.<id>}}`                 a game property (or the reserved `winners`)
 *   - `{{state.players.<playerId>.property.<id>}}`   a player property
 * There are no helpers or conditionals: `{{#if …}}`, `{{else}}` and `{{game.winners[0]}}` never resolve.
 *
 * Every `effect: message` in the spec is checked, wherever it appears. Input ids are checked only
 * for messages inline in an action's steps; a named effect may be called from any action.
 */

import type { ModularGameSpec } from "#gamedef/index.js";
import { RESERVED_PLAYER_PROPERTY_IDS } from "#gamedef/modules/state.js";
import { ValidationCode, type SpecValidator, type ValidationError } from "../types.js";

type Obj = Record<string, unknown>;

/** Set by the flow runner before win-condition effects run. */
const RESERVED_GAME_PROPERTY_IDS = ["winners"];

const SUPPORTED =
  "Supported: {{input.<id>}}, {{state.game.property.<id>}}, {{state.players.<playerId>.property.<id>}}. " +
  "Templates substitute values only; there are no helpers or conditionals.";

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const sorted = (ids: Iterable<string>): string[] => [...new Set(ids)].sort();

export class MessageTemplateValidator implements SpecValidator {
  readonly name = "MessageTemplate";

  validate(spec: ModularGameSpec): ValidationError[] {
    const errors: ValidationError[] = [];
    const gameIds = new Set<string>([
      ...(spec.state?.game?.properties ?? []).map((p) => p.id),
      ...RESERVED_GAME_PROPERTY_IDS,
    ]);
    const playerIds = new Set<string>([
      ...(spec.state?.player?.properties ?? []).map((p) => p.id),
      ...RESERVED_PLAYER_PROPERTY_IDS,
    ]);

    const checkToken = (raw: string, path: string, inputs: Set<string> | undefined): void => {
      const token = `{{${raw}}}`;
      const parts = raw.trim().split(".");
      const unresolved = (what: string, known: Set<string>): void => {
        errors.push({
          path,
          message: `Message template token ${token} names ${what}, which does not exist.`,
          code: ValidationCode.UnresolvedRef,
          knownIds: sorted(known),
        });
      };

      if (parts[0] === "input" && parts.length === 2) {
        if (inputs && !inputs.has(parts[1])) unresolved(`input "${parts[1]}"`, inputs);
        return;
      }
      if (parts[0] === "state" && parts[1] === "game" && parts[2] === "property" && parts.length === 4) {
        if (!gameIds.has(parts[3])) unresolved(`game property "${parts[3]}"`, gameIds);
        return;
      }
      if (parts[0] === "state" && parts[1] === "players" && parts[3] === "property" && parts.length === 5) {
        if (!playerIds.has(parts[4])) unresolved(`player property "${parts[4]}"`, playerIds);
        return;
      }
      errors.push({
        path,
        message: `Message template token ${token} is not a supported reference, so it would appear as written in the message. ${SUPPORTED}`,
        code: ValidationCode.InvalidTemplateToken,
      });
    };

    const walk = (node: unknown, path: string, inputs: Set<string> | undefined): void => {
      if (Array.isArray(node)) {
        node.forEach((child, i) => walk(child, `${path}[${i}]`, inputs));
        return;
      }
      if (!isObj(node)) return;

      let scope = inputs;
      if (/^actions\.actions\[\d+\]$/.test(path) && Array.isArray(node["steps"])) {
        scope = new Set(
          node["steps"].flatMap((step) => (isObj(step) && typeof step["input"] === "string" ? [step["input"]] : [])),
        );
      }

      if (node["effect"] === "message" && typeof node["template"] === "string") {
        for (const match of node["template"].matchAll(/\{\{([^}]+)\}\}/g)) {
          checkToken(match[1], `${path}.template`, scope);
        }
      }

      for (const [key, child] of Object.entries(node)) {
        walk(child, path === "" ? key : `${path}.${key}`, scope);
      }
    };

    walk(spec, "", undefined);
    return errors;
  }
}
