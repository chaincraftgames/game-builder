/**
 * SpecVersionValidator — rejects specs written for a newer spec format.
 *
 * Rules:
 *   - metadata.specVersion must not exceed CURRENT_SPEC_VERSION (absent means 1)
 */

import type { ModularGameSpec } from "#gamedef/index.js";
import { CURRENT_SPEC_VERSION } from "#gamedef/index.js";
import { ValidationCode, type SpecValidator, type ValidationError } from "../types.js";

export class SpecVersionValidator implements SpecValidator {
  readonly name = "SpecVersion";

  validate(spec: ModularGameSpec): ValidationError[] {
    const version = spec.metadata?.specVersion;
    if (version === undefined || version <= CURRENT_SPEC_VERSION) return [];
    return [
      {
        path: "metadata.specVersion",
        message: `Spec version ${version} is newer than the supported version ${CURRENT_SPEC_VERSION}`,
        code: ValidationCode.UnsupportedSpecVersion,
      },
    ];
  }
}
