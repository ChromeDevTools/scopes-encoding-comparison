// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { parseArgs } from "jsr:@std/cli/parse-args";
import { gzip } from "jsr:@deno-library/compress";
import { compress } from "https://deno.land/x/brotli/mod.ts";

import { CODEC as ProposalCodec } from "./proposal/proposal.ts";
import { CODEC as ProposalUnsignedCodec } from "./proposal_unsigned/proposal_unsigned.ts";
import { CODEC as PrefixCodec } from "./prefix/prefix.ts";
import { CODEC as PrefixUnsignedCodec } from "./prefix_unsigned/prefix_unsigned.ts";
import { CODEC as RemainingCodec } from "./remaining/remaining.ts";
import { CODEC as RemainingUnsignedCodec } from "./remaining_unsigned/remaining_unsigned.ts";
import { CODEC as TagSplitCodec } from "./tag_split/tag_split.ts";
import { CODEC as TagSplitUnsignedCodec } from "./tag_split_unsigned/tag_split_unsigned.ts";
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
      "prefix",
      "verify",
      "proposal",
      "remaining",
      "tag-split",
      "tag-combined",
      "tag-variables",
    ],
    string: ["sizes"],
    default: { sizes: "scopes" },
  });

  if (flags._.length === 0) {
    throw new Error("Usage: main.ts [OPTIONS] FILES...");
  }
  if (flags.sizes !== "scopes" && flags.sizes !== "map") {
    throw new Error("Valid values for 'sizes' are: 'scopes', 'map'");
  }

  const codecs: Codec[] = [];
  if (flags.proposal) {
    codecs.push(ProposalUnsignedCodec);
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
  const filterSourceMapProps: (keyof SourceMapJson)[] | undefined =
    flags.sizes === "scopes"
      ? ["originalScopes", "generatedRanges", "scopes"]
      : undefined;

  dumpCodecsInfo(codecs);

  const result: unknown[] = [];

  for (const file of flags._) {
    const content = Deno.readTextFileSync(file.toString());
    const map = JSON.parse(content);
    const baseSizes = calculateMapSizes(map, undefined, filterSourceMapProps);
    const scopesInfo = ProposalCodec.decode(map);

    const codecSizes = codecs.map((codec) => {
      const newMap = codec.encode(scopesInfo, map);
      if (flags.verify) verifyCodec(codec, map, newMap);
      const sizes = calculateMapSizes(newMap, baseSizes, filterSourceMapProps);
      return { Codec: codec.name, ...formatMapSizes(sizes) };
    });

    result.push({ File: file });
    result.push({ Codec: ProposalCodec.name, ...formatMapSizes(baseSizes) });
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
  dumpCodecInfo(ProposalCodec);
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
  initialMap: SourceMapJson,
  newMap: SourceMapJson,
) {
  const originalInfo = ProposalCodec.decode(initialMap);
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
