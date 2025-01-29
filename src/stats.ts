// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { gzip } from "jsr:@deno-library/compress";
import { compress } from "https://deno.land/x/brotli@0.1.7/mod.ts";

import { SourceMapJson } from "./types.ts";

export class SizesStats {
  readonly #stats = new Map<string, Map<string, MapSizes>>();
  readonly #referenceSizes = new Map<string, MapSizes>();
  readonly #filterSourceMapProps?: (keyof SourceMapJson)[];
  readonly #referenceCodecName: string;

  constructor(referenceCodecName: string, filterSourceMapProps?: (keyof SourceMapJson)[]) {
    this.#referenceCodecName = referenceCodecName;
    this.#filterSourceMapProps = filterSourceMapProps;
  }

  addMap(map: SourceMapJson, referenceMap: SourceMapJson, file: string, codecName: string): void {
    const referenceSizes = this.#getOrCalculateRefSizes(file, referenceMap);
    const sizes = this.#calculateMapSizes(map, referenceSizes);
    const perFileStats = this.#perFileStats(file);
    perFileStats.set(codecName, sizes);
  }

  logTable(): void {
    const result: unknown[] = [];

    for (const [file, perFileStats] of this.#stats) {
      result.push({ File: file });
      result.push({ Codec: this.#referenceCodecName, ...formatMapSizes(this.#referenceSizes.get(file)!)})
      for (const [codecName, sizes] of perFileStats) {
        result.push( { Codec: codecName, ...formatMapSizes(sizes)});
      }
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

  logCsv(): void {
    console.log("File,Codec,Uncompressed size,Δ,Compressed size (gzip),Δ,Compressed size (brotli),Δ");

    for (const [file, perFileStats] of this.#stats) {
      const baseSizes = this.#referenceSizes.get(file)!;
      console.log(`${file},${this.#referenceCodecName},${baseSizes.raw},,${baseSizes.gzip},,${baseSizes.brotli},`);

      for (const [codecName, sizes] of perFileStats) {
        console.log(`${file},${codecName},${sizes.raw},${sizes.deltaRaw},${sizes.gzip},${sizes.deltaGzip},${sizes.brotli},${sizes.deltaBrotli}`);
      }
      console.log(",,,,,,,");
    }
  }

  #getOrCalculateRefSizes(file: string, referenceMap: SourceMapJson): MapSizes {
    let sizes = this.#referenceSizes.get(file);
    if (!sizes) {
      sizes = this.#calculateMapSizes(referenceMap, undefined);
      this.#referenceSizes.set(file, sizes);
    }
    return sizes;
  }

  #perFileStats(file: string): Map<string, MapSizes> {
    let map = this.#stats.get(file);
    if (!map) {
      map = new Map<string, MapSizes>();
      this.#stats.set(file, map);
    }
    return map;
  }

  #calculateMapSizes(map: SourceMapJson, referenceSizes: MapSizes|undefined): MapSizes {
    const encoder = new TextEncoder();
    const mapToStringify = this.#filterSourceMapProps
      ? this.#filterSourceMapProps.reduce((obj, key) => {
          obj[key] = map[key];
          return obj;
        }, {} as any)
      : map;
    const data = encoder.encode(JSON.stringify(mapToStringify));
    const gzipData = gzip(data);
    const brotliData = compress(data);
  
    const delta = (old: number, ne: number) => (ne - old) / old;
    const deltaRaw = referenceSizes ? delta(referenceSizes.raw, data.length) : undefined;
    const deltaGzip = referenceSizes ? delta(referenceSizes.gzip, gzipData.length) : undefined;
    const deltaBrotli = referenceSizes ? delta(referenceSizes.brotli, brotliData.length) : undefined;
  
    return {
      raw: data.length,
      gzip: gzipData.length,
      brotli: brotliData.length,
      deltaRaw,
      deltaGzip,
      deltaBrotli,
    };
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
