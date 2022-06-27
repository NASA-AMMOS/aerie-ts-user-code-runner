/** None value */
export const None = Symbol('None');

/** Error with a message and contents */
class ErrorWithContents<T> extends Error {
  public readonly contents: T;
  constructor(message: string, contents: T) {
    super();
    this.contents = contents;
  }
}

export enum SerializedResultType {
  Ok = 'Result.Ok',
  Err = 'Result.Err',
}

export type SerializedResult<T, E> = {
  $$type: SerializedResultType.Ok;
  $$value: T;
} | {
  $$type: SerializedResultType.Err;
  $$value: E;
}

/**
 * Result<T, E> is a type used for returning and propagating errors. It has the variants, Ok(T), representing success
 * and containing a value, and Err(E), representing error and containing an error value.
 */
export class Result<T, E> {

  private readonly value: T | typeof None;
  private readonly error: E | typeof None;

  private constructor(value: T | typeof None, error: E | typeof None) {
    this.value = value;
    this.error = error;
  }

  /** Create a success value */
  public static Ok<T, E = any>(value: T): Result<T, E> {
    return new Result(value, None as unknown as E);
  }

  /** Create an error value */
  public static Err<E, T = any>(error: E): Result<T, E> {
    return new Result(None as unknown as T, error);
  }

  /** Returns true if the result is Ok. */
  public isOk(): this is Result<T, never> {
    return this.error === None && this.value !== None;
  }

  /** Returns true if the result is Err. */
  public isErr(): this is Result<never, E> {
    return this.value === None && this.error !== None;
  }

  /** Evaluate different branches based on whether the Result is an Ok or an Err */
  public match<RT, RE>(branches: { Ok: (val: T) => RT, Err: (err: E) => RE }): RT | RE {
    if (this.isOk()) {
      return branches.Ok(this.unwrap());
    }
    return branches.Err(this.unwrapErr());
  }

  /** Returns true if the result is an Ok value containing the given value. */
  public contains<V extends T>(value: V): boolean {
    return this.isOk() && this.value === value;
  }

  /** Returns true if the result is an Err value containing the given value. */
  public containsErr<V extends E>(error: V): boolean {
    return this.isErr() && this.error === error;
  }

  /**
   * Converts from Result<T, E> to Option<T>.
   *
   * Converts self into an Option<T>, consuming self, and discarding the error, if any.
   */
  public ok(): Option<T> {
    return this.isOk()
      ? Option.Some(this.unwrap())
      : Option.None();
  }

  /**
   * Converts from Result<T, E> to Option<E>.
   *
   * Converts self into an Option<E>, consuming self, and discarding the success value, if any.
   */
  public err(): Option<E> {
    return this.isErr()
      ? Option.Some(this.unwrapErr())
      : Option.None();
  }

  /**
   * Maps a Result<T, E> to Result<U, E> by applying a function to a contained Ok value, leaving an Err value untouched.
   *
   * This function can be used to compose the results of two functions.
   */
  public map<U, F extends (v: T) => U>(f: F): Result<U, E> {
    if (this.isErr()) {
      return Result.Err(this.unwrapErr());
    }
    return Result.Ok(f(this.unwrap()));
  }

  /**
   * Applies a function to the contained value (if Ok), or returns the provided default (if Err).
   *
   * Arguments passed to map_or are eagerly evaluated; if you are passing the result of a function call, it is recommended to use map_or_else, which is lazily evaluated, which is lazily evaluated.
   */
  public mapOr<U, F extends (v: T) => U>(defaultValue: U, f: F): U {
    if (this.isErr()) {
      return defaultValue;
    }
    return f(this.value as T);
  }

  /**
   * Maps a Result<T, E> to U by applying a function to a contained Ok value, or a fallback function to a contained Err value.
   *
   * This function can be used to unpack a successful result while handling an error.
   */
  public mapOrElse<U, F extends (v: T) => U>(errorMapper: (error: E) => U, f: (value: T) => U): U {
    if (this.isErr()) {
      return errorMapper(this.unwrapErr());
    }
    return f(this.unwrap());
  }

  /**
   * Maps a Result<T, E> to Result<T, F> by applying a function to a contained Err value, leaving an Ok value untouched.
   *
   * This function can be used to pass through a successful result while handling an error.
   */
  public mapErr<F>(f: (err: E) => F): Result<T, F> {
    if (this.isErr()) {
      return Result.Err(f(this.unwrapErr()));
    }
    return Result.Ok(this.unwrap());
  }

  /**
   * Returns an iterator over the possibly contained value.
   *
   * The iterator yields one value if the result is Ok, otherwise none.
   */
  public* iter(): Iterator<T> {
    if (this.isOk()) {
      yield this.unwrap();
    }
  }

  /** Returns res if the result is Ok, otherwise returns the Err value of self. */
  public and<U>(res: Result<U, E>): Result<U, E> {
    if (this.isOk()) {
      return res
    }
    return Result.Err(this.unwrapErr());
  }

  /**
   * Calls op if the result is Ok, otherwise returns the Err value of self.
   *
   * This function can be used for control flow based on Result values.
   */
  public andThen<U, F extends (v: T) => Result<U, E>>(op: F): Result<U, E> {
    if (this.isOk()) {
      return op(this.unwrap());
    }
    return Result.Err(this.unwrapErr());
  }

  /**
   * Returns res if the result is Err, otherwise returns the Ok value of self.
   *
   * Arguments passed to or are eagerly evaluated; if you are passing the result of a function call, it is recommended to use or_else, which is lazily evaluated.
   */
  public or<F>(res: Result<T, F>): Result<T, F> {
    if (this.isErr()) {
      return res;
    }
    return Result.Ok(this.unwrap());
  }

  /**
   * Calls op if the result is Err, otherwise returns the Ok value of self.
   *
   * This function can be used for control flow based on result values.
   */
  public orElse<F, O extends (err: E) => Result<T, F>>(op: O): Result<T, F>{
    if (this.isErr()) {
      return op(this.unwrapErr());
    }
    return Result.Ok(this.unwrap());
  }

  /**
   * Returns the contained Ok value or a provided default.
   *
   * Arguments passed to unwrap_or are eagerly evaluated; if you are passing the result of a function call, it is recommended to use unwrap_or_else, which is lazily evaluated.
   */
  public unwrapOr(defaultValue: T): T{
    if (this.isOk()) {
      return this.unwrap();
    }
    return defaultValue;
  }

  /** Returns the contained Ok value or computes it from a closure. */
  public unwrapOrElse<F extends (err: E) => T>(op: F): T {
    if (this.isOk()) {
      return this.unwrap();
    }
    return op(this.unwrapErr());
  }

  /**
   * Returns the contained Ok value.
   *
   * Throws if the value is an Err, with an error message including the passed message, and the content of the Err.
   */
  public expect(msg: string): T {
    if (this.isErr()) {
      throw new ErrorWithContents(msg, this.unwrapErr());
    }
    return this.unwrap();
  }

  /**
   * Returns the contained Ok value, consuming the self value.
   *
   * Because this function may throw, its use is generally discouraged. Instead, prefer to use match and
   * handle the Err case explicitly, or call unwrap_or, unwrap_or_else, or unwrap_or_default.
   *
   * Throws if the value is an Err, with the Err's value.
   */
  public unwrap(): T {
    if (this.isErr()) {
      throw this.unwrapErr();
    }
    return this.value as T;
  }

  /**
   * Returns the contained Err value.
   *
   * Panics if the value is an Ok, with a panic message including the passed message, and the content of the Ok.
   */
  public expectErr(msg: string): E {
    if (this.isOk()) {
      throw new ErrorWithContents(msg, this.unwrap());
    }
    return this.unwrapErr();
  }

  /**
   * Returns the contained Err value, consuming the self value.
   *
   * Throws if the value is an Ok, with the Ok's value.
   */
  public unwrapErr(): E {
    if (this.isOk()) {
      throw this.unwrap();
    }
    return this.error as E;
  }

  public toString(): string {
    if (this.isOk()) {
      return `Ok(${this.unwrap()})`;
    }
    return `Err(${this.unwrapErr()})`;
  }

  public toJSON(): SerializedResult<T, E> {
    if (this.isOk()) {
      return {
        $$type: SerializedResultType.Ok,
        $$value: this.unwrap()
      };
    }
    return {
      $$type: SerializedResultType.Err,
      $$value: this.unwrapErr()
    };
  }

  public static fromJSON<T, E>(json: SerializedResult<T, E>): Result<T, E> {
    if (json.$$type === SerializedResultType.Ok) {
      return Result.Ok(json.$$value);
    }
    else if (json.$$type === SerializedResultType.Err) {
      return Result.Err(json.$$value);
    }
    throw new Error(`Invalid JSON serialization of Result: ${JSON.stringify(json)}`);
  }
}

export enum SerializedOptionType {
  Some = 'Some',
  None = 'None'
}

export type SerializedOption<T> = {
  $$type: SerializedOptionType.Some,
  $$value: T
} | {
  $$type: SerializedOptionType.None
}

/**
 * Type Option represents an optional value: every Option is either Some and contains a value,
 * or None, and does not.
 */
export class Option<T> {
  private readonly value: T | typeof None
  private constructor(value: T | typeof None) {
    this.value = value;
  }

  /** Create a Some value */
  public static Some<V>(value: V): Option<V> {
    return new Option(value);
  }

  /** Create a None value */
  public static None<V = unknown>(): Option<V> {
    return new Option(None) as unknown as Option<V>;
  }

  /** Returns true if the option is a Some value. */
  public isSome(): boolean {
    return this.value !== None;
  }

  /** Returns true if the option is a None value. */
  public isNone(): boolean {
    return this.value === None;
  }

  /** Evaluate different branches based on whether the Result is Some or None */
  public match<RS, RN>(branches: { Some: (val: T) => RS, None: () => RN }): RS | RN {
    if (this.isSome()) {
      return branches.Some(this.unwrap());
    }
    return branches.None();
  }

  /** Returns true if the option is a Some value containing the given value. */
  public contains<U extends T>(x: U): boolean {
    if (this.isSome()) {
      return this.unwrap() === x;
    }
    return false;
  }

  /**
   * Returns the contained Some value.
   *
   * Throws if the value is a None with a custom panic message provided by message.
   */
  public expect(message: string): T {
    if (this.isSome()) {
      return this.unwrap();
    }
    throw new Error(message);
  }

  /**
   * Returns the contained Some value, consuming the self value.
   *
   * Because this function may panic, its use is generally discouraged. Instead, prefer to use match and
   * handle the None case explicitly, or call unwrap_or, unwrap_or_else, or unwrap_or_default.
   *
   * Throws if this is None
   */
  public unwrap(): T {
    if (this.isSome()) {
      return this.value as T;
    }
    throw new Error('Tried to unwrap a None');
  }

  /**
   * Returns the contained Some value or a provided default.
   *
   * Arguments passed to unwrap_or are eagerly evaluated; if you are passing the result of a function call,
   * it is recommended to use unwrap_or_else, which is lazily evaluated.
   */
  public unwrapOr(defaultValue: T): T {
    if (this.isSome()) {
      return this.unwrap();
    }
    return defaultValue;
  }

  /** Returns the contained Some value or computes it from a closure. */
  public unwrapOrElse<F extends () => T>(f: F): T {
    if (this.isSome()) {
      return this.unwrap();
    }
    return f();
  }

  /** Maps an Option<T> to Option<U> by applying a function to a contained value.*/
  public map<U, F extends (v: T) => U>(f: F): Option<U> {
    if (this.isSome()) {
      return Option.Some(f(this.unwrap()));
    }
    return Option.None<U>();
  }

  /**
   * Applies a function to the contained value (if any), or returns the provided default (if not).
   *
   * Arguments passed to map_or are eagerly evaluated; if you are passing the result of a function call,
   * it is recommended to use map_or_else, which is lazily evaluated.
   */
  public mapOr<U, F extends (v: T) => U>(defaultValue: U, f: F): U {
    if (this.isSome()) {
      return f(this.unwrap());
    }
    return defaultValue;
  }

  /** Applies a function to the contained value (if any), or computes a default (if not). */
  public mapOrElse<U, D extends () => U, F extends (v: T) => U>(defaultValue: D, f: F): U {
    if (this.isSome()) {
      return f(this.unwrap());
    }
    return defaultValue();
  }

  /**
   * Transforms the Option<T> into a Result<T, E>, mapping Some(v) to Ok(v) and None to Err(err).
   * Arguments passed to ok_or are eagerly evaluated; if you are passing the result of a function call,
   * it is recommended to use ok_or_else, which is lazily evaluated.
   */
  public okOr<E>(err: E): Result<T, E> {
    if (this.isSome()) {
      return Result.Ok<T, E>(this.unwrap());
    }
    return Result.Err<E, T>(err);
  }

  /** Transforms the Option<T> into a Result<T, E>, mapping Some(v) to Ok(v) and None to Err(err()). */
  public okOrElse<E, F extends () => E>(err: F): Result<T, E> {
    if (this.isSome()) {
      return Result.Ok<T, E>(this.unwrap());
    }
    return Result.Err<E, T>(err());
  }

  /** Returns an iterator over the possibly contained value. */
  public* iter(): Iterator<T> {
    if (this.isSome()) {
      yield this.unwrap();
    }
  }

  /** Returns None if the option is None, otherwise returns optb. */
  public and<U>(optb: Option<U>): Option<U> {
    if (this.isNone()) {
      return Option.None<U>();
    }
    return optb;
  }

  /** Returns None if the option is None, otherwise calls f with the wrapped value and returns the result. */
  public andThen<U, F extends (val: T) => Option<U>>(f: F): Option<U> {
    if (this.isNone()) {
      return Option.None<U>();
    }
    return f(this.unwrap());
  }

  /**
   * Returns None if the option is None, otherwise calls predicate with the wrapped value and returns:
   *
   * Some(t) if predicate returns true (where t is the wrapped value), and
   * None if predicate returns false.
   */
  public filter<P extends (val: T) => boolean>(predicate: P): Option<T> {
    if (this.isNone()) {
      return this;
    }
    if (predicate(this.unwrap())) {
      return this;
    }
    return Option.None();
  }

  /**
   * Returns the option if it contains a value, otherwise returns optb.
   *
   * Arguments passed to or are eagerly evaluated; if you are passing the result of a function call,
   * it is recommended to use or_else, which is lazily evaluated.
   */
  public or(optb: Option<T>): Option<T> {
    if (this.isSome()) {
      return this;
    }
    return optb;
  }

  /** Returns the option if it contains a value, otherwise calls f and returns the result. */
  public orElse<F extends () => Option<T>>(f: F): Option<T> {
    if (this.isSome()) {
      return this;
    }
    return f();
  }

  /** Returns Some if exactly one of this, optb is Some, otherwise returns None. */
  public xor(optb: Option<T>): Option<T> {
    if (this.isSome() && optb.isNone()) {
      return this;
    }
    if (this.isNone() && optb.isSome()) {
      return optb;
    }
    return Option.None();
  }

  /**
   * Zips self with another Option.
   *
   * If self is Some(s) and other is Some(o), this method returns Some([s, o]). Otherwise, None is returned.
   */
  public zip<U>(other: Option<U>): Option<[T, U]> {
    if (this.isSome() && other.isSome()) {
      return Option.Some([this.unwrap(), other.unwrap()]);
    }
    return Option.None();
  }

  /**
   * Zips self and another Option with function f.
   *
   * If self is Some(s) and other is Some(o), this method returns Some(f(s, o)). Otherwise, None is returned.
   */
  public zipWith<U, R, F extends (t: T, u: U) => R>(other: Option<U>, f: F): Option<R> {
    if (this.isSome() && other.isSome()) {
      return Option.Some(f(this.unwrap(), other.unwrap()));
    }
    return Option.None();
  }

  /**
   * Returns None
   *
   * Throws if the value is a Some, with a panic message including the passed message, and the content of the Some.
   */
  public expectNone(message: string): typeof None {
    if (this.isSome()) {
      throw new ErrorWithContents(message, this.unwrap());
    }
    return None;
  }

  /**
   * Returns None
   *
   * Throws if the value is Some, with the value of Some
   */
  public unwrapNone(): typeof None {
    if (this.isSome()) {
      throw this.unwrap();
    }
    return None;
  }

  public toString(): string {
    if (this.isSome()) {
      return `Some(${this.unwrap()})`;
    }
    return `None()`;
  }

  public toJSON(): SerializedOption<T> {
    if (this.isSome()) {
      return {
        $$type: SerializedOptionType.Some,
        $$value: this.unwrap()
      };
    }
    return {
      $$type: SerializedOptionType.None,
    };
  }

  public static fromJSON<T, E>(json: SerializedOption<T>): Option<T> {
    if (json.$$type === SerializedOptionType.Some) {
      return Option.Some(json.$$value);
    }
    else if (json.$$type === SerializedOptionType.None) {
      return Option.None()
    }
    throw new Error(`Invalid JSON serialization of Option: ${JSON.stringify(json)}`);
  }
}

