// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { Codec } from "../types.ts";
import { withUnsignedSupportEnabled } from "../vlq.ts";
import { decode } from "./decode.ts";
import { encode } from "./encode.ts";

export const CODEC: Codec = {
  name: "Base (no semicolon)",
  description: 'Same as "Base" but encodes generated lines as VLQ rather than ";"',
  encode: withUnsignedSupportEnabled(encode),
  decode: withUnsignedSupportEnabled(decode),
};
