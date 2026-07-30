import { PassContext } from './types';

export function continuationIndent(ctx: PassContext): string {
  const multiplier = ctx.continuationIndentMultiplier
    ?? ctx.formattingIntent?.dominantListIndentMultiplier
    ?? 1;
  return ctx.indentUnit.repeat(multiplier);
}
