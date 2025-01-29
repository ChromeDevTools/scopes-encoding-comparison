// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { Codec } from "../types.ts";
import { decode } from "./decode.ts";
import { encode } from "./encode.ts";

export const CODEC: Codec = {
  name: "Tag-Value-Length Split Variables (Option F)",
  description:
    "Prefix start/end items with a tag and their length. Separate items for variables/bindings.",
  encode,
  decode,
};
