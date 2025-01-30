// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

export const enum Tag {
  ORIGINAL_START = 0x1,
  ORIGINAL_END = 0x2,
  GENERATED_START = 0x3,
  GENERATED_END = 0x4,
  GENERATED_END_WITH_LINE = 0x5,
  VARIABLES = 0x6,
  BINDINGS = 0x7,
}

export const enum OriginalScopeFlag {
  HAS_NAME = 0x1,
  HAS_KIND = 0x2,
  IS_STACK_FRAME = 0x4,
}

export const enum GeneratedRangeFlag {
  HAS_LINE = 0x1,
  HAS_DEFINITION = 0x2,
  IS_STACK_FRAME = 0x4,
  IS_HIDDEN = 0x8,
  HAS_CALLSITE = 0x10,
}
