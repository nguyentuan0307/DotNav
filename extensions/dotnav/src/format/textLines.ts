export interface TextLine {
  text: string;
  eol: string;
  start: number;
  end: number;
}

export function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export function splitLines(text: string): TextLine[] {
  const lines: TextLine[] = [];
  const pattern = /.*?(?:\r\n|\n|\r|$)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match[0] === '' && match.index === text.length) {
      break;
    }
    const raw = match[0];
    const eolMatch = raw.match(/(\r\n|\n|\r)$/);
    const eol = eolMatch?.[0] ?? '';
    const lineText = eol ? raw.slice(0, -eol.length) : raw;
    lines.push({ text: lineText, eol, start: match.index, end: match.index + lineText.length });
    if (match.index + raw.length >= text.length) {
      break;
    }
  }

  return lines;
}

export function joinLines(lines: TextLine[]): string {
  return lines.map(line => line.text + line.eol).join('');
}

export function leadingWhitespace(line: string): string {
  return line.match(/^[\t ]*/)?.[0] ?? '';
}

export function leadingWidth(whitespace: string, tabSize: number): number {
  let width = 0;
  for (const ch of whitespace) {
    width += ch === '\t' ? tabSize : 1;
  }
  return width;
}

export function tabsForLeadingWhitespace(whitespace: string, tabSize: number): string {
  if (whitespace.length === 0) {
    return '';
  }
  const width = leadingWidth(whitespace, tabSize);
  return '\t'.repeat(Math.ceil(width / tabSize));
}
