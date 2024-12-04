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
        --proposal              Include the "Proposal" encoding schemes
        --prefix                Include the "Prefix" encoding scheme (Option A)
        --remaining             Include the "Remaining" encoding scheme (Option B)
        --tag-split             Include the "Tag Split" encoding scheme (Option C)
        --tag-combined          Include the "Tag Combined" encoding scheme (Option D)
        --sizes <arg>           How to calculate the sizes/deltas. Valid values are:
                                "scopes" (default). Include only scopes related source map fields (without names, mappings).
                                "map". Include the whole source map, including names, mappings and sources (content).
        --sizes-reference <arg> The baseline for the delta calculation. Useful to estimate the
                                size impact of the encoding schemes in general relative to source
                                maps with/without "names" mappings.
                                Valid values are:
                                "proposal" (default). Compare against the input source map with
                                    the "proposal" encoding scheme.
                                "no-scopes". Only valid with "--sizes=map". Compare against the
                                    input source map without scopes related fields.
                                "no-names". Only valid with "--sizes=map". Compare against the
                                    input source map without scopes related fields and "names"
                                    stripped from mappings.
        --verify                Internal. Round-trip decode each encoding scheme and compare the result against the input codec.
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
│     2 │                                    │ "Proposal (unsigned)"                             │ "163"             │ "-4.68%"  │ "132"                  │ "-3.65%"  │ "101"                    │ "-3.81%"  │
│     3 │                                    │ "Prefix (Option A)"                               │ "186"             │ "+8.77%"  │ "141"                  │ "+2.92%"  │ "115"                    │ "+9.52%"  │
│     4 │                                    │ "Prefix (Option A, unsigned)"                     │ "182"             │ "+6.43%"  │ "137"                  │ "+0%"     │ "110"                    │ "+4.76%"  │
│     5 │                                    │ "Remaining (Option B)"                            │ "162"             │ "-5.26%"  │ "130"                  │ "-5.11%"  │ "109"                    │ "+3.81%"  │
│     6 │                                    │ "Remaining (Option B, unsigned)"                  │ "158"             │ "-7.6%"   │ "128"                  │ "-6.57%"  │ "100"                    │ "-4.76%"  │
│     7 │                                    │ "Tag-Value-Length Split (Option C)"               │ "170"             │ "-0.58%"  │ "120"                  │ "-12.41%" │ "98"                     │ "-6.67%"  │
│     8 │                                    │ "Tag-Value-Length Split (Option C, unsigned)"     │ "166"             │ "-2.92%"  │ "112"                  │ "-18.25%" │ "94"                     │ "-10.48%" │
│     9 │                                    │ "Tag-Value-Length Combined (Option D)"            │ "158"             │ "-7.6%"   │ "114"                  │ "-16.79%" │ "94"                     │ "-10.48%" │
│    10 │                                    │ "Tag-Value-Length Combined (Option D, unsigned)"  │ "154"             │ "-9.94%"  │ "109"                  │ "-20.44%" │ "96"                     │ "-8.57%"  │
│    11 │                                    │ "Tag-Value-Length Variables (Option E)"           │ "178"             │ "+4.09%"  │ "121"                  │ "-11.68%" │ "101"                    │ "-3.81%"  │
│    12 │                                    │ "Tag-Value-Length Variables (Option E, unsigned)" │ "174"             │ "+1.75%"  │ "115"                  │ "-16.06%" │ "96"                     │ "-8.57%"  │
│    13 │                                    │                                                   │                   │           │                        │           │                          │           │
│    14 │ "./examples/common.min.js.map"     │                                                   │                   │           │                        │           │                          │           │
│    15 │                                    │ "Proposal"                                        │ "35,049"          │ ""        │ "10,510"               │ ""        │ "10,395"                 │ ""        │
│    16 │                                    │ "Proposal (unsigned)"                             │ "34,100"          │ "-2.71%"  │ "10,396"               │ "-1.08%"  │ "10,252"                 │ "-1.38%"  │
│    17 │                                    │ "Prefix (Option A)"                               │ "38,508"          │ "+9.87%"  │ "11,952"               │ "+13.72%" │ "11,573"                 │ "+11.33%" │
│    18 │                                    │ "Prefix (Option A, unsigned)"                     │ "37,531"          │ "+7.08%"  │ "11,780"               │ "+12.08%" │ "11,399"                 │ "+9.66%"  │
│    19 │                                    │ "Remaining (Option B)"                            │ "32,694"          │ "-6.72%"  │ "10,784"               │ "+2.61%"  │ "10,636"                 │ "+2.32%"  │
│    20 │                                    │ "Remaining (Option B, unsigned)"                  │ "31,503"          │ "-10.12%" │ "10,528"               │ "+0.17%"  │ "10,389"                 │ "-0.06%"  │
│    21 │                                    │ "Tag-Value-Length Split (Option C)"               │ "42,995"          │ "+22.67%" │ "12,311"               │ "+17.14%" │ "11,903"                 │ "+14.51%" │
│    22 │                                    │ "Tag-Value-Length Split (Option C, unsigned)"     │ "41,586"          │ "+18.65%" │ "12,078"               │ "+14.92%" │ "11,645"                 │ "+12.03%" │
│    23 │                                    │ "Tag-Value-Length Combined (Option D)"            │ "39,994"          │ "+14.11%" │ "11,733"               │ "+11.64%" │ "11,353"                 │ "+9.22%"  │
│    24 │                                    │ "Tag-Value-Length Combined (Option D, unsigned)"  │ "38,572"          │ "+10.05%" │ "11,457"               │ "+9.01%"  │ "11,070"                 │ "+6.49%"  │
│    25 │                                    │ "Tag-Value-Length Variables (Option E)"           │ "44,336"          │ "+26.5%"  │ "11,530"               │ "+9.71%"  │ "11,290"                 │ "+8.61%"  │
│    26 │                                    │ "Tag-Value-Length Variables (Option E, unsigned)" │ "42,942"          │ "+22.52%" │ "11,264"               │ "+7.17%"  │ "11,064"                 │ "+6.44%"  │
│    27 │                                    │                                                   │                   │           │                        │           │                          │           │
│    28 │ "./examples/sdk.min.js.map"        │                                                   │                   │           │                        │           │                          │           │
│    29 │                                    │ "Proposal"                                        │ "152,710"         │ ""        │ "47,908"               │ ""        │ "47,168"                 │ ""        │
│    30 │                                    │ "Proposal (unsigned)"                             │ "148,431"         │ "-2.8%"   │ "47,500"               │ "-0.85%"  │ "46,716"                 │ "-0.96%"  │
│    31 │                                    │ "Prefix (Option A)"                               │ "166,927"         │ "+9.31%"  │ "53,488"               │ "+11.65%" │ "51,981"                 │ "+10.2%"  │
│    32 │                                    │ "Prefix (Option A, unsigned)"                     │ "163,270"         │ "+6.92%"  │ "52,961"               │ "+10.55%" │ "51,441"                 │ "+9.06%"  │
│    33 │                                    │ "Remaining (Option B)"                            │ "142,512"         │ "-6.68%"  │ "49,024"               │ "+2.33%"  │ "48,503"                 │ "+2.83%"  │
│    34 │                                    │ "Remaining (Option B, unsigned)"                  │ "137,866"         │ "-9.72%"  │ "48,143"               │ "+0.49%"  │ "47,656"                 │ "+1.03%"  │
│    35 │                                    │ "Tag-Value-Length Split (Option C)"               │ "185,950"         │ "+21.77%" │ "55,295"               │ "+15.42%" │ "53,486"                 │ "+13.39%" │
│    36 │                                    │ "Tag-Value-Length Split (Option C, unsigned)"     │ "180,805"         │ "+18.4%"  │ "54,612"               │ "+13.99%" │ "52,575"                 │ "+11.46%" │
│    37 │                                    │ "Tag-Value-Length Combined (Option D)"            │ "173,278"         │ "+13.47%" │ "52,861"               │ "+10.34%" │ "51,504"                 │ "+9.19%"  │
│    38 │                                    │ "Tag-Value-Length Combined (Option D, unsigned)"  │ "168,096"         │ "+10.08%" │ "51,945"               │ "+8.43%"  │ "50,602"                 │ "+7.28%"  │
│    39 │                                    │ "Tag-Value-Length Variables (Option E)"           │ "190,899"         │ "+25.01%" │ "52,052"               │ "+8.65%"  │ "51,128"                 │ "+8.4%"   │
│    40 │                                    │ "Tag-Value-Length Variables (Option E, unsigned)" │ "185,785"         │ "+21.66%" │ "51,223"               │ "+6.92%"  │ "50,367"                 │ "+6.78%"  │
│    41 │                                    │                                                   │                   │           │                        │           │                          │           │
│    42 │ "./examples/typescript.min.js.map" │                                                   │                   │           │                        │           │                          │           │
│    43 │                                    │ "Proposal"                                        │ "1,226,318"       │ ""        │ "427,409"              │ ""        │ "403,839"                │ ""        │
│    44 │                                    │ "Proposal (unsigned)"                             │ "1,199,731"       │ "-2.17%"  │ "425,627"              │ "-0.42%"  │ "401,488"                │ "-0.58%"  │
│    45 │                                    │ "Prefix (Option A)"                               │ "1,326,946"       │ "+8.21%"  │ "476,402"              │ "+11.46%" │ "442,755"                │ "+9.64%"  │
│    46 │                                    │ "Prefix (Option A, unsigned)"                     │ "1,296,273"       │ "+5.7%"   │ "471,876"              │ "+10.4%"  │ "434,358"                │ "+7.56%"  │
│    47 │                                    │ "Remaining (Option B)"                            │ "1,162,783"       │ "-5.18%"  │ "437,372"              │ "+2.33%"  │ "415,149"                │ "+2.8%"   │
│    48 │                                    │ "Remaining (Option B, unsigned)"                  │ "1,117,642"       │ "-8.86%"  │ "431,507"              │ "+0.96%"  │ "404,017"                │ "+0.04%"  │
│    49 │                                    │ "Tag-Value-Length Split (Option C)"               │ "1,460,672"       │ "+19.11%" │ "490,192"              │ "+14.69%" │ "454,869"                │ "+12.64%" │
│    50 │                                    │ "Tag-Value-Length Split (Option C, unsigned)"     │ "1,419,447"       │ "+15.75%" │ "484,204"              │ "+13.29%" │ "444,055"                │ "+9.96%"  │
│    51 │                                    │ "Tag-Value-Length Combined (Option D)"            │ "1,371,961"       │ "+11.88%" │ "476,015"              │ "+11.37%" │ "444,253"                │ "+10.01%" │
│    52 │                                    │ "Tag-Value-Length Combined (Option D, unsigned)"  │ "1,330,208"       │ "+8.47%"  │ "469,904"              │ "+9.94%"  │ "433,458"                │ "+7.33%"  │
│    53 │                                    │ "Tag-Value-Length Variables (Option E)"           │ "1,456,763"       │ "+18.79%" │ "466,693"              │ "+9.19%"  │ "438,060"                │ "+8.47%"  │
│    54 │                                    │ "Tag-Value-Length Variables (Option E, unsigned)" │ "1,416,025"       │ "+15.47%" │ "458,821"              │ "+7.35%"  │ "428,188"                │ "+6.03%"  │
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
