// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * If "unsigned support" is disabled, the "encodeUnsignedVlq", "encodeMixedVlqList" and
 * TokenIterator.nextUnsignedVLQ functions, will still encode signed VLQs. This allows for
 * easy comparison of signed-only/unsigned encoding schemes.
 */
let unsignedSupportEnabled = false;

export function withUnsignedSupportEnabled<Args extends unknown[], Return>(
  fn: (...args: Args) => Return,
): (...args: Args) => Return {
  return (...args: Args) => {
    const backup = unsignedSupportEnabled;
    unsignedSupportEnabled = true;
    const result = fn(...args);
    unsignedSupportEnabled = backup;
    return result;
  };
}

export function withUnsignedSupportDisabled<Args extends unknown[], Return>(
  fn: (...args: Args) => Return,
): (...args: Args) => Return {
  return (...args: Args) => {
    const backup = unsignedSupportEnabled;
    unsignedSupportEnabled = false;
    const result = fn(...args);
    unsignedSupportEnabled = backup;
    return result;
  };
}

export const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export const BASE64_CODES = new Uint8Array(123);
for (let index = 0; index < BASE64_CHARS.length; ++index) {
  BASE64_CODES[BASE64_CHARS.charCodeAt(index)] = index;
}

const VLQ_BASE_SHIFT = 5;
const VLQ_BASE_MASK = (1 << 5) - 1;
const VLQ_CONTINUATION_MASK = 1 << 5;

/**
 * This class tracks character count histograms while emitting VLQs.
 */
export class EncoderWithStats {
  readonly #stats = new Map<string, number[]>();

  encodeSignedVlq(n: number, label?: string): string {
    const encoded = encodeVlqInternal(n);
    this.#trackStats(label, n, encoded);
    return encoded;
  }

  encodeUnsignedVlq(n: number, label?: string): string {
    const encoded = unsignedSupportEnabled
      ? encodeUnsignedVlqInternal(n)
      : encodeVlqInternal(n);
    this.#trackStats(label, n, encoded);
    return encoded;
  }

  dumpVlqHistograms(): void {
    // Trim trailing zeroes to reduce noise.
    for (const histogram of this.#stats.values()) {
      const lastValidIdx = histogram.findLastIndex((v) => v !== 0);
      histogram.length = lastValidIdx + 1;
    }

    const result: unknown[] = [];
    const indicesWithValues = new Set<number>();
    for (const [Label, stats] of this.#stats) {
      const obj: any = { Label };
      result.push(obj);

      for (const [idx, value] of stats.entries()) {
        if (value > 0) {
          obj[`"${idx}"`] = value;
          indicesWithValues.add(idx);
        }
      }
    }
    console.table(result, [
      "Label",
      ...[...indicesWithValues].toSorted((a, b) => a - b).map((x) => `"${x}"`),
    ]);
  }

  #trackStats(label: string | undefined, n: number, encoded: string): void {
    const stats = this.#statsForLabel(label ?? "<unlabeled>");
    const index = n === 0 ? 0 : encoded.length;
    stats[index] += 1;
  }

  #statsForLabel(label: string): number[] {
    let stats = this.#stats.get(label);
    if (!stats) {
      stats = new Array(20).fill(0);
      this.#stats.set(label, stats);
    }
    return stats;
  }
}

const DEFAULT = new EncoderWithStats();

let currentEncoder = DEFAULT;

export function withStatsEncoder<Args extends unknown[], Return>(
  encoder: EncoderWithStats,
  fn: (...args: Args) => Return,
): (...args: Args) => Return {
  return (...args: Args) => {
    const backup = currentEncoder;
    currentEncoder = encoder;
    const result = fn(...args);
    currentEncoder = backup;
    return result;
  };
}

export function encodeVlq(n: number, label?: string): string {
  return currentEncoder.encodeSignedVlq(n, label);
}

export function encodeUnsignedVlq(n: number, label?: string): string {
  return currentEncoder.encodeUnsignedVlq(n, label);
}

function encodeVlqInternal(n: number): string {
  // Set the sign bit as the least significant bit.
  n = n >= 0 ? 2 * n : 1 - 2 * n;
  return encodeUnsignedVlqInternal(n);
}

function encodeUnsignedVlqInternal(n: number): string {
  // Encode into a base64 run.
  let result = "";
  while (true) {
    // Extract the lowest 5 bits and remove them from the number.
    const digit = n & 0x1f;
    n >>>= 5;
    // Is there anything more left to encode?
    if (n === 0) {
      // We are done encoding, finish the run.
      result += BASE64_CHARS[digit];
      break;
    } else {
      // There is still more encode, so add the digit and the continuation bit.
      result += BASE64_CHARS[0x20 + digit];
    }
  }
  return result;
}

export function encodeVlqList(list: number[]) {
  return list.map((n) => encodeVlq(n)).join("");
}

export type MixedVlqList = ([number, "signed" | "unsigned"] | number)[];

export function encodeMixedVlqList(
  list: MixedVlqList,
): string {
  return list.map((param) => {
    if (typeof param === "number") {
      return encodeVlq(param);
    }
    return param[1] === "signed"
      ? encodeVlq(param[0])
      : encodeUnsignedVlq(param[0]);
  }).join("");
}

export class TokenIterator {
  readonly #string: string;
  #position: number;

  constructor(string: string) {
    this.#string = string;
    this.#position = 0;
  }

  next(): string {
    return this.#string.charAt(this.#position++);
  }

  /** Returns the unicode value of the next character and advances the iterator  */
  nextCharCode(): number {
    return this.#string.charCodeAt(this.#position++);
  }

  peek(): string {
    return this.#string.charAt(this.#position);
  }

  hasNext(): boolean {
    return this.#position < this.#string.length;
  }

  nextVLQ(): number {
    let result = this.#nextUnsignedVLQ();

    // Fix the sign.
    const negative = result & 1;
    result >>>= 1;
    return negative ? -result : result;
  }

  nextUnsignedVLQ(): number {
    return unsignedSupportEnabled ? this.#nextUnsignedVLQ() : this.nextVLQ();
  }

  #nextUnsignedVLQ(): number {
    let result = 0;
    let shift = 0;
    let digit: number = VLQ_CONTINUATION_MASK;
    while (digit & VLQ_CONTINUATION_MASK) {
      if (!this.hasNext()) {
        throw new Error("Unexpected end of input while decodling VLQ number!");
      }
      const charCode = this.nextCharCode();
      digit = BASE64_CODES[charCode];
      if (charCode !== 65 /* 'A' */ && digit === 0) {
        throw new Error(
          `Unexpected char '${
            String.fromCharCode(charCode)
          }' encountered while decoding`,
        );
      }
      result += (digit & VLQ_BASE_MASK) << shift;
      shift += VLQ_BASE_SHIFT;
    }
    return result;
  }

  /**
   * @returns the next VLQ number without iterating further. Or returns null if
   * the iterator is at the end or it's not a valid number.
   */
  peekVLQ(): null | number {
    const pos = this.#position;
    try {
      return this.nextVLQ();
    } catch {
      return null;
    } finally {
      this.#position = pos; // Reset the iterator.
    }
  }
}
