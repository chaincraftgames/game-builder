/**
 * In-Memory TypeScript Compilation Validator
 *
 * Validates generated mechanic TypeScript code against state interfaces
 * using the TypeScript compiler API. No temp files, no CLI — everything
 * runs in-memory via a custom CompilerHost.
 *
 * See: GENERATED_MECHANICS_DESIGN.md §7 — "tsc Validation"
 */

import ts from 'typescript';

export interface TscError {
  /** TypeScript diagnostic error code (e.g. 2339, 2322) */
  code: number;
  /** Human-readable error message */
  message: string;
  /** The transitionId this error belongs to (extracted from file name) */
  mechanicId: string;
  /** 1-based line number within the mechanic source */
  line: number;
  /** 0-based character offset within the line */
  column: number;
}

export interface TscValidationResult {
  valid: boolean;
  errors: TscError[];
}

const INTERFACES_FILE = '/virtual/state-interfaces.ts';
const MECHANIC_PREFIX = '/virtual/mechanic-';

function mechanicFileName(transitionId: string): string {
  return `${MECHANIC_PREFIX}${transitionId}.ts`;
}

function transitionIdFromFileName(fileName: string): string {
  const base = fileName.slice(MECHANIC_PREFIX.length);
  return base.replace(/\.ts$/, '');
}

/**
 * Validates generated mechanic TypeScript code against state interfaces
 * using the TypeScript compiler API in-memory.
 *
 * @param stateInterfaces - TypeScript source defining MechanicState, CallLLM, MechanicResult, etc.
 * @param mechanicSources - Map of transitionId → TypeScript source code for each mechanic
 * @returns Validation result with any type errors found
 */
export function validateMechanics(
  stateInterfaces: string,
  mechanicSources: Record<string, string>,
): TscValidationResult {
  // Build virtual file system
  const virtualFiles = new Map<string, string>();
  virtualFiles.set(INTERFACES_FILE, stateInterfaces);

  // Count lines in stateInterfaces so error line numbers can be offset back to
  // 1-based lines within the mechanic source (used in the diagnostic loop below).
  const stateInterfaceLineCount = stateInterfaces.split('\n').length;

  const mechanicFileNames: string[] = [];
  for (const [transitionId, source] of Object.entries(mechanicSources)) {
    const fileName = mechanicFileName(transitionId);
    // Concatenate stateInterfaces directly into each mechanic compilation unit so
    // all generated types — including sub-interfaces like GameState_LastRoundChoices
    // produced from 'object'-typed schema fields — are in scope without needing an
    // explicit named import. A named import can only list statically-known symbols;
    // concatenation makes every exported declaration available automatically.
    const fullSource = stateInterfaces + '\n' + source;
    virtualFiles.set(fileName, fullSource);
    mechanicFileNames.push(fileName);
  }

  const allFileNames = [INTERFACES_FILE, ...mechanicFileNames];

  // Compiler options — strict mode, ESNext target, no emit
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };

  // Get the default compiler host to delegate non-virtual file reads
  const defaultHost = ts.createCompilerHost(compilerOptions);

  // Custom CompilerHost that serves virtual files in-memory
  const customHost: ts.CompilerHost = {
    getSourceFile(fileName, languageVersion) {
      const virtualContent = virtualFiles.get(fileName);
      if (virtualContent !== undefined) {
        return ts.createSourceFile(fileName, virtualContent, languageVersion, true);
      }
      // Delegate to default host for lib.d.ts and other built-ins
      return defaultHost.getSourceFile(fileName, languageVersion);
    },
    getDefaultLibFileName: (options) => defaultHost.getDefaultLibFileName(options),
    writeFile: () => {
      /* no-op — we never emit */
    },
    getCurrentDirectory: () => defaultHost.getCurrentDirectory(),
    getCanonicalFileName: (fileName) => defaultHost.getCanonicalFileName(fileName),
    useCaseSensitiveFileNames: () => defaultHost.useCaseSensitiveFileNames(),
    getNewLine: () => defaultHost.getNewLine(),
    fileExists(fileName) {
      if (virtualFiles.has(fileName)) return true;
      return defaultHost.fileExists(fileName);
    },
    readFile(fileName) {
      const virtualContent = virtualFiles.get(fileName);
      if (virtualContent !== undefined) return virtualContent;
      return defaultHost.readFile(fileName);
    },
    resolveModuleNames(moduleNames, containingFile) {
      return moduleNames.map((moduleName) => {
        // Resolve relative imports between virtual files
        if (moduleName === './state-interfaces') {
          return {
            resolvedFileName: INTERFACES_FILE,
            isExternalLibraryImport: false,
          } as ts.ResolvedModule;
        }
        // Delegate other module resolution to the default host
        const result = ts.resolveModuleName(
          moduleName,
          containingFile,
          compilerOptions,
          defaultHost,
        );
        return result.resolvedModule;
      });
    },
  };

  // Create program and collect diagnostics for mechanic files only
  const program = ts.createProgram(allFileNames, compilerOptions, customHost);

  const errors: TscError[] = [];

  for (const mechanicFile of mechanicFileNames) {
    const sourceFile = program.getSourceFile(mechanicFile);
    if (!sourceFile) continue;

    const diagnostics = program.getSemanticDiagnostics(sourceFile);

    for (const diag of diagnostics) {
      const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
      let line = 1;
      let column = 0;

      if (diag.file && diag.start !== undefined) {
        const pos = diag.file.getLineAndCharacterOfPosition(diag.start);
        // Convert the 0-based position in the concatenated virtual file back to
        // a 1-based line number within the mechanic source itself.
        // The mechanic starts at line index `stateInterfaceLineCount` (0-based)
        // because stateInterfaces occupies lines 0..stateInterfaceLineCount-1,
        // followed by a blank separator line, then the mechanic source.
        line = pos.line - stateInterfaceLineCount + 1;
        column = pos.character;
      }

      errors.push({
        code: diag.code,
        message,
        mechanicId: transitionIdFromFileName(mechanicFile),
        line,
        column,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
