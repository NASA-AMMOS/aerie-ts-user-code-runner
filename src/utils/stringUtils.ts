export function indent(str: string, times: number = 1, indentation: string = '  '): string {
  return str.split('\n').map(line => {
    return indentation.repeat(times) + line;
  }).join('\n');
}

export function dedent(str: string, times: number = 1, dedentation: string = '  '): string {
  return str.split('\n').map(line => {
    for (let i = 0; i < times; i++) {
      line = line.replace(new RegExp(`^${dedentation}`, 'g'), '');
    }
    return line;
  }).join('\n');
}

export function trimCharacters(str: string, chars: string | string[]): string {
  return str.replace(new RegExp(`^[${chars}]+|[${chars}]+$`, 'g'), '');
}

export function trimTemplate(str: string): string {
  const regex = /^[^\S\r\n]*\n(.*)\n([^\S\r\n]*)$/s;
  const match = regex.exec(str);
  if (match) {
    return dedent(match[1]!, 1, match[2]!);
  }
  return trimCharacters(str, '\s');
}

declare global {
  interface String {
    indent(times?: number, indentation?: string): string;
    dedent(times?: number, dedentation?: string): string;
    trimCharacters(...chars: string[]): string;
    trimTemplate(): string;
  }
}

export function installStringUtils() {
  String.prototype.indent = function(times?: number, indentation?: string): string {
    return indent(this as string, times, indentation);
  };

  String.prototype.dedent = function(times?: number, dedentation?: string): string {
    return dedent(this as string, times, dedentation);
  };

  String.prototype.trimCharacters = function(...chars: string[]): string {
    return trimCharacters(this as string, chars);
  };

  String.prototype.trimTemplate = function(): string {
    return trimTemplate(this as string);
  };
}


