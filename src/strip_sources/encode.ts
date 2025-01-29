// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { ScopeInfo, SourceMapJson } from "../types.ts";

export function encode(
  _info: ScopeInfo,
  initialMap: SourceMapJson,
): SourceMapJson {
  const map = { ...initialMap };
  delete map.originalScopes;
  delete map.generatedRanges;

  delete map.sourcesContent;

  return map;
}
