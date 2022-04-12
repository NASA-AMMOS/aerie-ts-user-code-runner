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
  expect(result.unwrapErr().length).toBe(1);
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
  expect(result.unwrapErr().length).toBe(1);
  expect(result.unwrapErr()[0].message).toBe(`
    TypeError: TS2322 Incorrect return type. Expected: 'number', Actual: 'string'.
    `.trimTemplate());
  expect(result.unwrapErr()[0].stack).toBe(`
    at MyDSLFunction(1:55)
    `.trimTemplate())
  expect(result.unwrapErr()[0].location).toMatchObject({
    line: 1,
    column: 55,
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
  expect(result.unwrapErr().length).toBe(1);
  expect(result.unwrapErr()[0].message).toBe(`
    TypeError: TS2554 Incorrect argument type. Expected: '[string]', Actual: '[string, number]'.
    `.trimTemplate());
  expect(result.unwrapErr()[0].stack).toBe(`
    at MyDSLFunction(1:39)
    `.trimTemplate())
  expect(result.unwrapErr()[0].location).toMatchObject({
    line: 1,
    column: 39,
  });
  expect(result.unwrapErr()[0].sourceContext).toBe(`
    >1| export default function MyDSLFunction(thing: string, other: number): string {
                                              ~~~~~~~~~~~~~~~~~~~~~~~~~~~~
     2|   subroutine();
    `.trimTemplate());
});

it('should handle no default export errors', async () => {
  const userCode = `
    export function MyDSLFunction(thing: string, other: number): string {
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
  expect(result.unwrapErr().length).toBe(1);
  expect(result.unwrapErr()[0].message).toBe(`
    TypeError: TS1192 No default export. Expected a default export with the signature: "(...args: [string]) => string".
    `.trimTemplate());
  expect(result.unwrapErr()[0].stack).toBe(`
    at (1:1)
    `.trimTemplate())
  expect(result.unwrapErr()[0].location).toMatchObject({
    line: 1,
    column: 1,
  });
  expect(result.unwrapErr()[0].sourceContext).toBe(`
     1| export function MyDSLFunction(thing: string, other: number): string {
     2|   subroutine();
     3|   return thing + ' world';
     4| }
     5| 
     6| function subroutine() {
     7|   throw new Error('This is a test error');
     8| }
    `.trimTemplate());
});

it('should handle no export errors', async () => {
  const userCode = `
    function MyDSLFunction(thing: string, other: number): string {
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
  expect(result.unwrapErr().length).toBe(1);
  expect(result.unwrapErr()[0].message).toBe(`
    TypeError: TS2306 No exports. Expected a default export with the signature: "(...args: [string]) => string".
    `.trimTemplate());
  expect(result.unwrapErr()[0].stack).toBe(`
    at (1:1)
    `.trimTemplate())
  expect(result.unwrapErr()[0].location).toMatchObject({
    line: 1,
    column: 1,
  });
  expect(result.unwrapErr()[0].sourceContext).toBe(`
     1| function MyDSLFunction(thing: string, other: number): string {
     2|   subroutine();
     3|   return thing + ' world';
     4| }
     5| 
     6| function subroutine() {
     7|   throw new Error('This is a test error');
     8| }
    `.trimTemplate());
});

it('should handle default export not function errors', async () => {
  const userCode = `
    const hello = 'hello';
    export default hello;
    function MyDSLFunction(thing: string, other: number): string {
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
  expect(result.unwrapErr().length).toBe(1);
  expect(result.unwrapErr()[0].message).toBe(`
    TypeError: TS2349 Default export is not callable. Expected a default export with the signature: "(...args: [string]) => string".
    `.trimTemplate());
  expect(result.unwrapErr()[0].stack).toBe(`
    at (2:1)
    `.trimTemplate())
  expect(result.unwrapErr()[0].location).toMatchObject({
    line: 2,
    column: 1,
  });
  expect(result.unwrapErr()[0].sourceContext).toBe(`
     1| const hello = 'hello';
    >2| export default hello;
        ~~~~~~~~~~~~~~~~~~~~~
     3| function MyDSLFunction(thing: string, other: number): string {
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
  expect(result.unwrapErr().length).toBe(2);
  expect(result.unwrapErr()[0].message).toBe(`
    TypeError: TS2322 Type 'string' is not assignable to type 'number'.
    `.trimTemplate());
  expect(result.unwrapErr()[0].stack).toBe(`
    at MyDSLFunction(2:9)
    `.trimTemplate())
  expect(result.unwrapErr()[0].location).toMatchObject({
    line: 2,
    column: 9,
  });
  expect(result.unwrapErr()[0].sourceContext).toBe(`
     1| export default function MyDSLFunction(thing: string): number {
    >2|   const other: number = 'hello';
                ~~~~~
     3|   return thing + ' world';
    `.trimTemplate());
  expect(result.unwrapErr()[1].message).toBe(`
    TypeError: TS2322 Type 'string' is not assignable to type 'number'.
    `.trimTemplate());
  expect(result.unwrapErr()[1].stack).toBe(`
    at MyDSLFunction(3:3)
    `.trimTemplate())
  expect(result.unwrapErr()[1].location).toMatchObject({
    line: 3,
    column: 3,
  });
  expect(result.unwrapErr()[1].sourceContext).toBe(`
     2|   const other: number = 'hello';
    >3|   return thing + ' world';
          ~~~~~~~~~~~~~~~~~~~~~~~~
     4| }
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

test('Aerie command expansion throw Regression Test', async () => {
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
      stack: 'at BakeBananaBreadExpansionLogic(6:4)',
      sourceContext: ' 5|   context: Context\n' +
        '>6| ): ExpansionReturn {\n' +
        '       ~~~~~~~~~~~~~~~\n' +
        ' 7|   return [',
      location: { line: 6, column: 4 }
    }),
    expect.objectContaining({
      message: "TypeError: TS2339 Property 'temperature' does not exist on type 'ParameterTest'.",
      stack: 'at BakeBananaBreadExpansionLogic(8:41)',
      sourceContext:
        ' 7|   return [\n' +
        '>8|     PREHEAT_OVEN(props.activityInstance.temperature),\n' +
        '                                            ~~~~~~~~~~~\n' +
        ' 9|     PREPARE_LOAF(props.activityInstance.tbSugar, props.activityInstance.glutenFree),',
      location: { line: 8, column: 41 }
    }),
    expect.objectContaining({
      message: "TypeError: TS2339 Property 'tbSugar' does not exist on type 'ParameterTest'.",
      stack: 'at BakeBananaBreadExpansionLogic(9:41)',
      sourceContext:
        ' 8|     PREHEAT_OVEN(props.activityInstance.temperature),\n' +
        '>9|     PREPARE_LOAF(props.activityInstance.tbSugar, props.activityInstance.glutenFree),\n' +
        '                                            ~~~~~~~\n' +
        ' 10|     BAKE_BREAD,',
      location: { line: 9, column: 41 }
    }),
    expect.objectContaining({
      message: "TypeError: TS2339 Property 'glutenFree' does not exist on type 'ParameterTest'.",
      stack: 'at BakeBananaBreadExpansionLogic(9:73)',
      sourceContext:
        ' 8|     PREHEAT_OVEN(props.activityInstance.temperature),\n' +
        '>9|     PREPARE_LOAF(props.activityInstance.tbSugar, props.activityInstance.glutenFree),\n' +
        '                                                                            ~~~~~~~~~~\n' +
        ' 10|     BAKE_BREAD,',
      location: { line: 9, column: 73 }
    }),
  ]));
});

test('Aerie Scheduler test', async () => {
  const userCode = `
  export default function myGoal() {
    return myHelper(ActivityTemplates.PeelBanana({
      peelDirection: 'fromStem',
      fancy: { subfield1: 'value1', subfield2: [{ subsubfield1: 1.0, } ], },
      duration: 60 * 60 * 1000 * 1000,
    }))
  }
  function myHelper(activityTemplate) {
    return Goal.ActivityRecurrenceGoal({
      activityTemplate,
      interval: 60 * 60 * 1000 * 1000 // 1 hour in microseconds
    })
  }
  `.trimTemplate();

  const runner = new UserCodeRunner();
  const [schedulerAst, schedulerEdsl, modelSpecific] = await Promise.all([
    fs.promises.readFile(new URL('./inputs/scheduler-ast.ts', import.meta.url).pathname, 'utf8'),
    fs.promises.readFile(new URL('./inputs/scheduler-edsl-fluent-api.ts', import.meta.url).pathname, 'utf8'),
    fs.promises.readFile(new URL('./inputs/dsl-model-specific.ts', import.meta.url).pathname, 'utf8'),
  ]);

  const context = vm.createContext({
  });
  const result = await runner.executeUserCode(
    userCode,
    [],
    'Goal',
    [],
    undefined,
    [
      ts.createSourceFile('scheduler-ast.ts', schedulerAst, ts.ScriptTarget.ESNext),
      ts.createSourceFile('scheduler-edsl-fluent-api.ts', schedulerEdsl, ts.ScriptTarget.ESNext),
      ts.createSourceFile('model-specific.ts', modelSpecific, ts.ScriptTarget.ESNext),
    ],
    context,
  );

  expect(result.unwrap()).toMatchObject({
    goalSpecifier: {
      activityTemplate: {
        activityType: 'PeelBanana',
        args: {
          peelDirection: 'fromStem',
        }
      },
      interval: 60 * 60 * 1000 * 1000,
      kind: 'ActivityRecurrenceGoal',
    }
  });
});

test('Aerie Scheduler TS2345 regression test', async () => {
  const userCode = `
  export default function myGoal() {
    return myHelper(ActivityTemplates.PeelBanana({ peelDirection: 'fromStem' }))
  }
  function myHelper(activityTemplate) {
    return Goal.ActivityRecurrenceGoal({
      activityTemplate,
      interval: 60 * 60 * 1000 * 1000 // 1 hour in microseconds
    })
  }
  `.trimTemplate();

  const runner = new UserCodeRunner();
  const [schedulerAst, schedulerEdsl, modelSpecific] = await Promise.all([
    fs.promises.readFile(new URL('./inputs/scheduler-ast.ts', import.meta.url).pathname, 'utf8'),
    fs.promises.readFile(new URL('./inputs/scheduler-edsl-fluent-api.ts', import.meta.url).pathname, 'utf8'),
    fs.promises.readFile(new URL('./inputs/dsl-model-specific--2345.ts', import.meta.url).pathname, 'utf8'),
  ]);

  const context = vm.createContext({
  });
  const result = await runner.executeUserCode(
    userCode,
    [],
    'Goal',
    [],
    undefined,
    [
      ts.createSourceFile('scheduler-ast.ts', schedulerAst, ts.ScriptTarget.ESNext),
      ts.createSourceFile('scheduler-edsl-fluent-api.ts', schedulerEdsl, ts.ScriptTarget.ESNext),
      ts.createSourceFile('model-specific.ts', modelSpecific, ts.ScriptTarget.ESNext),
    ],
    context,
  );

  expect(result.isErr()).toBeTruthy();
  expect(result.unwrapErr().length).toBe(1);
  expect(result.unwrapErr()[0].message).toBe(`
    TypeError: TS2345 Argument of type '{ peelDirection: "fromStem"; }' is not assignable to parameter of type '{ duration: number; fancy: { subfield1: string; subfield2: { subsubfield1: number; }[]; }; peelDirection: "fromTip" | "fromStem"; }'.
      Type '{ peelDirection: "fromStem"; }' is missing the following properties from type '{ duration: number; fancy: { subfield1: string; subfield2: { subsubfield1: number; }[]; }; peelDirection: "fromTip" | "fromStem"; }': duration, fancy
    `.trimTemplate());
  expect(result.unwrapErr()[0].stack).toBe(`
    at myGoal(2:48)
    `.trimTemplate())
  expect(result.unwrapErr()[0].location).toMatchObject({
    line: 2,
    column: 48,
  });
  expect(result.unwrapErr()[0].sourceContext).toBe(`
     1| export default function myGoal() {
    >2|   return myHelper(ActivityTemplates.PeelBanana({ peelDirection: 'fromStem' }))
                                                       ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
     3| }
    `.trimTemplate());
});

test("Aerie Scheduler wrong return type no annotation regression test", async () => {
  const userCode = `
  export default function myGoal() {
    return 5
  }
  `.trimTemplate();

  const runner = new UserCodeRunner();
  const [schedulerAst, schedulerEdsl, modelSpecific] = await Promise.all([
    fs.promises.readFile(new URL('./inputs/scheduler-ast.ts', import.meta.url).pathname, 'utf8'),
    fs.promises.readFile(new URL('./inputs/scheduler-edsl-fluent-api.ts', import.meta.url).pathname, 'utf8'),
    fs.promises.readFile(new URL('./inputs/dsl-model-specific.ts', import.meta.url).pathname, 'utf8'),
  ]);

  const context = vm.createContext({
  });
  const result = await runner.executeUserCode(
    userCode,
    [],
    'Goal',
    [],
    undefined,
    [
      ts.createSourceFile('scheduler-ast.ts', schedulerAst, ts.ScriptTarget.ESNext),
      ts.createSourceFile('scheduler-edsl-fluent-api.ts', schedulerEdsl, ts.ScriptTarget.ESNext),
      ts.createSourceFile('model-specific.ts', modelSpecific, ts.ScriptTarget.ESNext),
    ],
    context,
  );

  expect(result.isErr()).toBeTruthy();
  expect(result.unwrapErr().length).toBe(1);
  expect(result.unwrapErr()[0].message).toBe(`
    TypeError: TS2322 Incorrect return type. Expected: 'Goal', Actual: 'number'.
    `.trimTemplate());
  expect(result.unwrapErr()[0].stack).toBe(`
    at myGoal(2:3)
    `.trimTemplate())
  expect(result.unwrapErr()[0].location).toMatchObject({
    line: 2,
    column: 3,
  });
  expect(result.unwrapErr()[0].sourceContext).toBe(`
     1| export default function myGoal() {
    >2|   return 5
          ~~~~~~~~
     3| }
    `.trimTemplate());
});

test('Aerie command expansion invalid count regression test', async () => {
  const userCode = `
    export default function SingleCommandExpansion(): ExpansionReturn {
      return DDM_CLOSE_OPEN_SELECT_DP;
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

  expect(result.isErr()).toBeTruthy();
  expect(result.unwrapErr().length).toBe(3);
  expect(result.unwrapErr()[0].message).toBe(`
    TypeError: TS2322 Incorrect return type. Expected: 'Command[] | Command | null', Actual: 'ExpansionReturn'.
    `.trimTemplate());
  expect(result.unwrapErr()[0].stack).toBe(`
    at SingleCommandExpansion(1:51)
    `.trimTemplate())
  expect(result.unwrapErr()[0].location).toMatchObject({
    line: 1,
    column: 51,
  });
  expect(result.unwrapErr()[0].sourceContext).toBe(`
    >1| export default function SingleCommandExpansion(): ExpansionReturn {
                                                          ~~~~~~~~~~~~~~~
     2|   return DDM_CLOSE_OPEN_SELECT_DP;
    `.trimTemplate());
  expect(result.unwrapErr()[1].message).toBe(`
    TypeError: TS2554 Incorrect argument type. Expected: '[{ activity: ActivityType }]', Actual: '[]'.
    `.trimTemplate());
  expect(result.unwrapErr()[1].stack).toBe(`
    at SingleCommandExpansion(1:1)
    `.trimTemplate())
  expect(result.unwrapErr()[1].location).toMatchObject({
    line: 1,
    column: 1,
  });
  expect(result.unwrapErr()[1].sourceContext).toBe(`
    >1| export default function SingleCommandExpansion(): ExpansionReturn {
        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
     2|   return DDM_CLOSE_OPEN_SELECT_DP;
    `.trimTemplate());
  expect(result.unwrapErr()[2].message).toBe(`
    TypeError: TS2304 Cannot find name 'DDM_CLOSE_OPEN_SELECT_DP'.
    `.trimTemplate());
  expect(result.unwrapErr()[2].stack).toBe(`
    at SingleCommandExpansion(2:10)
    `.trimTemplate())
  expect(result.unwrapErr()[2].location).toMatchObject({
    line: 2,
    column: 10,
  });
  expect(result.unwrapErr()[2].sourceContext).toBe(`
     1| export default function SingleCommandExpansion(): ExpansionReturn {
    >2|   return DDM_CLOSE_OPEN_SELECT_DP;
                 ~~~~~~~~~~~~~~~~~~~~~~~~
     3| }
    `.trimTemplate());
});