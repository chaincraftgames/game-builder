export function extractJsonBlocks(text: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();

  // 1) Try direct parse of the whole string
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch (e) {
    // continue to other heuristics
  }

  // 2) Try fenced code block extraction (```json ... ``` or ``` ... ```)
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/i;
  const fenceMatch = fenceRe.exec(text);
  if (fenceMatch && fenceMatch[1]) {
    const candidate = fenceMatch[1].trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch (e) {}
  }

  // 3) Try XML-like tags <json>...</json>
  const xmlRe = /<json>\s*([\s\S]*?)<\/json>/i;
  const xmlMatch = xmlRe.exec(text);
  if (xmlMatch && xmlMatch[1]) {
    const candidate = xmlMatch[1].trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch (e) {}
  }

  // 4) Fallback: find first brace/bracket and attempt a simple balanced-scan
  const firstBrace = (() => {
    const i1 = text.indexOf('{');
    const i2 = text.indexOf('[');
    if (i1 === -1) return i2;
    if (i2 === -1) return i1;
    return Math.min(i1, i2);
  })();

  if (firstBrace === -1) return null;

  const opening = text[firstBrace];
  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = firstBrace; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === opening) depth++;
    else if (ch === closing) {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(firstBrace, i + 1).trim();
        try {
          JSON.parse(candidate);
          return candidate;
        } catch (e) {
          break;
        }
      }
    }
  }

  return null;
}

export default extractJsonBlocks;
