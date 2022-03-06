# Typescript User Code Runner

A simple way to safeluy run user code written in Typescript.

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


## Example
```ts
const userCode = `
  export default function MyDSLFunction(thing: string): string {
    return thing + ' world';
  }
`;

const result = await executeUserCode(
  userCode, // Actual user code
  `userCode`, // Filename for stack traces
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
Incorrect return type. Expected: 'number', Actual: 'string'.
>1| export default function MyDSLFunction(thing: string): string {
                                                          ^^^^^^
 2|   subroutine();
```

```
Type 'string' is not assignable to type 'number'.
 1| export default function MyDSLFunction(thing: string): number {
>2|   const other: number = 'hello';
            ^^^^^
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


## API
```ts
async function executeUserCode<ArgsType extends any[], ReturnType = any>(
  userCode: string, // User code as a string
  userCodeFileName: string, // Filename for stack traces
  args: ArgsType, // Input arguments
  outputType: string = 'any', // Return type for typechecking
  argsTypes: string[] = ['any'], // Argument types for typechecking
  context: vm.Context = vm.createContext(), // vm.Context to carry state between user code runs and inject globals
  timeout: number = 5000, // Timeout in milliseconds
): Promise<Result<ReturnType, UserCodeError[]>>
```
