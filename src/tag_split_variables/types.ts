// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

export const enum Tag {
  Empty = 0x0,
  ORIGINAL_START = 0x1,
  ORIGINAL_END = 0x2,
  GENERATED_START = 0x3,
  GENERATED_END = 0x4,
  VARIABLES = 0x5,
  BINDINGS = 0x6,
}
