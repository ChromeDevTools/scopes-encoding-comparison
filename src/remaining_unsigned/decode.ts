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

interface OriginalScopeTree {
  readonly root: OriginalScope;
  readonly scopeForItemIndex: Map<number, OriginalScope>;
}

export function decode(map: SourceMapJson): ScopeInfo {
  if (!map.names || !map.originalScopes || !map.generatedRanges) {
    throw new Error("Nothing to decode!");
  }

  const scopeTrees = decodeOriginalScopes(map.originalScopes, map.names);
  const ranges = decodeGeneratedRanges(
    map.generatedRanges,
    scopeTrees,
    map.names,
  );
  return {
    scopes: scopeTrees.map((tree) => tree.root),
    ranges,
  };
}

function decodeOriginalScopes(
  encodedOriginalScopes: string[],
  names: string[],
): OriginalScopeTree[] {
  return encodedOriginalScopes.map((scope) =>
    decodeOriginalScope(scope, names)
  );
}

function decodeOriginalScope(
  encodedOriginalScope: string,
  names: string[],
): OriginalScopeTree {
  const scopeForItemIndex = new Map<number, OriginalScope>();
  const scopeStack: OriginalScope[] = [];
  let line = 0;
  let kindIdx = 0;

  for (const [index, item] of decodeOriginalScopeItems(encodedOriginalScope)) {
    line += item.line;
    const { column } = item;
    if (isStart(item)) {
      let kind: string | undefined;
      if (item.kind !== undefined) {
        kindIdx += item.kind;
        kind = resolveName(kindIdx, names);
      }
      const name = resolveName(item.name, names);
      const variables = item.variables.map((idx) => names[idx]);
      const scope: OriginalScope = {
        start: { line, column },
        end: { line, column },
        kind,
        name,
        isStackFrame: Boolean(
          item.flags & EncodedOriginalScopeFlag.IS_STACK_FRAME,
        ),
        variables,
        children: [],
      };
      scopeStack.push(scope);
      scopeForItemIndex.set(index, scope);
    } else {
      const scope = scopeStack.pop();
      if (!scope) {
        throw new Error(
          'Scope items not nested properly: encountered "end" item without "start" item',
        );
      }
      scope.end = { line, column };

      if (scopeStack.length === 0) {
        // We are done. There might be more top-level scopes but we only allow one.
        return { root: scope, scopeForItemIndex };
      }
      // scope.parent = scopeStack[scopeStack.length - 1];
      scopeStack[scopeStack.length - 1].children.push(scope);
    }
  }
  throw new Error("Malformed original scope encoding");
}

interface EncodedOriginalScopeStart {
  line: number;
  column: number;
  flags: number;
  name?: number;
  kind?: number;
  variables: number[];
}

export const enum EncodedOriginalScopeFlag {
  HAS_NAME = 0x1,
  HAS_KIND = 0x2,
  IS_STACK_FRAME = 0x4,
}

interface EncodedOriginalScopeEnd {
  line: number;
  column: number;
}

function isStart(
  item: EncodedOriginalScopeStart | EncodedOriginalScopeEnd,
): item is EncodedOriginalScopeStart {
  return "flags" in item;
}

function* decodeOriginalScopeItems(
  encodedOriginalScope: string,
): Generator<[number, EncodedOriginalScopeStart | EncodedOriginalScopeEnd]> {
  const iter = new TokenIterator(encodedOriginalScope);
  let itemCount = 0;

  while (iter.hasNext()) {
    const [line, column] = [iter.nextVLQ(), iter.nextUnsignedVLQ()];

    if ((line & 0x1) > 0) {
      yield [itemCount++, { line: line >> 1, column }];
      continue;
    }

    const startItem: EncodedOriginalScopeStart = {
      line: line >> 1,
      column,
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

    yield [itemCount++, startItem];
  }
}

export function decodeGeneratedRanges(
  encodedGeneratedRange: string,
  originalScopeTrees: OriginalScopeTree[],
  names: string[],
): GeneratedRange[] {
  // We insert a pseudo range as there could be multiple top-level ranges and we need a root range those can be attached to.
  const rangeStack: GeneratedRange[] = [{
    start: { line: 0, column: 0 },
    end: { line: 0, column: 0 },
    isStackFrame: false,
    isHidden: false,
    children: [],
    values: [],
  }];
  const rangeToStartItem = new Map<
    GeneratedRange,
    EncodedGeneratedRangeStart
  >();

  for (const item of decodeGeneratedRangeItems(encodedGeneratedRange)) {
    if (isRangeStart(item)) {
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

      if (item.definition) {
        const { scopeIdx, sourceIdx } = item.definition;
        if (!originalScopeTrees[sourceIdx]) {
          throw new Error("Invalid source index!");
        }
        const originalScope = originalScopeTrees[sourceIdx].scopeForItemIndex
          .get(scopeIdx);
        if (!originalScope) {
          throw new Error("Invalid original scope index!");
        }
        range.originalScope = originalScope;
      }

      if (item.callsite) {
        const { sourceIdx, line, column } = item.callsite;
        if (!originalScopeTrees[sourceIdx]) {
          throw new Error("Invalid source index!");
        }
        range.callsite = {
          sourceIndex: sourceIdx,
          line,
          column,
        };
      }

      rangeToStartItem.set(range, item);
      rangeStack.push(range);
    } else {
      const range = rangeStack.pop();
      if (!range) {
        throw new Error(
          'Range items not nested properly: encountered "end" item without "start" item',
        );
      }
      range.end = { line: item.line, column: item.column };
      resolveBindings(range, names, rangeToStartItem.get(range)?.bindings);
      rangeStack[rangeStack.length - 1].children.push(range);
    }
  }

  if (rangeStack.length !== 1) {
    throw new Error("Malformed generated range encoding");
  }
  return rangeStack[0].children;
}

function resolveBindings(
  range: GeneratedRange,
  names: string[],
  bindingsForAllVars: EncodedGeneratedRangeStart["bindings"] | undefined,
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

interface EncodedGeneratedRangeStart {
  line: number;
  column: number;
  flags: number;
  definition?: {
    sourceIdx: number;
    scopeIdx: number;
  };
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

interface EncodedGeneratedRangeEnd {
  line: number;
  column: number;
}

export const enum EncodedGeneratedRangeFlag {
  HAS_DEFINITION = 0x1,
  HAS_CALLSITE = 0x2,
  IS_STACK_FRAME = 0x4,
  IS_HIDDEN = 0x8,
}

function isRangeStart(
  item: EncodedGeneratedRangeStart | EncodedGeneratedRangeEnd,
): item is EncodedGeneratedRangeStart {
  return "flags" in item;
}

function* decodeGeneratedRangeItems(
  encodedGeneratedRange: string,
): Generator<EncodedGeneratedRangeStart | EncodedGeneratedRangeEnd> {
  const iter = new TokenIterator(encodedGeneratedRange);

  // The state are the fields of the last produced item, tracked because many
  // are relative to the preceeding item.
  const state = {
    line: 0,
    column: 0,
    defSourceIdx: 0,
    defScopeIdx: 0,
    callsiteSourceIdx: 0,
    callsiteLine: 0,
    callsiteColumn: 0,
  };

  while (iter.hasNext()) {
    const emittedColumn = iter.nextVLQ();
    const line = state.line + (emittedColumn & 0x1 ? iter.nextVLQ() : 0);
    state.column = (emittedColumn >> 2) +
      (line === state.line ? state.column : 0);
    state.line = line;
    if ((emittedColumn & 0x2) > 0) {
      yield { line, column: state.column };
      continue;
    }

    const startItem: EncodedGeneratedRangeStart = {
      line: state.line,
      column: state.column,
      flags: iter.nextUnsignedVLQ(),
      bindings: [],
    };

    if (startItem.flags & EncodedGeneratedRangeFlag.HAS_DEFINITION) {
      const sourceIdx = iter.nextVLQ();
      const scopeIdx = iter.nextVLQ();
      state.defScopeIdx = scopeIdx + (sourceIdx === 0 ? state.defScopeIdx : 0);
      state.defSourceIdx += sourceIdx;
      startItem.definition = {
        sourceIdx: state.defSourceIdx,
        scopeIdx: state.defScopeIdx,
      };
    }

    if (startItem.flags & EncodedGeneratedRangeFlag.HAS_CALLSITE) {
      const sourceIdx = iter.nextVLQ();
      const line = iter.nextVLQ();
      const column = iter.nextVLQ();
      state.callsiteColumn = column +
        (line === 0 && sourceIdx === 0 ? state.callsiteColumn : 0);
      state.callsiteLine = line + (sourceIdx === 0 ? state.callsiteLine : 0);
      state.callsiteSourceIdx += sourceIdx;
      startItem.callsite = {
        sourceIdx: state.callsiteSourceIdx,
        line: state.callsiteLine,
        column: state.callsiteColumn,
      };
    }

    const bindingsCount = iter.nextUnsignedVLQ();
    for (let i = 0; i < bindingsCount; ++i) {
      const bindings: EncodedGeneratedRangeStart["bindings"][number] = [];
      startItem.bindings.push(bindings);

      const idxOrSubrangeCount = iter.nextVLQ();
      if (idxOrSubrangeCount >= -1) {
        // Variable is available under the same expression in the whole range, or it's unavailable in the whole range.
        bindings.push({
          line: startItem.line,
          column: startItem.column,
          nameIdx: idxOrSubrangeCount,
        });
        continue;
      }

      // Variable is available under different expressions in this range or unavailable in parts of this range.
      bindings.push({
        line: startItem.line,
        column: startItem.column,
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
  }
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
