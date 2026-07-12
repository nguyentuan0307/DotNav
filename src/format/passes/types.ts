export interface PassContext {
  eol: string;
  indentUnit: string;
  tabSize: number;
  fluentChainMinSegments: number;
  wrapColumn: number;
}

export type LeadingCommaWrapStyle = 'wrapIfLong' | 'chopAlways' | 'keep';

export interface FormatPassSettings {
  normalizeIndentWhitespace: boolean;
  enableLeadingComma: boolean;
  enableFluentChainWrap: boolean;
  enableBlankLineRules: boolean;
  leadingCommaWrapStyle: LeadingCommaWrapStyle;
}
