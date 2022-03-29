/** START Preface */
export class Command<A extends ArgType[] | {[argName: string]: any} = [] | {}> {
	public readonly stem: string;
	public readonly arguments: A;

	private constructor(opts: {
		stem: string
		arguments: A,
	}) {
		this.stem = opts.stem;
		this.arguments = opts.arguments
	}

	public static new<A extends any[] | {[argName: string]: any}>(opts: {
		stem: string
		arguments: A,
	}): Command<A> {
		return new Command({
			stem: opts.stem,
			arguments: opts.arguments,
		});
	}

	public toSeqJson() {
		return {
			id: 'command',
			metadata: {},
			steps: [
				{
					stem: this.stem,
					time: {type: 'COMPLETE'},
					type: 'command',
					metadata: {},
					args: typeof this.arguments == 'object' ? Object.values(this.arguments) : this.arguments,
				}
			]
		}
	}
}

declare global {
	export class Command<A extends ArgType[] | {[argName: string]: any} = [] | {}> {
		public readonly stem: string;
		public readonly arguments: A;

		private constructor(opts: {
			stem: string
			arguments: A,
		})

		public static new<A extends any[] | {[argName: string]: any}>(opts: {
			stem: string
			arguments: A,
		}): Command<A>;

		public toSeqJson(): any
	}
	type Context = {}
	type ArgType = boolean | string | number;
	type Arrayable<T> = T | Arrayable<T>[];
	type ExpansionReturn = Arrayable<Command>;

	type U<BitLength extends 8 | 16 | 32 | 64> = number;
	type U8 = U<8>;
	type U16 = U<16>;
	type U32 = U<32>;
	type U64 = U<64>;
	type I<BitLength extends 8 | 16 | 32 | 64> = number;
	type I8 = I<8>;
	type I16 = I<16>;
	type I32 = I<32>;
	type I64 = I<64>;
	type VarString<PrefixBitLength extends number, MaxBitLength extends number> = string;
	type F<BitLength extends 32 | 64> = number;
	type F32 = F<32>;
	type F64 = F<64>;
}
/** END Preface */

declare global {


	/**This command will turn on the oven*/
	function PREHEAT_OVEN(
		temperature: U8,
	): PREHEAT_OVEN;

	/**This command will turn on the oven*/
	function PREHEAT_OVEN(args: {
		temperature: U8,
	}): PREHEAT_OVEN;
	interface PREHEAT_OVEN extends Command<[
		U8,
	] | {
		temperature: U8,
	}> {}


	/**This command make the banana bread dough*/
	function PREPARE_LOAF(
		tb_sugar: U8,
		gluten_free: boolean,
	): PREPARE_LOAF;

	/**This command make the banana bread dough*/
	function PREPARE_LOAF(args: {
		tb_sugar: U8,
		gluten_free: boolean,
	}): PREPARE_LOAF;
	interface PREPARE_LOAF extends Command<[
		U8,
		boolean,
	] | {
		tb_sugar: U8,
		gluten_free: boolean,
	}> {}


	/**This command bakes a bananan bread*/
	const BAKE_BREAD: BAKE_BREAD;
	interface BAKE_BREAD extends Command<[]> {}

	const Commands: {
		PREHEAT_OVEN: PREHEAT_OVEN,
		PREPARE_LOAF: PREPARE_LOAF,
		BAKE_BREAD: BAKE_BREAD,
	};
}


/**This command will turn on the oven*/
export function PREHEAT_OVEN(...args: [
	U8,
] | [{
	temperature: U8,
}]): PREHEAT_OVEN {
	return Command.new({
		stem: 'PREHEAT_OVEN',
		arguments: typeof args[0] === 'object' ? args[0] : args,
	}) as PREHEAT_OVEN;
}


/**This command make the banana bread dough*/
export function PREPARE_LOAF(...args: [
	U8,
	boolean,
] | [{
	tb_sugar: U8,
	gluten_free: boolean,
}]): PREPARE_LOAF {
	return Command.new({
		stem: 'PREPARE_LOAF',
		arguments: typeof args[0] === 'object' ? args[0] : args,
	}) as PREPARE_LOAF;
}


/**This command bakes a bananan bread*/
export const BAKE_BREAD: BAKE_BREAD = Command.new({
	stem: 'BAKE_BREAD',
	arguments: [],
})
export const Commands = {		PREHEAT_OVEN: PREHEAT_OVEN,
	PREPARE_LOAF: PREPARE_LOAF,
	BAKE_BREAD: BAKE_BREAD,
};
const globalThis = (0,eval)("this");
Object.assign(globalThis, Commands);
