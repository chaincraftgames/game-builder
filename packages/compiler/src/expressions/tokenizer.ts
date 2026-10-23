// ---------------------------------------------------------------------------
// Expression tokenizer
//
// Scans an infix expression string into a flat token array. Tokens:
//   number, string, boolean, ident, dot, lparen, rparen, comma,
//   compare (== != >= <= > <), and, or, not, plus, minus, star, slash, eof
// ---------------------------------------------------------------------------

import { ExpressionError } from './types.js';

export type TokenKind =
  | 'number'
  | 'string'
  | 'boolean'
  | 'ident'
  | 'dot'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'compare'
  | 'and'
  | 'or'
  | 'not'
  | 'plus'
  | 'minus'
  | 'star'
  | 'slash'
  | 'eof';

export interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

const KEYWORDS: Record<string, TokenKind> = {
  and: 'and',
  or: 'or',
  not: 'not',
  true: 'boolean',
  false: 'boolean',
};

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }

    const pos = i;

    // Two-char comparison operators
    if (i + 1 < input.length) {
      const two = input[i] + input[i + 1];
      if (two === '==' || two === '!=' || two === '>=' || two === '<=') {
        tokens.push({ kind: 'compare', value: two, pos });
        i += 2;
        continue;
      }
    }

    // Single-char tokens
    const ch = input[i];
    if (ch === '>' || ch === '<') {
      tokens.push({ kind: 'compare', value: ch, pos });
      i++;
      continue;
    }
    if (ch === '.') { tokens.push({ kind: 'dot', value: '.', pos }); i++; continue; }
    if (ch === '(') { tokens.push({ kind: 'lparen', value: '(', pos }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'rparen', value: ')', pos }); i++; continue; }
    if (ch === ',') { tokens.push({ kind: 'comma', value: ',', pos }); i++; continue; }
    if (ch === '+') { tokens.push({ kind: 'plus', value: '+', pos }); i++; continue; }
    if (ch === '*') { tokens.push({ kind: 'star', value: '*', pos }); i++; continue; }
    if (ch === '/') { tokens.push({ kind: 'slash', value: '/', pos }); i++; continue; }

    // Minus: negative number literal vs subtraction operator
    if (ch === '-') {
      if (i + 1 < input.length && /\d/.test(input[i + 1])) {
        const prev = tokens[tokens.length - 1];
        if (!prev || (prev.kind !== 'number' && prev.kind !== 'ident' && prev.kind !== 'rparen')) {
          // Negative number literal
          i++;
          let num = '-';
          while (i < input.length && /[\d.]/.test(input[i])) {
            num += input[i];
            i++;
          }
          tokens.push({ kind: 'number', value: num, pos });
          continue;
        }
      }
      tokens.push({ kind: 'minus', value: '-', pos });
      i++;
      continue;
    }

    // Number literals
    if (/\d/.test(ch)) {
      let num = '';
      while (i < input.length && /[\d.]/.test(input[i])) {
        num += input[i];
        i++;
      }
      tokens.push({ kind: 'number', value: num, pos });
      continue;
    }

    // String literals (single or double quoted)
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let str = '';
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          str += input[i + 1];
          i += 2;
        } else {
          str += input[i];
          i++;
        }
      }
      if (i >= input.length) {
        throw new ExpressionError('Unterminated string literal', pos, input);
      }
      i++; // skip closing quote
      tokens.push({ kind: 'string', value: str, pos });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
        ident += input[i];
        i++;
      }
      const keyword = KEYWORDS[ident];
      tokens.push({ kind: keyword ?? 'ident', value: ident, pos });
      continue;
    }

    throw new ExpressionError(`Unexpected character '${ch}'`, pos, input);
  }

  tokens.push({ kind: 'eof', value: '', pos: i });
  return tokens;
}
