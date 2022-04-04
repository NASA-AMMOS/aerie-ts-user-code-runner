# Typescript User Code Runner

A simple way to safely run user code written in Typescript.

- **Speed** - NodeJS/V8 makes JavaScript fast enough that if you have performance issues, you really should probably
  rethink your architecture and move more processing out of user code.
- **Isolation** - NodeJS exposes the internal VM of V8, which allows us to create new V8 isolates for each user code run.
  This means that bad user code will not crash your system and won't have access to anything you don't explicitly expose.
- **Execution Limits** - V8 isolates enable setting a timeout on the executing code, so users can't hang your system.
- **Simple User API** - User code just needs to export a default function that takes any arguments you want to give it,
  and returns anything you want back from it.
- **Great Error Messaging** - Both type errors and runtime errors are beautifully formatted to show your users exactly
  where the problem they need to address is.
- **No Throw** - executeUserCode never throws. The return uses a Result monad to ensure confidence in dealing with user code errors


## Requirements

NodeJS >= 13.0.0

Because we are transipiling and running the typescript code as modules in a vm, we need to flag on the vm modules flag at runtime with
```node --experimental-vm-modules```

## Example

```ts
import { UserCodeRunner } from './UserCodeRunner';

const userCode = `
  export default function MyDSLFunction(thing: string): string {
    return thing + ' world';
  }
`;

const codeRunner = new UserCodeRunner();

const result = await codeRunner.executeUserCode(
        userCode, // Actual user code
        ['hello'], // Input arguments
        'string', // Return type
        ['string'], // Argument types
);

expect(result.isOk()).toBeTruthy();
expect(result.unwrap()).toBe('hello world');
```

## Error Messages
Error messaging is even more important when dealing with user code as you really need to guide the user to resolve any errors.

### Type Error Examples

```
TypeError: TS2322 Incorrect return type. Expected: 'number', Actual: 'string'.
  at MyDSLFunction(0:54)
>1| export default function MyDSLFunction(thing: string): string {
                                                          ~~~~~~
 2|   subroutine();
```

```
TypeError: TS2554 Incorrect argument type. Expected: '[string]', Actual: '[string, number]'.
  at MyDSLFunction(0:38)
>1| export default function MyDSLFunction(thing: string, other: number): string {
                                          ~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 2|   subroutine();

```

```
TypeError: TS2322 Type 'string' is not assignable to type 'number'.
 1| export default function MyDSLFunction(thing: string): number {
>2|   const other: number = 'hello';
            ~~~~~
 3|   return thing + ' world';
```

### Runtime Error Examples

```
Error: This is a test error
      at subroutine(7:8)
      at MyDSLFunction(2:2)

 6| function subroutine() {
>7|   throw new Error('This is a test error');
 8| }
```

## Usage Examples

## Simple Example
```ts
const userCode = `
  export default function MyDSLFunction(thing: string): string {
    return thing + ' world';
  }
  `.trimTemplate();

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

### Including other files for import, declaring some globals, and specified context
```ts
const userCode = `
  import { importedFunction } from 'other-importable';
  export default function myDSLFunction(thing: string): string {
    return someGlobalFunction(thing) + otherFunction(' world');
  }
  `.trimTemplate();

const codeRunner = new UserCodeRunner();

const result = await codeRunner.executeUserCode(
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
```
