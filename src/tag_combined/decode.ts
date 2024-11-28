// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {
  BindingRange,
  GeneratedRange,
  OriginalPosition,
  OriginalScope,
  Position,
  ScopeInfo,
  SourceMapJson,
} from "../types.ts";
import { TokenIterator } from "../vlq.ts";
import { Tag } from "./types.ts";

export function decode(map: SourceMapJson): ScopeInfo {
  if (!map.names || !map.scopes) {
    throw new Error("Nothing to decode!");
  }
  return decodeScopes(map.scopes, map.names);
}

interface Scope extends OriginalScope {
  internalKind?: "scope";
}

interface Range extends GeneratedRange {
  internalKind?: "range";
}

function decodeScopes(encodedScopes: string, names: string[]): ScopeInfo {
  const itemForIndex = new Map<number, OriginalScope>();
  const stack: (Scope | Range)[] = [];
  const scopeResult: OriginalScope[] = [];
  const rangeResult: GeneratedRange[] = [];
  const originalState = {
    line: 0,
    kind: 0,
  };
  const rangeState = {
    line: 0,
    column: 0,
  };
  const rangeToStartItem = new Map<
    GeneratedRange,
    GeneratedItem
  >();

  for (const item of decodeScopeItem(encodedScopes)) {
    if (item.tag === Tag.ORIGINAL) {
      originalState.line += item.startLine;
      let kind: string | undefined = undefined;
      if (item.kind !== undefined) {
        originalState.kind += item.kind;
        kind = resolveName(originalState.kind, names);
      }
      const name = resolveName(item.name, names);
      const variables = item.variables.map((idx) => names[idx]);
      const scope: Scope = {
        internalKind: "scope",
        start: { line: originalState.line, column: item.startColumn },
        end: { line: item.endLine, column: item.endColumn },
        kind,
        name,
        isStackFrame: Boolean(
          item.flags & EncodedOriginalScopeFlag.IS_STACK_FRAME,
        ),
        variables,
        children: [],
      };
      stack.push(scope);
      itemForIndex.set(item.index, scope);
    } else if (
      item.tag === Tag.EMPTY && stack.at(-1)?.internalKind === "scope"
    ) {
      const scope = stack.pop() as Scope;
      const endReference = scope.children.at(-1)?.end ?? scope.start;
      scope.end.line += endReference.line;

      originalState.line = scope.end.line;
      if (!scope) {
        throw new Error(
          'Scope items not nested properly: encountered "end" item without "start" item',
        );
      }
      delete scope.internalKind;

      if (stack.length === 0) {
        // We are done. There might be more top-level scopes but we only allow one.
        scopeResult.push(scope);
        originalState.line = 0;
        originalState.kind = 0;
      } else {
        // scope.parent = scopeStack[scopeStack.length - 1];
        (stack[stack.length - 1] as Scope).children.push(scope);
      }
    } else if (item.tag === Tag.GENERATED) {
      const startLine = rangeState.line + item.startLine;
      const startColumn = startLine === rangeState.line
        ? rangeState.column + item.startColumn
        : item.startColumn;
      rangeState.line = startLine;
      rangeState.column = startColumn;

      const range: Range = {
        internalKind: "range",
        start: { line: startLine, column: startColumn },
        end: { line: item.endLine, column: item.endColumn },
        isStackFrame: Boolean(
          item.flags & EncodedGeneratedRangeFlag.IS_STACK_FRAME,
        ),
        isHidden: Boolean(item.flags & EncodedGeneratedRangeFlag.IS_HIDDEN),
        values: [],
        children: [],
      };

      if (item.definition !== undefined) {
        const originalScope = itemForIndex.get(item.definition);
        if (!originalScope) {
          throw new Error("Invalid original scope index!");
        }
        range.originalScope = originalScope;
      }

      if (item.callsite) {
        const { sourceIdx, line, column } = item.callsite;
        range.callsite = {
          sourceIndex: sourceIdx,
          line,
          column,
        };
      }

      rangeToStartItem.set(range, item);
      stack.push(range);
    } else if (
      item.tag === Tag.EMPTY && stack.at(-1)?.internalKind === "range"
    ) {
      const range = stack.pop() as Range;
      if (!range) {
        throw new Error(
          'Range items not nested properly: encountered "end" item without "start" item',
        );
      }
      const endReference = range.children.at(-1)?.end ?? range.start;
      rangeState.column = range.end.line !== 0
        ? range.end.column
        : (endReference.column + range.end.column);
      rangeState.line = endReference.line + range.end.line;
      range.end = { line: rangeState.line, column: rangeState.column };

      resolveBindings(range, names, rangeToStartItem.get(range)?.bindings);
      delete range.internalKind;

      if (stack.length === 0) {
        rangeResult.push(range);
      } else {
        (stack[stack.length - 1] as Range).children.push(range);
      }
    }
  }

  return {
    scopes: scopeResult,
    ranges: rangeResult,
  };
}

type Item =
  | { tag: Tag.EMPTY }
  | {
    tag: Tag.ORIGINAL;
    index: number;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    flags: number;
    name?: number;
    kind?: number;
    variables: number[];
  }
  | GeneratedItem;

interface GeneratedItem {
  tag: Tag.GENERATED;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  flags: number;
  definition?: number;
  callsite?: {
    sourceIdx: number;
    line: number;
    column: number;
  };
  bindings: {
    line: number;
    column: number;
    nameIdx: number;
  }[][];
}

function* decodeScopeItem(encodedScopes: string): Generator<Item> {
  const iter = new TokenIterator(encodedScopes);
  let itemCount = 0;

  // The state are the fields of the last produced item, tracked because many
  // are relative to the preceeding item.
  const generatedState = {
    defIdx: 0,
    callsiteSourceIdx: 0,
    callsiteLine: 0,
    callsiteColumn: 0,
  };

  while (iter.hasNext()) {
    const tag = iter.nextUnsignedVLQ();
    if (tag === Tag.ORIGINAL) {
      const _count = iter.nextUnsignedVLQ();
      const [startLine, startColumn, endLine, endColumn] = [
        iter.nextUnsignedVLQ(),
        iter.nextUnsignedVLQ(),
        iter.nextUnsignedVLQ(),
        iter.nextUnsignedVLQ(),
      ];

      const startItem: Item = {
        tag,
        index: itemCount,
        startLine,
        startColumn,
        endLine,
        endColumn,
        flags: iter.nextUnsignedVLQ(),
        variables: [],
      };

      if (startItem.flags & EncodedOriginalScopeFlag.HAS_NAME) {
        startItem.name = iter.nextUnsignedVLQ();
      }
      if (startItem.flags & EncodedOriginalScopeFlag.HAS_KIND) {
        startItem.kind = iter.nextVLQ();
      }

      const variableCount = iter.nextUnsignedVLQ();
      for (let i = 0; i < variableCount; ++i) {
        startItem.variables.push(iter.nextUnsignedVLQ());
      }
      yield startItem;
    } else if (tag === Tag.GENERATED) {
      const _count = iter.nextUnsignedVLQ();
      const emittedStartColumn = iter.nextUnsignedVLQ();
      const startLine = emittedStartColumn & 0x1 ? iter.nextUnsignedVLQ() : 0;

      const emittedEndColumn = iter.nextUnsignedVLQ();
      const endLine = (emittedEndColumn & 0x1) ? iter.nextUnsignedVLQ() : 0;

      const startItem: Item = {
        tag,
        startLine,
        startColumn: (emittedStartColumn >> 1),
        endLine,
        endColumn: (emittedEndColumn >> 1),
        flags: iter.nextUnsignedVLQ(),
        bindings: [],
      };

      if (startItem.flags & EncodedGeneratedRangeFlag.HAS_DEFINITION) {
        generatedState.defIdx += iter.nextVLQ();
        startItem.definition = generatedState.defIdx;
      }

      if (startItem.flags & EncodedGeneratedRangeFlag.HAS_CALLSITE) {
        const sourceIdx = iter.nextVLQ();
        const line = iter.nextVLQ();
        const column = iter.nextVLQ();
        generatedState.callsiteColumn = column +
          (line === 0 && sourceIdx === 0 ? generatedState.callsiteColumn : 0);
        generatedState.callsiteLine = line +
          (sourceIdx === 0 ? generatedState.callsiteLine : 0);
        generatedState.callsiteSourceIdx += sourceIdx;
        startItem.callsite = {
          sourceIdx: generatedState.callsiteSourceIdx,
          line: generatedState.callsiteLine,
          column: generatedState.callsiteColumn,
        };
      }

      const bindingsCount = iter.nextUnsignedVLQ();
      for (let i = 0; i < bindingsCount; ++i) {
        const bindings: GeneratedItem["bindings"][number] = [];
        startItem.bindings.push(bindings);

        const idxOrSubrangeCount = iter.nextVLQ();
        if (idxOrSubrangeCount >= -1) {
          // Variable is available under the same expression in the whole range, or it's unavailable in the whole range.
          bindings.push({
            line: startItem.startLine,
            column: startItem.startColumn,
            nameIdx: idxOrSubrangeCount,
          });
          continue;
        }

        // Variable is available under different expressions in this range or unavailable in parts of this range.
        bindings.push({
          line: startItem.startLine,
          column: startItem.startColumn,
          nameIdx: iter.nextVLQ(),
        });
        const rangeCount = -idxOrSubrangeCount;
        for (let i = 0; i < rangeCount - 1; ++i) {
          // line, column, valueOffset
          const line = iter.nextVLQ();
          const column = iter.nextVLQ();
          const nameIdx = iter.nextVLQ();

          const lastLine = bindings.at(-1)?.line ?? 0; // Only to make TS happy. `bindings` has one entry guaranteed.
          const lastColumn = bindings.at(-1)?.column ?? 0; // Only to make TS happy. `bindings` has one entry guaranteed.

          bindings.push({
            line: line + lastLine,
            column: column + (line === 0 ? lastColumn : 0),
            nameIdx,
          });
        }
      }

      yield startItem;
    } else if (tag === Tag.EMPTY) {
      // Empty tag doesn't count towards indices.
      yield { tag };
      continue;
    } else {
      throw new Error(`Unrecognized tag: ${tag}`);
    }
    itemCount++;
  }
}

export const enum EncodedOriginalScopeFlag {
  HAS_NAME = 0x1,
  HAS_KIND = 0x2,
  IS_STACK_FRAME = 0x4,
}

function resolveBindings(
  range: GeneratedRange,
  names: string[],
  bindingsForAllVars: GeneratedItem["bindings"] | undefined,
): void {
  if (bindingsForAllVars === undefined) {
    return;
  }

  range.values = bindingsForAllVars.map((bindings) => {
    if (bindings.length === 1) {
      return resolveName(bindings[0].nameIdx, names);
    }

    const bindingRanges: BindingRange[] = bindings.map((binding) => ({
      from: { line: binding.line, column: binding.column },
      to: { line: binding.line, column: binding.column },
      value: resolveName(binding.nameIdx, names),
    }));
    for (let i = 1; i < bindingRanges.length; ++i) {
      bindingRanges[i - 1].to = { ...bindingRanges[i].from };
    }
    bindingRanges[bindingRanges.length - 1].to = { ...range.end };
    return bindingRanges;
  });
}

export const enum EncodedGeneratedRangeFlag {
  HAS_DEFINITION = 0x1,
  HAS_CALLSITE = 0x2,
  IS_STACK_FRAME = 0x4,
  IS_HIDDEN = 0x8,
}

function resolveName(
  idx: number | undefined,
  names: string[],
): string | undefined {
  if (idx === undefined || idx < 0) {
    return undefined;
  }
  return names[idx];
}
