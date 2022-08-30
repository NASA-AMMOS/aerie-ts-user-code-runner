import { Option, Result, SerializedOptionType, SerializedResultType } from '../src/utils/monads';

describe('Result', () => {
	it('should be serializable and deserializable', () => {
		const result = Result.Ok(true);
		const serializedResult = result.toJSON();
		expect(serializedResult).toEqual({
			$$type: SerializedResultType.Ok,
			$$value: true,
		});
		expect(Result.fromJSON(serializedResult)).toEqual(result);
	});
});

describe('Option', () => {
	it('should be serializable and deserializable', () => {
		const option = Option.Some(true);
		const serializedOption = option.toJSON();
		expect(serializedOption).toEqual({
			$$type: SerializedOptionType.Some,
			$$value: true,
		});
		expect(Option.fromJSON(serializedOption)).toEqual(option);
	});
});
