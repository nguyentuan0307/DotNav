import { FormattingIntentSnapshot } from '../formattingStyleDetector';

export interface PassContext {
  eol: string;
  indentUnit: string;
  tabSize: number;
  fluentChainMinSegments: number;
  wrapColumn: number;
  enableWrapping?: boolean;
  allowPartialFragment?: boolean;
  continuationIndentMultiplier?: number;
  preserveExistingLayout?: boolean;
  formattingIntent?: FormattingIntentSnapshot;
}

export type LeadingCommaWrapStyle = 'wrapIfLong' | 'chopAlways' | 'keep';

export interface FormatPassSettings {
  normalizeIndentWhitespace: boolean;
  enableLeadingComma: boolean;
  enableFluentChainWrap: boolean;
  enableBlankLineRules: boolean;
  leadingCommaWrapStyle: LeadingCommaWrapStyle;
  enableBinaryExpressionWrap?: boolean;
  enableTernaryAlignment?: boolean;
  enableSwitchExpressionAlignment?: boolean;
  enableCollectionExpressionWrap?: boolean;
}
