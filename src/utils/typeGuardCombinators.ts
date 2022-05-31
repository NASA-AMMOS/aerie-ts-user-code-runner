export type TypeGuard<A, B extends A> = (a: A) => a is B;
export type GuardType<T> = T extends (o: any) => o is infer U ? U : never

export function Or<T extends TypeGuard<any, any>>(guards: T[]): T extends TypeGuard<infer A, any> ? (a: A) => a is GuardType<T> : never;
export function Or<T extends TypeGuard<any, any>>(guards: T[]) {
	return function (arg: T) {
		return guards.some(function (predicate) {
			predicate(arg);
		});
	}
}

type UnionToIntersection<U> =
	(U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;

export function And<T extends TypeGuard<any, any>>(guards: T[]):
	[T] extends [TypeGuard<infer A, any>] ?
		(a: A) => a is Extract<UnionToIntersection<GuardType<T>>, A> : never;
export function And<T extends TypeGuard<any, any>>(guards: T[]) {
	return function (arg: T) {
		return guards.every(function (predicate) {
			predicate(arg);
		});
	}
}
