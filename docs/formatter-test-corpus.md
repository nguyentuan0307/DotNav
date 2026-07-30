# DotNav Formatter Test Corpus

The dedicated corpus contains 120 named C# snippets:

| State | Count | Expected behavior |
| --- | ---: | --- |
| Badly formatted | 50 | Produce the exact expected output, then remain stable |
| Already well-formatted | 50 | Remain byte-for-byte unchanged |
| Malformed or ambiguous | 20 | Remain unchanged instead of guessing |

Every case is checked for exact output and idempotency. A separate deterministic
fuzz test generates 2,000 valid argument-list permutations across nested calls,
generics, strings, lambdas, collections, tuples, relational expressions, tabs,
spaces, LF, and CRLF. Every generated case must preserve non-whitespace tokens
and stabilize after one pass.

The smart-style suite adds 19 named compatibility cases across one-, two-, and
three-level continuation indents with tabs, four spaces, two spaces, fluent
chains, argument lists, and non-integral visual-column alignment. A regression
case covers mixed outer and nested indentation from a formula-processing lambda,
including restoration after a prior formatter normalizes everything to one
level.

Syntax-depth regressions also cover fluent calls separated by multiline
predicates and object initializer bodies. Only same-depth `.` and `?.`
continuations may be aligned; nested argument and initializer lines must retain
their own scope indentation.

Run only this corpus:

```console
npm run test:formatter-corpus --workspace dotnav
```

List every case with its complete C# input and expected output:

```console
npm run formatter:corpus:list --workspace dotnav
```

The source of truth is
`extensions/dotnav/src/test/fixtures/formatterCorpus.ts`.

## Categories

### Badly formatted and matching well-formatted pairs

- 20 single-line lists: calls, object creation, nested calls, generic values,
  named arguments, lambdas, tuples, collections, object initializers, regular,
  verbatim and raw strings, chars, relational expressions, null operators,
  type operators, ternaries, record constructors, and attributes.
- 10 multiline trailing-comma lists: constructors, async calls, repositories,
  mediator calls, builders, named arguments, nested calls, strings,
  collections, and predicates.
- 15 fluent chains: LINQ, async, MongoDB, strings, configuration, HTTP,
  nullable chains, ordering, tasks, JSON, logging, validation, observables,
  filesystem operations, and mapping.
- 5 blank-line layouts: methods, types, regions, adjacent members, and nested
  blocks.

### Malformed or ambiguous input

- Missing or extra parentheses, brackets, and braces.
- Unterminated regular, verbatim, and raw strings.
- Unterminated chars and block comments.
- Empty, duplicated, leading, and trailing arguments.
- Broken generics, lambdas, collections, and interpolations.
- Mixed comments and conditional directives with ambiguous ownership.

## Bugs found by this corpus

The first run found four unsafe transformations:

1. An extra closing bracket was still wrapped.
2. An extra closing brace was still wrapped.
3. A generic type missing `>` was split as an argument list.
4. A lambda missing `}` was still wrapped.

The structural guard now requires balanced input before moving separators or
wrapping. Unbalanced strict-selection fragments may only receive safe
leading-comma whitespace alignment.
