import './inputs/polyfills';
import {UserCodeRunner} from "../src/UserCodeRunner";
import {installStringUtils} from "../src/utils/stringUtils";
installStringUtils();

import ts from 'typescript';
import * as vm from "vm";
import * as fs from "fs";

it('should produce runtime errors', async () => {
  const userCode = `
    export default function MyDSLFunction(thing: string): string {
      subroutine();
      return thing + ' world';
    }
    
    function subroutine() {
      throw new Error('This is a test error');
    }
    `.trimTemplate();

  const runner = new UserCodeRunner();

  const result = await runner.executeUserCode(
    userCode,
    ['hello'],
    'string',
    ['string'],
  );

  expect(result.isErr()).toBeTruthy();
  expect(result.unwrapErr()[0].message).toBe(`
    Error: This is a test error
    `.trimTemplate());
  expect(result.unwrapErr()[0].stack).toBe(`
    at subroutine(7:8)
    at MyDSLFunction(2:2)
    `.trimTemplate())
  expect(result.unwrapErr()[0].location).toMatchObject({
    line: 7,
    column: 8,
  });
  expect(result.unwrapErr()[0].sourceContext).toBe(`
     6| function subroutine() {
    >7|   throw new Error('This is a test error');
     8| }
    `.trimTemplate());
});

it('should produce return type errors', async () => {
  const userCode = `
    export default function MyDSLFunction(thing: string): string {
      subroutine();
      return thing + ' world';
    }
    
    function subroutine() {
      throw new Error('This is a test error');
    }
    `.trimTemplate();

  const runner = new UserCodeRunner();

  const result = await runner.executeUserCode(
    userCode,
    ['hello'],
    'number',
    ['string'],
  );

  expect(result.isErr()).toBeTruthy();
  expect(result.unwrapErr()[0].message).toBe(`
    TypeError: Incorrect return type. Expected: 'number', Actual: 'string'.
    `.trimTemplate());
  expect(result.unwrapErr()[0].stack).toBe(`
    at MyDSLFunction(0:54)
    `.trimTemplate())
  expect(result.unwrapErr()[0].location).toMatchObject({
    line: 0,
    column: 54,
  });
  expect(result.unwrapErr()[0].sourceContext).toBe(`
    >1| export default function MyDSLFunction(thing: string): string {
                                                              ~~~~~~
     2|   subroutine();
    `.trimTemplate());
});

it('should produce input type errors', async () => {
  const userCode = `
    export default function MyDSLFunction(thing: string, other: number): string {
      subroutine();
      return thing + ' world';
    }
    
    function subroutine() {
      throw new Error('This is a test error');
    }
    `.trimTemplate();

  const runner = new UserCodeRunner();

  const result = await runner.executeUserCode(
    userCode,
    ['hello'],
    'string',
    ['string'],
  );

  expect(result.isErr()).toBeTruthy();
  expect(result.unwrapErr()[0].message).toBe(`
    TypeError: Incorrect argument type. Expected: '[string]', Actual: '[string, number]'.
    `.trimTemplate());
  expect(result.unwrapErr()[0].stack).toBe(`
    at MyDSLFunction(0:38)
    `.trimTemplate())
  expect(result.unwrapErr()[0].location).toMatchObject({
    line: 0,
    column: 38,
  });
  expect(result.unwrapErr()[0].sourceContext).toBe(`
    >1| export default function MyDSLFunction(thing: string, other: number): string {
                                              ~~~~~~~~~~~~~~~~~~~~~~~~~~~~
     2|   subroutine();
    `.trimTemplate());
});

it('should produce internal type errors', async () => {
  const userCode = `
    export default function MyDSLFunction(thing: string): number {
      const other: number = 'hello';
      return thing + ' world';
    }
    `.trimTemplate();

  const runner = new UserCodeRunner();

  const result = await runner.executeUserCode(
    userCode,
    ['hello'],
    'number',
    ['string'],
  );

  expect(result.isErr()).toBeTruthy();
  expect(result.unwrapErr()[0].message).toBe(`
    TypeError: Type 'string' is not assignable to type 'number'.
    `.trimTemplate());
  expect(result.unwrapErr()[0].stack).toBe(`
    at MyDSLFunction(1:8)
    `.trimTemplate())
  expect(result.unwrapErr()[0].location).toMatchObject({
    line: 1,
    column: 8,
  });
  expect(result.unwrapErr()[0].sourceContext).toBe(`
     1| export default function MyDSLFunction(thing: string): number {
    >2|   const other: number = 'hello';
                ~~~~~
     3|   return thing + ' world';
    `.trimTemplate());
});

it('should return the final value', async () => {
  const userCode = `
    export default function MyDSLFunction(thing: string): string {
      return thing + ' world';
    }
    `.trimTemplate();

  const runner = new UserCodeRunner();

  const result = await runner.executeUserCode(
    userCode,
    ['hello'],
    'string',
    ['string'],
  );

  expect(result.isOk()).toBeTruthy();
  expect(result.unwrap()).toBe('hello world');
});

it('should accept additional source files', async () => {
  const userCode = `
    import { importedFunction } from 'other-importable';
    export default function myDSLFunction(thing: string): string {
      return someGlobalFunction(thing) + importedFunction(' world');
    }
    `.trimTemplate();

  const runner = new UserCodeRunner();

  const result = await runner.executeUserCode(
    userCode,
    ['hello'],
    'string',
    ['string'],
    1000,
    [
      ts.createSourceFile('globals.d.ts', `
      declare global {
        function someGlobalFunction(thing: string): string;
      }
      export {};
      `.trimTemplate(), ts.ScriptTarget.ESNext, true),
      ts.createSourceFile('other-importable.ts', `
      export function importedFunction(thing: string): string {
        return thing + ' other';
      }
      `.trimTemplate(), ts.ScriptTarget.ESNext, true)
    ],
    vm.createContext({
      someGlobalFunction: (thing: string) => 'hello ' + thing, // Implementation injected to global namespace here
    }),
  );

  // expect(result.isOk()).toBeTruthy();
  expect(result.unwrap()).toBe('hello hello world other');
});

test.only('Aerie Throw Regression Test', async () => {
  const userCode = `
    export default function SingleCommandExpansion(props: { activity: ActivityType }): Command {
      const duration = Temporal.Duration.from('PT1H');
      return BAKE_BREAD;
    }
    `.trimTemplate()

  const runner = new UserCodeRunner();
  const [commandTypes, activityTypes, temporalPolyfill] = await Promise.all([
    fs.promises.readFile(new URL('./inputs/command-types.ts', import.meta.url).pathname, 'utf8'),
    fs.promises.readFile(new URL('./inputs/activity-types.ts', import.meta.url).pathname, 'utf8'),
    fs.promises.readFile(new URL('./inputs/TemporalPolyfillTypes.ts', import.meta.url).pathname, 'utf8'),
  ]);

  const context = vm.createContext({
    Temporal,
  });
  const result = await runner.executeUserCode(
    userCode,
    [{ activity: null}],
    'Command[] | Command | null',
    ['{ activity: ActivityType }'],
    1000,
    [
      ts.createSourceFile('command-types.ts', commandTypes, ts.ScriptTarget.ESNext, true),
      ts.createSourceFile('activity-types.ts', activityTypes, ts.ScriptTarget.ESNext, true),
      ts.createSourceFile('TemporalPolyfillTypes.ts', temporalPolyfill, ts.ScriptTarget.ESNext, true),
    ],
    context,
  );
  console.log(context);

  // expect(result.isOk()).toBeTruthy();
  // expect(result.unwrap()).toMatchObject({});
  expect(result.unwrapErr().toString()).toBe(null);
})

