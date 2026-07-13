export type CSharpSpanKind =
  | 'code'
  | 'lineComment'
  | 'blockComment'
  | 'string'
  | 'verbatimString'
  | 'rawString'
  | 'interpolationHole'
  | 'charLiteral';

export interface CSharpSpan {
  start: number;
  end: number;
  kind: CSharpSpanKind;
}

export function classifySpans(text: string): CSharpSpan[] {
  const spans: CSharpSpan[] = [];
  let codeStart = 0;
  let i = 0;

  const pushCode = (end: number) => {
    if (end > codeStart) {
      spans.push({ start: codeStart, end, kind: 'code' });
    }
  };

  const pushSpan = (start: number, end: number, kind: CSharpSpanKind) => {
    if (end > start) {
      spans.push({ start, end, kind });
    }
    codeStart = end;
  };

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '/' && next === '/') {
      pushCode(i);
      const start = i;
      i += 2;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
        i++;
      }
      pushSpan(start, i, 'lineComment');
      continue;
    }

    if (ch === '/' && next === '*') {
      pushCode(i);
      const start = i;
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        i++;
      }
      i = Math.min(text.length, i + 2);
      pushSpan(start, i, 'blockComment');
      continue;
    }

    const stringInfo = readStringPrefix(text, i);
    if (stringInfo) {
      pushCode(i);
      if (stringInfo.rawQuoteCount >= 3) {
        const end = readRawStringEnd(text, stringInfo.contentStart, stringInfo.rawQuoteCount);
        pushSpan(i, end, 'rawString');
      } else if (stringInfo.verbatim) {
        const end = readVerbatimStringEnd(text, stringInfo.contentStart);
        pushSpan(i, end, 'verbatimString');
      } else if (stringInfo.interpolated) {
        const end = readInterpolatedString(text, i, stringInfo.contentStart, spans);
        codeStart = end;
      } else {
        const end = readRegularStringEnd(text, stringInfo.contentStart);
        pushSpan(i, end, 'string');
      }
      i = codeStart;
      continue;
    }

    if (ch === "'") {
      pushCode(i);
      const start = i;
      i++;
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      pushSpan(start, i, 'charLiteral');
      continue;
    }

    i++;
  }

  pushCode(text.length);
  return spans;
}

export function buildCodeMask(text: string, spans = classifySpans(text)): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  for (const span of spans) {
    if (span.kind !== 'code' && span.kind !== 'interpolationHole') {
      continue;
    }
    for (let i = span.start; i < span.end; i++) {
      mask[i] = true;
    }
  }
  return mask;
}

export function isCodeOnly(mask: boolean[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    if (!mask[i]) {
      return false;
    }
  }
  return true;
}

interface StringPrefix {
  contentStart: number;
  interpolated: boolean;
  verbatim: boolean;
  rawQuoteCount: number;
}

function readStringPrefix(text: string, start: number): StringPrefix | undefined {
  let i = start;
  let dollars = 0;
  let verbatim = false;
  while (text[i] === '$' || text[i] === '@') {
    if (text[i] === '$') dollars++;
    else {
      if (verbatim) return undefined;
      verbatim = true;
    }
    i++;
  }

  if (text[i] !== '"') {
    return undefined;
  }

  let quoteCount = 0;
  while (text[i + quoteCount] === '"') {
    quoteCount++;
  }

  return {
    contentStart: i + (quoteCount >= 3 ? quoteCount : 1),
    interpolated: dollars > 0,
    verbatim,
    rawQuoteCount: quoteCount
  };
}

function readRegularStringEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === '"') {
      return i + 1;
    }
    i++;
  }
  return text.length;
}

function readVerbatimStringEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    if (text[i] === '"' && text[i + 1] === '"') {
      i += 2;
      continue;
    }
    if (text[i] === '"') {
      return i + 1;
    }
    i++;
  }
  return text.length;
}

function readRawStringEnd(text: string, start: number, quoteCount: number): number {
  const terminator = '"'.repeat(quoteCount);
  const index = text.indexOf(terminator, start);
  return index === -1 ? text.length : index + quoteCount;
}

function readInterpolatedString(text: string, tokenStart: number, contentStart: number, spans: CSharpSpan[]): number {
  let segmentStart = tokenStart;
  let i = contentStart;

  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }

    if (text[i] === '{' && text[i + 1] === '{') {
      i += 2;
      continue;
    }

    if (text[i] === '}' && text[i + 1] === '}') {
      i += 2;
      continue;
    }

    if (text[i] === '{') {
      if (i > segmentStart) {
        spans.push({ start: segmentStart, end: i, kind: 'string' });
      }
      const holeEnd = readInterpolationHoleEnd(text, i);
      spans.push({ start: i, end: holeEnd, kind: 'interpolationHole' });
      i = holeEnd;
      segmentStart = i;
      continue;
    }

    if (text[i] === '"') {
      spans.push({ start: segmentStart, end: i + 1, kind: 'string' });
      return i + 1;
    }

    i++;
  }

  spans.push({ start: segmentStart, end: text.length, kind: 'string' });
  return text.length;
}

function readInterpolationHoleEnd(text: string, start: number): number {
  let depth = 0;
  let i = start;

  while (i < text.length) {
    const stringInfo = readStringPrefix(text, i);
    if (stringInfo) {
      if (stringInfo.rawQuoteCount >= 3) {
        i = readRawStringEnd(text, stringInfo.contentStart, stringInfo.rawQuoteCount);
      } else if (stringInfo.verbatim) {
        i = readVerbatimStringEnd(text, stringInfo.contentStart);
      } else {
        i = readRegularStringEnd(text, stringInfo.contentStart);
      }
      continue;
    }

    if (text[i] === "'") {
      i++;
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (text[i] === '{') {
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }

    i++;
  }

  return text.length;
}
