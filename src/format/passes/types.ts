export interface PassContext {
  eol: string;
  indentUnit: string;
  tabSize: number;
  fluentChainMinSegments: number;
}

export interface FormatPassSettings {
  normalizeIndentWhitespace: boolean;
  enableLeadingComma: boolean;
  enableFluentChainWrap: boolean;
  enableBlankLineRules: boolean;
}
