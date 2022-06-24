import vm from 'vm';
import crypto from 'crypto';
import path from 'path';
import { defaultErrorCodeMessageMappers } from './defaultErrorCodeMessageMappers.js';
import { createMapDiagnosticMessage } from './utils/errorMessageMapping.js';
import ts from 'typescript';
import { parse } from 'stack-trace';
import { BasicSourceMapConsumer, IndexedSourceMapConsumer, SourceMapConsumer } from 'source-map';
import { Result } from './utils/monads.js';
import { TypeGuard } from './utils/typeGuardCombinators';

type integer = number;

export {defaultErrorCodeMessageMappers} from './defaultErrorCodeMessageMappers.js';

const EXECUTION_HARNESS_FILENAME = '__execution_harness';
const USER_CODE_FILENAME = '__user_file';

export interface CompilationArtifacts {
	jsFileMap: Map<string, ts.SourceFile>;
	tsFileMap: Map<string, ts.SourceFile>;
	sourceMap: BasicSourceMapConsumer | IndexedSourceMapConsumer;
}

export interface UserCodeRunnerOptions {
	typeErrorCodeMessageMappers?: {[errorCode: integer]: (message: string) => string | undefined },// The error code to message mappers
	compilerOptions?: Partial<Pick<ts.CompilerOptions, 'target' | 'module' | 'lib'>>,
	cache?: Map<string, Result<CompilationArtifacts, UserCodeError[]>>,
}

export class UserCodeRunner {
	private readonly user_file_cache: Map<string, Result<CompilationArtifacts, UserCodeError[]>> | undefined;
	private readonly mapDiagnosticMessage: ReturnType<typeof createMapDiagnosticMessage>;

	constructor(options?: UserCodeRunnerOptions) {
		this.user_file_cache = options?.cache;
		this.mapDiagnosticMessage = createMapDiagnosticMessage(options?.typeErrorCodeMessageMappers ?? defaultErrorCodeMessageMappers);
	}

	public async preProcess(
		userCode: string,
		outputType: string = 'any',
		argsTypes: string[] = ['any'],
		additionalSourceFiles: ts.SourceFile[] = [],
	): Promise<Result<CompilationArtifacts, UserCodeError[]>> {
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
				const filenameSansExt = removeExt(file.fileName);
				return `import '${filenameSansExt}';`;
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

		const typeChecker = program.getTypeChecker();

		const sourceErrors: UserCodeError[] = [];
		ts.getPreEmitDiagnostics(program).forEach(diagnostic => {
			if (diagnostic.file) {
				sourceErrors.push(UserCodeTypeError.new(diagnostic, tsFileMap, typeChecker, this.mapDiagnosticMessage));
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
				sourceErrors.push(UserCodeTypeError.new(diagnostic, tsFileMap, typeChecker, this.mapDiagnosticMessage));
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

		const result = this.user_file_cache?.has(userCodeHash)
			? this.user_file_cache.get(userCodeHash)!
			: await this.preProcess(userCode, outputType, argsTypes, additionalSourceFiles)
				.then(result => {
					this.user_file_cache?.set(userCodeHash, result);
					return result;
				});

		if (result.isErr()) {
			return result;
		}
		const { jsFileMap, sourceMap } = result.unwrap();

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
			const filenameSansExt = removeExt(specifier);
			if (moduleCache.has(filenameSansExt)) {
				return moduleCache.get(filenameSansExt)!;
			}
			throw new Error(`Unable to resolve dependency: ${specifier}`);
		});

		try {
			await harnessModule.evaluate({
				timeout,
			});
			return Result.Ok(context.__result);
		} catch (error: any) {
			return Result.Err([UserCodeRuntimeError.new(error as Error, sourceMap)]);
		}
	}
}

// Base error type for the User Code Runner
export abstract class UserCodeError {
	// Simple Error Message
	public abstract get message(): string;

	// Stack of the Error
	public abstract get stack(): string;

	// Location in the source code where the error occurred
	public abstract get location(): { line: integer; column: integer };

	protected static getDescendentNodes<T extends ts.Node>(node: ts.Node, guard: TypeGuard<ts.Node, T>): T[] {
		const nodeList: T[] = [];
		if (guard(node)) {
			nodeList.push(node);
			return nodeList;
		}
		for (const child of node.getChildren()) {
			nodeList.push(...UserCodeError.getDescendentNodes(child, guard))
		}
		return nodeList;
	}

	protected static getDescendentAtLocation(node: ts.Node, start: integer, end: integer): ts.Node | null {
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
		location: { line: integer; column: integer };
	} {
		return {
			message: this.message,
			stack: this.stack,
			location: this.location,
		};
	}

	public toString(): string {
		return `${this.message}\n${this.stack}`;
	}
}

// Pretty print type errors with indicators under the offending code
export class UserCodeTypeError extends UserCodeError {
	protected constructor(
		protected diagnostic: ts.Diagnostic,
		protected sources: Map<string, ts.SourceFile>,
		protected typeChecker: ts.TypeChecker,
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
		const functionDeclaration = ts.findAncestor(diagnosticNode, ts.isFunctionLike) as ts.FunctionDeclaration | undefined;

    return `at ${functionDeclaration?.name?.getText() ?? ''}(${this.location.line}:${this.location.column})`;
  }

	public get location(): { line: integer; column: integer } {
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
		typeChecker: ts.TypeChecker,
		mapDiagnosticMessage: (diagnostic:  ts.Diagnostic) => string[],
	): UserCodeError {
		if (removeExt(diagnostic.file?.fileName ?? '') === EXECUTION_HARNESS_FILENAME) {
			return new ExecutionHarnessTypeError(diagnostic, sources, typeChecker, mapDiagnosticMessage);
		}
		return new UserCodeTypeError(diagnostic, sources, typeChecker, mapDiagnosticMessage);
	}
}

// Pretty print runtime errors with lines numbers
export class UserCodeRuntimeError extends UserCodeError {
	private readonly error: Error;
	private readonly sourceMap: SourceMapConsumer;

	protected constructor(error: Error, sourceMap: SourceMapConsumer) {
		super();
		this.error = error;
		this.sourceMap = sourceMap;
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

	public get location(): { line: integer; column: integer } {
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
	): UserCodeRuntimeError {
		return new UserCodeRuntimeError(error, sourceMap);
	}
}

// Redirect the execution harness errors to the user code type signature
export class ExecutionHarnessTypeError extends UserCodeTypeError {
	constructor(
		protected diagnostic: ts.Diagnostic,
		protected sources: Map<string, ts.SourceFile>,
		protected typeChecker: ts.TypeChecker,
		protected mapDiagnosticMessage: (diagnostic:  ts.Diagnostic) => string[],
	) {
		super(diagnostic, sources, typeChecker, mapDiagnosticMessage);

		const diagnosticNode = UserCodeError.getDescendentAtLocation(
			sources.get(EXECUTION_HARNESS_FILENAME)!,
			this.diagnostic.start!,
			this.diagnostic.start! + this.diagnostic.length!,
		);

		if (diagnosticNode === null) {
			throw new Error('Unable to locate diagnostic node: ' + this.diagnostic.messageText);
		}

		const defaultExportSymbol = this.defaultExportSymbol;
		const defaultExportNode = this.defaultExportNode;
		// No default export
		if (defaultExportSymbol == undefined || defaultExportNode === undefined) {
			this.diagnostic.file = this.sources.get(USER_CODE_FILENAME)!;
			this.diagnostic.start = this.diagnostic.file.getStart();
			this.diagnostic.length = this.diagnostic.file.getEnd() - this.diagnostic.start;
			this.diagnostic.messageText = `No default export. Expected a default export function with the signature: "(...args: ${this.argumentTypeNode.getText()}) => ${this.outputTypeNode.getText()}".`;
			return;
		}

		const callSignature = this.defaultExportNodeType?.getCallSignatures()?.[0];

		// Default export is not a function
		if (callSignature === undefined) {
			this.diagnostic.file = this.sources.get(USER_CODE_FILENAME)!;
			this.diagnostic.start = defaultExportNode.getStart();
			this.diagnostic.length = defaultExportNode.getEnd()! - defaultExportNode.getStart()!;
			this.diagnostic.messageText = `Default export is not a valid function. Expected a default export function with the signature: "(...args: ${this.argumentTypeNode.getText()}) => ${this.outputTypeNode.getText()}".`;
			return;
		}


		// Errors in the return type of the user code default export
		if (
			diagnosticNode === this.executionHarnessResultNode
		) {
			const returnType = callSignature.getReturnType();
			const defaultExportedFunctionNodeReturnTypeNode = this.defaultExportedFunctionReturnNode;
			// Function declares return type
			if (defaultExportedFunctionNodeReturnTypeNode !== undefined) {
				this.diagnostic.start = defaultExportedFunctionNodeReturnTypeNode.getStart();
				this.diagnostic.length = defaultExportedFunctionNodeReturnTypeNode.getEnd() - defaultExportedFunctionNodeReturnTypeNode.getStart();
			}
			// Function does not declare a return type, just return the whole signature
			else {
				this.diagnostic.start = defaultExportNode.getStart();
				this.diagnostic.length = defaultExportNode.getEnd() - this.diagnostic.start;
			}

			this.diagnostic.file = this.sources.get(USER_CODE_FILENAME)!;
			this.diagnostic.messageText = `Incorrect return type. Expected: '${this.outputTypeNode.getText()}', Actual: '${this.typeChecker.typeToString(returnType)}'.`;
			return;
		}

		// Errors in the argument type of the user code default export
		if (
			diagnosticNode === this.executionHarnessDefaultFunctionCallNode
			||diagnosticNode === this.executionHarnessDefaultFunctionIdentifierNode
			||diagnosticNode === this.executionHarnessArgumentsNode
		) {

			const parameters = callSignature.getParameters();


			// No parameters on default exported function, just return the whole signature
			if (parameters.length === 0) {
				this.diagnostic.file = this.sources.get(USER_CODE_FILENAME);
				this.diagnostic.start = defaultExportNode.getStart();
				this.diagnostic.length = defaultExportNode.getEnd() - this.diagnostic.start;
				this.diagnostic.messageText = `Incorrect argument type. Expected: '${this.argumentTypeNode.getText()}', Actual: '[${parameters.map(p => this.typeChecker.typeToString(this.typeChecker.getTypeOfSymbolAtLocation(p, this.diagnostic.file!))).join(', ')}]'.`;
				return;
			}

			this.diagnostic.file = this.sources.get(USER_CODE_FILENAME);
			this.diagnostic.start = Math.min(...parameters.map(p => p.valueDeclaration!.getStart()));
			this.diagnostic.length = Math.max(...parameters.map(p => p.valueDeclaration!.getEnd())) - this.diagnostic.start;
			this.diagnostic.messageText = `Incorrect argument type. Expected: '${this.argumentTypeNode.getText()}', Actual: '[${parameters.map(p => this.typeChecker.typeToString(this.typeChecker.getTypeOfSymbolAtLocation(p, this.diagnostic.file!))).join(', ')}]'.`;
			return;
		}

		throw new Error(`Unhandled diagnostic node: ${diagnosticNode.getText()}`);
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

	public override get location(): { line: integer; column: integer } {
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

	protected get defaultExportSymbol(): ts.Symbol | undefined {
		const userFile = this.sources.get(USER_CODE_FILENAME)!;

		const userFileSymbol = this.typeChecker.getSymbolAtLocation(userFile);
		if (userFileSymbol === undefined) return undefined;
		const userFileExports = this.typeChecker.getExportsOfModule(userFileSymbol);
		return userFileExports.find(symbol => symbol.escapedName === 'default');
	}

  protected get defaultExportNode(): ts.Node | undefined {
	  const defaultExportSymbol =  this.defaultExportSymbol;
		if (defaultExportSymbol === undefined) return undefined;
		const node = defaultExportSymbol.valueDeclaration ?? defaultExportSymbol.declarations?.[0];
		if (node === undefined) return undefined;
		return node;
	}

	protected get defaultExportedFunctionSymbol(): ts.Symbol | undefined {
		const defaultExportSymbol = this.defaultExportSymbol;
		if (defaultExportSymbol === undefined) return undefined;
		let unaliasedDefaultExportSymbol = defaultExportSymbol;
		try {
			unaliasedDefaultExportSymbol = this.typeChecker.getAliasedSymbol(defaultExportSymbol)
		} catch {}
		if ((unaliasedDefaultExportSymbol.flags & ts.SymbolFlags.Function) === 0) return undefined;
		return unaliasedDefaultExportSymbol;
	}

	protected get defaultExportNodeType(): ts.Type | undefined {
		const defaultExportNode = this.defaultExportNode;
		if (defaultExportNode === undefined) return undefined;
		if (ts.isExportAssignment(defaultExportNode)) {
			return this.typeChecker.getTypeAtLocation(defaultExportNode.expression);
		}
		return this.typeChecker.getTypeAtLocation(defaultExportNode);
	}

	protected get defaultExportedFunctionNode(): ts.SignatureDeclaration | undefined {
		const node = this.defaultExportedFunctionSymbol?.valueDeclaration;
		if (!ts.isFunctionLike(node)) return undefined;
		return node
	}

	protected get defaultExportedFunctionReturnNode(): ts.TypeNode | undefined {
		const defaultExportedFunctionNode = this.defaultExportedFunctionNode;
		if (defaultExportedFunctionNode === undefined) return undefined;
		return defaultExportedFunctionNode.type;
	}

	protected get executionHarnessResultNode(): ts.Identifier {
		const binaryExpression = this.executionHarnessExpressionStatementNode;
		return binaryExpression.left as ts.Identifier;
	}

	protected get executionHarnessDefaultFunctionCallNode(): ts.CallExpression {
		const binaryExpression = this.executionHarnessExpressionStatementNode;
		return binaryExpression.right as ts.CallExpression;
	}

	protected get executionHarnessExpressionStatementNode() {
		const executionHarness = this.sources.get(EXECUTION_HARNESS_FILENAME)!;
		const expressionStatement = executionHarness.statements.find(
			s =>
				s.kind === ts.SyntaxKind.ExpressionStatement,
		)! as ts.ExpressionStatement;
		return expressionStatement.expression as ts.BinaryExpression;
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

	protected get globalModuleDeclarationBlock(): ts.ModuleBlock {
		const executionHarness = this.sources.get(EXECUTION_HARNESS_FILENAME)!;
		const moduleDeclaration = executionHarness.statements.find(
			s =>
				s.kind === ts.SyntaxKind.ModuleDeclaration,
		)! as ts.ModuleDeclaration;
		return moduleDeclaration.body! as ts.ModuleBlock;
	}

	protected get argumentTypeNode(): ts.TypeNode {
		const moduleBlock = this.globalModuleDeclarationBlock;
		const variableDeclaration = UserCodeError.getDescendentNodes(
			moduleBlock.statements[0],
			ts.isVariableDeclarationList,
		)[0] as ts.VariableDeclarationList;
		return variableDeclaration.declarations[0].type!;
	}

	protected get outputTypeNode(): ts.TypeNode {
		const moduleBlock = this.globalModuleDeclarationBlock;
		const variableDeclaration = UserCodeError.getDescendentNodes(
			moduleBlock.statements[1],
			ts.isVariableDeclarationList,
		)[0] as ts.VariableDeclarationList;
		return variableDeclaration.declarations[0].type!;
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

	export class SourceTextModule extends vm.Module {
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
