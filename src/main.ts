// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { parseArgs } from "jsr:@std/cli/parse-args";
import { gzip } from "jsr:@deno-library/compress";
import { compress } from "https://deno.land/x/brotli/mod.ts";

import { CODEC as BaseCodec } from "./base/codec.ts";
import { CODEC as BaseNoSemicolonCodec } from "./base_no_semicolon/codec.ts";
import { CODEC as ProposalCodec } from "./proposal/proposal.ts";
import { CODEC as ProposalUnsignedCodec } from "./proposal_unsigned/proposal_unsigned.ts";
import { CODEC as PrefixCodec } from "./prefix/prefix.ts";
import { CODEC as PrefixUnsignedCodec } from "./prefix_unsigned/prefix_unsigned.ts";
import { CODEC as RemainingCodec } from "./remaining/remaining.ts";
import { CODEC as RemainingUnsignedCodec } from "./remaining_unsigned/remaining_unsigned.ts";
import { CODEC as StripNamesCodec } from "./strip_names/strip_names.ts";
import { CODEC as StripScopesCodec } from "./strip_scopes/strip_scopes.ts";
import { CODEC as TagSplitCodec } from "./tag_split/tag_split.ts";
import { CODEC as TagSplitUnsignedCodec } from "./tag_split_unsigned/tag_split_unsigned.ts";
import { CODEC as TagSplitVariablesCodec } from "./tag_split_variables/tag_split_variables.ts";
import { CODEC as TagSplitVariablesUnsignedCodec } from "./tag_split_variables_unsigned/tag_split_variables_unsigned.ts";
import { CODEC as TagCombinedCodec } from "./tag_combined/tag_combined.ts";
import { CODEC as TagCombinedUnsignedCodec } from "./tag_combined_unsigned/tag_combined_unsigned.ts";
import { CODEC as TagVariablesCodec } from "./tag_variables/tag_variables.ts";
import { CODEC as TagVariablesUnsignedCodec } from "./tag_variables_unsigned/tag_variables_unsigned.ts";
import { Codec, SourceMapJson } from "./types.ts";
import { assertEquals } from "@std/assert";

const formatter = new Intl.NumberFormat("en-US");
const format = formatter.format.bind(formatter);

const deltaPercentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  signDisplay: "always",
  style: "percent",
});
const formatDeltaPercent = deltaPercentFormatter.format.bind(
  deltaPercentFormatter,
);

if (import.meta.main) {
  const flags = parseArgs(Deno.args, {
    boolean: [
      "base",
      "base-no-semicolon",
      "prefix",
      "verify",
      "proposal",
      "remaining",
      "tag-split",
      "tag-combined",
      "tag-variables",
      "tag-split-variables",
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
    !["base", "no-scopes", "no-names"].includes(flags["sizes-reference"])
  ) {
    throw new Error(
      "Valid values for 'sizes-reference' are: 'base', 'no-scopes', 'no-names'.",
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
  if (flags.prefix) {
    codecs.push(PrefixCodec);
    codecs.push(PrefixUnsignedCodec);
  }
  if (flags.remaining) {
    codecs.push(RemainingCodec);
    codecs.push(RemainingUnsignedCodec);
  }
  if (flags["tag-split"]) {
    codecs.push(TagSplitCodec);
    codecs.push(TagSplitUnsignedCodec);
  }
  if (flags["tag-combined"]) {
    codecs.push(TagCombinedCodec);
    codecs.push(TagCombinedUnsignedCodec);
  }
  if (flags["tag-variables"]) {
    codecs.push(TagVariablesCodec);
    codecs.push(TagVariablesUnsignedCodec);
  }
  if (flags["tag-split-variables"]) {
    codecs.push(TagSplitVariablesCodec);
    codecs.push(TagSplitVariablesUnsignedCodec);
  }
  const filterSourceMapProps: (keyof SourceMapJson)[] | undefined =
    flags.sizes === "scopes"
      ? ["originalScopes", "generatedRanges", "scopes"]
      : undefined;

  const referenceCodec = flags["sizes-reference"] === "no-scopes"
      ? StripScopesCodec
      : flags["sizes-reference"] === "no-names"
      ? StripNamesCodec
      : BaseCodec;
  dumpCodecsInfo([referenceCodec, ...codecs]);

  const result: unknown[] = [];

  for (const file of flags._) {
    const content = Deno.readTextFileSync(file.toString());
    const proposalMap = JSON.parse(content);
    const scopesInfo = ProposalCodec.decode(proposalMap);

    const referenceMap = referenceCodec.encode(scopesInfo, proposalMap);
    const baseSizes = calculateMapSizes(referenceMap, undefined, filterSourceMapProps);

    const codecSizes = codecs.map((codec) => {
      const newMap = codec.encode(scopesInfo, referenceMap);
      if (flags.verify) verifyCodec(codec, newMap, referenceCodec, referenceMap);
      const sizes = calculateMapSizes(newMap, baseSizes, filterSourceMapProps);
      return { Codec: codec.name, ...formatMapSizes(sizes) };
    });

    result.push({ File: file });
    result.push({ Codec: referenceCodec.name, ...formatMapSizes(baseSizes) });
    result.push(...codecSizes);
    result.push({});
  }

  console.table(result, [
    "File",
    "Codec",
    "Uncompressed size",
    "Δ raw",
    "Compressed size (gzip)",
    "Δ gzip",
    "Compressed size (brotli)",
    "Δ brotli",
  ]);
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
  referenceCodec: Codec,
  referenceMap: SourceMapJson,
) {
  const originalInfo = referenceCodec.decode(referenceMap);
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

interface MapSizes {
  raw: number;
  gzip: number;
  brotli: number;
  deltaRaw?: number;
  deltaGzip?: number;
  deltaBrotli?: number;
}

function calculateMapSizes(
  map: SourceMapJson,
  base: MapSizes | undefined,
  props?: (keyof SourceMapJson)[],
): MapSizes {
  const encoder = new TextEncoder();
  const mapToStringify = props
    ? props.reduce((obj, key) => {
        obj[key] = map[key];
        return obj;
      }, {} as any)
    : map;
  const data = encoder.encode(JSON.stringify(mapToStringify));
  const gzipData = gzip(data);
  const brotliData = compress(data);

  const delta = (old: number, ne: number) => (ne - old) / old;
  const deltaRaw = base ? delta(base.raw, data.length) : undefined;
  const deltaGzip = base ? delta(base.gzip, gzipData.length) : undefined;
  const deltaBrotli = base ? delta(base.brotli, brotliData.length) : undefined;

  return {
    raw: data.length,
    gzip: gzipData.length,
    brotli: brotliData.length,
    deltaRaw,
    deltaGzip,
    deltaBrotli,
  };
}

function formatMapSizes(map: MapSizes) {
  const formatDelta = (delta?: number) => {
    if (delta === undefined) return "";
    return formatDeltaPercent(delta);
  };
  return {
    ["Uncompressed size"]: format(map.raw),
    ["Δ raw"]: formatDelta(map.deltaRaw),
    ["Compressed size (gzip)"]: format(map.gzip),
    ["Δ gzip"]: formatDelta(map.deltaGzip),
    ["Compressed size (brotli)"]: format(map.brotli),
    ["Δ brotli"]: formatDelta(map.deltaBrotli),
  };
}
