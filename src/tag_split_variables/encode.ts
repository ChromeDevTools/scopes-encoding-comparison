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
import {
  encodeMixedVlqList,
  encodeUnsignedVlq,
  encodeVlq,
  encodeVlqList,
  MixedVlqList,
} from "../vlq.ts";
import { Tag } from "./types.ts";

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
  info.scopes.forEach((scope) => {
    builder.resetOriginalState();
    encodeOriginalScope(scope, builder);
  });
  info.ranges.forEach((range) => encodeGeneratedRange(range, builder));

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
  builder.startOriginal(scope.start.line, scope.start.column, {
    kind: scope.kind,
    name: scope.name,
    isStackFrame: scope.isStackFrame,
  });
  (scope as any)[DEFINITION_SYMBOL] = builder.lastWrittenItemIdx;
  if (scope.variables.length > 0) {
    builder.variables(scope.variables);
  }

  for (const child of scope.children) {
    encodeOriginalScope(child, builder);
  }
  builder.endOriginal(scope.end.line, scope.end.column);
}

function encodeGeneratedRange(
  range: GeneratedRange,
  builder: Builder,
) {
  const scope = range.originalScope as undefined | any;
  builder.startGenerated(range.start.line, range.start.column, {
    definition: scope?.[DEFINITION_SYMBOL],
    isStackFrame: range.isStackFrame,
  });
  if (range.values.length > 0) {
    builder.bindings(range.values);
  }

  for (const child of range.children) {
    encodeGeneratedRange(child, builder);
  }

  builder.endGenerated(range.end.line, range.end.column);
}

class Builder {
  #encodedScope = "";
  #originalState = {
    line: 0,
    kind: 0,
  };
  #generatedState = {
    line: 0,
    column: 0,
    defIdx: 0,
    callsiteSourceIdx: 0,
    callsiteLine: 0,
    callsiteColumn: 0,
  };
  #itemCounter = 0;

  readonly #names: string[];

  /** The 'names' field of the SourceMap. The builder will modify it. */
  constructor(names: string[]) {
    this.#names = names;
  }

  get lastWrittenItemIdx(): number {
    return this.#itemCounter - 1;
  }

  startOriginal(
    line: number,
    column: number,
    options?: {
      name?: string;
      kind?: string;
      isStackFrame?: boolean;
    },
  ): this {
    const lineDiff = line - this.#originalState.line;
    this.#originalState.line = line;
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
      [lineDiff, "unsigned"],
      [column, "unsigned"],
      [flags, "unsigned"],
      ...nameIdxAndKindIdx,
    ];

    this.#encodedScope += encodeUnsignedVlq(Tag.ORIGINAL_START);
    this.#encodedScope += encodeUnsignedVlq(encodedNumbers.length);
    this.#encodedScope += encodeMixedVlqList(encodedNumbers);

    this.#itemCounter++;

    return this;
  }

  endOriginal(line: number, column: number): this {
    const lineDiff = line - this.#originalState.line;
    this.#originalState.line = line;
    this.#encodedScope += encodeMixedVlqList([
      [Tag.ORIGINAL_END, "unsigned"],
      [2, "unsigned"],
      [lineDiff, "unsigned"],
      [column, "unsigned"],
    ]);
    this.#itemCounter++;

    return this;
  }

  variables(variables: string[]): this {
    const encodedNumbers: MixedVlqList = [];

    const vars: MixedVlqList = variables.map((
      variable,
    ) => [this.#nameIdx(variable), "unsigned"]);
    encodedNumbers.push(...vars);

    this.#encodedScope += encodeUnsignedVlq(Tag.VARIABLES);
    this.#encodedScope += encodeUnsignedVlq(encodedNumbers.length);
    this.#encodedScope += encodeMixedVlqList(encodedNumbers);

    this.#itemCounter++;

    return this;
  }

  startGenerated(line: number, column: number, options?: {
    isStackFrame?: boolean;
    isHidden?: boolean;
    definition?: number;
    callsite?: { sourceIdx: number; line: number; column: number };
  }): this {
    const emittedNumbers: MixedVlqList = [];

    const relativeLine = line - this.#generatedState.line;
    const relativeColumn = column -
      (relativeLine === 0 ? this.#generatedState.column : 0);
    let emittedColumn = relativeColumn << 1;
    if (relativeLine !== 0) {
      emittedColumn |= 0x1;
      emittedNumbers.push([emittedColumn, "unsigned"]);
      emittedNumbers.push([relativeLine, "unsigned"]);
    } else {
      emittedNumbers.push([emittedColumn, "unsigned"]);
    }

    this.#generatedState.line = line;
    this.#generatedState.column = column;

    let flags = 0;
    if (options?.definition !== undefined) {
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

    if (options?.definition !== undefined) {
      emittedNumbers.push(options.definition - this.#generatedState.defIdx);
      this.#generatedState.defIdx = options.definition;
    }

    if (options?.callsite) {
      const { sourceIdx, line, column } = options.callsite;
      emittedNumbers.push(
        sourceIdx - this.#generatedState.callsiteSourceIdx,
      );

      const emittedLine = line -
        (this.#generatedState.callsiteSourceIdx === sourceIdx
          ? this.#generatedState.callsiteLine
          : 0);
      emittedNumbers.push(emittedLine);

      const emittedColumn = column -
        (this.#generatedState.callsiteLine === line
          ? this.#generatedState.callsiteColumn
          : 0);
      emittedNumbers.push(emittedColumn);

      this.#generatedState.callsiteSourceIdx = sourceIdx;
      this.#generatedState.callsiteLine = line;
      this.#generatedState.callsiteColumn = column;
    }

    this.#encodedScope += encodeUnsignedVlq(Tag.GENERATED_START);
    this.#encodedScope += encodeUnsignedVlq(emittedNumbers.length);
    this.#encodedScope += encodeMixedVlqList(emittedNumbers);

    this.#itemCounter++;

    return this;
  }

  endGenerated(line: number, column: number): this {
    const emittedNumbers: MixedVlqList = [];

    const relativeLine = line - this.#generatedState.line;
    const relativeColumn = column -
      (relativeLine === 0 ? this.#generatedState.column : 0);
    let emittedColumn = relativeColumn << 1;
    if (relativeLine !== 0) {
      emittedColumn |= 0x1;
      emittedNumbers.push([emittedColumn, "unsigned"]);
      emittedNumbers.push([relativeLine, "unsigned"]);
    } else {
      emittedNumbers.push([emittedColumn, "unsigned"]);
    }

    this.#generatedState.line = line;
    this.#generatedState.column = column;

    this.#encodedScope += encodeUnsignedVlq(Tag.GENERATED_END);
    this.#encodedScope += encodeUnsignedVlq(emittedNumbers.length);
    this.#encodedScope += encodeMixedVlqList(emittedNumbers);

    this.#itemCounter++;

    return this;
  }

  bindings(bindingsArg: (string | undefined | BindingRange[])[]): this {
    const emittedNumbers: MixedVlqList = [];

    emittedNumbers.push([bindingsArg.length, "unsigned"]);
    for (const bindings of bindingsArg) {
      if (bindings === undefined || typeof bindings === "string") {
        emittedNumbers.push(this.#nameIdx(bindings));
        continue;
      }

      emittedNumbers.push(-bindings.length);
      emittedNumbers.push(this.#nameIdx(bindings[0].value));

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

    this.#encodedScope += encodeUnsignedVlq(Tag.BINDINGS);
    this.#encodedScope += encodeUnsignedVlq(emittedNumbers.length);
    this.#encodedScope += encodeMixedVlqList(emittedNumbers);

    this.#itemCounter++;

    return this;
  }

  resetOriginalState() {
    this.#originalState = {
      line: 0,
      kind: 0,
    };
  }

  build(): string {
    const result = this.#encodedScope;
    this.#generatedState = {
      line: 0,
      column: 0,
      defIdx: 0,
      callsiteSourceIdx: 0,
      callsiteLine: 0,
      callsiteColumn: 0,
    };
    this.#originalState = {
      line: 0,
      kind: 0,
    };
    this.#encodedScope = "";
    return result;
  }

  #encodeKind(kind: string): number {
    const kindIdx = this.#nameIdx(kind);
    const encodedIdx = kindIdx - this.#originalState.kind;
    this.#originalState.kind = kindIdx;
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
