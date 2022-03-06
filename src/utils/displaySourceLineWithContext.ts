export function displaySourceLineWithContext(sourceCode: string, lineNumber: number, context: number = 1): string {
  const lines = sourceCode.split('\n');
  const start = Math.max(0, lineNumber - 1 - context);
  const end = Math.min(lines.length, lineNumber - 1 + context);
  return lines.slice(start, end + 1).map((l, i) => {
    const isCurrentLine = i === (lineNumber - 1) - start;
    return (isCurrentLine ? '>' : ' ') + (i + start + 1) + '| ' + l;
  }).join('\n');
}
