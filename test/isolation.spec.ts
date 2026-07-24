import vm from 'node:vm';
import { describe, it } from 'node:test';
import { expect } from 'expect';

import { UserCodeRunner } from '../src/UserCodeRunner';

const PROCESS_UNAVAILABLE = 'process unavailable';

/**
 * security regression tests for the user-code boundary.
 *
 * access to the host `process` object enables arbitrary code execution through
 * node capabilities such as environment variables, filesystem access, networking,
 * native bindings, and child processes.
 *
 * a clean guest realm cannot access `process`, but host objects passed into it
 * may expose the host `Function` constructor through their constructor chain.
 * these tests ensure runner- and caller-provided values do not create that bridge.
 */

interface ExecuteOptions {
	args?: unknown[];
	argsTypes?: string[];
	context?: vm.Context;
}

async function execute(source: string, options: ExecuteOptions = {}): Promise<unknown> {
	const args = options.args ?? [];
	const argsTypes = options.argsTypes ?? args.map(() => 'any');

	const result = await new UserCodeRunner().executeUserCode(source, args, 'any', argsTypes, 1000, [], options.context);

	return result.unwrap();
}

describe('UserCodeRunner isolation', () => {
	it('does not expose process through guest-realm intrinsics', async () => {
		const value = await execute(`
			export default function(): string {
				try {
					return Function('return process.version')();
				} catch {
					return '${PROCESS_UNAVAILABLE}';
				}
			}
		`);

		expect(value).toBe(PROCESS_UNAVAILABLE);
	});

	it('does not expose process through the internal argument array', async () => {
		const value = await execute(`
			export default function(): string {
				try {
					const args = (globalThis as any).__args;
					return args.constructor.constructor(
						'return process.version',
					)();
				} catch {
					return '${PROCESS_UNAVAILABLE}';
				}
			}
		`);

		expect(value).toBe(PROCESS_UNAVAILABLE);
	});

	it('does not expose process through a user-code argument', async () => {
		const value = await execute(
			`
				export default function(props: any): string {
					try {
						return props.constructor.constructor(
							'return process.version',
						)();
					} catch {
						return '${PROCESS_UNAVAILABLE}';
					}
				}
			`,
			{ args: [{}] },
		);

		expect(value).toBe(PROCESS_UNAVAILABLE);
	});

	it('does not expose process through a nested user-code argument', async () => {
		const value = await execute(
			`
				export default function(props: any): string {
					try {
						return props.nested.constructor.constructor(
							'return process.version',
						)();
					} catch {
						return '${PROCESS_UNAVAILABLE}';
					}
				}
			`,
			{args: [{ nested: {} }]},
		);

		expect(value).toBe(PROCESS_UNAVAILABLE);
	});

	it('does not expose process through an explicitly provided context value', async () => {
		const context = vm.createContext({
			hostValue: {},
		});

		const value = await execute(
			`
				declare const hostValue: any;

				export default function(): string {
					try {
						return hostValue.constructor.constructor(
							'return process.version',
						)();
					} catch {
						return '${PROCESS_UNAVAILABLE}';
					}
				}
			`,
			{ args: [], context },
		);

		expect(value).toBe(PROCESS_UNAVAILABLE);
	});
});
