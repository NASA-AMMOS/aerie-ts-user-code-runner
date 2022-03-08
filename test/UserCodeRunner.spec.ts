// @ts-ignore
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
    TypeError: TS2322 Incorrect return type. Expected: 'number', Actual: 'string'.
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
    TypeError: TS2554 Incorrect argument type. Expected: '[string]', Actual: '[string, number]'.
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
    TypeError: TS2322 Type 'string' is not assignable to type 'number'.
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
    import { importedFunction } from 'other-importable.js';
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

test('Aerie Throw Regression Test', async () => {
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

  expect(result.unwrap()).toMatchObject({
    stem: 'BAKE_BREAD',
    arguments: [],
  });
})

test('Aerie undefined node test', async () => {
  const userCode = `
    export default function BakeBananaBreadExpansionLogic(
      props: {
        activityInstance: ActivityType;
      },
      context: Context
    ): ExpansionReturn {
      return [
        PREHEAT_OVEN(props.activityInstance.temperature),
        PREPARE_LOAF(props.activityInstance.tbSugar, props.activityInstance.glutenFree),
        BAKE_BREAD,
      ];
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
    [{ activityInstance: null}, {}],
    'Command[] | Command | null',
    ['{ activityInstance: ActivityType }', 'Context'],
    1000,
    [
      ts.createSourceFile('command-types.ts', commandTypes, ts.ScriptTarget.ESNext, true),
      ts.createSourceFile('activity-types.ts', activityTypes, ts.ScriptTarget.ESNext, true),
      ts.createSourceFile('TemporalPolyfillTypes.ts', temporalPolyfill, ts.ScriptTarget.ESNext, true),
    ],
    context,
  );

  expect(result.unwrapErr()).toMatchObject(expect.arrayContaining([
    expect.objectContaining({
      message: "TypeError: TS2322 Incorrect return type. Expected: 'Command[] | Command | null', Actual: 'ExpansionReturn'.",
      stack: 'at BakeBananaBreadExpansionLogic(5:3)',
      sourceContext: ' 5|   context: Context\n' +
        '>6| ): ExpansionReturn {\n' +
        '       ~~~~~~~~~~~~~~~\n' +
        ' 7|   return [',
      location: { line: 5, column: 3 }
    }),
    expect.objectContaining({
      message: "TypeError: TS2339 Property 'temperature' does not exist on type 'ParameterTest'.",
      stack: 'at BakeBananaBreadExpansionLogic(7:40)',
      sourceContext: ' 7|   return [\n' +
        '>8|     PREHEAT_OVEN(props.activityInstance.temperature),\n' +
        '                                            ~~~~~~~~~~~\n' +
        ' 9|     PREPARE_LOAF(props.activityInstance.tbSugar, props.activityInstance.glutenFree),',
      location: { line: 7, column: 40 }
    }),
    expect.objectContaining({
      message: "TypeError: TS2339 Property 'tbSugar' does not exist on type 'ParameterTest'.",
      stack: 'at BakeBananaBreadExpansionLogic(8:40)',
      sourceContext: ' 8|     PREHEAT_OVEN(props.activityInstance.temperature),\n' +
        '>9|     PREPARE_LOAF(props.activityInstance.tbSugar, props.activityInstance.glutenFree),\n' +
        '                                            ~~~~~~~\n' +
        ' 10|     BAKE_BREAD,',
      location: { line: 8, column: 40 }
    }),
    expect.objectContaining({
      message: "TypeError: TS2339 Property 'glutenFree' does not exist on type 'ParameterTest'.",
      stack: 'at BakeBananaBreadExpansionLogic(8:72)',
      sourceContext: ' 8|     PREHEAT_OVEN(props.activityInstance.temperature),\n' +
        '>9|     PREPARE_LOAF(props.activityInstance.tbSugar, props.activityInstance.glutenFree),\n' +
        '                                                                            ~~~~~~~~~~\n' +
        ' 10|     BAKE_BREAD,',
      location: { line: 8, column: 72 }
    }),
  ]));
})