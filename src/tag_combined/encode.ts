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
  builder.startOriginal(scope.start, scope.end, {
    kind: scope.kind,
    name: scope.name,
    variables: scope.variables,
    isStackFrame: scope.isStackFrame,
    lastChildEnd: scope.children.at(-1)?.end,
  });
  (scope as any)[DEFINITION_SYMBOL] = builder.lastWrittenItemIdx;

  for (const child of scope.children) {
    encodeOriginalScope(child, builder);
  }
  builder.endOriginal(scope.end.line);
}

function encodeGeneratedRange(
  range: GeneratedRange,
  builder: Builder,
) {
  const scope = range.originalScope as undefined | any;
  builder.startGenerated(range.start, range.end, {
    definition: scope?.[DEFINITION_SYMBOL],
    bindings: range.values as (string | undefined)[],
    isStackFrame: range.isStackFrame,
    lastChildEnd: range.children.at(-1)?.end,
  });

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
    start: { line: number; column: number },
    end: { line: number; column: number },
    options?: {
      name?: string;
      kind?: string;
      isStackFrame?: boolean;
      variables?: string[];
      lastChildEnd?: { line: number; column: number };
    },
  ): this {
    const startLineDelta = start.line - this.#originalState.line;
    this.#originalState.line = start.line;
    const endLineDelta = end.line - (options?.lastChildEnd?.line ?? start.line);
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
      [startLineDelta, "unsigned"],
      [start.column, "unsigned"],
      [endLineDelta, "unsigned"],
      [end.column, "unsigned"],
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

    this.#encodedScope += encodeUnsignedVlq(Tag.ORIGINAL);
    this.#encodedScope += encodeUnsignedVlq(encodedNumbers.length);
    this.#encodedScope += encodeMixedVlqList(encodedNumbers);

    this.#itemCounter++;

    return this;
  }

  endOriginal(line: number): this {
    this.#encodedScope += encodeUnsignedVlq(Tag.EMPTY);
    this.#originalState.line = line;
    return this;
  }

  startGenerated(
    start: { line: number; column: number },
    end: { line: number; column: number },
    options?: {
      isStackFrame?: boolean;
      isHidden?: boolean;
      definition?: number;
      callsite?: { sourceIdx: number; line: number; column: number };
      bindings?: (string | undefined | BindingRange[])[];
      lastChildEnd?: { line: number; column: number };
    },
  ): this {
    const emittedNumbers: MixedVlqList = [];

    const relativeLine = start.line - this.#generatedState.line;
    const relativeColumn = start.column -
      (relativeLine === 0 ? this.#generatedState.column : 0);
    let emittedColumn = relativeColumn << 1;
    if (relativeLine !== 0) {
      emittedColumn |= 0x1;
      emittedNumbers.push([emittedColumn, "unsigned"]);
      emittedNumbers.push([relativeLine, "unsigned"]);
    } else {
      emittedNumbers.push([emittedColumn, "unsigned"]);
    }

    const relativeEndLine = end.line -
      (options?.lastChildEnd?.line ?? start.line);
    const relativeEndColumn = end.column -
      (relativeEndLine === 0
        ? (options?.lastChildEnd?.column ?? start.column)
        : 0);
    let emittedEndColumn = relativeEndColumn << 1;
    if (relativeEndLine !== 0) {
      emittedEndColumn |= 0x1;
      emittedNumbers.push(
        [emittedEndColumn, "unsigned"],
        [relativeEndLine, "unsigned"],
      );
    } else {
      emittedNumbers.push([emittedEndColumn, "unsigned"]);
    }

    this.#generatedState.line = start.line;
    this.#generatedState.column = start.column;

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

    emittedNumbers.push([options?.bindings?.length ?? 0, "unsigned"]);
    for (const bindings of options?.bindings ?? []) {
      if (bindings === undefined || typeof bindings === "string") {
        emittedNumbers.push(this.#nameIdx(bindings));
        continue;
      }

      emittedNumbers.push(-bindings.length);
      emittedNumbers.push(this.#nameIdx(bindings[0].value));
      if (
        bindings[0].from.line !== start.line ||
        bindings[0].from.column !== start.column
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

    this.#encodedScope += encodeUnsignedVlq(Tag.GENERATED);
    this.#encodedScope += encodeUnsignedVlq(emittedNumbers.length);
    this.#encodedScope += encodeMixedVlqList(emittedNumbers);

    this.#itemCounter++;

    return this;
  }

  endGenerated(line: number, column: number): this {
    this.#generatedState.line = line;
    this.#generatedState.column = column;

    this.#encodedScope += encodeUnsignedVlq(Tag.EMPTY);

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
