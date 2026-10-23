export {
  compileExpression,
  compilePredicate,
  parseExpression,
  ExpressionError,
} from './expressions/index.js';

export type {
  Expr,
  EvalContext,
  ExprFn,
  PredicateFn,
} from './expressions/index.js';

export { 
  assembleConfig,
  assembleInitialState, 
  assembleModule,
  assembleSession 
} from './assembler/index.js';
export type { 
  AssembledSessionFactory, 
  GameConfig, 
  GameState, 
  GameSession 
} from './assembler/index.js';

