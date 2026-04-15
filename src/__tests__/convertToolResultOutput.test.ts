import {
  skillResultToToolOutput,
  toolResultOutputToString,
} from '../ai/convertToolResultOutput';

describe('skillResultToToolOutput', () => {
  it('maps error to error-text', () => {
    expect(skillResultToToolOutput({ error: 'Network down' })).toEqual({
      type: 'error-text',
      value: 'Network down',
    });
  });

  it('maps image to content with image-data', () => {
    expect(
      skillResultToToolOutput({ image: { base64: 'abc123' } }),
    ).toEqual({
      type: 'content',
      value: [
        { type: 'image-data', data: 'abc123', mediaType: 'image/png' },
      ],
    });
  });

  it('maps string result to text', () => {
    expect(skillResultToToolOutput({ result: 'hello' })).toEqual({
      type: 'text',
      value: 'hello',
    });
  });

  it('falls back to "No result" when nothing is provided', () => {
    expect(skillResultToToolOutput({})).toEqual({
      type: 'text',
      value: 'No result',
    });
  });
});

describe('toolResultOutputToString', () => {
  it('returns text value directly', () => {
    expect(toolResultOutputToString({ type: 'text', value: 'x' })).toBe('x');
  });

  it('prefixes error-text with Error:', () => {
    expect(
      toolResultOutputToString({ type: 'error-text', value: 'boom' }),
    ).toBe('Error: boom');
  });

  it('stringifies json value', () => {
    expect(
      toolResultOutputToString({ type: 'json', value: { a: 1 } }),
    ).toBe('{"a":1}');
  });

  it('stringifies error-json value with prefix', () => {
    expect(
      toolResultOutputToString({ type: 'error-json', value: { k: 'v' } }),
    ).toBe('Error: {"k":"v"}');
  });

  it('uses reason for execution-denied', () => {
    expect(
      toolResultOutputToString({
        type: 'execution-denied',
        reason: 'user refused',
      }),
    ).toBe('user refused');
  });

  it('falls back when execution-denied has no reason', () => {
    expect(
      toolResultOutputToString({ type: 'execution-denied' }),
    ).toBe('Execution denied');
  });

  it('joins text parts from content', () => {
    expect(
      toolResultOutputToString({
        type: 'content',
        value: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      }),
    ).toBe('a\nb');
  });

  it('marks non-text content parts with placeholders', () => {
    expect(
      toolResultOutputToString({
        type: 'content',
        value: [
          { type: 'text', text: 'caption' },
          { type: 'image-data', data: 'xx', mediaType: 'image/png' },
        ],
      }),
    ).toBe('caption\n[image-data]');
  });
});
