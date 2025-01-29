// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { parseArgs } from "jsr:@std/cli/parse-args";

import { CODEC as BaseCodec } from "./base/codec.ts";
import { CODEC as BaseNoSemicolonCodec } from "./base_no_semicolon/codec.ts";
import { CODEC as BaseTagCodec } from "./base_tag/codec.ts";
import { CODEC as ProposalCodec } from "./proposal/proposal.ts";
import { CODEC as StripNamesCodec } from "./strip_names/strip_names.ts";
import { CODEC as StripScopesCodec } from "./strip_scopes/strip_scopes.ts";
import { CODEC as StripSourcesCodec } from "./strip_sources/codec.ts";
import { CODEC as StripSourcesNamesCodec } from "./strip_sources_names/codec.ts";
import { Codec, ScopeInfo, SourceMapJson } from "./types.ts";
import { assertEquals } from "@std/assert";
import { SizesStats } from "./stats.ts";

const VALID_SIZES_REFERENCE = [
  "no-scopes",
  "no-names",
  "no-sources",
  "no-sources-names",
];

if (import.meta.main) {
  const flags = parseArgs(Deno.args, {
    boolean: [
      "base",
      "base-no-semicolon",
      "base-tag",
      "verify",
      "csv",
      "vlq-histograms",
    ],
    string: ["sizes", "sizes-reference"],
    default: { sizes: "scopes", "sizes-reference": "base" },
  });

  if (flags._.length === 0) {
    throw new Error("Usage: main.ts [OPTIONS] FILES...");
  }
  if (flags.sizes !== "scopes" && flags.sizes !== "map") {
    throw new Error("Valid values for 'sizes' are: 'scopes', 'map'");
  }
  if (
    !["base", ...VALID_SIZES_REFERENCE].includes(flags["sizes-reference"])
  ) {
    throw new Error(
      `Valid values for 'sizes-reference' are: ${
        VALID_SIZES_REFERENCE.join(", ")
      }`,
    );
  }
  if (flags.sizes === "scopes" && flags["sizes-reference"] !== "base") {
    throw new Error(
      `--sizes-reference="${flags["sizes-reference"]}" requires --sizes=map`,
    );
  }

  const codecs: Codec[] = [];
  if (flags.base) {
    if (flags["sizes-reference"] !== "base") {
      codecs.push(BaseCodec);
    }
  }
  if (flags["base-no-semicolon"]) {
    codecs.push(BaseNoSemicolonCodec);
  }
  if (flags["base-tag"]) {
    codecs.push(BaseTagCodec);
  }

  const filterSourceMapProps: (keyof SourceMapJson)[] | undefined =
    flags.sizes === "scopes"
      ? ["originalScopes", "generatedRanges", "scopes"]
      : undefined;

  const referenceCodec = flags["sizes-reference"] === "no-scopes"
    ? StripScopesCodec
    : flags["sizes-reference"] === "no-names"
    ? StripNamesCodec
    : flags["sizes-reference"] === "no-sources"
    ? StripSourcesCodec
    : flags["sizes-reference"] === "no-sources-names"
    ? StripSourcesNamesCodec
    : BaseCodec;

  const stats = new SizesStats(referenceCodec.name, filterSourceMapProps);

  for (const file of flags._) {
    const content = Deno.readTextFileSync(file.toString());
    const proposalMap = JSON.parse(content);
    const scopesInfo = ProposalCodec.decode(proposalMap);
    const referenceInfo = ProposalCodec.decode(proposalMap); // scopesInfo is updated with the definition symbol.

    // Use a stripped source map as the base to add scopes info.
    // This allows codecs to add names in a sane order for potential better encoding.
    const strippedMap = StripScopesCodec.encode(scopesInfo, proposalMap);
    const referenceMap = referenceCodec.encode(scopesInfo, strippedMap);

    for (const codec of codecs) {
      const newMap = codec.encode(scopesInfo, strippedMap);
      if (flags.verify) verifyCodec(codec, newMap, referenceInfo);
      stats.addMap(newMap, referenceMap, file.toString(), codec.name);
    }
  }

  if (flags.csv) {
    stats.logCsv();
  } else {
    dumpCodecsInfo([referenceCodec, ...codecs]);
    stats.logTable();
  }

  if (flags["vlq-histograms"]) {
    for (const codec of codecs) {
      if (codec.dumpVlqHistograms) {
        console.log(`\n==== VLQ Histograms for "${codec.name}" ====`);
        codec.dumpVlqHistograms();
      }
    }
  }
}

function dumpCodecsInfo(codecs: Codec[]) {
  codecs.forEach(dumpCodecInfo);
}

function dumpCodecInfo(codec: Codec) {
  console.info("Name:        ", codec.name);
  if (codec.description) {
    console.info("Description: ", codec.description);
  }
  console.info();
}

function verifyCodec(
  codec: Codec,
  newMap: SourceMapJson,
  originalInfo: ScopeInfo,
) {
  const decodedScopes = codec.decode(newMap);

  assertEquals(decodedScopes.scopes.length, originalInfo.scopes.length);
  assertEquals(decodedScopes.ranges.length, originalInfo.ranges.length);

  for (let i = 0; i < originalInfo.scopes.length; ++i) {
    assertEquals(decodedScopes.scopes[i], originalInfo.scopes[i]);
  }

  for (let i = 0; i < originalInfo.ranges.length; ++i) {
    assertEquals(decodedScopes.ranges[i], originalInfo.ranges[i]);
  }
}
