/** START Preface */
export type DOY_STRING = string & { __brand: 'DOY_STRING' };
export type HMS_STRING = string & { __brand: 'HMS_STRING' };

export enum TimingTypes {
  ABSOLUTE = 'ABSOLUTE',
  COMMAND_RELATIVE = 'COMMAND_RELATIVE',
  EPOCH_RELATIVE = 'EPOCH_RELATIVE',
  COMMAND_COMPLETE = 'COMMAND_COMPLETE',
}

type SeqJsonTimeType =
  | {
      type: TimingTypes.ABSOLUTE;
      tag: DOY_STRING;
    }
  | {
      type: TimingTypes.COMMAND_RELATIVE;
      tag: HMS_STRING;
    }
  | {
      type: TimingTypes.EPOCH_RELATIVE;
      tag: HMS_STRING;
    }
  | {
      type: TimingTypes.COMMAND_COMPLETE;
    };

export type CommandOptions<
  A extends ArgType[] | { [argName: string]: any } = [] | {},
  M extends Record<string, any> = Record<string, any>,
> = { stem: string; arguments: A; metadata?: M } & (
  | {
      absoluteTime: Temporal.Instant;
    }
  | {
      epochTime: Temporal.Duration;
    }
  | {
      relativeTime: Temporal.Duration;
    }
  // CommandComplete
  | {}
);

export interface CommandSeqJson<A extends ArgType[] = ArgType[]> {
  args: A;
  stem: string;
  time: SeqJsonTimeType;
  type: 'command';
  metadata: Record<string, unknown>;
}

export type ArgType = boolean | string | number;
export type Arrayable<T> = T | Arrayable<T>[];

export interface SequenceSeqJson {
  id: string;
  metadata: Record<string, any>;
  steps: CommandSeqJson[];
}

declare global {
  class Command<
    A extends ArgType[] | { [argName: string]: any } = [] | {},
    M extends Record<string, any> = Record<string, any>,
  > {
    public static new<A extends any[] | { [argName: string]: any }>(opts: CommandOptions<A>): Command<A>;

    public toSeqJson(): CommandSeqJson;

    public absoluteTiming(absoluteTime: Temporal.Instant): Command<A>;

    public epochTiming(epochTime: Temporal.Duration): Command<A>;

    public relativeTiming(relativeTime: Temporal.Duration): Command<A>;
  }

  class Sequence {
    public readonly seqId: string;
    public readonly metadata: Record<string, any>;
    public readonly commands: Command[];

    public static new(opts: { seqId: string; metadata: Record<string, any>; commands: Command[] }): Sequence;

    public toSeqJson(): SequenceSeqJson;
  }

  type Context = {};
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

  // @ts-ignore : 'Commands' found in generated code
  function A(...args: [TemplateStringsArray, ...string[]]): typeof Commands;
  // @ts-ignore : 'Commands' found in generated code
  function A(absoluteTime: Temporal.Instant): typeof Commands;
  // @ts-ignore : 'Commands' found in generated code
  function A(timeDOYString: string): typeof Commands;

  // @ts-ignore : 'Commands' found in generated code
  function R(...args: [TemplateStringsArray, ...string[]]): typeof Commands;
  // @ts-ignore : 'Commands' found in generated code
  function R(duration: Temporal.Duration): typeof Commands;
  // @ts-ignore : 'Commands' found in generated code
  function R(timeHMSString: string): typeof Commands;

  // @ts-ignore : 'Commands' found in generated code
  function E(...args: [TemplateStringsArray, ...string[]]): typeof Commands;
  // @ts-ignore : 'Commands' found in generated code
  function E(duration: Temporal.Duration): typeof Commands;
  // @ts-ignore : 'Commands' found in generated code
  function E(timeHMSString: string): typeof Commands;

  // @ts-ignore : 'Commands' found in generated code
  const C: typeof Commands;
}

const DOY_REGEX = /(\d{4})-(\d{3})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?/;
const HMS_REGEX = /(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?/;

export class Command<
  A extends ArgType[] | { [argName: string]: any } = [] | {},
  M extends Record<string, any> = Record<string, any>,
> {
  public readonly stem: string;
  public readonly metadata: M;
  public readonly arguments: A;
  public readonly absoluteTime: Temporal.Instant | null = null;
  public readonly epochTime: Temporal.Duration | null = null;
  public readonly relativeTime: Temporal.Duration | null = null;

  private constructor(opts: CommandOptions<A, M>) {
    this.stem = opts.stem;
    this.arguments = opts.arguments;
    this.metadata = opts.metadata ?? ({} as M);
    if ('absoluteTime' in opts) {
      this.absoluteTime = opts.absoluteTime;
    } else if ('epochTime' in opts) {
      this.epochTime = opts.epochTime;
    } else if ('relativeTime' in opts) {
      this.relativeTime = opts.relativeTime;
    }
  }

  public static new<A extends any[] | { [argName: string]: any }>(opts: CommandOptions<A>): Command<A> {
    if ('absoluteTime' in opts) {
      return new Command<A>({
        ...opts,
        absoluteTime: opts.absoluteTime,
      });
    } else if ('epochTime' in opts) {
      return new Command<A>({
        ...opts,
        epochTime: opts.epochTime,
      });
    } else if ('relativeTime' in opts) {
      return new Command<A>({
        ...opts,
        relativeTime: opts.relativeTime,
      });
    } else {
      return new Command<A>(opts);
    }
  }

  public toSeqJson(): CommandSeqJson {
    return {
      args: typeof this.arguments == 'object' ? Object.values(this.arguments) : this.arguments,
      stem: this.stem,
      time:
        this.absoluteTime !== null
          ? { type: TimingTypes.ABSOLUTE, tag: Command.instantToDoy(this.absoluteTime) }
          : this.epochTime !== null
          ? { type: TimingTypes.EPOCH_RELATIVE, tag: Command.durationToHms(this.epochTime) }
          : this.relativeTime !== null
          ? { type: TimingTypes.COMMAND_RELATIVE, tag: Command.durationToHms(this.relativeTime) }
          : { type: TimingTypes.COMMAND_COMPLETE },
      type: 'command',
      metadata: this.metadata,
    };
  }

  public static fromSeqJson<A extends ArgType[]>(json: CommandSeqJson<A>): Command<A> {
    const timeValue =
      json.time.type === TimingTypes.ABSOLUTE
        ? { absoluteTime: doyToInstant(json.time.tag) }
        : json.time.type === TimingTypes.COMMAND_RELATIVE
        ? { relativeTime: hmsToDuration(json.time.tag) }
        : json.time.type === TimingTypes.EPOCH_RELATIVE
        ? { epochTime: hmsToDuration(json.time.tag) }
        : {};

    return Command.new<A>({
      stem: json.stem,
      arguments: json.args as A,
      metadata: json.metadata,
      ...timeValue,
    });
  }

  public absoluteTiming(absoluteTime: Temporal.Instant): Command<A> {
    return Command.new({
      stem: this.stem,
      arguments: this.arguments,
      absoluteTime: absoluteTime,
    });
  }

  public epochTiming(epochTime: Temporal.Duration): Command<A> {
    return Command.new({
      stem: this.stem,
      arguments: this.arguments,
      epochTime: epochTime,
    });
  }

  public relativeTiming(relativeTime: Temporal.Duration): Command<A> {
    return Command.new({
      stem: this.stem,
      arguments: this.arguments,
      relativeTime: relativeTime,
    });
  }

  /** YYYY-DOYTHH:MM:SS.sss */
  private static instantToDoy(time: Temporal.Instant): DOY_STRING {
    const utcZonedDate = time.toZonedDateTimeISO('UTC');
    const YYYY = this.formatNumber(utcZonedDate.year, 4);
    const DOY = this.formatNumber(utcZonedDate.dayOfYear, 3);
    const HH = this.formatNumber(utcZonedDate.hour, 2);
    const MM = this.formatNumber(utcZonedDate.minute, 2);
    const SS = this.formatNumber(utcZonedDate.second, 2);
    const sss = this.formatNumber(utcZonedDate.millisecond, 3);
    return `${YYYY}-${DOY}T${HH}:${MM}:${SS}.${sss}` as DOY_STRING;
  }

  /** HH:MM:SS.sss */
  private static durationToHms(time: Temporal.Duration): HMS_STRING {
    const HH = this.formatNumber(time.hours, 2);
    const MM = this.formatNumber(time.minutes, 2);
    const SS = this.formatNumber(time.seconds, 2);
    const sss = this.formatNumber(time.milliseconds, 3);

    return `${HH}:${MM}:${SS}.${sss}` as HMS_STRING;
  }

  private static formatNumber(number: number, size: number): string {
    return number.toString().padStart(size, '0');
  }
}

export interface SequenceOptions {
  seqId: string;
  metadata: Record<string, any>;
  commands: Command[];
}

export class Sequence {
  public readonly seqId: string;
  public readonly metadata: Record<string, any>;
  public readonly commands: Command[];

  private constructor(opts: SequenceOptions) {
    this.seqId = opts.seqId;
    this.metadata = opts.metadata;
    this.commands = opts.commands;
  }

  public static new(opts: SequenceOptions): Sequence {
    return new Sequence(opts);
  }

  public toSeqJson(): SequenceSeqJson {
    return {
      id: this.seqId,
      metadata: this.metadata,
      steps: this.commands.map(c => c.toSeqJson()),
    };
  }

  public static fromSeqJson(json: SequenceSeqJson): Sequence {
    return Sequence.new({
      seqId: json.id,
      metadata: json.metadata,
      commands: json.steps.map(c => Command.fromSeqJson(c)),
    });
  }
}

//helper functions

function doyToInstant(doy: DOY_STRING): Temporal.Instant {
  const match = doy.match(DOY_REGEX);
  if (match === null) {
    throw new Error(`Invalid DOY string: ${doy}`);
  }
  const [, year, doyStr, hour, minute, second, millisecond] = match as [
    unknown,
    string,
    string,
    string,
    string,
    string,
    string | undefined,
  ];

  //use to convert doy to month and day
  const doyDate = new Date(parseInt(year, 10), 0, parseInt(doyStr, 10));
  // convert to UTC Date
  const utcDoyDate = new Date(
    Date.UTC(
      doyDate.getUTCFullYear(),
      doyDate.getUTCMonth(),
      doyDate.getUTCDate(),
      doyDate.getUTCHours(),
      doyDate.getUTCMinutes(),
      doyDate.getUTCSeconds(),
      doyDate.getUTCMilliseconds(),
    ),
  );

  return Temporal.ZonedDateTime.from({
    year: parseInt(year, 10),
    month: utcDoyDate.getUTCMonth() + 1,
    day: utcDoyDate.getUTCDate(),
    hour: parseInt(hour, 10),
    minute: parseInt(minute, 10),
    second: parseInt(second, 10),
    millisecond: parseInt(millisecond ?? '0', 10),
    timeZone: 'UTC',
  }).toInstant();
}

function hmsToDuration(hms: HMS_STRING): Temporal.Duration {
  const match = hms.match(HMS_REGEX);
  if (match === null) {
    throw new Error(`Invalid HMS string: ${hms}`);
  }
  const [, hours, minutes, seconds, milliseconds] = match as [unknown, string, string, string, string | undefined];
  return Temporal.Duration.from({
    hours: parseInt(hours, 10),
    minutes: parseInt(minutes, 10),
    seconds: parseInt(seconds, 10),
    milliseconds: parseInt(milliseconds ?? '0', 10),
  });
}

// @ts-ignore : Used in generated code
function A(...args: [TemplateStringsArray, ...string[]] | [Temporal.Instant] | [string]): typeof Commands {
  let time: Temporal.Instant;
  if (Array.isArray(args[0])) {
    time = doyToInstant(String.raw(...(args as [TemplateStringsArray, ...string[]])) as DOY_STRING);
  } else if (typeof args[0] === 'string') {
    time = doyToInstant(args[0] as DOY_STRING);
  } else {
    time = args[0] as Temporal.Instant;
  }

  return commandsWithTimeValue(time, TimingTypes.ABSOLUTE);
}

// @ts-ignore : Used in generated code
function R(...args: [TemplateStringsArray, ...string[]] | [Temporal.Duration] | [string]): typeof Commands {
  let duration: Temporal.Duration;
  if (Array.isArray(args[0])) {
    duration = hmsToDuration(String.raw(...(args as [TemplateStringsArray, ...string[]])) as HMS_STRING);
  } else if (typeof args[0] === 'string') {
    duration = hmsToDuration(args[0] as HMS_STRING);
  } else {
    duration = args[0] as Temporal.Duration;
  }

  return commandsWithTimeValue(duration, TimingTypes.COMMAND_RELATIVE);
}

// @ts-ignore : Used in generated code
function E(...args: [TemplateStringsArray, ...string[]] | [Temporal.Duration] | [string]): typeof Commands {
  let duration: Temporal.Duration;
  if (Array.isArray(args[0])) {
    duration = hmsToDuration(String.raw(...(args as [TemplateStringsArray, ...string[]])) as HMS_STRING);
  } else if (typeof args[0] === 'string') {
    duration = hmsToDuration(args[0] as HMS_STRING);
  } else {
    duration = args[0] as Temporal.Duration;
  }
  return commandsWithTimeValue(duration, TimingTypes.EPOCH_RELATIVE);
}

function commandsWithTimeValue<T extends TimingTypes>(
  timeValue: Temporal.Instant | Temporal.Duration,
  timeType: T,
  // @ts-ignore : 'Commands' found in generated code
): typeof Commands {
  // @ts-ignore : 'Commands' found in generated code
  return Object.keys(Commands).reduce((accum, key) => {
    // @ts-ignore : 'Commands' found in generated code
    const command = Commands[key as keyof Commands];
    if (typeof command === 'function') {
      if (timeType === TimingTypes.ABSOLUTE) {
        accum[key] = (...args: Parameters<typeof command>): typeof command => {
          return command(...args).absoluteTiming(timeValue);
        };
      } else if (timeType === TimingTypes.COMMAND_RELATIVE) {
        accum[key] = (...args: Parameters<typeof command>): typeof command => {
          return command(...args).relativeTiming(timeValue);
        };
      } else {
        accum[key] = (...args: Parameters<typeof command>): typeof command => {
          return command(...args).epochTiming(timeValue);
        };
      }
    } else {
      if (timeType === TimingTypes.ABSOLUTE) {
        accum[key] = command.absoluteTiming(timeValue);
      } else if (timeType === TimingTypes.COMMAND_RELATIVE) {
        accum[key] = command.relativeTiming(timeValue);
      } else {
        accum[key] = command.epochTiming(timeValue);
      }
    }
    return accum;
    // @ts-ignore : 'Commands' found in generated code
  }, {} as typeof Commands);
}

// @ts-ignore
function orderCommandArguments(args: { [argName: string]: any }, order: string[]): any {
  return order.map(key => args[key]);
}

// @ts-ignore: Used in generated code
function findAndOrderCommandArguments(
  commandName: string,
  args: { [argName: string]: any },
  argumentOrders: string[][],
): any {
  for (const argumentOrder of argumentOrders) {
    if (argumentOrder.length === Object.keys(args).length) {
      let difference = argumentOrder
        .filter((value: string) => !Object.keys(args).includes(value))
        .concat(Object.keys(args).filter((value: string) => !argumentOrder.includes(value))).length;

      // found correct argument order to apply
      if (difference === 0) {
        return orderCommandArguments(args, argumentOrder);
      }
    }
  }
  throw new Error(`Could not find correct argument order for command: ${commandName}`);
}

/** END Preface */

declare global {


	/**This command will echo back a string*/
	function ECHO(
		echo_string: VarString<8, 1024>,
	): ECHO;

	/**This command will echo back a string*/
	function ECHO(args: {
		echo_string: VarString<8, 1024>,
	}): ECHO;
	interface ECHO extends Command<[
		VarString<8, 1024>,
	] | {
		echo_string: VarString<8, 1024>,
	}> {}


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


	/**This command will throw a banana*/
	function THROW_BANANA(
		distance: U8,
	): THROW_BANANA;

	/**This command will throw a banana*/
	function THROW_BANANA(args: {
		distance: U8,
	}): THROW_BANANA;
	interface THROW_BANANA extends Command<[
		U8,
	] | {
		distance: U8,
	}> {}


	/**This command will grow bananas*/
	function GROW_BANANA(
		quantity: U8,
		durationSecs: U8,
	): GROW_BANANA;

	/**This command will grow bananas*/
	function GROW_BANANA(args: {
		quantity: U8,
		durationSecs: U8,
	}): GROW_BANANA;
	interface GROW_BANANA extends Command<[
		U8,
		U8,
	] | {
		quantity: U8,
		durationSecs: U8,
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


	/**This command peels a single banana*/
	function PEEL_BANANA(
		peelDirection: ('fromStem' | 'fromTip'),
	): PEEL_BANANA;

	/**This command peels a single banana*/
	function PEEL_BANANA(args: {
		peelDirection: ('fromStem' | 'fromTip'),
	}): PEEL_BANANA;
	interface PEEL_BANANA extends Command<[
		('fromStem' | 'fromTip'),
	] | {
		peelDirection: ('fromStem' | 'fromTip'),
	}> {}


	/**This command bakes a banana bread*/
	const BAKE_BREAD: BAKE_BREAD;
	interface BAKE_BREAD extends Command<[]> {}



	/**This command waters the banana tree*/
	const ADD_WATER: ADD_WATER;
	interface ADD_WATER extends Command<[]> {}




	/**Dynamically bundle bananas into lots*/
	function PACKAGE_BANANA(
	lot_number: U16,

	): PACKAGE_BANANA;

	/**Dynamically bundle bananas into lots*/
	function PACKAGE_BANANA(args: {
	lot_number: U16,

	}): PACKAGE_BANANA;

	/**Dynamically bundle bananas into lots*/
	function PACKAGE_BANANA(
	bundle_name1: VarString<8, 1024>,
	number_of_bananas1: U8,
	lot_number: U16,

	): PACKAGE_BANANA;

	/**Dynamically bundle bananas into lots*/
	function PACKAGE_BANANA(args: {
	bundle_name1: VarString<8, 1024>,
	number_of_bananas1: U8,
	lot_number: U16,

	}): PACKAGE_BANANA;

	/**Dynamically bundle bananas into lots*/
	function PACKAGE_BANANA(
	bundle_name1: VarString<8, 1024>,
	number_of_bananas1: U8,
	bundle_name2: VarString<8, 1024>,
	number_of_bananas2: U8,
	lot_number: U16,

	): PACKAGE_BANANA;

	/**Dynamically bundle bananas into lots*/
	function PACKAGE_BANANA(args: {
	bundle_name1: VarString<8, 1024>,
	number_of_bananas1: U8,
	bundle_name2: VarString<8, 1024>,
	number_of_bananas2: U8,
	lot_number: U16,

	}): PACKAGE_BANANA;

	/**Dynamically bundle bananas into lots*/
	function PACKAGE_BANANA(
	bundle_name1: VarString<8, 1024>,
	number_of_bananas1: U8,
	bundle_name2: VarString<8, 1024>,
	number_of_bananas2: U8,
	bundle_name3: VarString<8, 1024>,
	number_of_bananas3: U8,
	lot_number: U16,

	): PACKAGE_BANANA;

	/**Dynamically bundle bananas into lots*/
	function PACKAGE_BANANA(args: {
	bundle_name1: VarString<8, 1024>,
	number_of_bananas1: U8,
	bundle_name2: VarString<8, 1024>,
	number_of_bananas2: U8,
	bundle_name3: VarString<8, 1024>,
	number_of_bananas3: U8,
	lot_number: U16,

	}): PACKAGE_BANANA;

	/**Dynamically bundle bananas into lots*/
	function PACKAGE_BANANA(
	bundle_name1: VarString<8, 1024>,
	number_of_bananas1: U8,
	bundle_name2: VarString<8, 1024>,
	number_of_bananas2: U8,
	bundle_name3: VarString<8, 1024>,
	number_of_bananas3: U8,
	bundle_name4: VarString<8, 1024>,
	number_of_bananas4: U8,
	lot_number: U16,

	): PACKAGE_BANANA;

	/**Dynamically bundle bananas into lots*/
	function PACKAGE_BANANA(args: {
	bundle_name1: VarString<8, 1024>,
	number_of_bananas1: U8,
	bundle_name2: VarString<8, 1024>,
	number_of_bananas2: U8,
	bundle_name3: VarString<8, 1024>,
	number_of_bananas3: U8,
	bundle_name4: VarString<8, 1024>,
	number_of_bananas4: U8,
	lot_number: U16,

	}): PACKAGE_BANANA;

	/**Dynamically bundle bananas into lots*/
	function PACKAGE_BANANA(
	bundle_name1: VarString<8, 1024>,
	number_of_bananas1: U8,
	bundle_name2: VarString<8, 1024>,
	number_of_bananas2: U8,
	bundle_name3: VarString<8, 1024>,
	number_of_bananas3: U8,
	bundle_name4: VarString<8, 1024>,
	number_of_bananas4: U8,
	bundle_name5: VarString<8, 1024>,
	number_of_bananas5: U8,
	lot_number: U16,

	): PACKAGE_BANANA;

	/**Dynamically bundle bananas into lots*/
	function PACKAGE_BANANA(args: {
	bundle_name1: VarString<8, 1024>,
	number_of_bananas1: U8,
	bundle_name2: VarString<8, 1024>,
	number_of_bananas2: U8,
	bundle_name3: VarString<8, 1024>,
	number_of_bananas3: U8,
	bundle_name4: VarString<8, 1024>,
	number_of_bananas4: U8,
	bundle_name5: VarString<8, 1024>,
	number_of_bananas5: U8,
	lot_number: U16,

	}): PACKAGE_BANANA;

	/**Dynamically bundle bananas into lots*/
	function PACKAGE_BANANA(
	bundle_name1: VarString<8, 1024>,
	number_of_bananas1: U8,
	bundle_name2: VarString<8, 1024>,
	number_of_bananas2: U8,
	bundle_name3: VarString<8, 1024>,
	number_of_bananas3: U8,
	bundle_name4: VarString<8, 1024>,
	number_of_bananas4: U8,
	bundle_name5: VarString<8, 1024>,
	number_of_bananas5: U8,
	bundle_name6: VarString<8, 1024>,
	number_of_bananas6: U8,
	lot_number: U16,

	): PACKAGE_BANANA;

	/**Dynamically bundle bananas into lots*/
	function PACKAGE_BANANA(args: {
	bundle_name1: VarString<8, 1024>,
	number_of_bananas1: U8,
	bundle_name2: VarString<8, 1024>,
	number_of_bananas2: U8,
	bundle_name3: VarString<8, 1024>,
	number_of_bananas3: U8,
	bundle_name4: VarString<8, 1024>,
	number_of_bananas4: U8,
	bundle_name5: VarString<8, 1024>,
	number_of_bananas5: U8,
	bundle_name6: VarString<8, 1024>,
	number_of_bananas6: U8,
	lot_number: U16,

	}): PACKAGE_BANANA;
	interface PACKAGE_BANANA extends Command<any[]> {}


	/**Pick a banana*/
	const PICK_BANANA: PICK_BANANA;
	interface PICK_BANANA extends Command<[]> {}



	/**Eat a banana*/
	const EAT_BANANA: EAT_BANANA;
	interface EAT_BANANA extends Command<[]> {}

	const Commands: {
		ECHO: typeof ECHO,
		PREHEAT_OVEN: typeof PREHEAT_OVEN,
		THROW_BANANA: typeof THROW_BANANA,
		GROW_BANANA: typeof GROW_BANANA,
		PREPARE_LOAF: typeof PREPARE_LOAF,
		PEEL_BANANA: typeof PEEL_BANANA,
		BAKE_BREAD: typeof BAKE_BREAD,
		ADD_WATER: typeof ADD_WATER,
		PACKAGE_BANANA: typeof PACKAGE_BANANA,
		PICK_BANANA: typeof PICK_BANANA,
		EAT_BANANA: typeof EAT_BANANA,
	};
}


	/**This command will echo back a string*/
const ECHO_ARGS_ORDER = ['echo_string'];
export function ECHO(...args: [
	VarString<8, 1024>,
] | [{
	echo_string: VarString<8, 1024>,
}]): ECHO {
  return Command.new({
    stem: 'ECHO',
    arguments: typeof args[0] === 'object' ? orderCommandArguments(args[0],ECHO_ARGS_ORDER) : args,
  }) as ECHO;
}


	/**This command will turn on the oven*/
const PREHEAT_OVEN_ARGS_ORDER = ['temperature'];
export function PREHEAT_OVEN(...args: [
	U8,
] | [{
	temperature: U8,
}]): PREHEAT_OVEN {
  return Command.new({
    stem: 'PREHEAT_OVEN',
    arguments: typeof args[0] === 'object' ? orderCommandArguments(args[0],PREHEAT_OVEN_ARGS_ORDER) : args,
  }) as PREHEAT_OVEN;
}


	/**This command will throw a banana*/
const THROW_BANANA_ARGS_ORDER = ['distance'];
export function THROW_BANANA(...args: [
	U8,
] | [{
	distance: U8,
}]): THROW_BANANA {
  return Command.new({
    stem: 'THROW_BANANA',
    arguments: typeof args[0] === 'object' ? orderCommandArguments(args[0],THROW_BANANA_ARGS_ORDER) : args,
  }) as THROW_BANANA;
}


	/**This command will grow bananas*/
const GROW_BANANA_ARGS_ORDER = ['quantity', 'durationSecs'];
export function GROW_BANANA(...args: [
	U8,
	U8,
] | [{
	quantity: U8,
	durationSecs: U8,
}]): GROW_BANANA {
  return Command.new({
    stem: 'GROW_BANANA',
    arguments: typeof args[0] === 'object' ? orderCommandArguments(args[0],GROW_BANANA_ARGS_ORDER) : args,
  }) as GROW_BANANA;
}


	/**This command make the banana bread dough*/
const PREPARE_LOAF_ARGS_ORDER = ['tb_sugar', 'gluten_free'];
export function PREPARE_LOAF(...args: [
	U8,
	boolean,
] | [{
	tb_sugar: U8,
	gluten_free: boolean,
}]): PREPARE_LOAF {
  return Command.new({
    stem: 'PREPARE_LOAF',
    arguments: typeof args[0] === 'object' ? orderCommandArguments(args[0],PREPARE_LOAF_ARGS_ORDER) : args,
  }) as PREPARE_LOAF;
}


	/**This command peels a single banana*/
const PEEL_BANANA_ARGS_ORDER = ['peelDirection'];
export function PEEL_BANANA(...args: [
	('fromStem' | 'fromTip'),
] | [{
	peelDirection: ('fromStem' | 'fromTip'),
}]): PEEL_BANANA {
  return Command.new({
    stem: 'PEEL_BANANA',
    arguments: typeof args[0] === 'object' ? orderCommandArguments(args[0],PEEL_BANANA_ARGS_ORDER) : args,
  }) as PEEL_BANANA;
}


	/**This command bakes a banana bread*/
export const BAKE_BREAD: BAKE_BREAD = Command.new({
	stem: 'BAKE_BREAD',
	arguments: [],
})


	/**This command waters the banana tree*/
export const ADD_WATER: ADD_WATER = Command.new({
	stem: 'ADD_WATER',
	arguments: [],
})


	/**Dynamically bundle bananas into lots*/
const PACKAGE_BANANA_ARGS_ORDERS = [["lot_number"],["bundle_name1","number_of_bananas1","lot_number"],["bundle_name1","number_of_bananas1","bundle_name2","number_of_bananas2","lot_number"],["bundle_name1","number_of_bananas1","bundle_name2","number_of_bananas2","bundle_name3","number_of_bananas3","lot_number"],["bundle_name1","number_of_bananas1","bundle_name2","number_of_bananas2","bundle_name3","number_of_bananas3","bundle_name4","number_of_bananas4","lot_number"],["bundle_name1","number_of_bananas1","bundle_name2","number_of_bananas2","bundle_name3","number_of_bananas3","bundle_name4","number_of_bananas4","bundle_name5","number_of_bananas5","lot_number"],["bundle_name1","number_of_bananas1","bundle_name2","number_of_bananas2","bundle_name3","number_of_bananas3","bundle_name4","number_of_bananas4","bundle_name5","number_of_bananas5","bundle_name6","number_of_bananas6","lot_number"]];
export function PACKAGE_BANANA<T extends any[]>(...args: T) {
  return Command.new({
    stem: 'PACKAGE_BANANA',
    arguments: typeof args[0] === 'object' ? findAndOrderCommandArguments("PACKAGE_BANANA",args[0],PACKAGE_BANANA_ARGS_ORDERS) : args,
  }) as PACKAGE_BANANA;
}


	/**Pick a banana*/
export const PICK_BANANA: PICK_BANANA = Command.new({
	stem: 'PICK_BANANA',
	arguments: [],
})


	/**Eat a banana*/
export const EAT_BANANA: EAT_BANANA = Command.new({
	stem: 'EAT_BANANA',
	arguments: [],
})
export const Commands = {		ECHO: ECHO,
		PREHEAT_OVEN: PREHEAT_OVEN,
		THROW_BANANA: THROW_BANANA,
		GROW_BANANA: GROW_BANANA,
		PREPARE_LOAF: PREPARE_LOAF,
		PEEL_BANANA: PEEL_BANANA,
		BAKE_BREAD: BAKE_BREAD,
		ADD_WATER: ADD_WATER,
		PACKAGE_BANANA: PACKAGE_BANANA,
		PICK_BANANA: PICK_BANANA,
		EAT_BANANA: EAT_BANANA,
};

Object.assign(globalThis, Commands, { A:A, R:R, E:E, C:Commands, Sequence});

