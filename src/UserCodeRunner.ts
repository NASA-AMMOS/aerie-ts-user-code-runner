import vm from 'vm';
import ts from 'typescript';
import path from 'path';
import {SourceMapConsumer} from 'source-map';
import {Result} from './utils/monads.js';
import {parse} from 'stack-trace';

const EXECUTION_HARNESS_FILENAME = '__execution_harness';
const USER_FILE_ALIAS = '__user_file';

// Fill in the missing module vm types
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
  args: ArgsType,
  outputType: string = 'any',
  argsTypes: string[] = ['any'],
  context: vm.Context = vm.createContext(),
  timeout: number = 5000,
): Promise<Result<ReturnType, UserCodeError[]>> {

  // Typecheck and transpile code
  const userSourceFile = ts.createSourceFile(USER_FILE_ALIAS, userCode, ts.ScriptTarget.ESNext, undefined, ts.ScriptKind.TS);

  const executionCode =  `
    import defaultExport from '${USER_FILE_ALIAS}';
    
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
  public abstract get stack(): string;
  public abstract get sourceContext(): string;
  public abstract get location(): { line: number, column: number };
  protected static underlineNodes(file: ts.SourceFile, nodes: ts.Node[], contextLines: number = 1) {
    return UserCodeError.underlineRanges(file, nodes.map(node => [node.getStart(), node.getEnd()]), contextLines);
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
        lineMap.set(line, '>' + lineText.slice(1) + '\n' + ' '.repeat(character + line.toString().length + maxLineNumberLength + 2) + '~'.repeat(tokenLength));
      }
    }

    return [...lineMap.values()].join('\n');
  }
  protected static displayLineWithContext(sourceCode: string, lineNumber: number, context: number = 1): string {
    const lines = sourceCode.split('\n');
    const start = Math.max(0, lineNumber - 1 - context);
    const end = Math.min(lines.length, lineNumber - 1 + context);

    const lineNumbers = lines.slice(start, end + 1).map((l, i) => i);

    const maxLineNumberLength = Math.max(...lineNumbers).toString().length;

    return lines.slice(start, end + 1).map((l, i) => {
      const isCurrentLine = i === (lineNumber - 1) - start;
      return (isCurrentLine ? '>' : ' ') + (i + start + 1).toString().padStart(maxLineNumberLength, ' ') + '| ' + l;
    }).join('\n');
  }
  protected static getDescendentNodeOfType(node: ts.Node, nodeKind: ts.SyntaxKind): ts.Node | null {
    if (node.kind === nodeKind) {
      return node;
    }
    for (const child1 of node.getChildren()) {
      const result = UserCodeError.getDescendentNodeOfType(child1, nodeKind);
      if (result !== null) {
        return result;
      }
    }
    return null;
  }
  protected static getDescendentAtPosition(node: ts.Node, position: number): ts.Node | null {
    for (const child1 of node.getChildren()) {
      if (child1.getStart() <= position && position <= child1.getEnd()) {
        return UserCodeError.getDescendentAtPosition(child1, position);
      }
    }
    const start = node.getStart();
    const end = node.getEnd();
    if (start <= position && position <= end) {
      return node;
    }
    return null;
  }
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

  public get message(): string {
    return 'TypeError: ' + ts.flattenDiagnosticMessageText(this.diagnostic.messageText, '\n');
  }

  public get stack(): string {
    const userFile = this.sources.get(`${USER_FILE_ALIAS}.ts`)!;
    const diagnosticNode = UserCodeError.getDescendentAtPosition(userFile, this.diagnostic.start!);
    if (diagnosticNode === null) {
      throw new Error(`Could not find node for diagnostic ${this.diagnostic.messageText}`);
    }
    const functionDeclaration = ts.findAncestor(diagnosticNode, (node) => {
      return node.kind === ts.SyntaxKind.FunctionDeclaration;
    }) as ts.FunctionDeclaration;

    return 'at ' + functionDeclaration.name?.text + '(' + this.location.line + ':' + this.location.column + ')';
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
    return 'Error: ' + this.error.message;
  }

  public get stack(): string {
    const stack = parse(this.error);
    const stackWithoutHarness = stack
      .filter(callsite => callsite.getFileName()?.endsWith(`${USER_FILE_ALIAS}.js`))
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
    return stackWithoutHarness
      .map(callsite => {
        const mappedLocation = this.sourceMap.originalPositionFor({
          line: callsite.getLineNumber()!,
          column: callsite.getColumnNumber()!
        });
        const functionName = callsite.getFunctionName();
        const lineNumber = mappedLocation.line;
        const columnNumber = mappedLocation.column;
        return 'at ' + functionName + '(' +  lineNumber + ':' + columnNumber + ')';
      })
      .join('\n');
  }

  public get sourceContext(): string {
    return UserCodeRuntimeError.displayLineWithContext(this.tsFileCache.get(`${USER_FILE_ALIAS}.ts`)!.text, this.location.line);
  }

  public get location(): { line: number, column: number } {
    const stack = parse(this.error);
    const originalPosition = this.sourceMap.originalPositionFor({
      line: stack[0].getLineNumber()!,
      column: stack[0].getColumnNumber()!
    });
    return {
      line: originalPosition.line!,
      column: originalPosition.column!,
    }
  }
}

// Redirect the execution harness errors to the user code type signature
class ExecutionHarnessTypeError extends UserCodeTypeError {

  constructor(protected diagnostic: ts.Diagnostic, protected sources: Map<string, ts.SourceFile>) {
    super(diagnostic, sources);
    const diagnosticNode = UserCodeError.getDescendentAtPosition(sources.get(`${EXECUTION_HARNESS_FILENAME}.ts`)!, this.diagnostic.start!);
    // Get out diagnostic node and check if its our result or our defaultFunction call to map correctly back to user code file
    if (diagnosticNode === this.executionHarnessResultNode) {
      this.diagnostic.file = this.sources.get(`${USER_FILE_ALIAS}.ts`)!;
      this.diagnostic.start = this.defaultExportedFunctionNode.type!.getStart();
      this.diagnostic.length = this.defaultExportedFunctionNode.type!.getEnd() - this.defaultExportedFunctionNode.type!.getStart();
      this.diagnostic.messageText = `Incorrect return type. Expected: '${this.outputTypeNode.getText()}', Actual: '${this.defaultExportedFunctionNode.type!.getText()}'.`;
    } else if (diagnosticNode === this.executionHarnessDefaultFunctionIdentifierNode) {
      this.diagnostic.file = this.sources.get(`${USER_FILE_ALIAS}.ts`)!;
      const parameters = this.defaultExportedFunctionNode.parameters;
      this.diagnostic.start = Math.min(...parameters.map(p => p.getStart()));
      this.diagnostic.length = Math.max(...parameters.map(p => p.getEnd())) - this.diagnostic.start;
      this.diagnostic.messageText = `Incorrect argument type. Expected: '${this.argumentTypeNode.getText()}', Actual: '[${parameters.map(s => s.type?.getText()).join(', ')}]'.`;
    } else {
      throw new Error('Unmapped execution harness error');
    }
  }

  public get stack(): string {
    return 'at ' + this.defaultExportedFunctionNode.name!.getText() + '(' + this.location.line + ':' + this.location.column + ')';
  }

  public get sourceContext(): string {
    const userFile = this.sources.get(`${USER_FILE_ALIAS}.ts`)!;
    const diagnosticNode = UserCodeError.getDescendentAtPosition(this.sources.get(`${EXECUTION_HARNESS_FILENAME}.ts`)!, this.diagnostic.start!);

    if (diagnosticNode === this.executionHarnessResultNode) {
      return UserCodeTypeError.underlineNodes(userFile, [this.defaultExportedFunctionNode.type!]);
    } else if (diagnosticNode === this.executionHarnessDefaultFunctionIdentifierNode) {
      return UserCodeTypeError.underlineNodes(userFile, [...this.defaultExportedFunctionNode.parameters]);
    }

    return super.sourceContext;
  }

  public get location(): { line: number, column: number } {

    const location = this.sources.get(`${USER_FILE_ALIAS}.ts`)!.getLineAndCharacterOfPosition(this.diagnostic.start!)
    return {
      line: location.line,
      column: location.character,
    }
  }

  protected get defaultExportedFunctionNode(): ts.FunctionDeclaration {
    const userFile = this.sources.get(`${USER_FILE_ALIAS}.ts`)!;
    return userFile.statements.find(s => (
      s.kind === ts.SyntaxKind.FunctionDeclaration
      && s.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
      && s.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)
    ))! as ts.FunctionDeclaration;
  }

  protected get executionHarnessResultNode(): ts.Identifier {
    const executionHarness = this.sources.get(`${EXECUTION_HARNESS_FILENAME}.ts`)!;
    const assignmentExpression = (executionHarness.statements[2] as ts.ExpressionStatement).expression as ts.BinaryExpression;
    return assignmentExpression.left as ts.Identifier;
  }

  protected get executionHarnessDefaultFunctionIdentifierNode(): ts.Identifier {
    const executionHarness = this.sources.get(`${EXECUTION_HARNESS_FILENAME}.ts`)!;
    const assignmentExpression = (executionHarness.statements[2] as ts.ExpressionStatement).expression as ts.BinaryExpression;
    const callExpression = (assignmentExpression.right as ts.CallExpression);

    return callExpression.expression as ts.Identifier;
  }

  protected get argumentTypeNode(): ts.TypeNode {
    const executionHarness = this.sources.get(`${EXECUTION_HARNESS_FILENAME}.ts`)!;
    const moduleDeclaration = executionHarness.statements
      .find(s => s.kind === ts.SyntaxKind.ModuleDeclaration)! as ts.ModuleDeclaration;
    const moduleBlock = moduleDeclaration.body! as ts.ModuleBlock;
    const variableDeclaration = UserCodeError.getDescendentNodeOfType(moduleBlock.statements[0], ts.SyntaxKind.VariableDeclaration)! as ts.VariableDeclaration;
    return variableDeclaration.type!;
  }

  protected get outputTypeNode(): ts.TypeNode {
    const executionHarness = this.sources.get(`${EXECUTION_HARNESS_FILENAME}.ts`)!;
    const moduleDeclaration = executionHarness.statements
      .find(s => s.kind === ts.SyntaxKind.ModuleDeclaration)! as ts.ModuleDeclaration;
    const moduleBlock = moduleDeclaration.body! as ts.ModuleBlock;
    const variableDeclaration = UserCodeError.getDescendentNodeOfType(moduleBlock.statements[1], ts.SyntaxKind.VariableDeclaration)! as ts.VariableDeclaration;
    return variableDeclaration.type!;
  }
}

function printTree(node: ts.Node | ts.Node[], level = 0): string {
  if (Array.isArray(node)) {
    let returnString = '';
    for (const child of node) {
      returnString += printTree(child, level);
    }
    return returnString;
  }

  let returnString = ts.SyntaxKind[node.kind].indent(level) + ': ' + node.getText().split('\n')[0] +  '\n';
  for (const child of node.getChildren()) {
    returnString += printTree(child, level + 1);
  }
  return returnString;
}
