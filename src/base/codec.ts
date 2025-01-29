// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { Codec } from "../types.ts";
import {
  EncoderWithStats,
  withStatsEncoder,
  withUnsignedSupportEnabled,
} from "../vlq.ts";
import { decode } from "./decode.ts";
import { encode } from "./encode.ts";

const encoder = new EncoderWithStats();

export const CODEC: Codec = {
  name: "Base",
  description:
    'A slightly modified version of the currently proposed "Scopes" (stage 3) encoding',
  encode: withStatsEncoder(encoder, withUnsignedSupportEnabled(encode)),
  decode: withUnsignedSupportEnabled(decode),
  dumpVlqHistograms: encoder.dumpVlqHistograms.bind(encoder),
};
