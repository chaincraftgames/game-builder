/**
 * FaceTablesValidator — face table rules for gamepiece types.
 *
 * Rules:
 *   - gamepieceTypes.types[*] with category "dice" must declare faceCount or faces
 *   - faceCount and faces are mutually exclusive
 */

import type { ModularGameSpec } from "#gamedef/index.js";
import { ValidationCode, type SpecValidator, type ValidationError } from "../types.js";

export class FaceTablesValidator implements SpecValidator {
  readonly name = "FaceTables";

  validate(spec: ModularGameSpec): ValidationError[] {
    const errors: ValidationError[] = [];

    spec.gamepieceTypes?.types?.forEach((type, ti) => {
      const path = `gamepieceTypes.types[${ti}]`;
      const hasCount = type.faceCount !== undefined;
      const hasFaces = type.faces !== undefined;

      if (hasCount && hasFaces) {
        errors.push({
          path,
          message: `Gamepiece type "${type.id}" declares both faceCount and faces — use only one`,
          code: ValidationCode.FaceTable,
        });
      }
      if (type.category === "dice" && !hasCount && !hasFaces) {
        errors.push({
          path,
          message: `Dice type "${type.id}" must declare faceCount or faces — rolling it would do nothing`,
          code: ValidationCode.FaceTable,
        });
      }
    });

    return errors;
  }
}
