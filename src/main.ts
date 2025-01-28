// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { parseArgs } from "jsr:@std/cli/parse-args";
import { gzip } from "jsr:@deno-library/compress";
import { compress } from "https://deno.land/x/brotli/mod.ts";

import { CODEC as BaseCodec } from "./base/codec.ts";
import { CODEC as BaseNoSemicolonCodec } from "./base_no_semicolon/codec.ts";
import { CODEC as BaseTagCodec} from "./base_tag/codec.ts";
import { CODEC as BaseTagAllCodec } from "./base_tag_all/codec.ts";
import { CODEC as ProposalCodec } from "./proposal/proposal.ts";
import { CODEC as StripNamesCodec } from "./strip_names/strip_names.ts";
import { CODEC as StripScopesCodec } from "./strip_scopes/strip_scopes.ts";
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
      "base-tag",
      "base-tag-all",
      "verify",
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
  if (flags["base-tag"]) {
    codecs.push(BaseTagCodec);
  }
  if (flags["base-tag-all"]) {
    codecs.push(BaseTagAllCodec);
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

    // Use a stripped source map as the base to add scopes info.
    // This allows codecs to add names in a sane order for potential better encoding.
    const strippedMap = StripScopesCodec.encode(scopesInfo, proposalMap);

    const referenceMap = referenceCodec.encode(scopesInfo, strippedMap);
    const baseSizes = calculateMapSizes(referenceMap, undefined, filterSourceMapProps);

    const codecSizes = codecs.map((codec) => {
      const newMap = codec.encode(scopesInfo, strippedMap);
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
