// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {
  BindingRange,
  GeneratedRange,
  OriginalScope,
  ScopeInfo,
  SourceMapJson,
} from "../types.ts";
import { encodeVlq, encodeMixedVlqList, encodeUnsignedVlq } from "../vlq.ts";
import { GeneratedRangeFlag, OriginalScopeFlag, Tag } from "./types.ts";

/**
 * Takes a SourceMap with "current proposal" scopes and re-encodes them using the "prefix" method.
 */
export function encode(
  info: ScopeInfo,
  initialMap: SourceMapJson,
): SourceMapJson {
  const map = { ...initialMap };
  const names = map.names ?? [];
  if (!map.names) {
    map.names = names;
  }

  const builder = new Builder(names);
  info.scopes.forEach(scope => {
    builder.resetOriginalScopeState();
    encodeOriginalScope(scope, builder);
  });
  info.ranges.forEach(range => {
    builder.resetRangeState();
    encodeGeneratedRange(range, builder);
  });

  map.scopes = builder.build();
  delete map.originalScopes;
  delete map.generatedRanges;
  return map;
}

const DEFINITION_SYMBOL = Symbol("definition");

function encodeOriginalScope(
  scope: OriginalScope,
  builder: Builder,
) {
  builder.startOriginalScope(scope.start.line, scope.start.column, {
    kind: scope.kind,
    name: scope.name,
    isStackFrame: scope.isStackFrame,
  });
  (scope as any)[DEFINITION_SYMBOL] = builder.lastWrittenItemIdx;
  builder.variables(scope.variables);

  for (const child of scope.children) {
    encodeOriginalScope(child, builder);
  }
  builder.endOriginalScope(scope.end.line, scope.end.column);
}

function encodeGeneratedRange(
  range: GeneratedRange,
  builder: Builder,
) {
  const scope = range.originalScope as undefined | any;
  builder.startRange(range.start.line, range.start.column, {
    definition: scope?.[DEFINITION_SYMBOL],
    isStackFrame: range.isStackFrame,
  });
  builder.bindings(range.values, range.start.line, range.start.column);

  for (const child of range.children) {
    encodeGeneratedRange(child, builder);
  }

  builder.endRange(range.end.line, range.end.column);
}

class Builder {
  #encodedItems: string[] = [];

  readonly #names: string[];
  readonly #scopeState = {
    line: 0,
    kind: 0,
  };

  readonly #rangeState = {
    line: 0,
    column: 0,
    defScopeIdx: 0,
    callsiteSourceIdx: 0,
    callsiteLine: 0,
    callsiteColumn: 0,
  };

  /** The 'names' field of the SourceMap. The builder will modify it. */
  constructor(names: string[]) {
    this.#names = names;
  }

  get lastWrittenItemIdx() {
    return this.#encodedItems.length - 1;
  }

  startOriginalScope(
    line: number,
    column: number,
    options?: {
      name?: string;
      kind?: string;
      isStackFrame?: boolean;
    },
  ): this {
    let encodedScope = "";
    encodedScope += encodeVlq(Tag.ORIGINAL_START);

    const lineDiff = line - this.#scopeState.line;
    this.#scopeState.line = line;
    let flags = 0;
    const nameIdxAndKindIdx: number[] = [];

    if (options?.name) {
      flags |= OriginalScopeFlag.HAS_NAME;
      nameIdxAndKindIdx.push(this.#nameIdx(options.name));
    }
    if (options?.kind) {
      flags |= OriginalScopeFlag.HAS_KIND;
      nameIdxAndKindIdx.push(this.#encodeKind(options?.kind));
    }
    if (options?.isStackFrame) {
      flags |= OriginalScopeFlag.IS_STACK_FRAME;
    }

    encodedScope += encodeMixedVlqList([
      [lineDiff, "unsigned"],
      [column, "unsigned"],
      [flags, "unsigned"],
      ...nameIdxAndKindIdx,
    ]);

    this.#encodedItems.push(encodedScope);

    return this;
  }

  variables(variables?: string[]): this {
    if (!variables?.length) {
      return this;
    }

    let encodedVariables = encodeVlq(Tag.VARIABLES);
    encodedVariables += encodeMixedVlqList(
      variables.map((variable) => this.#nameIdx(variable)),
    );

    this.#encodedItems.push(encodedVariables);
    return this;
  }

  endOriginalScope(line: number, column: number): this {
    let encodedScope = "";
    encodedScope += encodeVlq(Tag.ORIGINAL_END);

    const lineDiff = line - this.#scopeState.line;
    this.#scopeState.line = line;
    encodedScope += encodeMixedVlqList([
      [lineDiff, "unsigned"],
      [column, "unsigned"],
    ]);
    this.#encodedItems.push(encodedScope);

    return this;
  }

  startRange(line: number, column: number, options?: {
    isStackFrame?: boolean;
    isHidden?: boolean;
    definition?: number;
    callsite?: { sourceIdx: number; line: number; column: number };
  }): this {
    let encodedRange = "";
    encodedRange += encodeVlq(Tag.GENERATED_START);

    const relativeLine = line - this.#rangeState.line;
    const relativeColumn = column -
      (relativeLine === 0 ? this.#rangeState.column : 0);
    let emittedColumn = relativeColumn << 1;
    if (relativeLine !== 0) {
      emittedColumn |= 0x1;
      encodedRange += encodeUnsignedVlq(emittedColumn);
      encodedRange += encodeUnsignedVlq(relativeLine);
    } else {
      encodedRange += encodeUnsignedVlq(emittedColumn);
    }

    this.#rangeState.line = line;
    this.#rangeState.column = column;

    let flags = 0;
    if (options?.definition !== undefined) {
      flags |= GeneratedRangeFlag.HAS_DEFINITION;
    }
    if (options?.callsite) {
      flags |= GeneratedRangeFlag.HAS_CALLSITE;
    }
    if (options?.isStackFrame) {
      flags |= GeneratedRangeFlag.IS_STACK_FRAME;
    }
    if (options?.isHidden) {
      flags |= GeneratedRangeFlag.IS_HIDDEN;
    }
    encodedRange += encodeUnsignedVlq(flags);

    if (options?.definition !== undefined) {
      encodedRange += encodeVlq(options.definition - this.#rangeState.defScopeIdx);
      this.#rangeState.defScopeIdx = options.definition;
    }

    if (options?.callsite) {
      const { sourceIdx, line, column } = options.callsite;
      encodedRange += encodeVlq(
        sourceIdx - this.#rangeState.callsiteSourceIdx,
      );

      const emittedLine = line -
        (this.#rangeState.callsiteSourceIdx === sourceIdx
          ? this.#rangeState.callsiteLine
          : 0);
      encodedRange += encodeVlq(emittedLine);

      const emittedColumn = column -
        (this.#rangeState.callsiteLine === line ? this.#rangeState.callsiteColumn : 0);
      encodedRange += encodeVlq(emittedColumn);

      this.#rangeState.callsiteSourceIdx = sourceIdx;
      this.#rangeState.callsiteLine = line;
      this.#rangeState.callsiteColumn = column;
    }

    this.#encodedItems.push(encodedRange);

    return this;
  }

  bindings(bs: (string | undefined | BindingRange[])[]|undefined, line: number, column: number): this {
    if (!bs?.length) {
      return this;
    }
    let encodedRange = encodeVlq(Tag.BINDINGS);
    for (const bindings of bs) {
      if (bindings === undefined || typeof bindings === "string") {
        encodedRange += encodeVlq(this.#nameIdx(bindings));
        continue;
      }

      encodedRange += encodeVlq(-bindings.length);
      encodedRange += encodeVlq(this.#nameIdx(bindings[0].value));
      if (
        bindings[0].from.line !== line || bindings[0].from.column !== column
      ) {
        throw new Error(
          "First binding line/column must match the range start line/column",
        );
      }

      for (let i = 1; i < bindings.length; ++i) {
        const { from: { line, column }, value } = bindings[i];
        const emittedLine = line - bindings[i - 1].from.line;
        const emittedColumn = column -
          (line === bindings[i - 1].from.line
            ? bindings[i - 1].from.column
            : 0);
        encodedRange += encodeVlq(emittedLine);
        encodedRange += encodeVlq(emittedColumn);
        encodedRange += encodeVlq(this.#nameIdx(value));
      }
    }
    this.#encodedItems.push(encodedRange);
    return this;
  }

  endRange(line: number, column: number): this {
    let encodedRange = "";
    encodedRange += encodeVlq(Tag.GENERATED_END);

    const relativeLine = line - this.#rangeState.line;
    const relativeColumn = column -
      (relativeLine === 0 ? this.#rangeState.column : 0);
    let emittedColumn = relativeColumn << 1;
    if (relativeLine !== 0) {
      emittedColumn |= 0x1;
      encodedRange += encodeUnsignedVlq(emittedColumn);
      encodedRange += encodeUnsignedVlq(relativeLine);
    } else {
      encodedRange += encodeUnsignedVlq(emittedColumn);
    }
    
    this.#rangeState.line = line;
    this.#rangeState.column = column;

    this.#encodedItems.push(encodedRange);

    return this;
  }

  resetOriginalScopeState(): void {
    this.#scopeState.line = 0;
    this.#scopeState.kind = 0;
  }

  resetRangeState(): void {
    this.#rangeState.line = 0;
    this.#rangeState.column = 0;
    this.#rangeState.defScopeIdx = 0;
    this.#rangeState.callsiteSourceIdx = 0;
    this.#rangeState.callsiteLine = 0;
    this.#rangeState.callsiteColumn = 0;
  }

  build(): string {
    const result = this.#encodedItems.join(",");
    this.#encodedItems = [];
    this.resetOriginalScopeState();
    this.resetRangeState();
    return result;
  }

  #encodeKind(kind: string): number {
    const kindIdx = this.#nameIdx(kind);
    const encodedIdx = kindIdx - this.#scopeState.kind;
    this.#scopeState.kind = kindIdx;
    return encodedIdx;
  }

  #nameIdx(name?: string): number {
    if (name === undefined) {
      return -1;
    }

    let idx = this.#names.indexOf(name);
    if (idx < 0) {
      idx = this.#names.length;
      this.#names.push(name);
    }
    return idx;
  }
}
