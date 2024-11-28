# Source Map "Scopes" encoding comparison

This repository implements various ideas for encoding
[source map scopes](https://github.com/tc39/source-map/blob/main/proposals/scopes.md).
The goal is to evaluate different encoding schemes w.r.t. complexity, size and
extensibility.

## Comparing different encoding schemes

The repository includes a simple tool that compares the different encoding
schemes against each other. It takes as input a list of source maps and a list
of encoding schemes, and it spits out the size of the resulting source map
(uncompressed, gzip, brotli). The input source maps require scope information in
the format of the current proposal.

Usage:

```
deno -R src/main.ts [OPTIONS] FILES...

Options:
        --prefix       Include the "Prefix" encoding scheme (Option A)
        --remaining    Include the "Remaining" encoding scheme (Option B)
        --tag-split    Include the "Tag Split" encoding scheme (Option C)
        --tag-combined Include the "Tag Combined" encoding scheme (Option D)
        --sizes <arg>  How to calculate the sizes/deltas. Valid values are:
                       "scopes" (default). Include only scopes related source map fields (without names, mappings).
                       "map". Include the whole source map, including names, mappings and sources (content).
        --verify       Internal. Round-trip decode each encoding scheme and compare the result against the input codec.
```

## Source map examples

The scope information in the `./examples` directory are obtained with a
customized [terser](https://github.com/terser/terser). The customized terser
supports basic function and block scopes, as well as variable renaming.

The examples are:

- _simple.min.js.map_: Two tiny scripts with two simple functions.
- _common.min.js.map_: The `front_end/core/common` module the Chrome DevTools
  repository.
- _sdk.min.js.map_: The `front_end/core/sdk` module from the Chrome DevTools
  repository.
- _typescript.min.js.map_: The `lib/typescript.js` file from the tsc node
  module.

## Results

```
Task all deno -R src/main.ts --proposal --prefix --remaining --tag-split --tag-combined --tag-variables ./examples/simple.min.js.map ./examples/common.min.js.map ./examples/sdk.min.js.map ./examples/typescript.min.js.map
Name:         Proposal
Description:  The currently proposed "Scopes" (stage 3) encoding

Name:         Proposal (unsigned)
Description:  The currently proposed "Scopes" (stage 3) encoding.  Use unsigned VLQ where appropriate.

Name:         Prefix (Option A)
Description:  Prefix start/end items with their length

Name:         Prefix (Option A, unsigned)
Description:  Prefix start/end items with their length. Use unsigned VLQ where appropriate.

Name:         Remaining (Option B)
Description:  Add a "remaining VLQs count" to items for unknown flags

Name:         Remaining (Option B, unsigned)
Description:  Add a "remaining VLQs count" to items for unknown flags. Use unsigned VLQ where appropriate.

Name:         Tag-Value-Length Split (Option C)
Description:  Prefix start/end items with a tag and their length

Name:         Tag-Value-Length Split (Option C, unsigned)
Description:  Prefix start/end items with a tag and their length. Use unsigned VLQ where appropriate.

Name:         Tag-Value-Length Combined (Option D)
Description:  Prefix original/generated items with a tag and their length. Combine start/end items.

Name:         Tag-Value-Length Combined (Option D, unsigned)
Description:  Prefix original/generated items with a tag and their length. Combine start/end items. Use unsigned VLQ where appropriate.

Name:         Tag-Value-Length Variables (Option E)
Description:  Prefix original/generated items with a tag and their length. Combine start/end items. Separate items for variables/bindings.

Name:         Tag-Value-Length Variables (Option E, unsigned)
Description:  Prefix original/generated items with a tag and their length. Combine start/end items. Separate items for variables/bindings. Use unsigned VLQ where appropriate.

┌───────┬────────────────────────────────────┬───────────────────────────────────────────────────┬───────────────────┬───────────┬────────────────────────┬───────────┬──────────────────────────┬───────────┐
│ (idx) │ File                               │ Codec                                             │ Uncompressed size │ Δ raw     │ Compressed size (gzip) │ Δ gzip    │ Compressed size (brotli) │ Δ brotli  │
├───────┼────────────────────────────────────┼───────────────────────────────────────────────────┼───────────────────┼───────────┼────────────────────────┼───────────┼──────────────────────────┼───────────┤
│     0 │ "./examples/simple.min.js.map"     │                                                   │                   │           │                        │           │                          │           │
│     1 │                                    │ "Proposal"                                        │ "171"             │ ""        │ "137"                  │ ""        │ "105"                    │ ""        │
│     2 │                                    │ "Proposal (unsigned)"                             │ "163"             │ "-4.68%"  │ "129"                  │ "-5.84%"  │ "100"                    │ "-4.76%"  │
│     3 │                                    │ "Prefix (Option A)"                               │ "186"             │ "+8.77%"  │ "141"                  │ "+2.92%"  │ "115"                    │ "+9.52%"  │
│     4 │                                    │ "Prefix (Option A, unsigned)"                     │ "182"             │ "+6.43%"  │ "138"                  │ "+0.73%"  │ "109"                    │ "+3.81%"  │
│     5 │                                    │ "Remaining (Option B)"                            │ "156"             │ "-8.77%"  │ "127"                  │ "-7.3%"   │ "105"                    │ "+0%"     │
│     6 │                                    │ "Remaining (Option B, unsigned)"                  │ "152"             │ "-11.11%" │ "126"                  │ "-8.03%"  │ "98"                     │ "-6.67%"  │
│     7 │                                    │ "Tag-Value-Length Split (Option C)"               │ "170"             │ "-0.58%"  │ "120"                  │ "-12.41%" │ "98"                     │ "-6.67%"  │
│     8 │                                    │ "Tag-Value-Length Split (Option C, unsigned)"     │ "166"             │ "-2.92%"  │ "112"                  │ "-18.25%" │ "93"                     │ "-11.43%" │
│     9 │                                    │ "Tag-Value-Length Combined (Option D)"            │ "158"             │ "-7.6%"   │ "114"                  │ "-16.79%" │ "95"                     │ "-9.52%"  │
│    10 │                                    │ "Tag-Value-Length Combined (Option D, unsigned)"  │ "154"             │ "-9.94%"  │ "108"                  │ "-21.17%" │ "91"                     │ "-13.33%" │
│    11 │                                    │ "Tag-Value-Length Variables (Option E)"           │ "178"             │ "+4.09%"  │ "118"                  │ "-13.87%" │ "102"                    │ "-2.86%"  │
│    12 │                                    │ "Tag-Value-Length Variables (Option E, unsigned)" │ "174"             │ "+1.75%"  │ "114"                  │ "-16.79%" │ "93"                     │ "-11.43%" │
│    13 │                                    │                                                   │                   │           │                        │           │                          │           │
│    14 │ "./examples/common.min.js.map"     │                                                   │                   │           │                        │           │                          │           │
│    15 │                                    │ "Proposal"                                        │ "35,050"          │ ""        │ "10,509"               │ ""        │ "10,391"                 │ ""        │
│    16 │                                    │ "Proposal (unsigned)"                             │ "34,101"          │ "-2.71%"  │ "10,397"               │ "-1.07%"  │ "10,248"                 │ "-1.38%"  │
│    17 │                                    │ "Prefix (Option A)"                               │ "38,509"          │ "+9.87%"  │ "11,937"               │ "+13.59%" │ "11,556"                 │ "+11.21%" │
│    18 │                                    │ "Prefix (Option A, unsigned)"                     │ "37,520"          │ "+7.05%"  │ "11,767"               │ "+11.97%" │ "11,376"                 │ "+9.48%"  │
│    19 │                                    │ "Remaining (Option B)"                            │ "31,779"          │ "-9.33%"  │ "9,723"                │ "-7.48%"  │ "9,589"                  │ "-7.72%"  │
│    20 │                                    │ "Remaining (Option B, unsigned)"                  │ "30,652"          │ "-12.55%" │ "9,500"                │ "-9.6%"   │ "9,381"                  │ "-9.72%"  │
│    21 │                                    │ "Tag-Value-Length Split (Option C)"               │ "42,996"          │ "+22.67%" │ "12,286"               │ "+16.91%" │ "11,902"                 │ "+14.54%" │
│    22 │                                    │ "Tag-Value-Length Split (Option C, unsigned)"     │ "41,575"          │ "+18.62%" │ "12,092"               │ "+15.06%" │ "11,643"                 │ "+12.05%" │
│    23 │                                    │ "Tag-Value-Length Combined (Option D)"            │ "39,995"          │ "+14.11%" │ "11,722"               │ "+11.54%" │ "11,349"                 │ "+9.22%"  │
│    24 │                                    │ "Tag-Value-Length Combined (Option D, unsigned)"  │ "38,561"          │ "+10.02%" │ "11,467"               │ "+9.12%"  │ "11,072"                 │ "+6.55%"  │
│    25 │                                    │ "Tag-Value-Length Variables (Option E)"           │ "44,337"          │ "+26.5%"  │ "11,519"               │ "+9.61%"  │ "11,278"                 │ "+8.54%"  │
│    26 │                                    │ "Tag-Value-Length Variables (Option E, unsigned)" │ "42,931"          │ "+22.49%" │ "11,279"               │ "+7.33%"  │ "11,058"                 │ "+6.42%"  │
│    27 │                                    │                                                   │                   │           │                        │           │                          │           │
│    28 │ "./examples/sdk.min.js.map"        │                                                   │                   │           │                        │           │                          │           │
│    29 │                                    │ "Proposal"                                        │ "156,976"         │ ""        │ "48,207"               │ ""        │ "47,532"                 │ ""        │
│    30 │                                    │ "Proposal (unsigned)"                             │ "152,697"         │ "-2.73%"  │ "47,783"               │ "-0.88%"  │ "47,090"                 │ "-0.93%"  │
│    31 │                                    │ "Prefix (Option A)"                               │ "171,193"         │ "+9.06%"  │ "53,815"               │ "+11.63%" │ "52,420"                 │ "+10.28%" │
│    32 │                                    │ "Prefix (Option A, unsigned)"                     │ "167,518"         │ "+6.72%"  │ "53,321"               │ "+10.61%" │ "51,796"                 │ "+8.97%"  │
│    33 │                                    │ "Remaining (Option B)"                            │ "143,221"         │ "-8.76%"  │ "44,695"               │ "-7.29%"  │ "44,080"                 │ "-7.26%"  │
│    34 │                                    │ "Remaining (Option B, unsigned)"                  │ "139,003"         │ "-11.45%" │ "43,936"               │ "-8.86%"  │ "43,432"                 │ "-8.63%"  │
│    35 │                                    │ "Tag-Value-Length Split (Option C)"               │ "190,216"         │ "+21.18%" │ "55,643"               │ "+15.43%" │ "53,871"                 │ "+13.34%" │
│    36 │                                    │ "Tag-Value-Length Split (Option C, unsigned)"     │ "185,053"         │ "+17.89%" │ "54,927"               │ "+13.94%" │ "52,892"                 │ "+11.28%" │
│    37 │                                    │ "Tag-Value-Length Combined (Option D)"            │ "177,544"         │ "+13.1%"  │ "53,171"               │ "+10.3%"  │ "51,868"                 │ "+9.12%"  │
│    38 │                                    │ "Tag-Value-Length Combined (Option D, unsigned)"  │ "172,344"         │ "+9.79%"  │ "52,249"               │ "+8.38%"  │ "50,924"                 │ "+7.14%"  │
│    39 │                                    │ "Tag-Value-Length Variables (Option E)"           │ "195,165"         │ "+24.33%" │ "52,338"               │ "+8.57%"  │ "51,417"                 │ "+8.17%"  │
│    40 │                                    │ "Tag-Value-Length Variables (Option E, unsigned)" │ "190,033"         │ "+21.06%" │ "51,474"               │ "+6.78%"  │ "50,652"                 │ "+6.56%"  │
│    41 │                                    │                                                   │                   │           │                        │           │                          │           │
│    42 │ "./examples/typescript.min.js.map" │                                                   │                   │           │                        │           │                          │           │
│    43 │                                    │ "Proposal"                                        │ "1,252,403"       │ ""        │ "430,028"              │ ""        │ "403,591"                │ ""        │
│    44 │                                    │ "Proposal (unsigned)"                             │ "1,225,816"       │ "-2.12%"  │ "428,333"              │ "-0.39%"  │ "402,369"                │ "-0.3%"   │
│    45 │                                    │ "Prefix (Option A)"                               │ "1,353,031"       │ "+8.03%"  │ "478,656"              │ "+11.31%" │ "443,284"                │ "+9.83%"  │
│    46 │                                    │ "Prefix (Option A, unsigned)"                     │ "1,323,427"       │ "+5.67%"  │ "474,539"              │ "+10.35%" │ "438,366"                │ "+8.62%"  │
│    47 │                                    │ "Remaining (Option B)"                            │ "1,147,147"       │ "-8.4%"   │ "388,148"              │ "-9.74%"  │ "367,372"                │ "-8.97%"  │
│    48 │                                    │ "Remaining (Option B, unsigned)"                  │ "1,110,878"       │ "-11.3%"  │ "384,033"              │ "-10.7%"  │ "362,182"                │ "-10.26%" │
│    49 │                                    │ "Tag-Value-Length Split (Option C)"               │ "1,486,757"       │ "+18.71%" │ "492,316"              │ "+14.48%" │ "455,141"                │ "+12.77%" │
│    50 │                                    │ "Tag-Value-Length Split (Option C, unsigned)"     │ "1,446,601"       │ "+15.51%" │ "486,669"              │ "+13.17%" │ "447,178"                │ "+10.8%"  │
│    51 │                                    │ "Tag-Value-Length Combined (Option D)"            │ "1,398,046"       │ "+11.63%" │ "478,498"              │ "+11.27%" │ "444,834"                │ "+10.22%" │
│    52 │                                    │ "Tag-Value-Length Combined (Option D, unsigned)"  │ "1,357,362"       │ "+8.38%"  │ "472,643"              │ "+9.91%"  │ "436,932"                │ "+8.26%"  │
│    53 │                                    │ "Tag-Value-Length Variables (Option E)"           │ "1,482,848"       │ "+18.4%"  │ "468,544"              │ "+8.96%"  │ "438,556"                │ "+8.66%"  │
│    54 │                                    │ "Tag-Value-Length Variables (Option E, unsigned)" │ "1,443,179"       │ "+15.23%" │ "460,949"              │ "+7.19%"  │ "430,827"                │ "+6.75%"  │
│    55 │                                    │                                                   │                   │           │                        │           │                          │           │
└───────┴────────────────────────────────────┴───────────────────────────────────────────────────┴───────────────────┴───────────┴────────────────────────┴───────────┴──────────────────────────┴───────────┘
```

## Goal: future-proofing "Scopes"

The current "Scopes" encoding is not ideal w.r.t. to future extension:

- Adding new fields to `OriginalScope` and `GeneratedRange` in a backwards
  compatible way is impossible. Any tool implementing the current proposal would
  break once we add new optional fields to either data structure.

- The encoding uses the `,` and `;` characters on top of base64 encoded VLQ
  numbers. Moving to a future binary source map format will require a different
  encoding for "Scopes" to account for `,` and `;`.

We should aim for an encoding that is both forwards-compatible and is purely VLQ
based: So the only difference between the current JSON source map format and a
potential future binary format is how VLQs are encoded.

The crux of the issue is to find the right balance between

- retaining some flexibility for future extensions without going overboard (e.g
  DWARF-style encoding),
- encoding/decoding complexity,
- and encoded size.

This repository proposes some potential "Scopes" encodings that keep both goals
in mind while aiming for a healthy balance.

## Grammar

The encoding formats are presented in a EBNF-like grammar with:

- there is only one terminal: a VLQ. Each terminal is labelled and we denote
  them with uppercase (e.g. `TERMINAL` is a VLQ with the label 'TERMINAL').
- non-terminals denoted with snake case (e.g. `non_term`).
- `symbol*` means zero or more repetitions of `symbol`.
- `symbol?` means zero or one `symbol`.
- `symbol[N]` means N occurrences of `symbol`.

## Option A - Prefix items with their length

```
original_scopes = (LENGTH original_item)*

original_item = original_start_item | original_end_item

original_start_item =
    LINE
    COLUMN
    FLAGS
    NAME? // present if FLAGS<0> is set
    KIND? // present if FLAGS<1> is set
    VARIABLE_COUNT
    VARIABLE[VARIABLE_COUNT]

original_end_item =
    LINE
    COLUMN

generated_ranges = (LENGTH generated_item)*

generated_item = generated_start_item | generated_end_item

generated_start_item =
    COLUMN   // the actual value is COLUMN<1:n>.
    LINE?    // if COLUMN<0> is set.
    FLAGS
    DEFINITION_SOURCE_OFFSET?  // present if FLAGS<0> is set
    DEFINITION_ITEM_OFFSET?    // present if FLAGS<0> is set
    CALL_SITE_SOURCE?          // present if FLAGS<1> is set
    CALL_SITE_LINE?            // present if FLAGS<1> is set
    CALL_SITE_COLUMN?          // present if FLAGS<1> is set
    BINDING_COUNT
    binding[BINDING_COUNT]

binding =
    EXPR_OR_SUB_RANGE_LENGTH   // -1 = not available, >=0 offset into "names"
    EXPR_0?                    // present if EXPR_OR_SUBRANGE_LENGTH < -1.
    sub_range_binding[-EXPR_OR_SUBRANGE_LENGTH - 1]

sub_range_binding =
    LINE
    COLUMN
    EXPR

generated_end_item =
    COLUMN   // the actual value is COLUMN<1:n>.
    LINE?    // if COLUMN<0> is set.
```

This is identical to the current proposal modulo:

- Each item is prefixed with the number of VLQs in the item
- Variables in `OriginalScope` and bindings in `GeneratedRange` are prefixed
  with their length
- columns in the generated range encode whether a line VLQ is present or not

`original_start_item` and `original_end_item` are distinguished by their length:
A "end" item always has 2 VLQs while a "start" item has at least 3.
`generated_start_item` and `generated_end_item` are distinguished by their
length: A "end" item has 1 or 2 VLQs while a "start" item has at least 3.

## Option B - Add "remaining" count in the presence of unknown flags

To distinguish start/end items, we have to use an additional bit. For
`original_*_item` we use a bit in `LINE` while for `generated_*_item` we use
another bit in `COLUMN`.

We'll list only the changed productions w.r.t. to "Option A":

```
original_scopes = original_item*

original_start_item =
    LINE  // the actual value is LINE<1:n>. LINE<0> is always 0 for original_start_item.
    COLUMN
    FLAGS
    NAME? // present if FLAGS<0> is set
    KIND? // present if FLAGS<1> is set
    VARIABLE_COUNT
    VARIABLE[VARIABLE_COUNT]
    REMAINING?  // present if FLAGS<n:3> is not zero.
    REST[REMAINING]

original_end_item =
    LINE // the actual value is LINE<1:n>. LINE<0> is always 1 for original_end_item.
    COLUMN

generated_ranges = generated_item*

generated_start_item =
    COLUMN   // the actual value is COLUMN<2:n>. COLUMN<1> is always 0 for generated_start_item.
    LINE?    // if COLUMN<0> is set.
    FLAGS
    DEFINITION_SOURCE_OFFSET?  // present if FLAGS<0> is set
    DEFINITION_ITEM_OFFSET?    // present if FLAGS<0> is set
    CALL_SITE_SOURCE?          // present if FLAGS<1> is set
    CALL_SITE_LINE?            // present if FLAGS<1> is set
    CALL_SITE_COLUMN?          // present if FLAGS<1> is set
    BINDING_COUNT
    binding[BINDING_COUNT]
    REMAINING?  // present if FLAGS<n:4> is not zero.
    REST[REMAINING]

generated_end_item =
    COLUMN   // the actual value is COLUMN<2:n>. COLUMN<1> is always 1 for generated_end_item.
    LINE?    // if COLUMN<0> is set.
```

Advantages over Option A:

- We only pay the price of encoding the item length once we actually add new
  fields
- Variables/bindings are not included, so REMAINING stays small even for
  scopes/ranges with lots of variables

Quirks:

- Adding new marker flags to FLAGS (not new fields) requires generators to emit
  a `REMAINING` value of 0.

## Option C - Tag-Length-Value Split

Similar to Option A but we prefix each item not only with it's length but a tag
as well. The advantages are:

- We can encode scopes and ranges in one blob. That is the JSON could have a
  single "scopes" field containing the combination of "originalScopes" and
  "generatedRanges".
- Start/end items can be distinguished by their tag.
- We keep the door open for not only extending `original_start_item` and
  `generated_start_item`, but adding new item types all-together.
- `GeneratedRange.definition` only requires one index instead of two.

Since it's similar to option A, we'll list only the changed productions:

```
scopes = items*

item =
      "0x1" LENGTH original_start_item
    | "0x2" LENGTH original_end_item
    | "0x3" LENGTH generated_start_item
    | "0x4" LENGTH generated_end_item

generated_start_item =
    COLUMN   // the actual value is COLUMN<1:n>.
    LINE?    // if COLUMN<0> is set.
    FLAGS
    DEFINITION_ITEM_OFFSET?    // present if FLAGS<0> is set
    CALL_SITE_SOURCE?          // present if FLAGS<1> is set
    CALL_SITE_LINE?            // present if FLAGS<1> is set
    CALL_SITE_COLUMN?          // present if FLAGS<1> is set
    BINDING_COUNT
    binding[BINDING_COUNT]
    REMAINING?  // present if FLAGS<n:4> is not zero.
    REST[REMAINING]
```

## Option D - Tag-Length-Value Combined

This is a variant to Option C. Instead of using `original_start_item` and
`original_end_item`, we combine both into a `original_item`. Similar to DWARF,
nesting is achieved by using a special tag to denote the end of an item's
children.

```
item =
      "0x0"
    | "0x1" LENGTH original_item
    | "0x2" LENGTH generated_item

original_item =
    START_LINE
    START_COLUMN
    END_LINE
    END_COLUMN
    FLAGS
    // ...

generated_item =
    START_COLUMN   // the actual value is START_COLUMN<1:n>.
    START_LINE?    // present if START_COLUMN<0> is set.
    END_COLUMN     // the actual value is END_COLUMN<1:n>.
    END_LINE?      // present if END_COLUMN<0> is set.
    FLAGS
    // ....
```

Example of nested scopes (tags only):
`[0x1, ...<length + content>, 0x1, ...<length + content>, 0x0, 0x0]`.

This comes with some special rules if we don't want to lose the efficiency of
relative line/column numbers for start and end locations:

- A scopes or ranges' start location is relative to the preceding siblings' end
  location, or the parents' start location if it's the first child.
- A scopes or ranges' end location is relative to it's last child's end
  location, or it's start location if it does not have any children.

There is also the question of `START_LINE`, and `END_LINE` in `generated_item`.
We could encode it's presence in FLAGS or use the LSB of the respective
`*_COLUMN`.

## Option E - Tag-Length-Value Variables

This is a variant of Option D: Instead of including variables and bindings in
`original_item` and `generated_item` respectively, we encode them in separate
`variable` and `binding` items.

```
item =
      "0x0"
    | "0x1" LENGTH original_item
    | "0x2" LENGTH generated_item
    | "0x3" LENGTH variables
    | "0x4" LENGTH bindings

original_item =
    START_LINE
    START_COLUMN
    END_LINE
    END_COLUMN
    FLAGS
    NAME? // present if FLAGS<0> is set
    KIND? // present if FLAGS<1> is set

variables =
    VARIABLE_COUNT
    VARIABLE[VARIABLE_COUNT]

generated_item =
    START_COLUMN   // the actual value is START_COLUMN<1:n>.
    START_LINE?    // present if START_COLUMN<0> is set.
    END_COLUMN     // the actual value is END_COLUMN<1:n>.
    END_LINE?      // present if END_COLUMN<0> is set.
    FLAGS
    DEFINITION_ITEM_OFFSET?    // present if FLAGS<0> is set
    CALL_SITE_SOURCE?          // present if FLAGS<1> is set
    CALL_SITE_LINE?            // present if FLAGS<1> is set
    CALL_SITE_COLUMN?          // present if FLAGS<1> is set

bindings =
    BINDING_COUNT
    binding[BINDING_COUNT]
```

Note that `variables` and `bindings` can't have child items. Nonetheless some
tools may chose to add child items so it is required that generators "close"
`variables` and `bindings` with an `EMPTY` tag.

This could be improved by using the first bit of the tag to signal whether a tag
has child items or not.

## Unsigned VLQ

The current source map specification only allows for signed VLQ. This makes
sense for mappings where most fields are relative. The "Scopes" proposal
includes various fields that can never be negative. As such it could be
interesting to see the impact on the encoding scheme if unsigned VLQs are
allowed.

The tool includes support for unsigned VLQ and will output the result for each
encoding scheme for both signed VLQ only, as well as using unsigned VLQ where
possible.
