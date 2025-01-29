// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { Codec } from "../types.ts";
import { encode } from "./encode.ts";

export const CODEC: Codec = {
  name: "Base (no scopes, no names)",
  description:
    "Input source map without any scope information and mappings stripped of their name.",
  encode,
  decode: () => {
    throw new Error(
      "Not implemented, does not make sense for a reference codec.",
    );
  },
};
