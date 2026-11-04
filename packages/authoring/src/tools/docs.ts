import { existsSync, readdirSync, readFileSync } from "node:fs";
import yaml from "js-yaml";
import { expressionDoc } from "#authoring/docs/expressions.js";
import { firstSentence } from "#authoring/docs/render-type.js";
import { schemaDoc } from "#authoring/docs/schema-ref.js";
import { AuthoringCode, type Diagnostic } from "#authoring/diagnostics.js";

/** Package `docs/` directory; the same relative depth from `src/tools` and `dist/tools`. */
const DOCS_DIR = new URL("../../docs/", import.meta.url);

/** Options for {@link docs}. */
export interface DocsOptions {
  /** Directory holding the shipped docs; defaults to the package's `docs/`. */
  docsDir?: URL;
}

/** Outcome of {@link docs}. */
export interface DocsResult {
  ok: boolean;
  /** The page; present when `ok`. */
  text?: string;
  diagnostics: Diagnostic[];
}

/** A topic is listed and resolvable only when its content exists. */
interface Topic {
  id: string;
  summary: string;
  available: (dir: URL) => boolean;
  /** Renders the topic page, or the ids `arg` could have meant. */
  render: (dir: URL, arg?: string) => { text: string } | { knownIds: string[] };
}

interface GuideSection {
  id: string;
  text: string;
}

interface Howto {
  id: string;
  title: string;
  touches: string[];
  body: string;
}

const slug = (heading: string): string => heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const exists = (dir: URL, relative: string): boolean => existsSync(new URL(relative, dir));

/** First non-empty prose line of a markdown body, cut to its first sentence. */
function oneLine(body: string): string {
  const line = body.split("\n").find((l) => l.trim() !== "" && !/^[#`|>-]/.test(l.trim())) ?? "";
  return firstSentence(line.trim());
}

/** Splits `guide.md` into its `##` sections. */
function guideSections(dir: URL): GuideSection[] {
  const sections: GuideSection[] = [];
  let current: { heading: string; lines: string[] } | undefined;
  const flush = () => {
    if (current) sections.push({ id: slug(current.heading), text: current.lines.join("\n").trimEnd() });
  };
  for (const line of readFileSync(new URL("guide.md", dir), "utf8").split("\n")) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      flush();
      current = { heading: heading[1], lines: [line] };
    } else {
      current?.lines.push(line);
    }
  }
  flush();
  return sections;
}

/** Reads `howto/*.md`; front matter carries `id`, `title` and `touches`. */
function howtos(dir: URL): Howto[] {
  const folder = new URL("howto/", dir);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(readFileSync(new URL(name, folder), "utf8"));
      if (!match) throw new Error(`howto/${name} has no front matter`);
      const meta = yaml.load(match[1]) as { id: string; title: string; touches?: string[] };
      return { id: meta.id, title: meta.title, touches: meta.touches ?? [], body: match[2].trim() };
    });
}

function table(header: string[], rows: string[][]): string {
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

const TOPICS: Topic[] = [
  {
    id: "schema",
    summary: "Shape of every module and element: `schema [module|Type|value|Type.value]`",
    available: () => true,
    render: (dir, arg) => {
      const result = schemaDoc(arg, { examplesDir: new URL("examples/", dir) });
      return result.ok ? { text: result.text } : { knownIds: result.knownIds };
    },
  },
  {
    id: "expressions",
    summary: "Condition expression syntax, paths and functions",
    available: () => true,
    render: (_dir, arg) => (arg === undefined ? { text: expressionDoc() } : { knownIds: [] }),
  },
  {
    id: "guide",
    summary: "How flow, actor context, game end, effects and visibility behave: `guide [section]`",
    available: (dir) => exists(dir, "guide.md"),
    render: (dir, arg) => {
      const sections = guideSections(dir);
      if (arg === undefined) {
        const index = sections.map((s) => [`\`${s.id}\``, oneLine(s.text.split("\n").slice(1).join("\n"))]);
        return { text: `# Guide sections\n\nRead one with \`chaincraft docs guide <id>\`.\n\n${table(["Section", "Summary"], index)}\n` };
      }
      const found = sections.find((s) => s.id === arg);
      return found ? { text: `${found.text}\n` } : { knownIds: sections.map((s) => s.id) };
    },
  },
  {
    id: "howto",
    summary: "Recipes for common patterns: `howto [id]`",
    available: (dir) => howtos(dir).length > 0,
    render: (dir, arg) => {
      const all = howtos(dir);
      if (arg === undefined) {
        const index = all.map((h) => [`\`${h.id}\``, h.title, h.touches.map((t) => `\`${t}\``).join(", ")]);
        return { text: `# How-to recipes\n\nRead one with \`chaincraft docs howto <id>\`.\n\n${table(["Recipe", "Title", "Touches"], index)}\n` };
      }
      const found = all.find((h) => h.id === arg);
      return found ? { text: `# ${found.title}\n\n${found.body}\n` } : { knownIds: all.map((h) => h.id) };
    },
  },
  {
    id: "known-gaps",
    summary: "Fields the schema declares but the engine does not enforce",
    available: (dir) => exists(dir, "known-gaps.md"),
    render: (dir, arg) => (arg === undefined ? { text: readFileSync(new URL("known-gaps.md", dir), "utf8") } : { knownIds: [] }),
  },
  {
    id: "example",
    summary: "A complete spec (High Card): `example [module]` for one top-level module",
    available: (dir) => exists(dir, "examples/high-card.yaml"),
    render: (dir, arg) => {
      const source = readFileSync(new URL("examples/high-card.yaml", dir), "utf8");
      if (arg === undefined) return { text: source };
      const spec = yaml.load(source) as Record<string, unknown>;
      if (!Object.hasOwn(spec, arg)) return { knownIds: Object.keys(spec) };
      return { text: yaml.dump({ [arg]: spec[arg] }, { lineWidth: -1 }) };
    },
  },
];

function indexPage(available: Topic[]): string {
  return [
    "# chaincraft docs",
    "",
    "Start with `chaincraft docs example` (a complete spec), then `chaincraft docs schema <module>` for the module you are writing.",
    "",
    ...available.map((t) => `- \`${t.id}\` — ${t.summary}`),
    "",
  ].join("\n");
}

/**
 * Looks up agent documentation.
 *
 * @param topic - A topic id; omitted for the topic index.
 * @param arg - A topic-specific argument, e.g. a module key for `schema`.
 * @returns The page, or an `unknown-topic` diagnostic listing the ids that would have resolved.
 */
export function docs(topic?: string, arg?: string, options: DocsOptions = {}): DocsResult {
  const dir = options.docsDir ?? DOCS_DIR;
  const available = TOPICS.filter((t) => t.available(dir));
  /** Builds the failure result for a topic or argument that does not resolve. */
  const unknown = (message: string, knownIds: string[]): DocsResult => ({
    ok: false,
    diagnostics: [{ severity: "error", code: AuthoringCode.UnknownTopic, message, ...(knownIds.length > 0 ? { knownIds } : {}) }],
  });

  if (topic === undefined) return { ok: true, text: indexPage(available), diagnostics: [] };
  const found = available.find((t) => t.id === topic);
  if (!found) return unknown(`Unknown docs topic "${topic}".`, available.map((t) => t.id));
  const page = found.render(dir, arg);
  if ("text" in page) return { ok: true, text: page.text, diagnostics: [] };
  if (page.knownIds.length === 0) return unknown(`Docs topic "${topic}" takes no argument.`, []);
  return unknown(`Unknown argument "${arg}" for docs topic "${topic}".`, page.knownIds);
}
