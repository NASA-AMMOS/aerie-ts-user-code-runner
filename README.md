# Typescript User Code Runner

A simple way to safely run user code written in Typescript.

- **Speed** - NodeJS/V8 makes JavaScript fast enough that if you have performance issues, you really should probably
  rethink your architecture and move more processing out of user code.
- **Isolation** - NodeJS exposes the internal VM of V8, which allows us to create new V8 isolates for each user code run.
  This means that bad user code will not crash your system and won't have access to anything you don't explicitly expose.
- **Execution Limits** - V8 isolates enable setting a timeout on the executing code, so users can't hang your system.
- **Simple User API** - User code just needs to export a default function that takes any arguments you want to give it,
  and returns anything you want back from it.
- **No Throw** - executeUserCode never throws. The return uses a Result monad to ensure confidence in dealing with user code errors


## Requirements

NodeJS >= 24.0.0

Because this library uses `isolated-vm`, node.js must be started with the `--no-node-snapshot` flag when this module is used:
```
node --no-node-snapshot
```

## Limitations

This library uses the `isolated-vm` library to run user code in a protected sandbox context. This comes with some
important limitations - specifically, only objects which are considered "transferable" may be passed into or out of the
sandbox. As a rule of thumb, anything that can be `JSON.stringify`ed is "transferable". Notably, this does *not* include
functions. If your user code takes *a function* as an input argument, or *returns* anything containing a function, it
will not work with the isolated sandbox.

A few workarounds exist for common use cases:
* If you are passing a function in order to provide a shared code library to users for use in their code - you can instead
  provide it as a Typescript or JS source file in the `additionalFiles` array & expose it to users by adding it as a
  property on the `globalThis` object if needed.
* If you are expecting user code to return non-transferable objects/functions that are **transformable** to transferable
  objects (such as an instance of a class that represents a serializable timestamp), you can provide a `resultSerializer`
  function which will run on the results of user code, *inside* the sandbox, before returning to the caller. This allows
  you to convert all unsafe objects to safe objects before returning them. See example below.


## Error Messages
Error messaging is even more important when dealing with user code as you really need to guide the user to resolve any errors.

### Type Error Examples

```
TypeError: TS2322 Incorrect return type. Expected: 'number', Actual: 'string'.
  at MyDSLFunction(0:54)
```

```
TypeError: TS2554 Incorrect argument type. Expected: '[string]', Actual: '[string, number]'.
  at MyDSLFunction(0:38)

```

```
TypeError: TS2322 Type 'string' is not assignable to type 'number'.
```

### Runtime Error Examples

```
Error: This is a test error
      at subroutine(7:8)
      at MyDSLFunction(2:2)
```

## Usage Examples

## Simple Example
```ts
const userCode = `
  export default function MyDSLFunction(thing: string): string {
    return thing + ' world';
  }
  `;

const codeRunner = new UserCodeRunner();

const result = await codeRunner.executeUserCode(
  userCode,
  ['hello'],
  'string',
  ['string'],
);

expect(result.isOk()).toBeTruthy();
expect(result.unwrap()).toBe('hello world');
```

### Including other files for import, limiting memory of user process
```ts
import ts from "typescript";
const userCode = `
  import { importedFunction } from 'other-importable';
  export default function myDSLFunction(thing: string): string {
    return importedFunction(thing);
  }
  `

const codeRunner = new UserCodeRunner();

const result = await codeRunner.executeUserCode(
  userCode,
  ['hello'],
  'string',
  ['string'],
  1000,
  [
    ts.createSourceFile('other-importable.ts', `
    export function importedFunction(thing: string): string {
      return thing + ' other';
    }
    `, ts.ScriptTarget.ESNext, true)
  ],
  { memoryLimitMb: 128 }
);

// expect(result.isOk()).toBeTruthy();
expect(result.unwrap()).toBe('hello other');
```

## Using a Result Serializer
In this case, the user code returns a function, which cannot be passed back outside the sandbox. Instead we provide a
`resultSerializer` which transforms it to an object which can safely be serialized and passed back.

```ts
const serializer = ts.createSourceFile(
  'result-serializer.ts',
  `
    export default function serializeResult(
      result: { greet(name: string): string },
    ): string {
      return result.greet('world');
    }
  `,
  ts.ScriptTarget.ESNext,
  undefined,
  ts.ScriptKind.TS,
);

const result = await new UserCodeRunner().executeUserCode<[], string>(
  `
    // user code
    export default function() {
      return {
        greet(name: string): string {
          return 'hello ' + name;
        },
      };
    }
  `,
  [],
  '{ greet(name: string): string }',
  [],
  1000,
  [serializer],
  {
    resultSerializer: {
      moduleName: 'result-serializer',
      outputType: 'string',
    },
  },
);

expect(result.unwrap()).toBe('hello world');
```