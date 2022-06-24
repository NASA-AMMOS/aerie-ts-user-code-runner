import { Result } from './utils/monads';
import { CompilationArtifacts, UserCodeError } from './UserCodeRunner';

export class SharedArrayBufferBackedAsyncMap implements Map<string, Result<CompilationArtifacts, UserCodeError[]>> {
	private sharedArrayBuffer: SharedArrayBuffer;

	constructor(sharedArrayBuffer: SharedArrayBuffer) {
		this.sharedArrayBuffer = sharedArrayBuffer;
	}

	public clear(): void {
		throw new Error('Method not implemented.');
	}

	public delete(key: string): boolean {
		throw new Error('Method not implemented.');
	}

	public forEach(callbackfn: (value: Result<CompilationArtifacts, UserCodeError[]>, key: string, map: Map<string, Result<CompilationArtifacts, UserCodeError[]>>) => void, thisArg?: any): void {
		throw new Error('Method not implemented.');
	}

	public get(key: string): Result<CompilationArtifacts, UserCodeError[]> | undefined {
		throw new Error('Method not implemented.');
	}

	public has(key: string): boolean {
		throw new Error('Method not implemented.');
	}

	public set(key: string, value: Result<CompilationArtifacts, UserCodeError[]>): this {
		const serializedValue = value.toJSON();
		return this;
	}

	public get size(): number {
		throw new Error('Method not implemented.');
	}

	public entries(): IterableIterator<[string, Result<CompilationArtifacts, UserCodeError[]>]> {
		throw new Error('Method not implemented.');
	}

	public keys(): IterableIterator<string> {
		throw new Error('Method not implemented.');
	}

	public values(): IterableIterator<Result<CompilationArtifacts, UserCodeError[]>> {
		throw new Error('Method not implemented.');
	}

	public [Symbol.iterator](): IterableIterator<[string, Result<CompilationArtifacts, UserCodeError[]>]> {
		throw new Error('Method not implemented.');
	}

	public get [Symbol.toStringTag](): string {
		throw new Error('Method not implemented.');
	}
}
