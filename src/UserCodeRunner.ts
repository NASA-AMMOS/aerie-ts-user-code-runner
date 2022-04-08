import vm from 'vm';
import crypto from 'crypto';
import path from 'path';
import { defaultErrorCodeMessageMappers } from './defaultErrorCodeMessageMappers.js';
import { createMapDiagnosticMessage } from './utils/errorMessageMapping.js';
import ts from 'typescript';
import { parse } from 'stack-trace';
import { BasicSourceMapConsumer, IndexedSourceMapConsumer, SourceMapConsumer } from 'source-map';
import LRUCache from 'lru-cache';
import { Result } from './utils/monads.js';

type integer = number;

export {defaultErrorCodeMessageMappers} from './defaultErrorCodeMessageMappers.js';

const EXECUTION_HARNESS_FILENAME = '__execution_harness';
const USER_CODE_FILENAME = '__user_file';

export interface CacheItem {
	jsFileMap: Map<string, ts.SourceFile>;
	tsFileMap: Map<string, ts.SourceFile>;
	sourceMap: BasicSourceMapConsumer | IndexedSourceMapConsumer;
}

export interface UserCodeRunnerOptions {
	cacheOptions?: LRUCache.Options<string, CacheItem>;
	typeErrorCodeMessageMappers?: {[errorCode: number]: (message: string) => string | undefined },// The error code to message mappers
}

export class UserCodeRunner {
	private readonly user_file_cache: LRUCache<string, CacheItem>;
	private readonly mapDiagnosticMessage: ReturnType<typeof createMapDiagnosticMessage>;

	constructor(options?: UserCodeRunnerOptions) {
		this.user_file_cache = new LRUCache<string, CacheItem>({
			max: 500,
			ttl: 1000 * 60 * 30,
			...options?.cacheOptions
		});
		this.mapDiagnosticMessage = createMapDiagnosticMessage(options?.typeErrorCodeMessageMappers ?? defaultErrorCodeMessageMappers);
	}

	public async preProcess(
		userCode: string,
		outputType: string = 'any',
		argsTypes: string[] = ['any'],
		additionalSourceFiles: ts.SourceFile[] = [],
	): Promise<Result<CacheItem, UserCodeError[]>> {
		// TypeCheck and transpile code
		const userSourceFile = ts.createSourceFile(
			USER_CODE_FILENAME,
			userCode,
			ts.ScriptTarget.ESNext,
			undefined,
			ts.ScriptKind.TS,
		);

		const executionCode = `
			${additionalSourceFiles.map(file => {
				if (file.fileName.endsWith('.d.ts')) return '';
				const fileNameSansExt = removeExt(file.fileName);
				return `import '${fileNameSansExt}';`;
			}).join('\n  ')}
      import defaultExport from '${USER_CODE_FILENAME}';
            
      declare global {
        const __args: [${argsTypes.join(', ')}];
        let __result: ${outputType};
      }
      __result = defaultExport(...__args);
    `;

		const executionSourceFile = ts.createSourceFile(
			EXECUTION_HARNESS_FILENAME,
			executionCode,
			ts.ScriptTarget.ESNext,
			undefined,
			ts.ScriptKind.TS,
		);

		const tsFileMap = new Map<string, ts.SourceFile>();

		tsFileMap.set(USER_CODE_FILENAME, userSourceFile);
		tsFileMap.set(EXECUTION_HARNESS_FILENAME, executionSourceFile);

		for (const additionalSourceFile of additionalSourceFiles) {
			tsFileMap.set(removeExt(additionalSourceFile.fileName), additionalSourceFile);
		}

		const jsFileMap = new Map<string, ts.SourceFile>();
		const sourceMapMap = new Map<string, ts.SourceFile>();

		const defaultCompilerHost = ts.createCompilerHost({});
		const customCompilerHost: ts.CompilerHost = {
			...defaultCompilerHost,
			getCurrentDirectory(): string {
				return '';
			},
			getSourceFile: (fileName, languageVersion) => {
				const filenameSansExt = removeExt(fileName);
				if (tsFileMap.has(filenameSansExt)) {
					return tsFileMap.get(filenameSansExt);
				} else if (fileName.includes('typescript/lib')) {
					return defaultCompilerHost.getSourceFile(fileName, languageVersion);
				}
				return undefined;
			},
			writeFile: (fileName, data) => {
				const filenameSansExt = removeExt(fileName);
				if (fileName.endsWith('.map')) {
					sourceMapMap.set(removeExt(filenameSansExt), ts.createSourceFile(removeExt(filenameSansExt), data, ts.ScriptTarget.ESNext));
				} else {
					jsFileMap.set(
						filenameSansExt,
						ts.createSourceFile(filenameSansExt, data, ts.ScriptTarget.ESNext, undefined, ts.ScriptKind.JS),
					);
				}
			},
			readFile(fileName: string): string | undefined {
				const filenameSansExt = removeExt(fileName);
				if (tsFileMap.has(filenameSansExt)) {
					return tsFileMap.get(filenameSansExt)!.text;
				}
				return defaultCompilerHost.readFile(fileName);
			},
			fileExists(fileName: string): boolean {
				const filenameSansExt = removeExt(fileName);
				return tsFileMap.has(filenameSansExt);
			},
		};

		const program = ts.createProgram(
			[...additionalSourceFiles.map(f => f.fileName), EXECUTION_HARNESS_FILENAME],
			{
				target: ts.ScriptTarget.ESNext,
				module: ts.ModuleKind.ES2022,
				lib: ['lib.esnext.d.ts'],
				sourceMap: true,
			},
			customCompilerHost,
		);

		const sourceErrors: UserCodeError[] = [];
		ts.getPreEmitDiagnostics(program).forEach(diagnostic => {
			if (diagnostic.file) {
				sourceErrors.push(UserCodeTypeError.new(diagnostic, tsFileMap, this.mapDiagnosticMessage));
			} else {
				const codes = getDiagnosticCodes(diagnostic);
				if (codes.some(code => ([1420] as integer[]).includes(code))) {
					// Do Nothing, this is an implicit type library we don't want imported
				} else {
					throw new Error(`Unhandled diagnostic: ${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
				}
			}
		});

		const emitResult = program.emit();

		const sourceMap = await new SourceMapConsumer(sourceMapMap.get(USER_CODE_FILENAME)!.text);

		emitResult.diagnostics.forEach(diagnostic => {
			if (diagnostic.file) {
				sourceErrors.push(UserCodeTypeError.new(diagnostic, tsFileMap, this.mapDiagnosticMessage));
			} else {
				throw new Error(`Unhandled diagnostic: ${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
			}
		});

		if (sourceErrors.length > 0) {
			return Result.Err(sourceErrors);
		}

		return Result.Ok({
			jsFileMap,
			tsFileMap,
			sourceMap,
		});
	}

	private static hash(str: string): string {
		return crypto.createHash('sha1').update(str).digest('base64');
	}

	public async executeUserCode<ArgsType extends any[], ReturnType = any>(
		userCode: string,
		args: ArgsType,
		outputType: string = 'any',
		argsTypes: string[] = ['any'],
		timeout: number = 5000,
		additionalSourceFiles: ts.SourceFile[] = [],
		context: vm.Context = vm.createContext(),
	): Promise<Result<ReturnType, UserCodeError[]>> {
		const userCodeHash = UserCodeRunner.hash(`${userCode}:${outputType}:${argsTypes.join(':')}${additionalSourceFiles.map(f => `:${f.text}`).join('')}`);

		if (!this.user_file_cache.has(userCodeHash)) {
			const result = await this.preProcess(userCode, outputType, argsTypes, additionalSourceFiles);

			if (result.isErr()) {
				return result;
			}
			this.user_file_cache.set(userCodeHash, result.unwrap());
		}

		const { jsFileMap, tsFileMap, sourceMap } = this.user_file_cache.get(userCodeHash)!;

		// Put args and result into context
		context.__args = args;
		context.__result = undefined;

		// Create modules for VM
		const moduleCache = new Map<string, vm.Module>();
		for (const jsFile of jsFileMap.values()) {
			moduleCache.set(
				jsFile.fileName,
				new vm.SourceTextModule(jsFile.text, {
					identifier: jsFile.fileName,
					context,
				}),
			);
		}
		const harnessModule = moduleCache.get(EXECUTION_HARNESS_FILENAME)!;
		await harnessModule.link(specifier => {
			if (moduleCache.has(specifier)) {
				return moduleCache.get(specifier)!;
			}
			throw new Error(`Unable to resolve dependency: ${specifier}`);
		});

		try {
			await harnessModule.evaluate({
				timeout,
			});
			return Result.Ok(context.__result);
		} catch (error: any) {
			return Result.Err([UserCodeRuntimeError.new(error as Error, sourceMap, tsFileMap)]);
		}
	}
}

// Base error type for the User Code Runner
export abstract class UserCodeError {
	// Simple Error Message
	public abstract get message(): string;

	// Stack of the Error
	public abstract get stack(): string;

	// Source code with surrounding lines to provide context to the error
	public abstract get sourceContext(): string;

	// Location in the source code where the error occurred
	public abstract get location(): { line: number; column: number };

	protected static underlineNodes(file: ts.SourceFile, nodes: ts.Node[], contextLines: number = 1) {
		return UserCodeError.underlineRanges(
			file,
			nodes.map(node => [node.getStart(), node.getEnd()]),
			contextLines,
		);
	}

	protected static underlineRanges(file: ts.SourceFile, ranges: [number, number][], contextLines: number = 1) {
		const lines = file.text.split('\n');

		const linesToDisplay = [
			...ranges.reduce((accum, item) => {
				const line = file.getLineAndCharacterOfPosition(item[0]).line;
				const startLineIndex = Math.max(0, line - contextLines);
				const endLineIndex = Math.min(lines.length, line + contextLines);
				for (let i = startLineIndex; i <= endLineIndex; i++) {
					accum.add(i);
				}
				return accum;
			}, new Set<number>()),
		];

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
			const { line, character } = file.getLineAndCharacterOfPosition(range[0]);
			const tokenLength = range[1] - range[0];
			if (lineMap.has(line)) {
				const lineText = lineMap.get(line)!;
				lineMap.set(
					line,
					'>' +
						lineText.slice(1) +
						'\n' +
						' '.repeat(character + line.toString().length + maxLineNumberLength + 2) +
						'~'.repeat(tokenLength),
				);
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

		return lines
			.slice(start, end + 1)
			.map((l, i) => {
				const isCurrentLine = i === lineNumber - 1 - start;
				return (isCurrentLine ? '>' : ' ') + (i + start + 1).toString().padStart(maxLineNumberLength, ' ') + '| ' + l;
			})
			.join('\n');
	}

	protected static displayLinesWithLineNumbers(sourceCode: string, startLine: number, endLine: number): string {
		const lines = sourceCode.split('\n');
		const start = Math.max(0, startLine - 1);
		const end = Math.min(lines.length, endLine - 1);

		const lineNumbers = lines.slice(start, end + 1).map((l, i) => i);

		const maxLineNumberLength = Math.max(...lineNumbers).toString().length;

		return lines
			.slice(start, end + 1)
			.map((l, i) => {
				return ' ' + (i + start + 1).toString().padStart(maxLineNumberLength, ' ') + '| ' + l;
			})
			.join('\n');
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

	protected static getDescendentAtLocation(node: ts.Node, start: number, end: number): ts.Node | null {
		if (node.getStart() === start && node.getEnd() === end) {
			return node;
		}
		for (const child1 of node.getChildren()) {
			if (child1.getStart() <= start && end <= child1.getEnd()) {
				return UserCodeError.getDescendentAtLocation(child1, start, end);
			}
		}
		return null;
	}

	public toJSON(): {
		message: string;
		stack: string;
		sourceContext: string;
		location: { line: number; column: number };
	} {
		return {
			message: this.message,
			stack: this.stack,
			sourceContext: this.sourceContext,
			location: this.location,
		};
	}

	public toString(): string {
		return `${this.message}\n${this.stack}\n${this.sourceContext}`;
	}
}

// Pretty print type errors with indicators under the offending code
export class UserCodeTypeError extends UserCodeError {
	protected constructor(
		protected diagnostic: ts.Diagnostic,
		protected sources: Map<string, ts.SourceFile>,
		protected mapDiagnosticMessage: (diagnostic:  ts.Diagnostic) => string[],
	) {
		super();
	}

	public get message(): string {
		return `TypeError: TS${this.diagnostic.code} ${this.mapDiagnosticMessage(this.diagnostic).join('\n')}`;
	}

	public get stack(): string {
		const userFile = this.sources.get(USER_CODE_FILENAME)!;
		const diagnosticNode = UserCodeError.getDescendentAtLocation(userFile, this.diagnostic.start!, this.diagnostic.start! + this.diagnostic.length!);
		if (diagnosticNode === null) {
			throw new Error(`Could not find node for diagnostic ${this.diagnostic.messageText}`);
		}
		const functionDeclaration = ts.findAncestor(diagnosticNode, node => {
			return node.kind === ts.SyntaxKind.FunctionDeclaration;
		}) as ts.FunctionDeclaration | undefined;

    return `at ${functionDeclaration?.name?.text ?? ''}(${this.location.line}:${this.location.column})`;
  }

	// Source code with surrounding lines to provide context to the error
	public get sourceContext(): string {
		const start = this.diagnostic.start!;
		const end = this.diagnostic.start! + this.diagnostic.length!;
		return UserCodeTypeError.underlineRanges(this.sources.get(USER_CODE_FILENAME)!, [[start, end]]);
	}

	public get location(): { line: number; column: number } {
		if (this.diagnostic.start === undefined) {
			throw new Error('Could not find start position');
		}
		const location = this.sources.get(USER_CODE_FILENAME)!.getLineAndCharacterOfPosition(this.diagnostic.start);
		return {
			line: location.line + 1,
			column: location.character + 1,
		};
	}

	public static new(
		diagnostic: ts.Diagnostic,
		sources: Map<string, ts.SourceFile>,
		mapDiagnosticMessage: (diagnostic:  ts.Diagnostic) => string[],
	): UserCodeError {
		if (removeExt(diagnostic.file?.fileName ?? '') === EXECUTION_HARNESS_FILENAME) {
			return new ExecutionHarnessTypeError(diagnostic, sources, mapDiagnosticMessage);
		}
		return new UserCodeTypeError(diagnostic, sources, mapDiagnosticMessage);
	}
}

// Pretty print runtime errors with lines numbers
export class UserCodeRuntimeError extends UserCodeError {
	private readonly error: Error;
	private readonly sourceMap: SourceMapConsumer;
	private readonly tsFileCache: Map<string, ts.SourceFile>;

	protected constructor(error: Error, sourceMap: SourceMapConsumer, tsFileCache: Map<string, ts.SourceFile>) {
		super();
		this.error = error;
		this.sourceMap = sourceMap;
		this.tsFileCache = tsFileCache;
	}

	public get message(): string {
		return 'Error: ' + this.error.message;
	}

	public get stack(): string {
		const stack = parse(this.error);
		const stackWithoutHarness = stack
			.filter(callSite => callSite.getFileName()?.endsWith(USER_CODE_FILENAME))
			.filter(callSite => {
				if (callSite.getFileName() === undefined) {
					return false;
				}
				const mappedLocation = this.sourceMap.originalPositionFor({
					line: callSite.getLineNumber()!,
					column: callSite.getColumnNumber()!,
				});
				return mappedLocation.line !== null;
			});
		return stackWithoutHarness
			.map(callSite => {
				const mappedLocation = this.sourceMap.originalPositionFor({
					line: callSite.getLineNumber()!,
					column: callSite.getColumnNumber()!,
				});
				const functionName = callSite.getFunctionName();
				const lineNumber = mappedLocation.line;
				const columnNumber = mappedLocation.column;
				return 'at ' + functionName + '(' + lineNumber + ':' + columnNumber + ')';
			})
			.join('\n');
	}

	// Source code with surrounding lines to provide context to the error
	public get sourceContext(): string {
		return UserCodeRuntimeError.displayLineWithContext(
			this.tsFileCache.get(USER_CODE_FILENAME)!.text,
			this.location.line,
		);
	}

	public get location(): { line: number; column: number } {
		const stack = parse(this.error);
		const originalPosition = this.sourceMap.originalPositionFor({
			line: stack[0].getLineNumber()!,
			column: stack[0].getColumnNumber()!,
		});
		return {
			line: originalPosition.line!,
			column: originalPosition.column!,
		};
	}

	public static new(
		error: Error,
		sourceMap: SourceMapConsumer,
		tsFileCache: Map<string, ts.SourceFile>,
	): UserCodeRuntimeError {
		return new UserCodeRuntimeError(error, sourceMap, tsFileCache);
	}
}

// Redirect the execution harness errors to the user code type signature
export class ExecutionHarnessTypeError extends UserCodeTypeError {
	constructor(
		protected diagnostic: ts.Diagnostic,
		protected sources: Map<string, ts.SourceFile>,
		protected mapDiagnosticMessage: (diagnostic:  ts.Diagnostic) => string[],
	) {
		super(diagnostic, sources, mapDiagnosticMessage);
		const diagnosticNode = UserCodeError.getDescendentAtLocation(
			sources.get(EXECUTION_HARNESS_FILENAME)!,
			this.diagnostic.start!,
			this.diagnostic.start! + this.diagnostic.length!,
		);

		if (diagnosticNode === null) {
			throw new Error('Unable to locate diagnostic node: ' + this.diagnostic.messageText);
		}

		// Handle various cases for mapping errors to the user code
		// "Module '{0}' has no default export."
		if (this.diagnostic.code === 1192){
			this.diagnostic.file = this.sources.get(USER_CODE_FILENAME)!;
			this.diagnostic.start = undefined;
			this.diagnostic.length = undefined;
			this.diagnostic.messageText = `No default export. Expected a default export with the signature: "(...args: ${this.argumentTypeNode.getText()}) => ${this.outputTypeNode.getText()}".`;
		}
		// "File '{0}' is not a module."
		else if (this.diagnostic.code === 2306){
			this.diagnostic.file = this.sources.get(USER_CODE_FILENAME)!;
			this.diagnostic.start = undefined;
			this.diagnostic.length = undefined;
			this.diagnostic.messageText = `No exports. Expected a default export with the signature: "(...args: ${this.argumentTypeNode.getText()}) => ${this.outputTypeNode.getText()}".`;
		}
		// "This expression is not callable."
		else if (this.diagnostic.code === 2349 && diagnosticNode === this.executionHarnessDefaultFunctionIdentifierNode){
			this.diagnostic.file = this.sources.get(USER_CODE_FILENAME)!;
			this.diagnostic.start = this.defaultExportNode!.getStart();
			this.diagnostic.length = this.defaultExportNode!.getEnd() - this.defaultExportNode!.getStart();
			this.diagnostic.messageText = `Default export is not callable. Expected a default export with the signature: "(...args: ${this.argumentTypeNode.getText()}) => ${this.outputTypeNode.getText()}".`;
		}
		// Errors in the return type of the user code default export
		else if (
			diagnosticNode === this.executionHarnessResultNode
		) {
			this.diagnostic.file = this.sources.get(USER_CODE_FILENAME)!;
			const typeNode = this.defaultExportedFunctionNode!.type!;
			this.diagnostic.start = typeNode.getStart();
			this.diagnostic.length = typeNode.getEnd() - typeNode.getStart();
			this.diagnostic.messageText = `Incorrect return type. Expected: '${this.outputTypeNode.getText()}', Actual: '${this.defaultExportedFunctionNode!.type!.getText()}'.`;
		}
		// Errors in the calling of user code default export
		else if (
			diagnosticNode === this.executionHarnessDefaultFunctionCallNode
			||diagnosticNode === this.executionHarnessDefaultFunctionIdentifierNode
			||diagnosticNode === this.executionHarnessArgumentsNode
		) {
			this.diagnostic.file = this.sources.get(USER_CODE_FILENAME)!;
			const parameters = this.defaultExportedFunctionNode!.parameters;
			this.diagnostic.start = Math.min(...parameters.map(p => p.getStart()));
			this.diagnostic.length = Math.max(...parameters.map(p => p.getEnd())) - this.diagnostic.start;
			this.diagnostic.messageText = `Incorrect argument type. Expected: '${this.argumentTypeNode.getText()}', Actual: '[${parameters
				.map(s => s.type?.getText())
				.join(', ')}]'.`;
		}
		// We haven't yet handled this case - this is an error in our code that needs to be addressed
		else {
			throw new Error(`Unmapped execution harness error: ${this.diagnostic.file?.fileName} TS${this.diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
		}
	}

	public get stack(): string {
		return (
			'at ' +
			(this.defaultExportedFunctionNode?.name?.getText() ?? '') +
			'(' +
			this.location.line +
			':' +
			this.location.column +
			')'
		);
	}

	// Source code with surrounding lines to provide context to the error
	public get sourceContext(): string {
		const userFile = this.sources.get(USER_CODE_FILENAME)!;
		const diagnosticNode = UserCodeError.getDescendentAtLocation(
			this.sources.get(EXECUTION_HARNESS_FILENAME)!,
			this.diagnostic.start!,
			this.diagnostic.start! + this.diagnostic.length!,
		);

		if (this.diagnostic.code === 1192){
			return UserCodeTypeError.displayLinesWithLineNumbers(userFile.text, userFile.getStart(), userFile.getEnd());
		} else if (this.diagnostic.code === 2306){
			return UserCodeTypeError.displayLinesWithLineNumbers(userFile.text, userFile.getStart(), userFile.getEnd());
		} else if (this.diagnostic.code === 2349) {
			return UserCodeTypeError.underlineRanges(userFile, [[this.diagnostic.start!, this.diagnostic.start! + this.diagnostic.length!]]);
		} else if (
			diagnosticNode === this.executionHarnessResultNode
		) {
			return UserCodeTypeError.underlineNodes(userFile, [this.defaultExportedFunctionNode!.type!]);
		} else if (
			diagnosticNode === this.executionHarnessDefaultFunctionCallNode
			||diagnosticNode === this.executionHarnessDefaultFunctionIdentifierNode
			||diagnosticNode === this.executionHarnessArgumentsNode
		) {
			return UserCodeTypeError.underlineNodes(userFile, [...this.defaultExportedFunctionNode!.parameters]);
		}

		return super.sourceContext;
	}

	public get location(): { line: number; column: number } {
		const userFile = this.sources.get(USER_CODE_FILENAME)!;
		if (this.diagnostic.start === undefined) {
			return {
				line: 1,
				column: 1,
			};
		}
		const location = userFile.getLineAndCharacterOfPosition(this.diagnostic.start);
		return {
			line: location.line + 1,
			column: location.character + 1,
		};
	}

	protected get defaultExportNode(): ts.ExportAssignment | undefined {
		const userFile = this.sources.get(USER_CODE_FILENAME)!;
		const exportAssignments =  userFile.statements.filter(
			s =>
				s.kind === ts.SyntaxKind.ExportAssignment
		) as ts.ExportAssignment[];
		return exportAssignments.reverse().find(e => UserCodeError.getDescendentNodeOfType(e, ts.SyntaxKind.DefaultKeyword) !== null);
	}

	protected get defaultExportedFunctionNode(): ts.FunctionDeclaration | undefined {
		const userFile = this.sources.get(USER_CODE_FILENAME)!;
		return userFile.statements.find(
			s =>
				s.kind === ts.SyntaxKind.FunctionDeclaration &&
				s.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) &&
				s.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword),
		)! as ts.FunctionDeclaration;
	}

	protected get executionHarnessResultNode(): ts.Identifier {
		const executionHarness = this.sources.get(EXECUTION_HARNESS_FILENAME)!;
		const expressionStatement = executionHarness.statements.find(
			s =>
				s.kind === ts.SyntaxKind.ExpressionStatement
		)! as ts.ExpressionStatement;
		const binaryExpression = expressionStatement.expression as ts.BinaryExpression;
		return binaryExpression.left as ts.Identifier;
	}

	protected get executionHarnessDefaultFunctionCallNode(): ts.CallExpression {
		const executionHarness = this.sources.get(EXECUTION_HARNESS_FILENAME)!;
		const expressionStatement = executionHarness.statements.find(
			s =>
				s.kind === ts.SyntaxKind.ExpressionStatement
		)! as ts.ExpressionStatement;
		const binaryExpression = expressionStatement.expression as ts.BinaryExpression;
		return binaryExpression.right as ts.CallExpression;
	}

	protected get executionHarnessArgumentsNode(): ts.SyntaxList {
		const callExpression = this.executionHarnessDefaultFunctionCallNode
		return callExpression.getChildren().find(
			c =>
				c.kind === ts.SyntaxKind.SyntaxList,
		)! as ts.SyntaxList;
	}

	protected get executionHarnessDefaultFunctionIdentifierNode(): ts.Identifier {
		const callExpression = this.executionHarnessDefaultFunctionCallNode
		return callExpression.expression as ts.Identifier;
	}

	protected get argumentTypeNode(): ts.TypeNode {
		const executionHarness = this.sources.get(EXECUTION_HARNESS_FILENAME)!;
		const moduleDeclaration = executionHarness.statements.find(
			s =>
				s.kind === ts.SyntaxKind.ModuleDeclaration,
		)! as ts.ModuleDeclaration;
		const moduleBlock = moduleDeclaration.body! as ts.ModuleBlock;
		const variableDeclaration = UserCodeError.getDescendentNodeOfType(
			moduleBlock.statements[0],
			ts.SyntaxKind.VariableDeclaration,
		)! as ts.VariableDeclaration;
		return variableDeclaration.type!;
	}

	protected get outputTypeNode(): ts.TypeNode {
		const executionHarness = this.sources.get(EXECUTION_HARNESS_FILENAME)!;
		const moduleDeclaration = executionHarness.statements.find(
			s =>
				s.kind === ts.SyntaxKind.ModuleDeclaration,
		)! as ts.ModuleDeclaration;
		const moduleBlock = moduleDeclaration.body! as ts.ModuleBlock;
		const variableDeclaration = UserCodeError.getDescendentNodeOfType(
			moduleBlock.statements[1],
			ts.SyntaxKind.VariableDeclaration,
		)! as ts.VariableDeclaration;
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

	let returnString = ts.SyntaxKind[node.kind].indent(level) + ': ' + node.getText().split('\n')[0] + '\n';
	for (const child of node.getChildren()) {
		returnString += printTree(child, level + 1);
	}
	return returnString;
}

function getDiagnosticCodes(diagnostic: ts.Diagnostic): integer[] {
	const codes: integer[] = [];
	codes.push(diagnostic.code);
	if (typeof diagnostic.messageText !== 'string') {
		codes.push(...getDiagnosticMessageChainCodes(diagnostic.messageText));
	}
	return codes;
}

function getDiagnosticMessageChainCodes(diagnosticMessageChain: ts.DiagnosticMessageChain): integer[] {
	const codes: integer[] = [];
	codes.push(diagnosticMessageChain.code);
	if (diagnosticMessageChain.next) {
		for (const nextDiagnosticMessageChain of diagnosticMessageChain.next) {
			codes.push(...getDiagnosticMessageChainCodes(nextDiagnosticMessageChain));
		}
	}
	return codes;
}

function removeExt(pathname: string): string {
	return path.basename(pathname).replace(path.extname(pathname), '');
}

// Fill in the missing module vm types
// These were created from the node documentation
// https://nodejs.org/api/vm.html#class-vmmodule
declare module 'vm' {
	export class Module {
		dependencySpecifiers: string[];
		error: any;
		identifier: string;
		namespace: unknown; // GetModuleNamespace;
		status: 'unlinked' | 'linking' | 'linked' | 'evaluating' | 'evaluated' | 'errored';

		evaluate(options?: { timeout?: number; breakOnSigInt?: boolean }): Promise<undefined>;

		link(
			linker: (
				specifier: string,
				extra: { assert?: { [key: string]: any } },
				referencingModule: vm.Module,
			) => vm.Module | Promise<vm.Module>,
		): void;
	}

	export class SourceTextModule extends Module {
		public constructor(
			code: string,
			options?: {
				identifier?: string;
				cachedData?: Buffer | NodeJS.TypedArray | DataView;
				context?: vm.Context;
				lineOffset?: number;
				columnOffset?: number;
				initializeImportMeta?: {
					meta?: any;
					module?: vm.SourceTextModule;
				};
				importModuleDynamically?: (specifier: string, importMeta: any) => Promise<vm.Module>;
			},
		);

		createCachedData(): Buffer;
	}
}