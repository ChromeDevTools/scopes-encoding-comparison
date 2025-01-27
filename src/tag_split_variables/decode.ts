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
import { TokenIterator } from "../vlq.ts";
import { Tag } from "./types.ts";

export function decode(map: SourceMapJson): ScopeInfo {
  if (!map.names || !map.scopes) {
    throw new Error("Nothing to decode!");
  }
  return decodeScopes(map.scopes, map.names);
}

function decodeScopes(encodedScopes: string, names: string[]): ScopeInfo {
  const itemForIndex = new Map<number, OriginalScope>();
  const scopeStack: OriginalScope[] = [];
  const scopeResult: OriginalScope[] = [];
  const rangeStack: GeneratedRange[] = [];
  const rangeResult: GeneratedRange[] = [];
  const originalState = {
    line: 0,
    kind: 0,
  };
  const rangeToStartItem = new Map<
    GeneratedRange,
    GeneratedStartItem
  >();

  for (const item of decodeScopeItem(encodedScopes)) {
    if (item.tag === Tag.ORIGINAL_START) {
      originalState.line += item.line;
      let kind: string | undefined = undefined;
      if (item.kind !== undefined) {
        originalState.kind += item.kind;
        kind = resolveName(originalState.kind, names);
      }
      const name = resolveName(item.name, names);
      const scope: OriginalScope = {
        start: { line: originalState.line, column: item.column },
        end: { line: originalState.line, column: item.column },
        kind,
        name,
        isStackFrame: Boolean(
          item.flags & EncodedOriginalScopeFlag.IS_STACK_FRAME,
        ),
        variables: [],
        children: [],
      };
      scopeStack.push(scope);
      itemForIndex.set(item.index, scope);
    } else if (item.tag === Tag.ORIGINAL_END) {
      originalState.line += item.line;
      const scope = scopeStack.pop();
      if (!scope) {
        throw new Error(
          'Scope items not nested properly: encountered "end" item without "start" item',
        );
      }
      scope.end = { line: originalState.line, column: item.column };

      if (scopeStack.length === 0) {
        // We are done. There might be more top-level scopes but we only allow one.
        scopeResult.push(scope);
        originalState.line = 0;
        originalState.kind = 0;
      } else {
        // scope.parent = scopeStack[scopeStack.length - 1];
        scopeStack[scopeStack.length - 1].children.push(scope);
      }
    } else if (item.tag === Tag.VARIABLES) {
      const variables = item.variables.map((idx) => names[idx]);
      (scopeStack.at(-1) as OriginalScope).variables = variables;
    } else if (item.tag === Tag.GENERATED_START) {
      const range: GeneratedRange = {
        start: { line: item.line, column: item.column },
        end: { line: item.line, column: item.column },
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
      rangeStack.push(range);
    } else if (item.tag === Tag.GENERATED_END) {
      const range = rangeStack.pop();
      if (!range) {
        throw new Error(
          'Range items not nested properly: encountered "end" item without "start" item',
        );
      }
      range.end = { line: item.line, column: item.column };
      resolveBindings(range, names, rangeToStartItem.get(range)?.bindings);

      if (rangeStack.length === 0) {
        rangeResult.push(range);
      } else {
        rangeStack[rangeStack.length - 1].children.push(range);
      }
    } else if (item.tag === Tag.BINDINGS) {
      const startItem = rangeToStartItem.get(rangeStack.at(-1) as GeneratedRange);
      startItem!.bindings = item.bindings;
    }
  }

  return {
    scopes: scopeResult,
    ranges: rangeResult,
  };
}

type Item =
  | {
    tag: Tag.ORIGINAL_START;
    index: number;
    line: number;
    column: number;
    flags: number;
    name?: number;
    kind?: number;
  }
  | {
    tag: Tag.ORIGINAL_END;
    line: number;
    column: number;
  }
  | {
    tag: Tag.VARIABLES;
    variables: number[];
  }
  | GeneratedStartItem
  | {
    tag: Tag.GENERATED_END;
    line: number;
    column: number;
  }
  | BindingItem;

interface GeneratedStartItem {
  tag: Tag.GENERATED_START;
  line: number;
  column: number;
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

interface BindingItem {
  tag: Tag.BINDINGS;
  bindings: {
    line: number;
    column: number;
    nameIdx: number;
  }[][];
}

function* decodeScopeItem(encodedScopes: string): Generator<Item> {
  const iter = new TokenIterator(encodedScopes);
  let itemCount = 0;
  let lastGeneratedItem: GeneratedStartItem | undefined = undefined;

  // The state are the fields of the last produced item, tracked because many
  // are relative to the preceeding item.
  const generatedState = {
    line: 0,
    column: 0,
    defIdx: 0,
    callsiteSourceIdx: 0,
    callsiteLine: 0,
    callsiteColumn: 0,
  };

  while (iter.hasNext()) {
    const [tag, count] = [iter.nextUnsignedVLQ(), iter.nextUnsignedVLQ()];
    if (tag === Tag.ORIGINAL_START) {
      const [line, column] = [iter.nextUnsignedVLQ(), iter.nextUnsignedVLQ()];

      const startItem: Item = {
        tag,
        index: itemCount,
        line,
        column,
        flags: iter.nextUnsignedVLQ(),
      };

      if (startItem.flags & EncodedOriginalScopeFlag.HAS_NAME) {
        startItem.name = iter.nextUnsignedVLQ();
      }
      if (startItem.flags & EncodedOriginalScopeFlag.HAS_KIND) {
        startItem.kind = iter.nextVLQ();
      }

      yield startItem;
    } else if (tag === Tag.ORIGINAL_END) {
      const [line, column] = [iter.nextUnsignedVLQ(), iter.nextUnsignedVLQ()];
      yield { tag, line, column };
    } else if (tag === Tag.VARIABLES) {
      const item: Item = {
        tag,
        variables: [],
      };
      for (let i = 0; i < count; ++i) {
        item.variables.push(iter.nextUnsignedVLQ());
      }
      yield item;
    } else if (tag === Tag.GENERATED_START) {
      const emittedColumn = iter.nextUnsignedVLQ();
      const line = generatedState.line +
        (emittedColumn & 0x1 ? iter.nextUnsignedVLQ() : 0);
      generatedState.column = (emittedColumn >> 1) +
        (line === generatedState.line ? generatedState.column : 0);
      generatedState.line = line;

      const startItem: Item = {
        tag,
        line: generatedState.line,
        column: generatedState.column,
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

      lastGeneratedItem = startItem;

      yield startItem;
    } else if (tag === Tag.GENERATED_END) {
      const emittedColumn = iter.nextUnsignedVLQ();
      const line = generatedState.line +
        (emittedColumn & 0x1 ? iter.nextUnsignedVLQ() : 0);
      generatedState.column = (emittedColumn >> 1) +
        (line === generatedState.line ? generatedState.column : 0);
      generatedState.line = line;
      yield { tag, line, column: generatedState.column };
    } else if (tag === Tag.BINDINGS) {
      const item: Item = {
        tag,
        bindings: [],
      };
      const bindingsCount = iter.nextUnsignedVLQ();
      for (let i = 0; i < bindingsCount; ++i) {
        const bindings: BindingItem["bindings"][number] = [];
        item.bindings.push(bindings);

        const idxOrSubrangeCount = iter.nextVLQ();
        if (idxOrSubrangeCount >= -1) {
          // Variable is available under the same expression in the whole range, or it's unavailable in the whole range.
          bindings.push({
            line: lastGeneratedItem?.line ?? 0,
            column: lastGeneratedItem?.column ?? 0,
            nameIdx: idxOrSubrangeCount,
          });
          continue;
        }

        // Variable is available under different expressions in this range or unavailable in parts of this range.
        bindings.push({
          line: lastGeneratedItem?.line ?? 0,
          column: lastGeneratedItem?.column ?? 0,
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

      yield item;
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
  bindingsForAllVars: GeneratedStartItem["bindings"] | undefined,
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
