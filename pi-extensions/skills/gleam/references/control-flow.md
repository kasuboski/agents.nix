# Gleam Control Flow

Use the type that represents the domain, then flatten control flow without
hiding error semantics.

## Choose the type by meaning

- `Result(value, error)` represents success or failure.
- `Option(value)` represents presence or absence without error information.
- `Result(Option(value), error)` distinguishes failure from successful absence.
- `Result(value, Nil)` is commonly used by stdlib lookups whose only failure is
  not finding a value.

The called API's installed signature is ground truth; these semantic rules do
not change its return type.

## Chain compatible results with `result.try`

Use `result.try` instead of nesting one `case` for every fallible operation:

```gleam
fn process(url: String) -> Result(String, String) {
  use body <- result.try(fetch(url))
  use data <- result.try(parse(body))
  use _ <- result.try(store(data))
  Ok("done")
}
```

The error type must unify across the chain. Normalize different external error
types at their boundaries:

```gleam
use content <- result.try(
  simplifile.read(path)
  |> result.map_error(fn(_) { "Failed to read file" }),
)
```

Do not erase useful errors merely to make a chain type-check. Map them into the
function's chosen error domain.

## Try alternatives with `list.find_map`

When several functions have compatible input, success, and error types,
`list.find_map` returns the first success and otherwise `Error(Nil)`:

```gleam
fn parse(raw: String) -> option.Option(String) {
  [parser_a, parser_b, parser_c]
  |> list.find_map(fn(parser) { parser(raw) })
  |> result.map(format_value)
  |> option.from_result
}
```

Use this only when discarding each failed attempt's error is intentional. Keep
explicit `Result` handling when the errors matter.

## Keep preconditions flat with `bool.guard`

```gleam
fn handle(input: String) -> String {
  use <- bool.guard(when: input == "", return: "error")
  process_non_empty(input)
}
```

Use `bool.lazy_guard` when constructing the early return is expensive. Inspect
the installed signatures before use.

## Use `list.each` for effects

Do not allocate and discard a mapped list:

```gleam
list.each(items, fn(item) { perform_effect(item) })
```

Use `list.map` when its returned list is part of the computation. A discarded
`list.map` result obscures intent and allocates unnecessarily.
