import { detectEol } from '../textLines';
import { normalizeBlankLines } from './blankLines';
import { formatFluentChains } from './fluentChain';
import { formatLeadingCommas } from './leadingComma';
import { normalizeIndentWhitespace } from './normalizeIndentWhitespace';
import { FormatPassSettings, PassContext } from './types';

export function runFormatPasses(text: string, settings: FormatPassSettings, partialContext: Partial<PassContext> = {}): string {
  const ctx: PassContext = {
    eol: partialContext.eol ?? detectEol(text),
    indentUnit: partialContext.indentUnit ?? '\t',
    tabSize: partialContext.tabSize ?? 4,
    fluentChainMinSegments: partialContext.fluentChainMinSegments ?? 3,
    wrapColumn: partialContext.wrapColumn ?? 120
  };

  let result = text;
  if (settings.normalizeIndentWhitespace) {
    result = normalizeIndentWhitespace(result, ctx);
  }
  if (settings.enableLeadingComma) {
    result = formatLeadingCommas(result, ctx, settings.leadingCommaWrapStyle);
  }
  if (settings.enableFluentChainWrap) {
    result = formatFluentChains(result, ctx);
  }
  if (settings.enableBlankLineRules) {
    result = normalizeBlankLines(result);
  }
  return result;
}

export type { FormatPassSettings, PassContext };
