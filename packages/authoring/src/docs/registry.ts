/**
 * Named-type registry for the schema reference.
 *
 * gamedef exports its schemas as `FooSchema`; the reference calls them `Foo`. The registry maps
 * each name to its schema and resolves a schema, or a `.describe()` copy of one, back to its name.
 */

import * as gamedef from "@chaincraft/gamedef";
import { z } from "zod";

/** Named gamedef schemas, registered so that `.describe()` copies still resolve. */
export interface Registry {
  /** Registry name (export name without the `Schema` suffix) to its exported schema. */
  readonly schemas: ReadonlyMap<string, z.ZodType>;
  /** Exports skipped because an earlier export is the same schema instance: skipped name to kept name. */
  readonly aliases: ReadonlyMap<string, string>;
  /** The registry name of `schema` or of the schema it was copied from, if any. */
  nameOf(schema: z.ZodType): string | undefined;
}

/** True for any Zod schema, checked structurally so a second copy of zod would still match. */
function isSchema(value: unknown): value is z.ZodType {
  return typeof value === "object" && value !== null && "_zod" in value && typeof (value as z.ZodType).safeParse === "function";
}

/** Builds the registry from gamedef's exports. */
function buildRegistry(): Registry {
  const schemas = new Map<string, z.ZodType>();
  const aliases = new Map<string, string>();
  const byInstance = new Map<z.ZodType, string>();
  // The key must not be `id`: Zod does not carry `id` over to `.describe()` copies.
  const names = z.registry<{ name: string }>();
  for (const [exportName, value] of Object.entries(gamedef)) {
    if (!exportName.endsWith("Schema") || !isSchema(value)) continue;
    const name = exportName.slice(0, -"Schema".length);
    const existing = byInstance.get(value);
    if (existing !== undefined) {
      aliases.set(name, existing);
      continue;
    }
    byInstance.set(value, name);
    names.add(value, { name });
    schemas.set(name, value);
  }
  return { schemas, aliases, nameOf: (schema) => names.get(schema)?.name };
}

/** Memoised registry; gamedef's exports never change at runtime. */
let registry: Registry | undefined;

/** The named-type registry. */
export function getRegistry(): Registry {
  registry ??= buildRegistry();
  return registry;
}

/** Top-level spec module keys, from the same source as the loader's `unknown-module` check. */
export function moduleKeys(): string[] {
  return Object.keys(gamedef.ModularGameSpecSchema.shape);
}
