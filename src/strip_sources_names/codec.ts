// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { Codec, ScopeInfo, SourceMapJson } from "../types.ts";
import { encode as stripNames } from "../strip_names/encode.ts";
import { encode as stripSources } from "../strip_sources/encode.ts";

export const CODEC: Codec = {
  name: "Base (no scopes, no sources, no names)",
  description: "Input source map without any sources, scope information. Mappings are stripped of names.",
  encode: (info: ScopeInfo, initialMap: SourceMapJson) => stripSources(info, stripNames(info, initialMap)),
  decode: () => {
    throw new Error(
      "Not implemented, does not make sense for a reference codec.",
    );
  },
};
