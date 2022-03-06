import {dedent, indent, installStringUtils, trimTemplate} from "./stringUtils";

describe('indent', () => {
  it('should indent a string', () => {
    expect(indent('foo', 2, ' ')).toBe('  foo');
  });
  it('should indent a string with a tab', () => {
    expect(indent('foo', 1, '\t')).toBe('\tfoo');
  });

});

describe('dedent', () => {
  it('should dedent a string', () => {
    expect(dedent('  foo', 2, ' ')).toBe('foo');
  });
  it('should dedent a string with a tab', () => {
    expect(dedent('\tfoo', 1, '\t')).toBe('foo');
  });

});


describe('trimTemplate', () => {
  it('should trim a template string', () => {
    expect(trimTemplate('\n\tfoo\n\t')).toBe('foo');
    expect(trimTemplate('\n\tfoo\n\tbar\n\t')).toBe('foo\nbar');
  });
});


describe('installStringUtils', () => {
  beforeEach(() => {
    installStringUtils();
  });

  it('should make indent available on the prototype', () => {
    expect(String.prototype.indent).toBeDefined();
    expect('foo'.indent()).toBe('  foo');
  });

  it('should make dedent available on the prototype', () => {
    expect(String.prototype.dedent).toBeDefined();
    expect('  foo'.dedent()).toBe('foo');
  });

  it('should make trimTemplate available on the prototype', () => {
    expect(String.prototype.trimTemplate).toBeDefined();
    expect('\n\tfoo\n\t'.trimTemplate()).toBe('foo');
  });
});
