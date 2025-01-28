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
import { GeneratedRangeFlag, OriginalScopeFlag, Tag } from "./types.ts";

export function decode(map: SourceMapJson): ScopeInfo {
  if (!map.names || !map.scopes) {
    throw new Error("Nothing to decode!");
  }
 
  return decodeScopes(map.scopes, map.names);
}

function decodeScopes(scopes: string, names: string[]): ScopeInfo {
  const itemForIndex = new Map<number, OriginalScope>();
  const scopeStack: OriginalScope[] = [];
  const scopeResult: OriginalScope[] = [];
  const rangeStack: GeneratedRange[] = [];
  const rangeResult: GeneratedRange[] = [];
  const originalState = {
    line: 0,
    name: 0,
    kind: 0,
  };
  const generatedState = {
    line: 0,
    column: 0,
    defIdx: 0,
    callsiteSourceIdx: 0,
    callsiteLine: 0,
    callsiteColumn: 0,
  };
  const rangeToStartItem = new Map<
    GeneratedRange,
    GeneratedStartItem
  >();
  
  let itemIndex = 0;
  for (const item of decodeScopeItems(scopes)) {
    if (item.tag === Tag.ORIGINAL_START) {
      originalState.line += item.line;
      let kind: string | undefined = undefined;
      if (item.kindIdx !== undefined) {
        originalState.kind += item.kindIdx;
        kind = resolveName(originalState.kind, names);
      }
      let name: string | undefined = undefined;
      if (item.nameIdx !== undefined) {
        originalState.name += item.nameIdx;
        name = resolveName(originalState.name, names);
      }
      const scope: OriginalScope = {
        start: { line: originalState.line, column: item.column },
        end: { line: originalState.line, column: item.column },
        kind,
        name,
        isStackFrame: Boolean(
          item.flags & OriginalScopeFlag.IS_STACK_FRAME,
        ),
        variables: [],
        children: [],
      };
      scopeStack.push(scope);
      itemForIndex.set(itemIndex, scope);
    } else if (item.tag === Tag.VARIABLES) {
      const top = scopeStack.at(-1);
      if (top) {
        top.variables = item.variableIdxs.map((idx) => names[idx]);
      } else {
        throw new Error('Encountered "Variable" item outside of OriginalScope');
      }
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
        originalState.name = 0;
      } else {
        // scope.parent = scopeStack[scopeStack.length - 1];
        scopeStack[scopeStack.length - 1].children.push(scope);
      }
    } else if (item.tag === Tag.GENERATED_START) {
      generatedState.line = generatedState.line + (item.line ?? 0);
      generatedState.column = item.column + (item.line === undefined ? generatedState.column : 0);

      const range: GeneratedRange = {
        start: { line: generatedState.line, column: generatedState.column },
        end: { line: generatedState.line, column: generatedState.column },
        isStackFrame: Boolean(
          item.flags & GeneratedRangeFlag.IS_STACK_FRAME,
        ),
        isHidden: Boolean(item.flags & GeneratedRangeFlag.IS_HIDDEN),
        values: [],
        children: [],
      };

      if (item.definitionIdx !== undefined) {
        generatedState.defIdx += item.definitionIdx;
        const originalScope = itemForIndex.get(generatedState.defIdx);
        if (!originalScope) {
          throw new Error("Invalid original scope index!");
        }
        range.originalScope = originalScope;
      }

      rangeToStartItem.set(range, item);
      rangeStack.push(range);
    } else if (item.tag === Tag.BINDINGS) {
      const top = rangeStack.at(-1);
      if (!top) {
        throw new Error("Encountered bindings item outside of generated range!");
      }
      const values = item.bindingIdxs.map(idx => resolveName(idx, names));
      top.values = values;
    } else if (item.tag === Tag.GENERATED_END) {
      generatedState.line = generatedState.line + (item.line ?? 0);
      generatedState.column = item.column + (item.line === undefined ? generatedState.column : 0);

      const range = rangeStack.pop();
      if (!range) {
        throw new Error(
          'Range items not nested properly: encountered "end" item without "start" item',
        );
      }
      range.end = { line: generatedState.line, column: generatedState.column };

      if (rangeStack.length === 0) {
        generatedState.line = 0;
        generatedState.column = 0;
        generatedState.defIdx = 0;
        rangeResult.push(range);
      } else {
        rangeStack[rangeStack.length - 1].children.push(range);
      }
    }

    ++itemIndex;
  }

  return {
    scopes: scopeResult,
    ranges: rangeResult,
  };
}

interface OriginalStartItem {
  tag: Tag.ORIGINAL_START;
  line: number;
  column: number;
  flags: number;
  nameIdx?: number;
  kindIdx?: number;
}

interface OriginalEndItem {
  tag: Tag.ORIGINAL_END;
  line: number;
  column: number;
}

interface GeneratedStartItem {
  tag: Tag.GENERATED_START;
  line?: number;
  column: number;
  flags: number;
  definitionIdx?: number;
}

interface GeneratedEndItem {
  tag: Tag.GENERATED_END;
  line?: number;
  column: number;
}

interface VariablesItem {
  tag: Tag.VARIABLES;
  variableIdxs: number[],
}

interface BindingsItem {
  tag: Tag.BINDINGS;
  bindingIdxs: number[],
}

type Item = OriginalStartItem|OriginalEndItem|GeneratedStartItem|GeneratedEndItem|VariablesItem|BindingsItem;

function* decodeScopeItems(encodedScopes: string): Generator<Item> {
  const iter = new TokenIterator(encodedScopes);
  
  while (iter.hasNext()) {
    if (iter.peek() === ",") {
      iter.next(); // Consume ','.
      continue;
    }

    const tag = iter.nextUnsignedVLQ();
    if (tag === Tag.ORIGINAL_START) {
      const startItem: OriginalStartItem = {
        tag,
        line: iter.nextUnsignedVLQ(),
        column: iter.nextUnsignedVLQ(),
        flags: iter.nextUnsignedVLQ(),
      };

      if (startItem.flags & OriginalScopeFlag.HAS_NAME) {
        startItem.nameIdx = iter.nextVLQ();
      }
      if (startItem.flags & OriginalScopeFlag.HAS_KIND) {
        startItem.kindIdx = iter.nextVLQ();
      }

      yield startItem;
    } else if (tag === Tag.VARIABLES) {
      const variablesItem: VariablesItem = {
        tag,
        variableIdxs: [],
      };

      while (iter.peek() !== ",") {
        variablesItem.variableIdxs.push(iter.nextVLQ());
      }

      yield variablesItem;
    } else if (tag === Tag.ORIGINAL_END) {
      const endItem: OriginalEndItem = {
        tag,
        line: iter.nextUnsignedVLQ(),
        column: iter.nextUnsignedVLQ(),
      };

      yield endItem;
    } else if (tag === Tag.GENERATED_START) {
      const column = iter.nextUnsignedVLQ();
      const line = (column & 0x1) ? iter.nextUnsignedVLQ() : undefined;

      const startItem: GeneratedStartItem = {
        tag,
        line,
        column: column >> 1,
        flags: iter.nextUnsignedVLQ(),
      };

      if (startItem.flags & GeneratedRangeFlag.HAS_DEFINITION) {
        startItem.definitionIdx = iter.nextVLQ();
      }
      if (startItem.flags & GeneratedRangeFlag.HAS_CALLSITE) {
        throw new Error("Callsite decoding not implemented");
      }

      yield startItem;
    } else if (tag === Tag.BINDINGS) {
      const item: BindingsItem = {
        tag,
        bindingIdxs: [],
      };
      while (iter.peek() !== ",") {
        const idx = iter.nextVLQ();
        if (idx < -1) {
          throw new Error("Binding sub-range decoding not implemented!");
        }
        item.bindingIdxs.push(idx);
      }

      yield item;
    } else if (tag === Tag.GENERATED_END) {
      const column = iter.nextUnsignedVLQ();
      const line = (column & 0x1) ? iter.nextUnsignedVLQ() : undefined;

      const item: GeneratedEndItem = {
        tag,
        line,
        column: column >> 1,
      };

      yield item;
    } else {
      throw new Error(`Tag ${tag} not implemented!`);
    }
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
