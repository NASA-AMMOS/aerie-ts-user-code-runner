import {executeDSL} from "./DSLRunner.js";
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

  const DSLCode = `
    declare global {
      type DSLReturnType = string;
      type DSLArgsType = [string];
    }
    `.trimTemplate();


  const result = await executeDSL(
    userCode,
    `userCode`,
    DSLCode,
    ['hello'],
    'DSLReturnType',
    'DSLArgsType',
  );

  expect(result.isErr()).toBeTruthy();
  expect(result.unwrapErr()[0].message).toBe(`
    Error: This is a test error
      at subroutine(7:8)
      at MyDSLFunction(2:2)
    `.trimTemplate());
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


  const DSLCode = `
    declare global {
      type DSLReturnType = number;
      type DSLArgsType = [string];
    }
    `.trimTemplate();


  const result = await executeDSL(
    userCode,
    `userCode`,
    DSLCode,
    ['hello'],
    'DSLReturnType',
    'DSLArgsType',
  );

  expect(result.isErr()).toBeTruthy();
  expect(result.unwrapErr()[0].message).toBe('Incorrect return type. Expected: \'number\', Actual: \'string\'.');
  expect(result.unwrapErr()[0].sourceContext).toBe(`
    >1| export default function MyDSLFunction(thing: string): string {
                                                              ^^^^^^
     2|   subroutine();
    `.trimTemplate());
});

it('should produce input type errors', async () => {
  const userCode = `
    export default function MyDSLFunction(thing: string, other: thing): string {
      subroutine();
      return thing + ' world';
    }
    
    function subroutine() {
      throw new Error('This is a test error');
    }
    
    `.trimTemplate();


  const DSLCode = `
    declare global {
      type DSLReturnType = number;
      type DSLArgsType = [[string]];
    }
    `.trimTemplate();


  const result = await executeDSL(
    userCode,
    `userCode`,
    DSLCode,
    ['hello'],
    'DSLReturnType',
    'DSLArgsType',
  );

  expect(result.isErr()).toBeTruthy();
  expect(result.unwrapErr()[0].message).toBe('Incorrect return type. Expected: \'number\', Actual: \'string\'.');
  expect(result.unwrapErr()[0].sourceContext).toBe(`
    >1| export default function MyDSLFunction(thing: string, other: thing): string {
                                                                            ^^^^^^
     2|   subroutine();
    `.trimTemplate());
});

it('should return the final value', async () => {
  const userCode = `
    export default function MyDSLFunction(thing: string): string {
      return thing + ' world';
    }
    
    function subroutine() {
      throw new Error('This is a test error');
    }
    `.trimTemplate();

  const DSLCode = `
    declare global {
      type DSLReturnType = string;
      type DSLArgsType = [string];
    }
    `.trimTemplate();


  const result = await executeDSL(
    userCode,
    `userCode`,
    DSLCode,
    ['hello'],
    'DSLReturnType',
    'DSLArgsType',
  );

  expect(result.isOk()).toBeTruthy();
  expect(result.unwrap()).toBe('hello world');
});
