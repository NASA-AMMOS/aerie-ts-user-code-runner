import vm from 'vm';
import ts from 'typescript';
import path from 'path';
import {SourceMapConsumer} from 'source-map';
import {Result} from './utils/monads.js';
import {displaySourceLineWithContext} from './utils/displaySourceLineWithContext.js';
import {parse} from 'stack-trace';
import {indent} from "./utils/stringUtils.js";

const EXECUTION_HARNESS_FILENAME = '__execution_harness';
const USER_FILE_ALIAS = '__user_file';

const outputsErrorRegex = new RegExp(`Type '(.*)' is not assignable to type '(.*)'.`);
const argumentsErrorRegex = new RegExp(`Argument of type '(.*)' is not assignable to parameter of type '(.*)'.`);
const tooManyArgs = new RegExp(`Expected (\\d+) arguments, but got (\\d+).`);

declare module 'vm' {

  export class Module {
    dependencySpecifiers: string[];
    error: any;
    evaluate(options?: {
      timeout?: number,
      breakOnSigInt?: boolean,
    }): Promise<undefined>;
    identifier: string;
    link(linker: (specifier: string, extra: { assert?: {[key:string]: any} }, referencingModule: vm.Module) => vm.Module | Promise<vm.Module>): void;
    namespace: unknown; // GetModuleNamespace;
    status: 'unlinked' | 'linking' | 'linked' | 'evaluating' | 'evaluated' | 'errored';
  }

  export class SourceTextModule extends Module {
    public constructor(code: string, options?: {
      identifier?: string,
      cachedData?: Buffer | NodeJS.TypedArray | DataView,
      context?: vm.Context,
      lineOffset?: number,
      columnOffset?: number,
      initializeImportMeta?: {
        meta?: any,
        module?: vm.SourceTextModule,
      },
      importModuleDynamically?: (specifier: string, importMeta: any) => Promise<vm.Module>,
    });
    createCachedData(): Buffer;
  }

}

export async function executeUserCode<ArgsType extends any[], ReturnType = any>(
  userCode: string,
  userCodeFileName: string,
  args: ArgsType,
  outputType: string = 'any',
  argsTypes: string[] = ['any'],
  systemCode: string = '',
  context: vm.Context = vm.createContext(),
  timeout: number = 5000,
): Promise<Result<ReturnType, UserCodeError[]>> {

  // Typecheck and transpile code
  const userSourceFile = ts.createSourceFile(userCodeFileName, userCode, ts.ScriptTarget.ESNext, undefined, ts.ScriptKind.TS);

  const executionCode =  `
    import defaultExport from '${USER_FILE_ALIAS}';
    
    ${systemCode}
    
    declare global {
      const args: [${argsTypes.join(', ')}];
      let result: ${outputType};
    }
    result = defaultExport(...args);
  `;
  const executionSourceFile = ts.createSourceFile(EXECUTION_HARNESS_FILENAME, executionCode, ts.ScriptTarget.ESNext, undefined, ts.ScriptKind.TS);

  const tsFileCache = new Map<string, ts.SourceFile>();

  tsFileCache.set(`${USER_FILE_ALIAS}.ts`, userSourceFile);
  tsFileCache.set(`${EXECUTION_HARNESS_FILENAME}.ts`, executionSourceFile);

  const jsFileCache = new Map<string, ts.SourceFile>();

  const defaultCompilerHost = ts.createCompilerHost({});
  const customCompilerHost: ts.CompilerHost = {
    ...defaultCompilerHost,
    getSourceFile: (fileName, languageVersion) => {
      if (tsFileCache.has(fileName)) {
        return tsFileCache.get(fileName);
      } else if (fileName.includes('typescript/lib')) {
        return defaultCompilerHost.getSourceFile(fileName, languageVersion);
      }
      return undefined;
    },
    writeFile: (filename, data) => {
      jsFileCache.set(filename, ts.createSourceFile(filename, data, ts.ScriptTarget.ESNext, undefined, ts.ScriptKind.JS));
    },
    readFile(fileName: string): string | undefined {

      if (tsFileCache.has(fileName)) {
        return tsFileCache.get(fileName)!.text;
      }
      return defaultCompilerHost.readFile(fileName);
    },
    fileExists(fileName: string): boolean {
      return tsFileCache.has(path.basename(fileName));

    },
  };

  const program = ts.createProgram([USER_FILE_ALIAS, EXECUTION_HARNESS_FILENAME], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ES2022,
    lib: ['lib.esnext.d.ts'],
    sourceMap: true,
  }, customCompilerHost);

  const sourceErrors: UserCodeError[] = [];
  ts.getPreEmitDiagnostics(program).forEach(diagnostic => {
    if (diagnostic.file) {
      sourceErrors.push(UserCodeTypeError.new(diagnostic, tsFileCache));
    }
  });

  const emitResult = program.emit();

  const sourceMap = await new SourceMapConsumer(jsFileCache.get(`${USER_FILE_ALIAS}.js.map`)!.text);

  for (const diagnostic of emitResult.diagnostics) {
    if (diagnostic.file) {
      sourceErrors.push(UserCodeTypeError.new(diagnostic, tsFileCache));
    }
  }

  if (sourceErrors.length > 0) {
    return Result.Err(sourceErrors);
  }

  // Put args and result into context
  context.args = args;
  context.result = undefined;

  // Create modules for VM
  const moduleCache = new Map<string, vm.Module>();
  for (const jsFile of jsFileCache.values()) {
    if (jsFile.fileName.endsWith('.js')) {
      moduleCache.set(jsFile.fileName, new vm.SourceTextModule(jsFile.text, {
        identifier: jsFile.fileName,
        context,
      }));
    }
  }

  const harnessModule = moduleCache.get(`${EXECUTION_HARNESS_FILENAME}.js`)!;
  await harnessModule.link((specifier) => {
    if (moduleCache.has(specifier + '.js')) {
      return moduleCache.get(specifier + '.js')!;
    }
    throw new Error(`Unable to resolve dependency: ${specifier}`);
  });

  try {
    await harnessModule.evaluate({
      timeout
    });
    return Result.Ok(context.result);
  } catch (error: any) {
    return Result.Err([UserCodeRuntimeError.new(error as Error, sourceMap, tsFileCache)]);
  }
}

// Base error type for the DSLRunner
abstract class UserCodeError {
  public abstract get message(): string;
  public abstract get sourceContext(): string;
  public abstract get location(): { line: number, column: number };
}

// Pretty print type errors with indicators under the offending code
class UserCodeTypeError extends UserCodeError {
  protected constructor(protected diagnostic: ts.Diagnostic, protected sources: Map<string, ts.SourceFile>) {
    super();
  }

  public static new(diagnostic: ts.Diagnostic, sources: Map<string, ts.SourceFile>): UserCodeError {
    if (diagnostic.file?.fileName === `${EXECUTION_HARNESS_FILENAME}.ts`) {
      return new ExecutionHarnessTypeError(diagnostic, sources);
    }
    return new UserCodeTypeError(diagnostic, sources);
  }

  public toString(): string {
    return 'TypeError: ' + this.message + '\n' + this.sourceContext;
  }


  public get message(): string {
    return ts.flattenDiagnosticMessageText(this.diagnostic.messageText, '\n');
  }

  public get sourceContext(): string {
    const start = this.diagnostic.start!;
    const end = this.diagnostic.start! + this.diagnostic.length!;
    return UserCodeTypeError.underlineRanges(this.sources.get(`${USER_FILE_ALIAS}.ts`)!, [[start, end]]);
  }

  public get location(): { line: number, column: number } {
    if (this.diagnostic.start === undefined) {
      throw new Error('Could not find start position');
    }
    const location = this.sources.get(`${USER_FILE_ALIAS}.ts`)!.getLineAndCharacterOfPosition(this.diagnostic.start)
    return {
      line: location.line,
      column: location.character,
    }
  }

  protected static underlineNodes(file: ts.SourceFile, nodes: ts.Node[], contextLines: number = 1) {

    const lines = file.text.split('\n');

    const linesToDisplay = [...nodes.reduce((accum, item) => {
      const line = file.getLineAndCharacterOfPosition(item.getStart()).line;
      const startLineIndex = Math.max(0, line - contextLines);
      const endLineIndex = Math.min(lines.length, line + contextLines);
      for (let i = startLineIndex; i <= endLineIndex; i++) {
        accum.add(i);
      }
      return accum;
    }, new Set<number>())];

    const maxLineNumberLength = Math.max(...linesToDisplay).toString().length;

    const lineMap = new Map<number, string>();
    for (const [index, line] of linesToDisplay.entries()) {
      if (!lineMap.has(line)) {
        lineMap.set(line, ' ' + (line + 1).toString().padStart(maxLineNumberLength, ' ') + '| ' + lines[line]);
        if (line !== linesToDisplay[index - 1] + 1 && index !== 0) {
          lineMap.set(line - 1, '⋮'.padStart(maxLineNumberLength, ' '));
        }
      }

    }

    for (const node of nodes) {
      const {line, character} = file.getLineAndCharacterOfPosition(node!.getStart())
      const tokenLength = node!.getEnd() - node!.getStart();
      if (lineMap.has(line)) {
        const lineText = lineMap.get(line)!;
        lineMap.set(line, '>' + lineText.slice(1) + '\n' + ' '.repeat(character + line.toString().length + maxLineNumberLength + 2) + '^'.repeat(tokenLength));
      }
    }

    return [...lineMap.values()].join('\n');
  }
  protected static underlineRanges(file: ts.SourceFile, ranges: [number, number][], contextLines: number = 1) {

    const lines = file.text.split('\n');

    const linesToDisplay = [...ranges.reduce((accum, item) => {
      const line = file.getLineAndCharacterOfPosition(item[0]).line;
      const startLineIndex = Math.max(0, line - contextLines);
      const endLineIndex = Math.min(lines.length, line + contextLines);
      for (let i = startLineIndex; i <= endLineIndex; i++) {
        accum.add(i);
      }
      return accum;
    }, new Set<number>())];

    const maxLineNumberLength = Math.max(...linesToDisplay).toString().length;

    const lineMap = new Map<number, string>();
    for (const [index, line] of linesToDisplay.entries()) {
      if (!lineMap.has(line)) {
        lineMap.set(line, ' ' + (line + 1).toString().padStart(maxLineNumberLength, ' ') + '| ' + lines[line]);
        if (line !== linesToDisplay[index - 1] + 1 && index !== 0) {
          lineMap.set(line - 1, '⋮'.padStart(maxLineNumberLength, ' '));
        }
      }

    }

    for (const range of ranges) {
      const {line, character} = file.getLineAndCharacterOfPosition(range[0])
      const tokenLength = range[1] - range[0];
      if (lineMap.has(line)) {
        const lineText = lineMap.get(line)!;
        lineMap.set(line, '>' + lineText.slice(1) + '\n' + ' '.repeat(character + line.toString().length + maxLineNumberLength + 2) + '^'.repeat(tokenLength));
      }
    }

    return [...lineMap.values()].join('\n');
  }
}

// Pretty print runtime errors with lines numbers
class UserCodeRuntimeError extends UserCodeError {
  private readonly error: Error;
  private readonly sourceMap: SourceMapConsumer;
  private readonly tsFileCache: Map<string, ts.SourceFile>;
  protected constructor(error: Error, sourceMap: SourceMapConsumer, tsFileCache: Map<string, ts.SourceFile>) {
    super();
    this.error = error;
    this.sourceMap = sourceMap;
    this.tsFileCache = tsFileCache;
  }

  public static new(error: Error, sourceMap: SourceMapConsumer, tsFileCache: Map<string, ts.SourceFile>): UserCodeRuntimeError {
    return new UserCodeRuntimeError(error, sourceMap, tsFileCache);
  }

  public get message(): string {

    const stack = parse(this.error);
    const stackWithoutHarness = stack.filter(callsite => callsite.getFileName()?.endsWith(`${USER_FILE_ALIAS}.js`))
      .filter(callsite => {
        if (callsite.getFileName() === undefined) {
          return false;
        }
        const mappedLocation = this.sourceMap.originalPositionFor({
          line: callsite.getLineNumber()!,
          column: callsite.getColumnNumber()!,
        });
        return mappedLocation.line !== null;
      });
    const stackMessage = stackWithoutHarness
      .map(callsite => {
        const mappedLocation = this.sourceMap.originalPositionFor({
          line: callsite.getLineNumber()!,
          column: callsite.getColumnNumber()!
        });
        const functionName = callsite.getFunctionName();
        const lineNumber = mappedLocation.line;
        const columnNumber = mappedLocation.column;
        return indent('at ' + functionName + '(' +  lineNumber + ':' + columnNumber + ')');
      })
      .join('\n');

    let errorMessage = this.error.name + ': ';
    errorMessage += this.error.message + '\n' + stackMessage;
    return errorMessage;
  }

  public get sourceContext(): string {
    const stack = parse(this.error);
    return displaySourceLineWithContext(this.tsFileCache.get(`${USER_FILE_ALIAS}.ts`)!.text, this.sourceMap.originalPositionFor({
      line: stack[0].getLineNumber()!,
      column: stack[0].getColumnNumber()!
    }).line!);
  }

  public get location(): { line: number, column: number } {
    const stack = parse(this.error);
    return {
      line: stack[0].getLineNumber(),
      column: stack[0].getColumnNumber(),
    }
  }

}

// Redirect the execution harness errors to the user code type signature
class ExecutionHarnessTypeError extends UserCodeTypeError {
  public get message(): string {
    let errorMessage = '';

    const flatMessage = ts.flattenDiagnosticMessageText(this.diagnostic.messageText, '\n');
    if (outputsErrorRegex.test(flatMessage)) {
      const match = flatMessage.match(outputsErrorRegex)!;
      errorMessage += `Incorrect return type. Expected: '${match[2]}', Actual: '${match[1]}'.`;
    } else if (argumentsErrorRegex.test(flatMessage)) {
      const match = flatMessage.match(argumentsErrorRegex)!;
      errorMessage += `Incorrect argument type. Expected: '${match[1]}', Actual: '${match[2]}'.`;
    } else if (tooManyArgs.test(flatMessage)) {
      const match = flatMessage.match(tooManyArgs)!;
      errorMessage += `Incorrect number of arguments. Expected: '${match[2]}', Actual: '${match[1]}'.`;
    } else {
      errorMessage += flatMessage;
    }
    return errorMessage;
  }

  get sourceContext(): string {

    const userFile = this.sources.get(`${USER_FILE_ALIAS}.ts`)!;

    const flatMessage = ts.flattenDiagnosticMessageText(this.diagnostic.messageText, '\n');

    if (outputsErrorRegex.test(flatMessage)) {
      const defaultExportedFunctionNode = userFile
        .getChildren()[0]
        .getChildren()
        .find(node0 => (
          node0.kind === ts.SyntaxKind.FunctionDeclaration
          && node0.getChildren().some(node1 => (
            node1.kind === ts.SyntaxKind.SyntaxList
            && node1.getChildren().some(node2 => node2.kind === ts.SyntaxKind.ExportKeyword)
            && node1.getChildren().some(node2 => node2.kind === ts.SyntaxKind.DefaultKeyword)
          ))
        ));

      if (defaultExportedFunctionNode === undefined) {
        throw new Error('Could not find default exported function');
      }

      let returnTypeNode: ts.Node | null = null;
      let lastNode: ts.Node | null = null;
      for (const child1 of defaultExportedFunctionNode.getChildren()) {
        if (
          child1.kind === ts.SyntaxKind.CloseParenToken
        ) {
          lastNode = child1;
        } else if (
          child1.kind === ts.SyntaxKind.ColonToken
          && lastNode?.kind === ts.SyntaxKind.CloseParenToken
        ) {
          lastNode = child1;
        } else if (
          lastNode?.kind === ts.SyntaxKind.ColonToken
        ) {
          returnTypeNode = child1;
          break;
        }
      }

      if (returnTypeNode === null) {
        throw new Error('Could not find return type node');
      }

      return UserCodeTypeError.underlineNodes(userFile, [returnTypeNode]);
    } else if (argumentsErrorRegex.test(flatMessage) || tooManyArgs.test(flatMessage)) {
      const defaultExportedFunctionNode = userFile
        .getChildren()[0]
        .getChildren()
        .find(node0 => (
          node0.kind === ts.SyntaxKind.FunctionDeclaration
          && node0.getChildren().some(node1 => (
            node1.kind === ts.SyntaxKind.SyntaxList
            && node1.getChildren().some(node2 => node2.kind === ts.SyntaxKind.ExportKeyword)
            && node1.getChildren().some(node2 => node2.kind === ts.SyntaxKind.DefaultKeyword)
          ))
        ));

      if (defaultExportedFunctionNode === undefined) {
        throw new Error('Could not find default exported function');
      }

      let parameterTypeNode: ts.Node | null = null;
      let lastNode: ts.Node | null = null;
      for (const child1 of defaultExportedFunctionNode.getChildren()) {
        if (child1.kind === ts.SyntaxKind.OpenParenToken) {
          lastNode = child1;
        } else if (
          lastNode?.kind === ts.SyntaxKind.OpenParenToken
          && child1.kind === ts.SyntaxKind.SyntaxList
        ) {
          parameterTypeNode = child1;
          break;
        }
      }

      if (parameterTypeNode === null) {
        throw new Error('Could not find parameter type node');
      }

      return UserCodeTypeError.underlineNodes(userFile, [parameterTypeNode]);
    }

    return '';
  }
}
