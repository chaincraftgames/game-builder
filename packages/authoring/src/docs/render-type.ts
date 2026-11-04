/**
 * Schema walker: renders a Zod schema as compact markdown for `chaincraft docs schema`.
 *
 * Nothing is written to disk; each call walks one schema and returns one page of text. The text is
 * read by an agent, so the format favours few tokens over polish.
 *
 * Page layout:
 * - A page is a root section plus one section for each named type it expands.
 * - A section is a heading (`#` for the root, `##` for the named types below it), the type's
 *   description, then its body.
 * - An object body is one line per field: `` - `name` (required|optional[, default X]) Type — description ``.
 * - A discriminated union body is one `### kind: value` sub-section per variant, or a table of
 *   values once it has more than VARIANT_TABLE_THRESHOLD variants.
 * - A plain union body lists its options; a keyed union body lists its branches.
 *
 * Expansion rules:
 * - Levels count from the page root (level 0). The fields of an object at level N are at level N + 1.
 *   A union is not a level of its own: its variants are at the level the union would have.
 * - A named type at a level up to MAX_EXPANSION_LEVEL gets a section, once per page; later mentions
 *   and anything deeper are a link such as `FlowNode`.
 * - An anonymous object expands inline, indented under its field. Past the limit it collapses to
 *   `object (see <named ancestor> page)`.
 * - A type already being expanded (a cycle through `z.lazy`) is never expanded again.
 *
 * Types the walker does not know make it throw, so a new Zod node type in gamedef fails a test
 * rather than vanishing from the reference.
 */

import * as gamedef from "@chaincraft/gamedef";
import { z } from "zod";
import { getRegistry } from "#authoring/docs/registry.js";

/** Unions with more variants than this render as a table of values instead of per-variant sections. */
const VARIANT_TABLE_THRESHOLD = 4;

/** Named types expand this many levels below the page root; deeper ones collapse to a link. */
const MAX_EXPANSION_LEVEL = 2;

/** Unions whose variants are another union's variants plus extra fields: derived name to base name. */
export const DERIVED_UNIONS: Readonly<Record<string, string>> = { NamedEffect: "Effect" };

/** Zod v4 check definition; only the fields rendered. */
interface CheckDef {
  check: string;
  format?: string;
  value?: number | bigint;
  inclusive?: boolean;
  minimum?: number;
  maximum?: number;
  length?: number;
}

/** Zod v4 definition node; only the fields this walk reads. */
interface Def {
  type: string;
  shape?: Record<string, z.ZodType>;
  innerType?: z.ZodType;
  element?: z.ZodType;
  valueType?: z.ZodType;
  options?: z.ZodType[];
  discriminator?: string;
  values?: unknown[];
  entries?: Record<string, unknown>;
  getter?: () => z.ZodType;
  checks?: { _zod: { def: CheckDef } }[];
  defaultValue?: unknown;
}

/** The definition node of a schema; `.describe()` copies share it with the original. */
const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** A lazy getter builds a new schema on every call, so each lazy definition is resolved once. */
const resolvedLazy = new WeakMap<object, z.ZodType>();

/** The schema a `z.lazy` definition stands for, memoised so a recursive reference is the same instance. */
function resolveLazy(def: Def): z.ZodType {
  let resolved = resolvedLazy.get(def);
  if (resolved === undefined) {
    resolved = def.getter!();
    resolvedLazy.set(def, resolved);
  }
  return resolved;
}

/** A schema with its optional / nullable / default / readonly / lazy wrappers stripped and their facts collected. */
interface Unwrapped {
  core: z.ZodType;
  def: Def;
  /** Registry name of the outermost named schema on the wrapper chain. */
  name?: string;
  /** Outermost non-empty description on the wrapper chain. */
  description?: string;
  optional: boolean;
  nullable: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
}

/** Collapses runs of whitespace so a description is a single line. */
const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Strips the wrappers around `schema` down to the schema that has content, recording whether it is
 * optional, nullable or defaulted, and taking its name and description from the outermost layer
 * that has one. A keyed union is a `pipe` underneath, so it is the core as soon as it is reached.
 */
function unwrap(schema: z.ZodType): Unwrapped {
  const registry = getRegistry();
  const result = { optional: false, nullable: false, hasDefault: false } as Unwrapped;
  let current = schema;
  for (;;) {
    result.name ??= registry.nameOf(current);
    if (result.description === undefined && current.description) result.description = normalize(current.description);
    const def = defOf(current);
    if (gamedef.keyedBranchesOf(current) !== undefined) break;
    if (def.type === "optional") result.optional = true;
    else if (def.type === "nullable") result.nullable = true;
    else if (def.type === "default") {
      result.hasDefault = true;
      result.defaultValue = def.defaultValue;
    } else if (def.type !== "readonly" && def.type !== "lazy") break;
    current = def.type === "lazy" ? resolveLazy(def) : def.innerType!;
  }
  result.core = current;
  result.def = defOf(current);
  return result;
}

/** Text up to the first sentence end; a period inside `e.g.` / `i.e.` does not end it. */
export function firstSentence(text: string): string {
  const end = /\.(?=\s|$)/g;
  for (let match = end.exec(text); match !== null; match = end.exec(text)) {
    if (!/(?:e\.g|i\.e|etc|vs)$/i.test(text.slice(0, match.index))) return text.slice(0, match.index + 1);
  }
  return text;
}

/** A type or field name as inline code; the `docs schema` command accepts the same name. */
const link = (name: string): string => `\`${name}\``;

/** The check definitions (min, max, format, ...) attached to a string, number or array schema. */
function checksOf(def: Def): CheckDef[] {
  return (def.checks ?? []).map((check) => check._zod.def);
}

/** Label for a string, number or boolean: the base type plus the constraints a reader needs, e.g. `number int ≥0`. */
function primitiveLabel(def: Def): string {
  const checks = checksOf(def);
  if (def.type === "boolean") return "boolean";
  const parts = [def.type];
  for (const check of checks) {
    if (def.type === "string") {
      if (check.check === "string_format") parts.push(`(${check.format === "regex" ? "pattern" : check.format})`);
      else if (check.check === "min_length") parts.push(`(min length ${check.minimum})`);
      else if (check.check === "max_length") parts.push(`(max length ${check.maximum})`);
      else if (check.check === "length_equals") parts.push(`(length ${check.length})`);
    } else if (check.check === "number_format") {
      parts.push(check.format!.includes("int") ? "int" : check.format!);
    } else if (check.check === "greater_than") {
      parts.push(`${check.inclusive ? "≥" : ">"}${check.value}`);
    } else if (check.check === "less_than") {
      parts.push(`${check.inclusive ? "≤" : "<"}${check.value}`);
    }
  }
  return parts.join(" ");
}

/** Length bounds of an array as a suffix, e.g. ` (min 1)`; empty when unbounded. */
function arrayBounds(def: Def): string {
  const bounds: string[] = [];
  for (const check of checksOf(def)) {
    if (check.check === "min_length") bounds.push(`min ${check.minimum}`);
    else if (check.check === "max_length") bounds.push(`max ${check.maximum}`);
    else if (check.check === "length_equals") bounds.push(`exactly ${check.length}`);
  }
  return bounds.length > 0 ? ` (${bounds.join(", ")})` : "";
}

/** Label for a literal or enum: its values, quoted, joined with `|`. */
function valuesLabel(def: Def): string {
  const values = def.type === "enum" ? Object.values(def.entries!) : def.values!;
  return values.map((value) => JSON.stringify(value)).join(" | ");
}

/** `{ a, b? }`: the keys of an object, optional ones marked. Names an anonymous object option compactly. */
function objectSignature(core: z.ZodType): string {
  const keys = Object.entries(defOf(core).shape ?? {}).map(([key, field]) => {
    const { optional, hasDefault } = unwrap(field);
    return optional || hasDefault ? `${key}?` : key;
  });
  return `{ ${keys.join(", ")} }`;
}

/** The discriminator values a union option matches; throws if the option has no literal discriminator. */
function discriminatorValues(option: z.ZodType, discriminator: string): string[] {
  const { def } = unwrap(option);
  const field = def.type === "object" ? def.shape?.[discriminator] : undefined;
  const literal = field === undefined ? undefined : unwrap(field).def;
  if (literal?.type !== "literal") {
    throw new Error(`render-type: union option has no literal "${discriminator}" discriminator`);
  }
  return literal.values!.map(String);
}

/** The outermost non-empty description on the wrapper chain of `schema`. */
export function descriptionOf(schema: z.ZodType): string | undefined {
  return unwrap(schema).description;
}

/** The variants of a discriminated union, one entry per discriminator value; undefined for any other schema. */
export function variantsOf(schema: z.ZodType): { discriminator: string; variants: [string, z.ZodType][] } | undefined {
  const { def } = unwrap(schema);
  if (def.type !== "union" || def.discriminator === undefined) return undefined;
  const discriminator = def.discriminator;
  const variants = def.options!.flatMap((option) =>
    discriminatorValues(option, discriminator).map((value): [string, z.ZodType] => [value, option]),
  );
  return { discriminator, variants };
}

/** A field type as a label, plus the lines that expand it (to be indented under the label). */
interface TypeInfo {
  label: string;
  nested: string[];
}

/** A named type that gets its own section on the page. */
interface Section {
  /** Registry name; empty for an unnamed root. */
  name: string;
  unwrapped: Unwrapped;
  /** Level below the page root; the fields of a section at level N are at level N + 1. */
  level: number;
  /** Markdown heading depth: 1 for the root, 2 for the rest. */
  heading: number;
  /** Definitions being expanded when the section was queued, for cycle detection. */
  path: readonly Def[];
}

/**
 * One page under construction. It holds the per-page state the expansion rules need (which named
 * types already have a section, whose description was shown) so a new `Page` is made per render.
 */
class Page {
  private readonly registry = getRegistry();
  /** Named types that have, or are queued to have, a section: each expands at most once. */
  private readonly expanded = new Set<string>();
  /** Named types whose one-line description has been shown. */
  private readonly described = new Set<string>();
  /** Cache of each named type's own description, which `describe` compares field text against. */
  private readonly ownDescriptions = new Map<string, string | undefined>();
  /** Sections in discovery order; the root first. Rendering a section may append more. */
  private queue: Section[] = [];
  /** Definitions being expanded, outermost first: a revisit is a cycle. `.describe()` copies share their def. */
  private path: Def[] = [];
  /** The named type whose section is being written, for "see <owner> page" pointers. */
  private owner: string | undefined;

  /** Renders the root section, then every section it queued, in the order they were discovered. */
  render(root: z.ZodType): string {
    const unwrapped = unwrap(root);
    const name = unwrapped.name ?? "";
    if (name) this.expanded.add(name);
    this.queue = [{ name, unwrapped, level: 0, heading: 1, path: [] }];
    const blocks: string[] = [];
    for (let i = 0; i < this.queue.length; i++) blocks.push(this.section(this.queue[i]));
    return `${blocks.join("\n\n")}\n`;
  }

  /** The type label of `root` alone, with nothing expanded. */
  label(root: z.ZodType): string {
    return this.type(unwrap(root), Number.POSITIVE_INFINITY).label;
  }

  /** One section: heading, description and body. Named types it mentions are queued, not written here. */
  private section(section: Section): string {
    const { name, unwrapped } = section;
    this.path = [...section.path, unwrapped.def];
    this.owner = name || undefined;
    const lines: string[] = [];
    if (name) lines.push(`${"#".repeat(section.heading)} ${name}`, "");
    if (unwrapped.description) lines.push(unwrapped.description, "");
    lines.push(...this.sectionBody(section));
    return lines.join("\n").trimEnd();
  }

  /** The body of a section, chosen by what the type is: keyed union, object, union, or a plain type. */
  private sectionBody(section: Section): string[] {
    const { unwrapped, level } = section;
    const branches = gamedef.keyedBranchesOf(unwrapped.core);
    if (branches !== undefined) {
      // A keyed union has no fields of its own, so its branches sit at its level.
      return ["One of, chosen by which key is present:", ...this.keyedBullets(branches, level)];
    }
    switch (unwrapped.def.type) {
      case "object":
        return this.fieldLines(unwrapped.core, level);
      case "union":
        return this.unionBody(section);
      default: {
        // Unnamed so that a named primitive does not point at itself.
        const info = this.type({ ...unwrapped, name: undefined }, level + 1);
        return [`Type: ${info.label}`, ...info.nested];
      }
    }
  }

  /**
   * The body of a union section: a derived union's extra fields, a plain union's options, a large
   * discriminated union's table, or a small one's per-variant sub-sections.
   */
  private unionBody(section: Section): string[] {
    const { unwrapped, level, name, heading } = section;
    const { options, discriminator } = unwrapped.def;
    const base = DERIVED_UNIONS[name];
    if (base !== undefined) return this.derivedLines(base, unwrapped, level);
    if (discriminator === undefined) return ["One of:", ...this.unionBullets(unwrapped, level)];
    if (options!.length > VARIANT_TABLE_THRESHOLD) return this.variantTable(unwrapped);
    const lines: string[] = [];
    for (const option of options!) {
      const variant = unwrap(option);
      lines.push(`${"#".repeat(heading + 1)} ${discriminator}: ${discriminatorValues(option, discriminator).join(" | ")}`, "");
      if (variant.description) lines.push(variant.description, "");
      lines.push(...this.fieldLines(variant.core, level, discriminator), "");
    }
    return lines;
  }

  /** "Any <base> variant, plus": the fields a derived union adds to every variant of its base union. */
  private derivedLines(baseName: string, derived: Unwrapped, level: number): string[] {
    const baseOptions = unwrap(this.registry.schemas.get(baseName)!).def.options!;
    const [first] = derived.def.options!;
    const firstShape = defOf(first).shape!;
    const [value] = discriminatorValues(first, derived.def.discriminator!);
    const baseShape = defOf(baseOptions.find((option) => discriminatorValues(option, derived.def.discriminator!)[0] === value)!).shape!;
    const lines = [`Any ${link(baseName)} variant, plus:`];
    for (const [key, field] of Object.entries(firstShape)) {
      if (!(key in baseShape)) lines.push(...this.fieldLine(key, field, level));
    }
    return lines;
  }

  /** A markdown table of a discriminated union's values and the first sentence of each description. */
  private variantTable(union: Unwrapped): string[] {
    const discriminator = union.def.discriminator!;
    const lines = [`| \`${discriminator}\` | Description |`, "|---|---|"];
    for (const option of union.def.options!) {
      const description = unwrap(option).description;
      const cell = description === undefined ? "" : firstSentence(description).replace(/\|/g, "\\|");
      lines.push(`| ${discriminatorValues(option, discriminator).map(link).join(", ")} | ${cell} |`);
    }
    return lines;
  }

  /**
   * One bullet per union option, for plain unions and for unions expanded inline under a field.
   * Object options list their fields beneath; a large discriminated union lists values only.
   */
  private unionBullets(union: Unwrapped, level: number): string[] {
    const { options, discriminator } = union.def;
    const lines: string[] = [];
    if (discriminator !== undefined && options!.length > VARIANT_TABLE_THRESHOLD) {
      for (const option of options!) {
        const description = unwrap(option).description;
        const values = discriminatorValues(option, discriminator).map(link).join(", ");
        lines.push(`- ${values}${description === undefined ? "" : ` — ${firstSentence(description)}`}`);
      }
      return lines;
    }
    for (const option of options!) {
      const variant = unwrap(option);
      let head: string;
      let nested: string[] = [];
      if (discriminator !== undefined) {
        head = link(`${discriminator}: ${discriminatorValues(option, discriminator).join(" | ")}`);
        nested = this.fieldLines(variant.core, level, discriminator);
      } else if (variant.name === undefined && variant.def.type === "object") {
        head = `\`${objectSignature(variant.core)}\``;
        nested = this.fieldLines(variant.core, level);
      } else {
        const info = this.type(variant, level + 1);
        head = info.label;
        nested = info.nested;
      }
      const description = this.describe(variant);
      lines.push(`- ${head}${description === undefined ? "" : ` — ${description}`}`);
      lines.push(...nested.map((line) => `  ${line}`));
    }
    return lines;
  }

  /** One bullet per branch of a keyed union: `` - `key` → Type ``. */
  private keyedBullets(branches: Record<string, z.ZodType>, level: number): string[] {
    const lines: string[] = [];
    for (const [key, branch] of Object.entries(branches)) {
      const info = this.type(unwrap(branch), level);
      lines.push(`- ${link(key)} → ${info.label}`);
      lines.push(...info.nested.map((line) => `  ${line}`));
    }
    return lines;
  }

  /** The field lines of the object `core`, which is itself at `level`; `skip` is the discriminator. */
  private fieldLines(core: z.ZodType, level: number, skip?: string): string[] {
    const lines: string[] = [];
    this.path.push(defOf(core));
    for (const [key, field] of Object.entries(defOf(core).shape ?? {})) {
      if (key !== skip) lines.push(...this.fieldLine(key, field, level));
    }
    this.path.pop();
    return lines;
  }

  /** One field: its line, then the lines that expand its type, indented. `level` is the owning object's. */
  private fieldLine(key: string, field: z.ZodType, level: number): string[] {
    const unwrapped = unwrap(field);
    const info = this.type(unwrapped, level + 1);
    const flags = unwrapped.hasDefault
      ? `optional, default ${JSON.stringify(unwrapped.defaultValue)}`
      : unwrapped.optional
        ? "optional"
        : "required";
    const description = this.describe(unwrapped);
    return [
      `- ${link(key)} (${flags}) ${info.label}${description === undefined ? "" : ` — ${description}`}`,
      ...info.nested.map((line) => `  ${line}`),
    ];
  }

  /**
   * The description to print beside a type. A named type's own description is shown once per page,
   * in full by its section or as one sentence at its first link; a field's own text always shows.
   */
  private describe(unwrapped: Unwrapped): string | undefined {
    const { name, description } = unwrapped;
    if (description === undefined) return undefined;
    if (name === undefined || description !== this.ownDescription(name)) return description;
    if (this.expanded.has(name) || this.described.has(name)) return undefined;
    this.described.add(name);
    return firstSentence(description);
  }

  /** The description of the registered schema `name` itself, without any field-level override. */
  private ownDescription(name: string): string | undefined {
    if (!this.ownDescriptions.has(name)) {
      this.ownDescriptions.set(name, unwrap(this.registry.schemas.get(name)!).description);
    }
    return this.ownDescriptions.get(name);
  }

  /** The label and expansion of a type; `level` is where a composite type here would sit. */
  private type(unwrapped: Unwrapped, level: number): TypeInfo {
    const info = this.typeOf(unwrapped, level);
    return unwrapped.nullable ? { ...info, label: `${info.label} | null` } : info;
  }

  /** `type` without the nullable suffix; dispatches on the Zod node type and throws on one it does not know. */
  private typeOf(unwrapped: Unwrapped, level: number): TypeInfo {
    const { core, def, name } = unwrapped;
    const branches = gamedef.keyedBranchesOf(core);
    if (branches !== undefined) return this.keyedType(unwrapped, branches, level);
    switch (def.type) {
      case "string":
        return { label: name === undefined ? primitiveLabel(def) : link(name), nested: [] };
      case "number":
      case "boolean":
        return { label: primitiveLabel(def), nested: [] };
      case "any":
        return { label: "any", nested: [] };
      case "literal":
      case "enum":
        return { label: valuesLabel(def), nested: [] };
      case "array": {
        const element = this.type(unwrap(def.element!), level);
        const label = element.label.includes(" | ") ? `(${element.label})` : element.label;
        return { label: `${label}[]${arrayBounds(def)}`, nested: element.nested };
      }
      case "record": {
        const value = this.type(unwrap(def.valueType!), level);
        return { label: `Record<string, ${value.label}>`, nested: value.nested };
      }
      case "object":
        return this.objectType(unwrapped, level);
      case "union":
        return this.unionType(unwrapped, level);
      default:
        throw new Error(`render-type: unhandled Zod node type "${def.type}"${name === undefined ? "" : ` in ${name}`}`);
    }
  }

  /** Whether a composite at `level` may still be expanded here: within the level limit and not a cycle. */
  private canExpand(core: z.ZodType, level: number): boolean {
    return level <= MAX_EXPANSION_LEVEL && !this.path.includes(defOf(core));
  }

  /** Queues a section for a named composite unless it has one already or is too deep. */
  private queueSection(name: string, core: z.ZodType, level: number): void {
    if (this.expanded.has(name) || !this.canExpand(core, level)) return;
    this.expanded.add(name);
    // The section describes the type itself, not the field that happened to reach it first.
    const unwrapped = unwrap(this.registry.schemas.get(name)!);
    this.queue.push({ name, unwrapped, level, heading: 2, path: [...this.path] });
  }

  /** A named object is a link (with a section queued); an anonymous one expands inline or collapses. */
  private objectType(unwrapped: Unwrapped, level: number): TypeInfo {
    const { core, name } = unwrapped;
    if (name !== undefined) {
      this.queueSection(name, core, level);
      return { label: link(name), nested: [] };
    }
    if (this.canExpand(core, level)) return { label: "object", nested: this.fieldLines(core, level) };
    return { label: this.owner === undefined ? "object" : `object (see ${this.owner} page)`, nested: [] };
  }

  /**
   * A named union is a link (with a section queued). An anonymous one lists its options inline,
   * or collapses to its option labels once past the level limit.
   */
  private unionType(unwrapped: Unwrapped, level: number): TypeInfo {
    const { core, def, name } = unwrapped;
    if (name !== undefined) {
      this.queueSection(name, core, level);
      return { label: link(name), nested: [] };
    }
    if (!this.canExpand(core, level)) {
      if (def.discriminator !== undefined) {
        const values = def.options!.flatMap((option) => discriminatorValues(option, def.discriminator!));
        return { label: `object, one of ${link(def.discriminator)}: ${values.map((value) => JSON.stringify(value)).join(" | ")}`, nested: [] };
      }
      const labels = def.options!.map((option) => {
        const variant = unwrap(option);
        if (variant.name === undefined && variant.def.type === "object") return objectSignature(variant.core);
        return this.type(variant, Number.POSITIVE_INFINITY).label;
      });
      return { label: labels.join(" | "), nested: [] };
    }
    this.path.push(def);
    const nested = this.unionBullets(unwrapped, level);
    this.path.pop();
    return { label: "one of", nested };
  }

  /** A named keyed union is a link (with a section queued); an anonymous one is described inline by its branches. */
  private keyedType(unwrapped: Unwrapped, branches: Record<string, z.ZodType>, level: number): TypeInfo {
    const { core, def, name } = unwrapped;
    if (name !== undefined) {
      this.queueSection(name, core, level);
      return { label: link(name), nested: [] };
    }
    if (this.path.includes(def)) return { label: "(recursive)", nested: [] };
    // A keyed union has no fields of its own, so its branches sit at the union's level.
    this.path.push(def);
    const parts: string[] = [];
    const nested: string[] = [];
    for (const [key, branch] of Object.entries(branches)) {
      const info = this.type(unwrap(branch), level);
      parts.push(`${link(key)} → ${info.label}`);
      nested.push(...info.nested);
    }
    this.path.pop();
    return { label: `one of, chosen by which key is present: ${parts.join(", ")}`, nested };
  }
}

/**
 * Renders a schema as one markdown page: a heading and description, one line per field, and a
 * section for each named type it contains, up to MAX_EXPANSION_LEVEL levels below the root.
 * With `expandRoot: false` it returns only the root's type label, such as `` `FlowNode` ``.
 */
export function renderType(schema: z.ZodType, options: { expandRoot?: boolean } = {}): string {
  const page = new Page();
  return options.expandRoot === false ? page.label(schema) : page.render(schema);
}
