// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

export const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export const BASE64_CODES = new Uint8Array(123);
for (let index = 0; index < BASE64_CHARS.length; ++index) {
  BASE64_CODES[BASE64_CHARS.charCodeAt(index)] = index;
}

const VLQ_BASE_SHIFT = 5;
const VLQ_BASE_MASK = (1 << 5) - 1;
const VLQ_CONTINUATION_MASK = 1 << 5;

export function encodeVlq(n: number): string {
  // Set the sign bit as the least significant bit.
  n = n >= 0 ? 2 * n : 1 - 2 * n;
  return encodeUnsignedVlq(n);
}

export function encodeUnsignedVlq(n: number): string {
  // Encode into a base64 run.
  let result = "";
  while (true) {
    // Extract the lowest 5 bits and remove them from the number.
    const digit = n & 0x1f;
    n >>= 5;
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
  return list.map(encodeVlq).join("");
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
    let result = this.nextUnsignedVLQ();

    // Fix the sign.
    const negative = result & 1;
    result >>= 1;
    return negative ? -result : result;
  }

  nextUnsignedVLQ(): number {
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
