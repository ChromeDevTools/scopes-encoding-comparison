// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

export interface SourceMapJson {
  version: 3;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: string[];
  names?: string[];
  mappings: string;

  originalScopes?: string[];
  generatedRanges?: string;
  scopes?: string;
}

export interface Codec {
  name: string;
  description?: string;

  /**
   * Takes scope infos and a pre-existing source map, and adds the scopes to it.
   */
  encode(info: ScopeInfo, map: SourceMapJson): SourceMapJson;

  decode(map: SourceMapJson): ScopeInfo;

  dumpVlqHistograms?(): void;
}

export interface ScopeInfo {
  scopes: OriginalScope[];
  ranges: GeneratedRange[];
}

/**
 * A scope in the authored source.
 */
export interface OriginalScope {
  start: Position;
  end: Position;

  /**
   * JavaScript-like languages are encouraged to use 'global', 'class', 'function' and 'block'.
   * Other languages might require language-specific scope kinds, in which case we'll print the
   * kind as-is.
   */
  kind?: string;
  name?: string;
  isStackFrame: boolean;
  variables: string[];
  children: OriginalScope[];
  parent?: OriginalScope;
}

/**
 * A range (can be a scope) in the generated JavaScript.
 */
export interface GeneratedRange {
  start: Position;
  end: Position;
  originalScope?: OriginalScope;

  /**
   * Whether this generated range is an actual JavaScript function in the generated code.
   */
  isStackFrame: boolean;
  /**
   * Whether calls to this generated range should be hidden from stack traces even if
   * this range has an `originalScope`.
   */
  isHidden: boolean;

  /**
   * If this `GeneratedRange` is the result of inlining `originalScope`, then `callsite`
   * refers to where `originalScope` was called in the original ("authored") code.
   */
  callsite?: OriginalPosition;

  /**
   * Expressions that compute the values of the variables of this OriginalScope. The length
   * of `values` must match the length of `originalScope.variables`.
   *
   * For each variable this can either be a single expression (valid for the full `GeneratedRange`),
   * or an array of `BindingRange`s, e.g. if computing the value requires different expressions
   * throughout the range or if the variable is only available in parts of the `GeneratedRange`.
   *
   * `undefined` denotes that the value of a variable is unavailble in the whole range.
   * This can happen e.g. if the variable was optimized out and can't be recomputed.
   */
  values: (string | undefined | BindingRange[])[];
  children: GeneratedRange[];
}

export interface BindingRange {
  value?: string;
  from: Position;
  to: Position;
}

export interface Position {
  line: number;
  column: number;
}

export interface OriginalPosition extends Position {
  sourceIndex: number;
}
