import ivm from 'isolated-vm';
import path from 'path';
import { defaultErrorCodeMessageMappers } from './defaultErrorCodeMessageMappers.js';
import { createMapDiagnosticMessage } from './utils/errorMessageMapping.js';
import ts from 'typescript';
import { parse, StackFrame } from 'stack-trace';
import { SourceMapConsumer } from 'source-map';
import { Result } from './utils/monads.js';
import { TypeGuard } from './utils/typeGuardCombinators';

type integer = number;

export { defaultErrorCodeMessageMappers } from './defaultErrorCodeMessageMappers.js';

const EXECUTION_HARNESS_FILENAME = '__execution_harness';
const USER_CODE_FILENAME = '__user_file';

export type UserCodeGlobals = Record<string, unknown>;

export interface CacheItem {
	jsFileMap: { [key: string]: string };
	userCodeSourceMap: string;
}

// instance options provided by the user when constructing the UserCodeRunner
export interface UserCodeRunnerOptions {
	typeErrorCodeMessageMappers?: { [errorCode: number]: (message: string) => string | undefined }; // The error code to message mappers
}

// optional execution-specific options that can be provided when code is executed
export interface ResultSerializerOptions {
	/**
	 * Name of an additional source module whose default export converts the
	 * user's raw result into transferable data that can safely leave the isolate.
	 */
	moduleName: string;

	/**
	 * TypeScript type returned by the serializer.
	 */
	outputType?: string;
}
export interface UserCodeExecutionOptions {
	/**
	 * Plain data copied into the guest isolate.
	 */
	globals?: UserCodeGlobals;

	/**
	 * Maximum guest-isolate heap size in MB.
	 */
	memoryLimitMb?: number;

	/**
	 * Trusted guest-side serializer included in additionalSourceFiles.
	 */
	resultSerializer?: ResultSerializerOptions;
}

export interface ArtifactExecutionOptions {
	globals?: UserCodeGlobals;
	memoryLimitMb?: number;
}

export class UserCodeRunner {
	private readonly mapDiagnosticMessage: ReturnType<typeof createMapDiagnosticMessage>;

	constructor(options?: UserCodeRunnerOptions) {
		this.mapDiagnosticMessage = createMapDiagnosticMessage(
			options?.typeErrorCodeMessageMappers ?? defaultErrorCodeMessageMappers,
		);
	}

	/**
	 * Pre-process user code into executable Javascript artifacts by:
	 * - generating a top level Typescript harness which imports the main user code and additional source files
	 * - type-checking and transpiling the module graph
	 * - producing source files and source maps for runtime error mapping
	 * The harness invokes the user module and optionally serializes its result inside the guest environment.
	 *
	 * @param userCode TypeScript source containing the user module's default export.
	 * @param outputType Expected TypeScript return type of the user function.
	 * @param argsTypes TypeScript types corresponding to the user function arguments.
	 * @param additionalSourceFiles Additional virtual TypeScript modules available to the harness and user code.
	 * @param options Optional preprocessing behavior, including guest-side result serialization.
	 * @returns The transpiled module map and user-code source map, or preprocessing errors.
	 */
	public async preProcess(
		userCode: string,
		outputType: string = 'any',
		argsTypes: string[] = ['any'],
		additionalSourceFiles: ts.SourceFile[] = [],
		options: Pick<UserCodeExecutionOptions, 'resultSerializer'> = {},
	): Promise<Result<CacheItem, UserCodeError[]>> {
		const userSourceFile = ts.createSourceFile(
			USER_CODE_FILENAME,
			userCode,
			ts.ScriptTarget.ESNext,
			undefined,
			ts.ScriptKind.TS,
		);

		// optional result serializer passed by the user
		// if passed, will be run on all results of user code before returning to transform them to safe values
		const serializer = options.resultSerializer;
		const serializerModuleName = serializer === undefined ? undefined : removeExt(serializer.moduleName);
		if (
			serializerModuleName !== undefined &&
			!additionalSourceFiles.some(file => removeExt(file.fileName) === serializerModuleName)
		) {
			throw new Error(`Result serializer module not found: ${serializerModuleName}`);
		}

		const serializerImport =
			serializerModuleName === undefined
				? ''
				: `import __serializeResult from ${JSON.stringify(serializerModuleName)};`;

		const finalOutputType = serializer?.outputType ?? outputType;

		const executionCode = `
			${additionalSourceFiles
				.map(file => {
					if (file.fileName.endsWith('.d.ts')) return '';
					return `import ${JSON.stringify(removeExt(file.fileName))};`;
				})
				.join('\n')}
		
			${serializerImport}
		
			import defaultExport from ${JSON.stringify(USER_CODE_FILENAME)};
			
			declare global {
				const __args: [${argsTypes.join(', ')}];
				let __result: ${outputType} | Promise<${outputType}>;
			}
			let __finalResult: ${finalOutputType};
			
			__result = defaultExport(...__args);
			if ((__result as any) instanceof Promise) {
				__result = await __result;
			}
			const __resolvedResult: ${outputType} = await __result;
			
			__finalResult = ${serializer === undefined ? '__resolvedResult' : 'await __serializeResult(__resolvedResult)'};
			(globalThis as any).__finalResult = __finalResult;
		`;

		const executionSourceFile = ts.createSourceFile(
			EXECUTION_HARNESS_FILENAME,
			executionCode,
			ts.ScriptTarget.ESNext,
			undefined,
			ts.ScriptKind.TS,
		);

		// Precompiled JavaScript bundles are runtime-only guest modules.
		// They must bypass TypeScript compilation to avoid re-emission conflicts.
		const runtimeJavascriptFiles = additionalSourceFiles.filter(file => /\.(?:c|m)?js$/.test(file.fileName));

		// TypeScript and declaration files remain in the virtual compiler program for
		// type checking, transpilation, diagnostics, and source-map generation.
		const typescriptSourceFiles = additionalSourceFiles.filter(file => !/\.(?:c|m)?js$/.test(file.fileName));

		const tsFileMap = new Map<string, ts.SourceFile>([
			[USER_CODE_FILENAME, userSourceFile],
			[EXECUTION_HARNESS_FILENAME, executionSourceFile],
		]);
		for (const typescriptSourceFile of typescriptSourceFiles) {
			tsFileMap.set(removeExt(typescriptSourceFile.fileName), typescriptSourceFile);
		}

		// Seed the runtime module map with precompiled JS guest bundles unchanged.
		const jsFileMap: Record<string, string> = {};
		for (const file of runtimeJavascriptFiles) {
			const moduleName = removeExt(file.fileName);
			if (jsFileMap[moduleName] !== undefined) {
				throw new Error(`Duplicate runtime module: ${moduleName}`);
			}
			jsFileMap[moduleName] = file.text;
		}

		let userCodeSourceMap: string;

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
					if (removeExt(filenameSansExt) === USER_CODE_FILENAME) {
						userCodeSourceMap = ts.createSourceFile(removeExt(filenameSansExt), data, ts.ScriptTarget.ESNext).text;
					}
					return;
				}
				// Prevent emitted TypeScript from silently replacing a supplied runtime bundle.
				if (jsFileMap[filenameSansExt] !== undefined) {
					throw new Error(`Duplicate emitted module: ${filenameSansExt}`);
				}
				// Add transpiled (now JS) modules to the same map as the untouched precompiled JS bundles.
				jsFileMap[filenameSansExt] = data;
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
			[...typescriptSourceFiles.map(f => f.fileName), EXECUTION_HARNESS_FILENAME],
			{
				target: ts.ScriptTarget.ESNext,
				module: ts.ModuleKind.ES2022,
				lib: ['lib.esnext.d.ts'],
				sourceMap: true,
				// allow TS files OR pre-bundled JS files
				allowJs: true,
				checkJs: true,
				// prevent pre-bundled JavaScript inputs from overwriting themselves
				// The custom compiler host captures these virtual output paths in memory.
				outDir: '__generated__',
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
					throw new Error(
						`Unhandled diagnostic: ${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
					);
				}
			}
		});

		const emitResult = program.emit();

		emitResult.diagnostics.forEach(diagnostic => {
			if (diagnostic.file) {
				sourceErrors.push(UserCodeTypeError.new(diagnostic, tsFileMap, typeChecker, this.mapDiagnosticMessage));
			} else {
				throw new Error(
					`Unhandled diagnostic: ${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
				);
			}
		});

		if (sourceErrors.length > 0) {
			return Result.Err(sourceErrors);
		}

		return Result.Ok({
			jsFileMap,
			userCodeSourceMap: userCodeSourceMap!,
		});
	}

	public async executeUserCode<ArgsType extends unknown[], OutputType>(
		userCode: string,
		args: ArgsType,
		outputType = 'any',
		argsTypes: string[] = ['any'],
		timeout = 5000,
		additionalSourceFiles: ts.SourceFile[] = [],
		options: UserCodeExecutionOptions = {},
	): Promise<Result<OutputType, UserCodeError[]>> {
		const result = await this.preProcess(userCode, outputType, argsTypes, additionalSourceFiles, {
			resultSerializer: options.resultSerializer,
		});

		if (result.isErr()) {
			return result;
		}

		const { jsFileMap, userCodeSourceMap } = result.unwrap();

		return this.executeUserCodeFromArtifacts<ArgsType, OutputType>(jsFileMap, userCodeSourceMap, args, timeout, {
			globals: options.globals,
			memoryLimitMb: options.memoryLimitMb,
		});
	}

	public async executeUserCodeFromArtifacts<ArgsType extends unknown[], OutputType>(
		jsFileMap: Record<string, string>,
		sourceMap: string,
		args: ArgsType,
		timeout = 5000,
		options: ArtifactExecutionOptions = {},
	): Promise<Result<OutputType, UserCodeError[]>> {
		const isolate = new ivm.Isolate({
			memoryLimit: options.memoryLimitMb ?? 1024,
		});

		try {
			const context = isolate.createContextSync();
			const global = context.global;

			// copy host values into the guest isolate so objects are guest-owned clones,
			// not live host objects whose prototypes or constructors could expose host capabilities.
			global.setSync('__args', args, { copy: true });
			global.setSync('__result', undefined);
			// global.setSync('__finalResult', undefined);

			for (const [name, value] of Object.entries(options.globals ?? {})) {
				if (name === '__args' || name === '__result' || name === '__finalResult') {
					throw new Error(`Reserved global name: ${name}`);
				}

				global.setSync(name, value, { copy: true });
			}

			// Create modules for VM
			const moduleCache = new Map<string, ivm.Module>();
			for (const [fileName, content] of Object.entries(jsFileMap)) {
				moduleCache.set(
					fileName,
					isolate.compileModuleSync(content, {
						filename: fileName,
					}),
				);
			}

			// the harness module imports and invokes the user module,
			// keeping execution and result capture inside the isolated context.
			const harnessModule = moduleCache.get(EXECUTION_HARNESS_FILENAME);
			if (harnessModule === undefined) {
				throw new Error('Execution harness module is missing');
			}

			// recursively resolve & link the harness module’s imports
			harnessModule.instantiateSync(context, specifier => {
				// module names currently use a flat namespace; directory paths and extensions are discarded.
				const module = moduleCache.get(removeExt(specifier));
				if (module === undefined) {
					throw new Error(`Unable to resolve dependency: ${specifier}`);
				}
				return module;
			});

			// evaluate the resolved module
			await harnessModule.evaluate({ timeout });
			// copy guest results out as host-owned data; don't expose live guest reference.
			const value = await global.get('__finalResult', { copy: true });

			return Result.Ok(value as OutputType);
		} catch (error) {
			// errors from outside user code are "fatal" and will be re-thrown by new() to bubble up
			const runtimeErr = UserCodeRuntimeError.new(error as Error, await new SourceMapConsumer(sourceMap));
			// errors originating in user code are returned to the caller in a Result.Err
			return Result.Err([runtimeErr]);
		} finally {
			isolate.dispose();
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
	public abstract get location(): { line: number; column: number };

	protected static getDescendentNodes<T extends ts.Node>(node: ts.Node, guard: TypeGuard<ts.Node, T>): T[] {
		const nodeList: T[] = [];
		if (guard(node)) {
			nodeList.push(node);
			return nodeList;
		}
		for (const child of node.getChildren()) {
			nodeList.push(...UserCodeError.getDescendentNodes(child, guard));
		}
		return nodeList;
	}

	protected static getDescendentAtLocation(node: ts.Node, start: number, end: number): ts.Node {
		if (node.getStart() === start && node.getEnd() === end) {
			return node;
		}
		for (const child1 of node.getChildren()) {
			if (child1.getStart() <= start && end <= child1.getEnd()) {
				return UserCodeError.getDescendentAtLocation(child1, start, end);
			}
		}
		return node;
	}

	public toJSON(): {
		message: string;
		stack: string;
		location: { line: number; column: number };
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
		protected mapDiagnosticMessage: (diagnostic: ts.Diagnostic) => string[],
	) {
		super();
	}

	public get message(): string {
		return `TypeError: TS${this.diagnostic.code} ${this.mapDiagnosticMessage(this.diagnostic).join('\n')}`;
	}

	public get stack(): string {
		const userFile = this.sources.get(USER_CODE_FILENAME)!;
		const diagnosticNode = UserCodeError.getDescendentAtLocation(
			userFile,
			this.diagnostic.start!,
			this.diagnostic.start! + this.diagnostic.length!,
		);
		if (diagnosticNode === null) {
			throw new Error(`Could not find node for diagnostic ${this.diagnostic.messageText}`);
		}
		const functionDeclaration = ts.findAncestor(diagnosticNode, ts.isFunctionLike) as
			| ts.FunctionDeclaration
			| undefined;

		return `at ${functionDeclaration?.name?.getText() ?? ''}(${this.location.line}:${this.location.column})`;
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
		typeChecker: ts.TypeChecker,
		mapDiagnosticMessage: (diagnostic: ts.Diagnostic) => string[],
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
	private readonly stackFrames: StackFrame[];

	protected constructor(error: Error, sourceMap: SourceMapConsumer, stackFrames: StackFrame[]) {
		super();
		this.error = error;
		this.sourceMap = sourceMap;
		this.stackFrames = stackFrames;
	}

	public get message(): string {
		return 'Error: ' + this.error.message;
	}

	public get stack(): string {
		const stackWithoutHarness = this.stackFrames
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

	public get location(): { line: number; column: number } {
		const stack = parse(this.error);
		const userFileStackFrame = stack.find(callSite => callSite.getFileName() === USER_CODE_FILENAME)!;
		const originalPosition = this.sourceMap.originalPositionFor({
			line: userFileStackFrame.getLineNumber()!,
			column: userFileStackFrame.getColumnNumber()!,
		});
		return {
			line: originalPosition.line!,
			column: originalPosition.column!,
		};
	}

	public static new(error: Error, sourceMap: SourceMapConsumer): UserCodeRuntimeError {
		const stackFrames = parse(error);
		const userCodeFrame = stackFrames.find(frame => frame.getFileName() === USER_CODE_FILENAME);

		if (userCodeFrame === undefined) {
			// errors from *outside* user code are thrown instead of wrapped in a Result.Err(UserCodeRuntimeError)
			error.message =
				'Runtime error detected outside of user code execution path. ' +
				'This is most likely a bug in the additional library source.\n' +
				'Inherited from:\n' +
				error.message;

			throw error;
		}

		return new UserCodeRuntimeError(error, sourceMap, stackFrames);
	}
}

// Redirect the execution harness errors to the user code type signature
export class ExecutionHarnessTypeError extends UserCodeTypeError {
	constructor(
		protected diagnostic: ts.Diagnostic,
		protected sources: Map<string, ts.SourceFile>,
		protected typeChecker: ts.TypeChecker,
		protected mapDiagnosticMessage: (diagnostic: ts.Diagnostic) => string[],
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
		if (diagnosticNode === this.executionHarnessResultNode || diagnosticNode === this.executionHarnessAsyncResultNode) {
			const returnType = callSignature.getReturnType();
			const defaultExportedFunctionNodeReturnTypeNode = this.defaultExportedFunctionReturnNode;
			// Function declares return type
			if (defaultExportedFunctionNodeReturnTypeNode !== undefined) {
				this.diagnostic.start = defaultExportedFunctionNodeReturnTypeNode.getStart();
				this.diagnostic.length =
					defaultExportedFunctionNodeReturnTypeNode.getEnd() - defaultExportedFunctionNodeReturnTypeNode.getStart();
			}
			// Function does not declare a return type, just return the whole signature
			else {
				this.diagnostic.start = defaultExportNode.getStart();
				this.diagnostic.length = defaultExportNode.getEnd() - this.diagnostic.start;
			}

			this.diagnostic.file = this.sources.get(USER_CODE_FILENAME)!;
			this.diagnostic.messageText = `Incorrect return type. Expected: '${this.outputTypeNode.getText()}', Actual: '${this.typeChecker.typeToString(
				returnType,
			)}'.`;
			return;
		}

		// Errors in the argument type of the user code default export
		if (
			diagnosticNode === this.executionHarnessDefaultFunctionCallNode ||
			diagnosticNode === this.executionHarnessDefaultFunctionIdentifierNode ||
			diagnosticNode === this.executionHarnessArgumentsNode
		) {
			const parameters = callSignature.getParameters();

			// No parameters on default exported function, just return the whole signature
			if (parameters.length === 0) {
				this.diagnostic.file = this.sources.get(USER_CODE_FILENAME);
				this.diagnostic.start = defaultExportNode.getStart();
				this.diagnostic.length = defaultExportNode.getEnd() - this.diagnostic.start;
				this.diagnostic.messageText = `Incorrect argument type. Expected: '${this.argumentTypeNode.getText()}', Actual: '[${parameters
					.map(p => this.typeChecker.typeToString(this.typeChecker.getTypeOfSymbolAtLocation(p, this.diagnostic.file!)))
					.join(', ')}]'.`;
				return;
			}

			this.diagnostic.file = this.sources.get(USER_CODE_FILENAME);
			this.diagnostic.start = Math.min(...parameters.map(p => p.valueDeclaration!.getStart()));
			this.diagnostic.length = Math.max(...parameters.map(p => p.valueDeclaration!.getEnd())) - this.diagnostic.start;
			this.diagnostic.messageText = `Incorrect argument type. Expected: '${this.argumentTypeNode.getText()}', Actual: '[${parameters
				.map(p => this.typeChecker.typeToString(this.typeChecker.getTypeOfSymbolAtLocation(p, this.diagnostic.file!)))
				.join(', ')}]'.`;
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

	protected get defaultExportSymbol(): ts.Symbol | undefined {
		const userFile = this.sources.get(USER_CODE_FILENAME)!;

		const userFileSymbol = this.typeChecker.getSymbolAtLocation(userFile);
		if (userFileSymbol === undefined) return undefined;
		const userFileExports = this.typeChecker.getExportsOfModule(userFileSymbol);
		return userFileExports.find(symbol => symbol.escapedName === 'default');
	}

	protected get defaultExportNode(): ts.Node | undefined {
		const defaultExportSymbol = this.defaultExportSymbol;
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
			unaliasedDefaultExportSymbol = this.typeChecker.getAliasedSymbol(defaultExportSymbol);
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
		return node;
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

	protected get executionHarnessAsyncResultNode(): ts.Identifier {
		const binaryExpression = this.executionHarnessAsyncExpressionStatementNode;
		return binaryExpression.left as ts.Identifier;
	}

	protected get executionHarnessDefaultFunctionCallNode(): ts.CallExpression {
		const binaryExpression = this.executionHarnessExpressionStatementNode;
		return binaryExpression.right as ts.CallExpression;
	}

	protected get executionHarnessExpressionStatementNode() {
		const executionHarness = this.sources.get(EXECUTION_HARNESS_FILENAME)!;
		const expressionStatement = executionHarness.statements.find(ts.isExpressionStatement)!;
		return expressionStatement.expression as ts.BinaryExpression;
	}

	protected get executionHarnessAsyncExpressionStatementNode() {
		const executionHarness = this.sources.get(EXECUTION_HARNESS_FILENAME)!;
		const ifStatement = executionHarness.statements.find(ts.isIfStatement)!;

		const thenStatement = ifStatement.thenStatement as ts.Block;

		const expressionStatement = thenStatement.statements.find(ts.isExpressionStatement)!;

		return expressionStatement.expression as ts.BinaryExpression;
	}

	protected get executionHarnessArgumentsNode(): ts.SyntaxList {
		const callExpression = this.executionHarnessDefaultFunctionCallNode;
		return callExpression.getChildren().find(c => c.kind === ts.SyntaxKind.SyntaxList)! as ts.SyntaxList;
	}

	protected get executionHarnessDefaultFunctionIdentifierNode(): ts.Identifier {
		const callExpression = this.executionHarnessDefaultFunctionCallNode;
		return callExpression.expression as ts.Identifier;
	}

	protected get globalModuleDeclarationBlock(): ts.ModuleBlock {
		const executionHarness = this.sources.get(EXECUTION_HARNESS_FILENAME)!;
		const moduleDeclaration = executionHarness.statements.find(ts.isModuleDeclaration)!;
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
