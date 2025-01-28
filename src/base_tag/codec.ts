// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { Codec } from "../types.ts";
import { withUnsignedSupportEnabled } from "../vlq.ts";
import { decode } from "./decode.ts";
import { encode } from "./encode.ts";

export const CODEC: Codec = {
  name: "Base (tag)",
  description: 'Same as "base" but emits a "tag" VLQ to distinguish items',
  encode: withUnsignedSupportEnabled(encode),
  decode: withUnsignedSupportEnabled(decode),
};
