/**
 * Lookup for `chaincraft docs schema [query]`.
 *
 * A query is a module key (`flow`), a type name (`MoveEffect`), a qualified variant
 * (`Effect.move`) or a bare discriminator value (`move`). A bare value that several discriminated
 * unions share resolves to the one in PRIMARY_UNIONS; otherwise the caller gets the qualified forms.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as gamedef from "@chaincraft/gamedef";
import { z } from "zod";
import { getRegistry, moduleKeys } from "#authoring/docs/registry.js";
import { DERIVED_UNIONS, descriptionOf, firstSentence, renderType, variantsOf } from "#authoring/docs/render-type.js";
import { REQUIRED_MODULES } from "#authoring/tools/validate.js";

/** Unions that win a bare discriminator value shared with other unions. */
export const PRIMARY_UNIONS: readonly string[] = [
  "Effect",
  "FlowNode",
  "TurnGrammarNode",
  "PropertyType",
  "InventoryPlacement",
  "GameMechanic",
];

/** Unions listed as mechanic kinds on the index page. */
const MECHANIC_UNIONS = ["GameMechanic", "PieceMechanic"];

const EXAMPLES_DIR = new URL("../../docs/examples/", import.meta.url);

export type SchemaDocResult = { ok: true; text: string } | { ok: false; knownIds: string[] };

interface Variant {
  union: string;
  value: string;
  schema: z.ZodType;
}

const qualified = (variant: Variant): string => `${variant.union}.${variant.value}`;

/** Every variant of every named discriminated union, derived unions excluded, keyed by qualified id. */
let variantIndex: Map<string, Variant> | undefined;

function variants(): Map<string, Variant> {
  if (variantIndex === undefined) {
    variantIndex = new Map();
    for (const [union, schema] of getRegistry().schemas) {
      if (union in DERIVED_UNIONS) continue;
      for (const [value, option] of variantsOf(schema)?.variants ?? []) {
        const variant = { union, value, schema: option };
        variantIndex.set(qualified(variant), variant);
      }
    }
  }
  return variantIndex;
}

/** Qualified `Type.value` ids of every variant the lookup resolves. */
export function variantIds(): string[] {
  return [...variants().keys()].sort();
}

const moduleSchema = (key: string): z.ZodType => (gamedef.ModularGameSpecSchema.shape as Record<string, z.ZodType>)[key];

const cell = (text: string | undefined): string => (text === undefined ? "" : firstSentence(text).replace(/\|/g, "\\|"));

function indexPage(): string {
  const required = new Set<string>(REQUIRED_MODULES);
  const lines = [
    "# Spec modules",
    "",
    "Top-level keys of a spec. Look one up with `chaincraft docs schema <module>`.",
    "",
    "| Module | Required | Description |",
    "|---|---|---|",
  ];
  for (const key of moduleKeys()) {
    lines.push(`| \`${key}\` | ${required.has(key) ? "yes" : "no"} | ${cell(descriptionOf(moduleSchema(key)))} |`);
  }
  lines.push("", "# Mechanic kinds", "", "Look one up with `chaincraft docs schema <kind>`.");
  const registry = getRegistry();
  for (const union of MECHANIC_UNIONS) {
    const schema = registry.schemas.get(union)!;
    const { discriminator, variants: kinds } = variantsOf(schema)!;
    lines.push("", `## ${union}`, "", `| \`${discriminator}\` | Description |`, "|---|---|");
    for (const [value, option] of kinds) lines.push(`| \`${value}\` | ${cell(descriptionOf(option))} |`);
  }
  return `${lines.join("\n")}\n`;
}

/** The `## <Type>.<value>` section of `docs/examples/*.md`, if one exists. */
function exampleSection(id: string, examplesDir: URL): string | undefined {
  if (!existsSync(examplesDir)) return undefined;
  const heading = `## ${id}`;
  for (const file of readdirSync(examplesDir).filter((name) => name.endsWith(".md")).sort()) {
    const lines = readFileSync(new URL(file, examplesDir), "utf8").split("\n");
    const start = lines.findIndex((line) => line.trimEnd() === heading);
    if (start === -1) continue;
    const end = lines.findIndex((line, i) => i > start && /^#{1,2} /.test(line));
    return lines.slice(start, end === -1 ? undefined : end).join("\n").trimEnd();
  }
  return undefined;
}

function variantPage(variant: Variant, others: Variant[], examplesDir: URL): string {
  let text = renderType(variant.schema);
  // An anonymous variant renders without a heading of its own.
  if (!text.startsWith("# ")) text = `# ${qualified(variant)}\n\n${text}`;
  if (others.length > 0) {
    const newline = text.indexOf("\n");
    const also = `Also matches: ${others.map((other) => `\`${qualified(other)}\``).join(", ")}`;
    text = `${text.slice(0, newline)}\n\n${also}${text.slice(newline)}`;
  }
  const example = exampleSection(qualified(variant), examplesDir);
  return example === undefined ? text : `${text}\n${example}\n`;
}

/** Resolves a `docs schema` query to a page, or to the ids the caller could have meant. */
export function schemaDoc(query?: string, options: { examplesDir?: URL } = {}): SchemaDocResult {
  const examplesDir = options.examplesDir ?? EXAMPLES_DIR;
  if (query === undefined || query === "") return { ok: true, text: indexPage() };
  const registry = getRegistry();
  if (moduleKeys().includes(query)) return { ok: true, text: renderType(moduleSchema(query)) };
  const named = registry.schemas.get(query);
  if (named !== undefined) return { ok: true, text: renderType(named) };
  const exact = variants().get(query);
  if (exact !== undefined) return { ok: true, text: variantPage(exact, [], examplesDir) };
  const matches = [...variants().values()].filter((variant) => variant.value === query);
  if (matches.length === 1) return { ok: true, text: variantPage(matches[0], [], examplesDir) };
  const primary = matches.filter((variant) => PRIMARY_UNIONS.includes(variant.union));
  if (primary.length === 1) {
    const others = matches.filter((variant) => variant !== primary[0]);
    return { ok: true, text: variantPage(primary[0], others, examplesDir) };
  }
  if (matches.length > 1) return { ok: false, knownIds: matches.map(qualified).sort() };
  return { ok: false, knownIds: [...moduleKeys(), ...registry.schemas.keys()].sort() };
}
