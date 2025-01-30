// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {
  SourceMapConsumer,
  SourceMapGenerator,
} from "npm:@jridgewell/source-map@0.3.6";

import { ScopeInfo, SourceMapJson } from "../types.ts";

export function encode(
  _info: ScopeInfo,
  initialMap: SourceMapJson,
): SourceMapJson {
  const map = { ...initialMap };
  delete map.originalScopes;
  delete map.generatedRanges;

  const consumer = new SourceMapConsumer(initialMap, null);
  const generator = new SourceMapGenerator(map);

  consumer.eachMapping((mapping: any) => {
    generator.addMapping({
      source: mapping.source,
      generated: {
        line: mapping.generatedLine,
        column: mapping.generatedColumn,
      },
      original: { line: mapping.originalLine, column: mapping.originalColumn },
    });
  });

  const tmpMap = generator.toJSON();
  map.names = tmpMap.names;
  map.mappings = tmpMap.mappings;
  return map;
}
