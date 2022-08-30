// @ts-ignore
import './inputs/polyfills';
import {UserCodeRunner} from "../src/UserCodeRunner";
import {installStringUtils} from "../src/utils/stringUtils";
installStringUtils();

import ts from 'typescript';
import * as vm from "vm";
import * as fs from "fs";

describe('behavior', () => {
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
  });

  it('should produce runtime errors from additional files', async () => {
    const userCode = `
      export default function MyDSLFunction(thing: string): string {
        throwingLibraryFunction();
        return thing + ' world';
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
        ts.createSourceFile('globals.ts', `
        declare global {
          function throwingLibraryFunction(): void;
        }
        export function throwingLibraryFunction(): void {
          throw new Error("Error in library code")
        }
        
        Object.assign(globalThis, { throwingLibraryFunction });
        `.trimTemplate(), ts.ScriptTarget.ESNext, true),
      ],
    );

    expect(result.isErr()).toBeTruthy();
    expect(result.unwrapErr().length).toBe(1);
    expect(result.unwrapErr()[0].message).toBe(`
      Error: Error in library code
      `.trimTemplate());
    expect(result.unwrapErr()[0].stack).toBe(`
      at MyDSLFunction(2:2)
      `.trimTemplate())
    expect(result.unwrapErr()[0].location).toMatchObject({
      line: 2,
      column: 2,
    });
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
    TypeError: TS1192 No default export. Expected a default export function with the signature: "(...args: [string]) => string".
    `.trimTemplate());
    expect(result.unwrapErr()[0].stack).toBe(`
    at (1:1)
    `.trimTemplate())
    expect(result.unwrapErr()[0].location).toMatchObject({
      line: 1,
      column: 1,
    });
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
    TypeError: TS2306 No default export. Expected a default export function with the signature: "(...args: [string]) => string".
    `.trimTemplate());
    expect(result.unwrapErr()[0].stack).toBe(`
    at (1:1)
    `.trimTemplate())
    expect(result.unwrapErr()[0].location).toMatchObject({
      line: 1,
      column: 1,
    });
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
    TypeError: TS2349 Default export is not a valid function. Expected a default export function with the signature: "(...args: [string]) => string".
    `.trimTemplate());
    expect(result.unwrapErr()[0].stack).toBe(`
    at (2:1)
    `.trimTemplate())
    expect(result.unwrapErr()[0].location).toMatchObject({
      line: 2,
      column: 1,
    });
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

  it('should handle unnamed arrow function default exports', async () => {
    const userCode = `
    type ExpansionProps = { activity: ActivityType };

    export default (props: ExpansionProps): ExpansionReturn => {
        const { activity } = props;
        const { biteSize } = activity.attributes.arguments;
    
        return [
            AVS_DMP_ADC_SNAPSHOT(biteSize)
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
    at (3:1)
    `.trimTemplate())
    expect(result.unwrapErr()[0].location).toMatchObject({
      line: 3,
      column: 1,
    });
  });

  it('should handle exported variable that references an arrow function', async () => {
    const userCode = `
    type ExpansionProps = { activity: ActivityType };

    const myExpansion = (props: ExpansionProps): ExpansionReturn => {
        const { activity } = props;
        const { biteSize } = activity.attributes.arguments;
    
        return [
            AVS_DMP_ADC_SNAPSHOT(biteSize)
        ];
    };
    export default myExpansion;
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
    at (11:1)
    `.trimTemplate())
    expect(result.unwrapErr()[0].location).toMatchObject({
      line: 11,
      column: 1,
    });
  });

  it('should handle exported variable that references a function', async () => {
    const userCode = `
    type ExpansionProps = { activity: ActivityType };

    const myExpansion =  function(props: ExpansionProps): ExpansionReturn {
        const { activity } = props;
        const { biteSize } = activity.attributes.arguments;
    
        return [
            AVS_DMP_ADC_SNAPSHOT(biteSize)
        ];
    };
    export default myExpansion;
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
    at (11:1)
    `.trimTemplate())
    expect(result.unwrapErr()[0].location).toMatchObject({
      line: 11,
      column: 1,
    });
  });

  it('should handle unnamed arrow function default exports assignment', async () => {
    const userCode = `
    type ExpansionProps = { activity: ActivityType };

    const myExpansion = (props: ExpansionProps) => {
        const { activity } = props;
        const { primitiveLong } = activity.attributes.arguments;
    
        if (true) {
          return undefined;
        }
    
        return [
            PREHEAT_OVEN(primitiveLong)
        ];
    };
    export default myExpansion;
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
      [{ activity: { attributes: { arguments: { primitiveLong: 1 } } } }],
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

    expect(result.isOk()).toBeTruthy();
  });

  it('should handle throws in user code but outside default function execution path', async () => {
    const userCode = `
    export default function MyDSLFunction(thing: string): string {
      return thing + ' world';
    }
    
    throw new Error('This is a test error');
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
    at null(5:6)
    `.trimTemplate())
    expect(result.unwrapErr()[0].location).toMatchObject({
      line: 5,
      column: 6,
    });
  });

  it('should handle throws in library code outside default function execution path with an explicit error', async () => {
    const userCode = `
    export default function MyDSLFunction(thing: string): string {
      return thing + ' world';
    }
    `.trimTemplate();

    const runner = new UserCodeRunner();

    try {
      await runner.executeUserCode(
        userCode,
        ['hello'],
        'string',
        ['string'],
        1000,
        [
          ts.createSourceFile('additionalFile.ts', `
      export {}
      throw new Error('This is a test error');
      `.trimTemplate(), ts.ScriptTarget.ESNext, true),
        ],
      );
    } catch (err: any) {
      expect(err.message).toBe(`
      Error: Runtime error detected outside of user code execution path. This is most likely a bug in the additional library source.
      Inherited from:
      This is a test error
      `.trimTemplate());
      expect(err.stack).toContain(`
      Error: This is a test error
          at additionalFile:1:7
          at SourceTextModule.evaluate (node:internal/vm/module:224:23)
      `.trimTemplate());
      expect(err.stack).toMatch(/at UserCodeRunner\.executeUserCodeFromArtifacts \(\S+src\/UserCodeRunner\.ts:222:24/);
      expect(err.stack).toMatch(/at Object\.<anonymous> \(\S+test\/UserCodeRunner\.spec\.ts:614:7/);
    }
  });

  it('should allow preprocessing of user code and subsequent execution', async () => {
    const userCode = `
    export default function MyDSLFunction(thing: string): string {
      return thing + ' world';
    }
    `.trimTemplate();

    const runner = new UserCodeRunner();

    const result = await runner.preProcess(
      userCode,
      'string',
      ['string'],
    );

    expect(result.isOk()).toBeTruthy();

    const result2 = await runner.executeUserCodeFromArtifacts(
      result.unwrap().jsFileMap,
      result.unwrap().userCodeSourceMap,
      ['hello'],
    );

    expect(result2.isOk()).toBeTruthy();
    expect(result2.unwrap()).toBe('hello world');
  });
});

describe('regression tests', () => {
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
      [{ activity: null }],
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
      [{ activityInstance: null }, {}],
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

    expect(result.isErr()).toBeTruthy();
    expect(result.unwrapErr().length).toBe(4);
    expect(result.unwrapErr()[0].message).toBe(`
    TypeError: TS2322 Incorrect return type. Expected: 'Command[] | Command | null', Actual: 'ExpansionReturn'.
    `.trimTemplate());
    expect(result.unwrapErr()[0].stack).toBe(`
    at BakeBananaBreadExpansionLogic(6:4)
    `.trimTemplate())
    expect(result.unwrapErr()[0].location).toMatchObject({
      line: 6,
      column: 4,
    });
    expect(result.unwrapErr()[1].message).toBe(`
    TypeError: TS2339 Property 'temperature' does not exist on type 'ParameterTest'.
    `.trimTemplate());
    expect(result.unwrapErr()[1].stack).toBe(`
    at BakeBananaBreadExpansionLogic(8:41)
    `.trimTemplate())
    expect(result.unwrapErr()[1].location).toMatchObject({
      line: 8,
      column: 41,
    });
    expect(result.unwrapErr()[2].message).toBe(`
    TypeError: TS2339 Property 'tbSugar' does not exist on type 'ParameterTest'.
    `.trimTemplate());
    expect(result.unwrapErr()[2].stack).toBe(`
    at BakeBananaBreadExpansionLogic(9:41)
    `.trimTemplate())
    expect(result.unwrapErr()[2].location).toMatchObject({
      line: 9,
      column: 41,
    });
    expect(result.unwrapErr()[3].message).toBe(`
    TypeError: TS2339 Property 'glutenFree' does not exist on type 'ParameterTest'.
    `.trimTemplate());
    expect(result.unwrapErr()[3].stack).toBe(`
    at BakeBananaBreadExpansionLogic(9:73)
    `.trimTemplate())
    expect(result.unwrapErr()[3].location).toMatchObject({
      line: 9,
      column: 73,
    });
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
      fs.promises.readFile(new URL('./inputs/mission-model-generated-code.ts', import.meta.url).pathname, 'utf8'),
    ]);

    const context = vm.createContext({});
    const result = await runner.executeUserCode(
      userCode,
      [],
      'Goal',
      [],
      undefined,
      [
        ts.createSourceFile('scheduler-ast.ts', schedulerAst, ts.ScriptTarget.ESNext),
        ts.createSourceFile('scheduler-edsl-fluent-api.ts', schedulerEdsl, ts.ScriptTarget.ESNext),
        ts.createSourceFile('mission-model-generated-code.ts', modelSpecific, ts.ScriptTarget.ESNext),
      ],
      context,
    );

    expect(result.unwrap()).toMatchObject({
      __astNode: {
        activityTemplate: {
          activityType: 'PeelBanana',
          args: {
            peelDirection: 'fromStem',
            duration: 60 * 60 * 1000 * 1000,
            fancy: {
              subfield1: 'value1',
              subfield2: [{
                subsubfield1: 1,
              }]
            }
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

    const context = vm.createContext({});
    const result = await runner.executeUserCode(
      userCode,
      [],
      'Goal',
      [],
      undefined,
      [
        ts.createSourceFile('scheduler-ast.ts', schedulerAst, ts.ScriptTarget.ESNext),
        ts.createSourceFile('scheduler-edsl-fluent-api.ts', schedulerEdsl, ts.ScriptTarget.ESNext),
        ts.createSourceFile('mission-model-generated-code.ts', modelSpecific, ts.ScriptTarget.ESNext),
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
  });

  test("Aerie Scheduler wrong return type no annotation regression test", async () => {
    const userCode = `
  export default function myGoal<T>() {
    return 5
  }
  `.trimTemplate();

    const runner = new UserCodeRunner();
    const [schedulerAst, schedulerEdsl, modelSpecific] = await Promise.all([
      fs.promises.readFile(new URL('./inputs/scheduler-ast.ts', import.meta.url).pathname, 'utf8'),
      fs.promises.readFile(new URL('./inputs/scheduler-edsl-fluent-api.ts', import.meta.url).pathname, 'utf8'),
      fs.promises.readFile(new URL('./inputs/mission-model-generated-code.ts', import.meta.url).pathname, 'utf8'),
    ]);

    const context = vm.createContext({});
    const result = await runner.executeUserCode(
      userCode,
      [],
      'Goal',
      [],
      undefined,
      [
        ts.createSourceFile('scheduler-ast.ts', schedulerAst, ts.ScriptTarget.ESNext),
        ts.createSourceFile('scheduler-edsl-fluent-api.ts', schedulerEdsl, ts.ScriptTarget.ESNext),
        ts.createSourceFile('mission-model-generated-code.ts', modelSpecific, ts.ScriptTarget.ESNext),
      ],
      context,
    );

    expect(result.isErr()).toBeTruthy();
    expect(result.unwrapErr().length).toBe(1);
    expect(result.unwrapErr()[0].message).toBe(`
    TypeError: TS2322 Incorrect return type. Expected: 'Goal', Actual: 'number'.
    `.trimTemplate());
    expect(result.unwrapErr()[0].stack).toBe(`
    at myGoal(1:1)
    `.trimTemplate())
    expect(result.unwrapErr()[0].location).toMatchObject({
      line: 1,
      column: 1,
    });
  });

  test("literal type regression test", async () => {
    const userCode = `
  export default function myGoal() {
    return 5
  }
  `.trimTemplate();

    const runner = new UserCodeRunner();
    const [schedulerAst, schedulerEdsl, modelSpecific] = await Promise.all([
      fs.promises.readFile(new URL('./inputs/scheduler-ast.ts', import.meta.url).pathname, 'utf8'),
      fs.promises.readFile(new URL('./inputs/scheduler-edsl-fluent-api.ts', import.meta.url).pathname, 'utf8'),
      fs.promises.readFile(new URL('./inputs/mission-model-generated-code.ts', import.meta.url).pathname, 'utf8'),
    ]);

    const context = vm.createContext({});
    const result = await runner.executeUserCode(
      userCode,
      [],
      'number',
      [],
      undefined,
      [
        ts.createSourceFile('scheduler-ast.ts', schedulerAst, ts.ScriptTarget.ESNext),
        ts.createSourceFile('scheduler-edsl-fluent-api.ts', schedulerEdsl, ts.ScriptTarget.ESNext),
        ts.createSourceFile('mission-model-generated-code.ts', modelSpecific, ts.ScriptTarget.ESNext),
      ],
      context,
    );

    expect(result.isOk()).toBeTruthy();
  });

  test("branching return regression test", async () => {
    const userCode = `
  export default function myGoal() {
    if (true) {
      return '4'
    }
    return 5
  }
  `.trimTemplate();

    const runner = new UserCodeRunner();
    const [schedulerAst, schedulerEdsl, modelSpecific] = await Promise.all([
      fs.promises.readFile(new URL('./inputs/scheduler-ast.ts', import.meta.url).pathname, 'utf8'),
      fs.promises.readFile(new URL('./inputs/scheduler-edsl-fluent-api.ts', import.meta.url).pathname, 'utf8'),
      fs.promises.readFile(new URL('./inputs/mission-model-generated-code.ts', import.meta.url).pathname, 'utf8'),
    ]);

    const context = vm.createContext({});
    const result = await runner.executeUserCode(
      userCode,
      [],
      'string',
      [],
      undefined,
      [
        ts.createSourceFile('scheduler-ast.ts', schedulerAst, ts.ScriptTarget.ESNext),
        ts.createSourceFile('scheduler-edsl-fluent-api.ts', schedulerEdsl, ts.ScriptTarget.ESNext),
        ts.createSourceFile('mission-model-generated-code.ts', modelSpecific, ts.ScriptTarget.ESNext),
      ],
      context,
    );

    expect(result.isErr()).toBeTruthy();
    expect(result.unwrapErr().length).toBe(1);
    expect(result.unwrapErr()[0].message).toBe(`
    TypeError: TS2322 Incorrect return type. Expected: 'string', Actual: '5 | "4"'.
    `.trimTemplate());
    expect(result.unwrapErr()[0].stack).toBe(`
    at myGoal(1:1)
    `.trimTemplate())
    expect(result.unwrapErr()[0].location).toMatchObject({
      line: 1,
      column: 1,
    });
  });

  test("literal return regression test", async () => {
    const userCode = `
  export default function myGoal() {
    return 5
  }
  `.trimTemplate();

    const runner = new UserCodeRunner();
    const [schedulerAst, schedulerEdsl, modelSpecific] = await Promise.all([
      fs.promises.readFile(new URL('./inputs/scheduler-ast.ts', import.meta.url).pathname, 'utf8'),
      fs.promises.readFile(new URL('./inputs/scheduler-edsl-fluent-api.ts', import.meta.url).pathname, 'utf8'),
      fs.promises.readFile(new URL('./inputs/mission-model-generated-code.ts', import.meta.url).pathname, 'utf8'),
    ]);

    const context = vm.createContext({});
    const result = await runner.executeUserCode(
      userCode,
      [],
      '4',
      [],
      undefined,
      [
        ts.createSourceFile('scheduler-ast.ts', schedulerAst, ts.ScriptTarget.ESNext),
        ts.createSourceFile('scheduler-edsl-fluent-api.ts', schedulerEdsl, ts.ScriptTarget.ESNext),
        ts.createSourceFile('mission-model-generated-code.ts', modelSpecific, ts.ScriptTarget.ESNext),
      ],
      context,
    );

    expect(result.isErr()).toBeTruthy();
    expect(result.unwrapErr().length).toBe(1);
    expect(result.unwrapErr()[0].message).toBe(`
    TypeError: TS2322 Incorrect return type. Expected: '4', Actual: 'number'.
    `.trimTemplate());
    expect(result.unwrapErr()[0].stack).toBe(`
    at myGoal(1:1)
    `.trimTemplate())
    expect(result.unwrapErr()[0].location).toMatchObject({
      line: 1,
      column: 1,
    });
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
      [{ activity: null }],
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
  });

  test('Aerie scheduler unmapped harness error on missing property return type', async () => {
    const userCode = `
    interface FakeGoal {
      and(...others: FakeGoal[]): FakeGoal;
      or(...others: FakeGoal[]): FakeGoal;
    }
    export default function() {
      const myFakeGoal: FakeGoal = {
        and: (...others: FakeGoal[]) => {
          return myFakeGoal;
        },
        or: (...others: FakeGoal[]) => {
          return myFakeGoal;
        },
      };
      return myFakeGoal;
    }
    `.trimTemplate()

    const runner = new UserCodeRunner();
    const [schedulerAst, schedulerEdsl, modelSpecific] = await Promise.all([
      fs.promises.readFile(new URL('./inputs/scheduler-ast.ts', import.meta.url).pathname, 'utf8'),
      fs.promises.readFile(new URL('./inputs/scheduler-edsl-fluent-api.ts', import.meta.url).pathname, 'utf8'),
      fs.promises.readFile(new URL('./inputs/mission-model-generated-code.ts', import.meta.url).pathname, 'utf8'),
    ]);

    const context = vm.createContext({});
    const result = await runner.executeUserCode(
      userCode,
      [],
      'Goal',
      [],
      undefined,
      [
        ts.createSourceFile('scheduler-ast.ts', schedulerAst, ts.ScriptTarget.ESNext),
        ts.createSourceFile('scheduler-edsl-fluent-api.ts', schedulerEdsl, ts.ScriptTarget.ESNext),
        ts.createSourceFile('mission-model-generated-code.ts', modelSpecific, ts.ScriptTarget.ESNext),
      ],
      context,
    );

    expect(result.isErr()).toBeTruthy();
    expect(result.unwrapErr().length).toBe(1);
    expect(result.unwrapErr()[0].message).toBe(`TypeError: TS2741 Incorrect return type. Expected: 'Goal', Actual: 'FakeGoal'.`);
    expect(result.unwrapErr()[0].stack).toBe(`
    at (5:1)
    `.trimTemplate())
    expect(result.unwrapErr()[0].location).toMatchObject({
      line: 5,
      column: 1,
    });
  });

  test('Aerie incorrect stack frame assumption regression test', async () => {
    const userCode = `
      export default () => {
        return Real.Resource("state of charge").lessThan(0.3).split(0)
      }
      `.trimTemplate()

    const runner = new UserCodeRunner();
    const [constraintsAst, constraintsEdsl, modelSpecific] = await Promise.all([
      fs.promises.readFile(new URL('./inputs/missing-location/constraints-ast.ts', import.meta.url).pathname, 'utf8'),
      fs.promises.readFile(new URL('./inputs/missing-location/constraints-edsl-fluent-api.ts', import.meta.url).pathname, 'utf8'),
      fs.promises.readFile(new URL('./inputs/missing-location/mission-model-generated-code.ts', import.meta.url).pathname, 'utf8'),
    ]);

    const result = await runner.executeUserCode(
      userCode,
      [],
      'Constraint',
      [],
      undefined,
      [
        ts.createSourceFile('constraints-ast.ts', constraintsAst, ts.ScriptTarget.ESNext),
        ts.createSourceFile('constraints-edsl-fluent-api.ts', constraintsEdsl, ts.ScriptTarget.ESNext),
        ts.createSourceFile('mission-model-generated-code.ts', modelSpecific, ts.ScriptTarget.ESNext),
      ],
    );

    expect(result.isErr()).toBeTruthy();
    expect(result.unwrapErr().length).toBe(1);
    expect(result.unwrapErr()[0].message).toBe(`Error: .split numberOfSubWindows cannot be less than 1, but was: 0`);
    expect(result.unwrapErr()[0].stack).toBe(`
      at default(2:56)
      `.trimTemplate())
    expect(result.unwrapErr()[0].location).toMatchObject({
      line: 2,
      column: 56,
    });
  });

  test('Unterminated string literal regression', async () => {
    const userCode =
      `export default () =>
      Sequence.new({
        seqId: 'seq0',
        metadata: {},
        commands: [
          A('2020-001T00:00:00').ECHO("BDS_DIAG_SVC_CMD_CHANGE_MODE),
        ],
      });`.trimTemplate();

    const runner = new UserCodeRunner();
    const [commandTypes, temporalPolyfill] = await Promise.all([
      fs.promises.readFile(new URL('./inputs/command-types.ts', import.meta.url).pathname, 'utf8'),
      fs.promises.readFile(new URL('./inputs/TemporalPolyfillTypes.ts', import.meta.url).pathname, 'utf8'),
    ]);

    const result = await runner.executeUserCode(
      userCode,
      [],
      'Sequence',
      [],
      1000,
      [
        ts.createSourceFile('command-types.ts', commandTypes, ts.ScriptTarget.ESNext),
        ts.createSourceFile('TemporalPolyfillTypes.ts', temporalPolyfill, ts.ScriptTarget.ESNext),
      ],
      vm.createContext({
        Temporal,
      }),
    );

    expect(result.isErr()).toBeTruthy();
    expect(result.unwrapErr().length).toBe(2);
    expect(result.unwrapErr()[0].message).toBe(`TypeError: TS1002 Unterminated string literal.`);
    expect(result.unwrapErr()[0].stack).toBe(`
    at (6:70)
    `.trimTemplate())
    expect(result.unwrapErr()[0].location).toMatchObject({
      line: 6,
      column: 70,
    });
    expect(result.unwrapErr()[1].message).toBe(`TypeError: TS1005 ',' expected.`);
    expect(result.unwrapErr()[1].stack).toBe(`
    at (7:9)
    `.trimTemplate())
    expect(result.unwrapErr()[1].location).toMatchObject({
      line: 7,
      column: 9,
    });
  });
});
