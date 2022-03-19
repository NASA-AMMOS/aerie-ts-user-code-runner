
declare global {
  interface ParameterTest {
    readonly type: 'ParameterTest';
    readonly duration: Temporal.Duration;
    readonly startOffset: Temporal.Duration;
    readonly attributes: {
      readonly arguments: {
        readonly intMap: {
          key: number;
          value: number;
        }[];
        readonly string: string;
        readonly byteMap: {
          key: number;
          value: number;
        }[];
        readonly charMap: {
          key: string;
          value: string;
        }[];
        readonly intList: number[];
        readonly longMap: {
          key: number;
          value: number;
        }[];
        readonly boxedInt: number;
        readonly byteList: number[];
        readonly charList: string[];
        readonly floatMap: {
          key: number;
          value: number;
        }[];
        readonly intArray: number[];
        readonly longList: number[];
        readonly mappyBoi: {
          key: number;
          value: string[];
        }[];
        readonly shortMap: {
          key: number;
          value: number;
        }[];
        readonly testEnum: ('A' | 'B' | 'C');
        readonly boxedByte: number;
        readonly boxedChar: string;
        readonly boxedLong: number;
        readonly byteArray: number[];
        readonly charArray: string[];
        readonly doubleMap: {
          key: number;
          value: number;
        }[];
        readonly floatList: number[];
        readonly longArray: number[];
        readonly obnoxious: {
          key: string[][];
          value: {
            key: number;
            value: number[][];
          }[];
        }[][];
        readonly shortList: number[];
        readonly stringMap: {
          key: string;
          value: string;
        }[];
        readonly booleanMap: {
          key: boolean;
          value: boolean;
        }[];
        readonly boxedFloat: number;
        readonly boxedShort: number;
        readonly doubleList: number[];
        readonly floatArray: number[];
        readonly shortArray: number[];
        readonly stringList: string[];
        readonly booleanList: boolean[];
        readonly boxedDouble: number;
        readonly doubleArray: number[];
        readonly stringArray: string[];
        readonly booleanArray: boolean[];
        readonly boxedBoolean: boolean;
        readonly primIntArray: number[];
        readonly primitiveInt: number;
        readonly testDuration: Temporal.Duration;
        readonly primByteArray: number[];
        readonly primCharArray: string[];
        readonly primLongArray: number[];
        readonly primitiveByte: number;
        readonly primitiveChar: string;
        readonly primitiveLong: number;
        readonly primFloatArray: number[];
        readonly primShortArray: number[];
        readonly primitiveFloat: number;
        readonly primitiveShort: number;
        readonly primDoubleArray: number[];
        readonly primitiveDouble: number;
        readonly primBooleanArray: boolean[];
        readonly primitiveBoolean: boolean;
        readonly intListArrayArray: number[][][];
        readonly doublePrimIntArray: number[][];
      }
      readonly computed: null;
    }
  }
  type ActivityType = ParameterTest;
}

export {};
