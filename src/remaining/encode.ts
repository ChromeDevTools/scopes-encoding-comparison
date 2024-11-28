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
import { encodeMixedVlqList, encodeVlqList, MixedVlqList } from "../vlq.ts";

export function encode(
  info: ScopeInfo,
  initialMap: SourceMapJson,
): SourceMapJson {
  const map = { ...initialMap };
  const names = map.names ?? [];
  if (!map.names) {
    map.names = names;
  }

  let sourceIdx = 0;
  const encodedScopes = info.scopes.map((scope) => {
    const builder = new OriginalScopeBuilder(names);
    encodeOriginalScope(scope, builder, sourceIdx++);
    return builder.build();
  });

  const builder = new GeneratedRangeBuilder(names);
  info.ranges.forEach((range) => encodeGeneratedRange(range, builder));
  const encodedRanges = builder.build();

  map.originalScopes = encodedScopes;
  map.generatedRanges = encodedRanges;
  return map;
}

const DEFINITION_SYMBOL = Symbol("definition");

function encodeOriginalScope(
  scope: OriginalScope,
  builder: OriginalScopeBuilder,
  sourceIdx: number,
) {
  builder.start(scope.start.line, scope.start.column, {
    kind: scope.kind,
    name: scope.name,
    variables: scope.variables,
    isStackFrame: scope.isStackFrame,
  });
  (scope as any)[DEFINITION_SYMBOL] = {
    sourceIdx,
    scopeIdx: builder.lastWrittenScopeIdx,
  };

  for (const child of scope.children) {
    encodeOriginalScope(child, builder, sourceIdx);
  }
  builder.end(scope.end.line, scope.end.column);
}

function encodeGeneratedRange(
  range: GeneratedRange,
  builder: GeneratedRangeBuilder,
) {
  const scope = range.originalScope as undefined | any;
  builder.start(range.start.line, range.start.column, {
    definition: scope?.[DEFINITION_SYMBOL],
    bindings: range.values as (string | undefined)[],
    isStackFrame: range.isStackFrame,
  });

  for (const child of range.children) {
    encodeGeneratedRange(child, builder);
  }

  builder.end(range.end.line, range.end.column);
}

export class OriginalScopeBuilder {
  #encodedScope = "";
  #lastLine = 0;
  #lastKind = 0;
  #scopeCounter = 0;

  readonly #names: string[];

  /** The 'names' field of the SourceMap. The builder will modify it. */
  constructor(names: string[]) {
    this.#names = names;
  }

  get lastWrittenScopeIdx() {
    return this.#scopeCounter - 1;
  }

  start(
    line: number,
    column: number,
    options?: {
      name?: string;
      kind?: string;
      isStackFrame?: boolean;
      variables?: string[];
    },
  ): this {
    const lineDiff = line - this.#lastLine;
    this.#lastLine = line;
    let flags = 0;
    const nameIdxAndKindIdx: MixedVlqList = [];

    if (options?.name) {
      flags |= 0x1;
      nameIdxAndKindIdx.push([this.#nameIdx(options.name), "unsigned"]);
    }
    if (options?.kind) {
      flags |= 0x2;
      nameIdxAndKindIdx.push(this.#encodeKind(options?.kind));
    }
    if (options?.isStackFrame) {
      flags |= 0x4;
    }

    const encodedNumbers: MixedVlqList = [
      [lineDiff << 1, "unsigned"],
      [column, "unsigned"],
      [flags, "unsigned"],
      ...nameIdxAndKindIdx,
    ];

    if (options?.variables) {
      const variables: MixedVlqList = options.variables.map((
        variable,
      ) => [this.#nameIdx(variable), "unsigned"]);
      encodedNumbers.push([variables.length, "unsigned"]);
      encodedNumbers.push(...variables);
    }

    this.#encodedScope += encodeMixedVlqList(encodedNumbers);

    this.#scopeCounter++;

    return this;
  }

  end(line: number, column: number): this {
    const lineDiff = line - this.#lastLine;
    this.#lastLine = line;
    this.#encodedScope += encodeMixedVlqList([(lineDiff << 1) | 0x1, [
      column,
      "unsigned",
    ]]);
    this.#scopeCounter++;

    return this;
  }

  build(): string {
    const result = this.#encodedScope;
    this.#lastLine = 0;
    this.#encodedScope = "";
    return result;
  }

  #encodeKind(kind: string): number {
    const kindIdx = this.#nameIdx(kind);
    const encodedIdx = kindIdx - this.#lastKind;
    this.#lastKind = kindIdx;
    return encodedIdx;
  }

  #nameIdx(name: string): number {
    let idx = this.#names.indexOf(name);
    if (idx < 0) {
      idx = this.#names.length;
      this.#names.push(name);
    }
    return idx;
  }
}

export class GeneratedRangeBuilder {
  #encodedRange = "";
  #state = {
    line: 0,
    column: 0,
    defSourceIdx: 0,
    defScopeIdx: 0,
    callsiteSourceIdx: 0,
    callsiteLine: 0,
    callsiteColumn: 0,
  };

  readonly #names: string[];

  /** The 'names' field of the SourceMap. The builder will modify it. */
  constructor(names: string[]) {
    this.#names = names;
  }

  start(line: number, column: number, options?: {
    isStackFrame?: boolean;
    isHidden?: boolean;
    definition?: { sourceIdx: number; scopeIdx: number };
    callsite?: { sourceIdx: number; line: number; column: number };
    bindings?: (string | undefined | BindingRange[])[];
  }): this {
    const emittedNumbers: MixedVlqList = [];

    const relativeLine = line - this.#state.line;
    const relativeColumn = column -
      (relativeLine === 0 ? this.#state.column : 0);
    let emittedColumn = relativeColumn << 2;
    if (relativeLine !== 0) {
      emittedColumn |= 0x1;
      emittedNumbers.push([emittedColumn, "unsigned"]);
      emittedNumbers.push([relativeLine, "unsigned"]);
    } else {
      emittedNumbers.push([emittedColumn, "unsigned"]);
    }

    this.#state.line = line;
    this.#state.column = column;

    let flags = 0;
    if (options?.definition) {
      flags |= 0x1;
    }
    if (options?.callsite) {
      flags |= 0x2;
    }
    if (options?.isStackFrame) {
      flags |= 0x4;
    }
    if (options?.isHidden) {
      flags |= 0x8;
    }
    emittedNumbers.push([flags, "unsigned"]);

    if (options?.definition) {
      const { sourceIdx, scopeIdx } = options.definition;
      emittedNumbers.push(sourceIdx - this.#state.defSourceIdx);

      const emittedScopeIdx = scopeIdx -
        (this.#state.defSourceIdx === sourceIdx ? this.#state.defScopeIdx : 0);
      emittedNumbers.push(emittedScopeIdx);

      this.#state.defSourceIdx = sourceIdx;
      this.#state.defScopeIdx = scopeIdx;
    }

    if (options?.callsite) {
      const { sourceIdx, line, column } = options.callsite;
      emittedNumbers.push(
        sourceIdx - this.#state.callsiteSourceIdx,
      );

      const emittedLine = line -
        (this.#state.callsiteSourceIdx === sourceIdx
          ? this.#state.callsiteLine
          : 0);
      emittedNumbers.push(emittedLine);

      const emittedColumn = column -
        (this.#state.callsiteLine === line ? this.#state.callsiteColumn : 0);
      emittedNumbers.push(emittedColumn);

      this.#state.callsiteSourceIdx = sourceIdx;
      this.#state.callsiteLine = line;
      this.#state.callsiteColumn = column;
    }

    emittedNumbers.push([options?.bindings?.length ?? 0, "unsigned"]);
    for (const bindings of options?.bindings ?? []) {
      if (bindings === undefined || typeof bindings === "string") {
        emittedNumbers.push(this.#nameIdx(bindings));
        continue;
      }

      emittedNumbers.push(-bindings.length);
      emittedNumbers.push(this.#nameIdx(bindings[0].value));
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
        emittedNumbers.push(emittedLine);
        emittedNumbers.push(emittedColumn);
        emittedNumbers.push(this.#nameIdx(value));
      }
    }

    this.#encodedRange += encodeMixedVlqList(emittedNumbers);

    return this;
  }

  end(line: number, column: number): this {
    const emittedNumbers: number[] = [];

    const relativeLine = line - this.#state.line;
    const relativeColumn = column -
      (relativeLine === 0 ? this.#state.column : 0);
    let emittedColumn = relativeColumn << 2;
    emittedColumn |= 0x2;
    if (relativeLine !== 0) {
      emittedColumn |= 0x1;
      emittedNumbers.push([emittedColumn, "unsigned"]);
      emittedNumbers.push([relativeLine, "unsigned"]);
    } else {
      emittedNumbers.push([emittedColumn, "unsigned"]);
    }

    this.#state.line = line;
    this.#state.column = column;

    this.#encodedRange += encodeVlqList(emittedNumbers);

    return this;
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

  build(): string {
    const result = this.#encodedRange;
    this.#state = {
      line: 0,
      column: 0,
      defSourceIdx: 0,
      defScopeIdx: 0,
      callsiteSourceIdx: 0,
      callsiteLine: 0,
      callsiteColumn: 0,
    };
    this.#encodedRange = "";
    return result;
  }
}
