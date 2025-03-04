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
import { encodeMixedVlqList, encodeUnsignedVlq, encodeVlq } from "../vlq.ts";

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
  #lastName = 0;
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
    if (this.#encodedScope !== "") {
      this.#encodedScope += ",";
    }

    const lineDiff = line - this.#lastLine;
    this.#lastLine = line;
    let flags = 0;

    if (options?.name) {
      flags |= 0x1;
    }
    if (options?.kind) {
      flags |= 0x2;
    }
    if (options?.isStackFrame) {
      flags |= 0x4;
    }
    if (options?.variables?.length) {
      flags |= 0x8;
    }

    this.#encodedScope += encodeUnsignedVlq(
      lineDiff,
      "OriginalScope.start.line",
    );
    this.#encodedScope += encodeUnsignedVlq(
      column,
      "OriginalScope.start.column",
    );
    this.#encodedScope += encodeUnsignedVlq(flags, "OriginalScope.flags");

    if (options?.name) {
      this.#encodedScope += encodeVlq(
        this.#encodeName(options.name),
        "OriginalScope.name",
      );
    }

    if (options?.kind) {
      this.#encodedScope += encodeVlq(
        this.#encodeKind(options.kind),
        "OriginalScope.kind",
      );
    }

    if (options?.variables?.length) {
      this.#encodedScope += encodeUnsignedVlq(
        options.variables.length,
        "OriginalScope.variableCount",
      );
      for (const variable of options.variables) {
        this.#encodedScope += encodeVlq(
          this.#nameIdx(variable),
          "OriginalScope.variable",
        );
      }
    }

    this.#scopeCounter++;

    return this;
  }

  end(line: number, column: number): this {
    if (this.#encodedScope !== "") {
      this.#encodedScope += ",";
    }

    const lineDiff = line - this.#lastLine;
    this.#lastLine = line;

    this.#encodedScope += encodeUnsignedVlq(lineDiff, "OriginalScope.end.line");
    this.#encodedScope += encodeUnsignedVlq(column, "OriginalScope.end.column");

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

  #encodeName(name: string): number {
    const nameIdx = this.#nameIdx(name);
    const encodedIdx = nameIdx - this.#lastName;
    this.#lastName = nameIdx;
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
    this.#emitItemSepratorIfRequired();

    const relativeLine = line - this.#state.line;
    const relativeColumn = column -
      (relativeLine === 0 ? this.#state.column : 0);
    let emittedColumn = relativeColumn << 1;
    if (relativeLine !== 0) {
      emittedColumn |= 0x1;
      this.#encodedRange += encodeUnsignedVlq(
        emittedColumn,
        "GeneratedRange.start.column",
      );
      this.#encodedRange += encodeUnsignedVlq(
        relativeLine,
        "GeneratedRange.start.line",
      );
    } else {
      this.#encodedRange += encodeUnsignedVlq(
        emittedColumn,
        "GeneratedRange.start.column",
      );
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
    if (options?.bindings?.length) {
      flags |= 0x8;
    }
    if (options?.isHidden) {
      flags |= 0x10;
    }

    this.#encodedRange += encodeUnsignedVlq(flags, "GeneratedRange.flags");

    if (options?.definition) {
      const { sourceIdx, scopeIdx } = options.definition;
      this.#encodedRange += encodeVlq(
        sourceIdx - this.#state.defSourceIdx,
        "GeneratedRange.definition.sourceIdx",
      );

      const emittedScopeIdx = scopeIdx -
        (this.#state.defSourceIdx === sourceIdx ? this.#state.defScopeIdx : 0);
      this.#encodedRange += encodeVlq(
        emittedScopeIdx,
        "GeneratedRange.definition.scopeIdx",
      );

      this.#state.defSourceIdx = sourceIdx;
      this.#state.defScopeIdx = scopeIdx;
    }

    if (options?.callsite) {
      const { sourceIdx, line, column } = options.callsite;
      this.#encodedRange += encodeVlq(
        sourceIdx - this.#state.callsiteSourceIdx,
      );

      const emittedLine = line -
        (this.#state.callsiteSourceIdx === sourceIdx
          ? this.#state.callsiteLine
          : 0);
      this.#encodedRange += encodeVlq(emittedLine);

      const emittedColumn = column -
        (this.#state.callsiteLine === line ? this.#state.callsiteColumn : 0);
      this.#encodedRange += encodeVlq(emittedColumn);

      this.#state.callsiteSourceIdx = sourceIdx;
      this.#state.callsiteLine = line;
      this.#state.callsiteColumn = column;
    }

    if (options?.bindings?.length) {
      this.#encodedRange += encodeUnsignedVlq(
        options.bindings.length,
        "GeneratedRange.bindingsCount",
      );
    }

    for (const bindings of options?.bindings ?? []) {
      if (bindings === undefined || typeof bindings === "string") {
        this.#encodedRange += encodeVlq(
          this.#nameIdx(bindings),
          "GeneratedRange.bindings.value",
        );
        continue;
      }

      this.#encodedRange += encodeVlq(-bindings.length);
      this.#encodedRange += encodeVlq(this.#nameIdx(bindings[0].value));
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
        this.#encodedRange += encodeVlq(emittedLine);
        this.#encodedRange += encodeVlq(emittedColumn);
        this.#encodedRange += encodeVlq(this.#nameIdx(value));
      }
    }

    return this;
  }

  end(line: number, column: number): this {
    this.#emitItemSepratorIfRequired();

    const relativeLine = line - this.#state.line;
    const relativeColumn = column -
      (relativeLine === 0 ? this.#state.column : 0);
    let emittedColumn = relativeColumn << 1;
    if (relativeLine !== 0) {
      emittedColumn |= 0x1;
      this.#encodedRange += encodeUnsignedVlq(
        emittedColumn,
        "GeneratedRange.end.column",
      );
      this.#encodedRange += encodeUnsignedVlq(
        relativeLine,
        "GeneratedRange.end.line",
      );
    } else {
      this.#encodedRange += encodeUnsignedVlq(
        emittedColumn,
        "GeneratedRange.end.column",
      );
    }

    this.#state.line = line;
    this.#state.column = column;

    return this;
  }

  #emitLineSeparator(line: number): void {
    for (let i = this.#state.line; i < line; ++i) {
      this.#encodedRange += ";";
    }
  }

  #emitItemSepratorIfRequired(): void {
    if (
      this.#encodedRange !== "" &&
      this.#encodedRange[this.#encodedRange.length - 1] !== ";"
    ) {
      this.#encodedRange += ",";
    }
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
