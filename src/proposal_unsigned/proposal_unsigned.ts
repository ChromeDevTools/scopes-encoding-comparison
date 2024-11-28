// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { Codec } from "../types.ts";
import { decode } from "../proposal/decode.ts";
import { encode } from "../proposal/encode.ts";
import { withUnsignedSupportEnabled } from "../vlq.ts";

export const CODEC: Codec = {
  name: "Proposal (unsigned)",
  description:
    'The currently proposed "Scopes" (stage 3) encoding.  Use unsigned VLQ where appropriate.',
  encode: withUnsignedSupportEnabled(encode),
  decode: withUnsignedSupportEnabled(decode),
};
