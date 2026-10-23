// ---------------------------------------------------------------------------
// Expression parser — recursive descent, produces an Expr AST.
//
// Grammar (precedence low → high):
//
//   expression     → logical_or
//   logical_or     → logical_and ('or' logical_and)*
//   logical_and    → not_expr ('and' not_expr)*
//   not_expr       → 'not' not_expr | comparison
//   comparison     → additive (compare_op additive)?
//   additive       → multiplicative (('+' | '-') multiplicative)*
//   multiplicative → primary (('*' | '/') primary)*
//   primary        → literal | call | path | '(' expression ')'
//   call           → IDENT '(' args? ')'
//   path           → IDENT ('.' IDENT)*
//   args           → expression (',' expression)*
//   literal        → NUMBER | STRING | BOOLEAN
// ---------------------------------------------------------------------------

import type { Token, TokenKind } from './tokenizer.js';
import { tokenize } from './tokenizer.js';
import type { Expr, CompareOp, ArithOp } from './types.js';
import { ExpressionError } from './types.js';

class Parser {
  private pos = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  parse(): Expr {
    const expr = this.expression();
    if (!this.isAt('eof')) {
      throw this.error(`Unexpected token '${this.current().value}'`);
    }
    return expr;
  }

  // --- Precedence layers ---------------------------------------------------

  private expression(): Expr {
    return this.logicalOr();
  }

  private logicalOr(): Expr {
    let left = this.logicalAnd();
    while (this.isAt('or')) {
      this.advance();
      const right = this.logicalAnd();
      left = { kind: 'logical', op: 'or', left, right };
    }
    return left;
  }

  private logicalAnd(): Expr {
    let left = this.notExpr();
    while (this.isAt('and')) {
      this.advance();
      const right = this.notExpr();
      left = { kind: 'logical', op: 'and', left, right };
    }
    return left;
  }

  private notExpr(): Expr {
    if (this.isAt('not')) {
      this.advance();
      const operand = this.notExpr();
      return { kind: 'not', operand };
    }
    return this.comparison();
  }

  private comparison(): Expr {
    let left = this.additive();
    if (this.isAt('compare')) {
      const op = this.current().value as CompareOp;
      this.advance();
      const right = this.additive();
      left = { kind: 'compare', op, left, right };
    }
    return left;
  }

  private additive(): Expr {
    let left = this.multiplicative();
    while (this.isAt('plus') || this.isAt('minus')) {
      const op = this.current().value as ArithOp;
      this.advance();
      const right = this.multiplicative();
      left = { kind: 'arithmetic', op, left, right };
    }
    return left;
  }

  private multiplicative(): Expr {
    let left = this.primary();
    while (this.isAt('star') || this.isAt('slash')) {
      const op = this.current().value as ArithOp;
      this.advance();
      const right = this.primary();
      left = { kind: 'arithmetic', op, left, right };
    }
    return left;
  }

  // --- Primary expressions -------------------------------------------------

  private primary(): Expr {
    const tok = this.current();

    // Parenthesized expression
    if (tok.kind === 'lparen') {
      this.advance();
      const inner = this.expression();
      this.expect('rparen');
      return inner;
    }

    // Literals
    if (tok.kind === 'number') {
      this.advance();
      return { kind: 'literal', value: Number(tok.value) };
    }
    if (tok.kind === 'string') {
      this.advance();
      return { kind: 'literal', value: tok.value };
    }
    if (tok.kind === 'boolean') {
      this.advance();
      return { kind: 'literal', value: tok.value === 'true' };
    }

    // Identifier: could be a function call or a dotted path
    if (tok.kind === 'ident') {
      // Look ahead for '(' → function call
      if (this.peek()?.kind === 'lparen') {
        return this.call();
      }
      return this.path();
    }

    throw this.error(`Expected expression, got '${tok.value || tok.kind}'`);
  }

  private call(): Expr {
    const fnTok = this.current();
    this.advance(); // consume ident
    this.expect('lparen');
    const args: Expr[] = [];
    if (!this.isAt('rparen')) {
      args.push(this.expression());
      while (this.isAt('comma')) {
        this.advance();
        args.push(this.expression());
      }
    }
    this.expect('rparen');
    return { kind: 'call', fn: fnTok.value, args };
  }

  private path(): Expr {
    const segments: string[] = [this.current().value];
    this.advance(); // consume first ident
    while (this.isAt('dot')) {
      this.advance(); // consume dot
      if (!this.isAt('ident')) {
        throw this.error('Expected identifier after "."');
      }
      segments.push(this.current().value);
      this.advance();
    }
    return { kind: 'path', segments };
  }

  // --- Utilities -----------------------------------------------------------

  private current(): Token {
    return this.tokens[this.pos];
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos + 1];
  }

  private isAt(kind: TokenKind): boolean {
    return this.current().kind === kind;
  }

  private advance(): Token {
    const tok = this.tokens[this.pos];
    this.pos++;
    return tok;
  }

  private expect(kind: TokenKind): Token {
    if (!this.isAt(kind)) {
      throw this.error(`Expected '${kind}', got '${this.current().value || this.current().kind}'`);
    }
    return this.advance();
  }

  private error(message: string): ExpressionError {
    return new ExpressionError(message, this.current().pos, this.source);
  }
}

/**
 * Parse an infix expression string into an AST.
 */
export function parseExpression(input: string): Expr {
  const tokens = tokenize(input);
  return new Parser(tokens, input).parse();
}
