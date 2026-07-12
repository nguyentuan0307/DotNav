import { formatCSharpWrapping } from './wrapping';
import { normalizeMultilineArgumentLists } from './multilineList';
import { LeadingCommaWrapStyle, PassContext } from './types';

export function formatLeadingCommas(text: string, ctx: PassContext, style: LeadingCommaWrapStyle = 'wrapIfLong'): string {
  const wrapped = formatCSharpWrapping(text, ctx, { style });
  return normalizeMultilineArgumentLists(wrapped, ctx);
}
