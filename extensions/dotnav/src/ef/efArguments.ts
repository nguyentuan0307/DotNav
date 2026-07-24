const managedOptions = new Set([
  '--project',
  '-p',
  '--startup-project',
  '-s',
  '--context',
  '-c',
  '--configuration',
  '--connection',
  '--output',
  '-o',
  '--json',
  '--prefix-output',
  '--no-color'
]);

export interface ParsedEfArguments {
  readonly args: readonly string[];
  readonly error?: string;
}

/** Parses a shell-like argument string without invoking a shell. */
export function parseAdditionalArguments(input: string): ParsedEfArguments {
  const args: string[] = [];
  let token = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let tokenStarted = false;

  for (const character of input) {
    if (escaped) {
      token += character;
      escaped = false;
      tokenStarted = true;
      continue;
    }

    if (character === '\\' && quote !== "'") {
      escaped = true;
      tokenStarted = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        token += character;
      }
      tokenStarted = true;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(character)) {
      if (tokenStarted) {
        args.push(token);
        token = '';
        tokenStarted = false;
      }
      continue;
    }

    token += character;
    tokenStarted = true;
  }

  if (escaped) {
    return { args: [], error: 'Additional arguments end with an incomplete escape.' };
  }
  if (quote) {
    return { args: [], error: `Additional arguments contain an unclosed ${quote} quote.` };
  }
  if (tokenStarted) {
    args.push(token);
  }

  const conflict = args.find(argument => managedOptions.has(argument.toLowerCase()));
  if (conflict) {
    return {
      args: [],
      error: `${conflict} is managed by DotNav. Use the corresponding form field instead.`
    };
  }

  return { args };
}
