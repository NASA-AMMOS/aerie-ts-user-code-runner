import {executeUserCode} from "./UserCodeRunner";
import {installStringUtils} from "./utils/stringUtils";
installStringUtils();

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

  const result = await executeUserCode(
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

  const result = await executeUserCode(
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

  const result = await executeUserCode(
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

  const result = await executeUserCode(
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

  const result = await executeUserCode(
    userCode,
    ['hello'],
    'string',
    ['string'],
  );

  expect(result.isOk()).toBeTruthy();
  expect(result.unwrap()).toBe('hello world');
});
