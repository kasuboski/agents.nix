# Gleam Compile Traps

Read only the section matching the diagnostic or construct being edited.

## `Result` and `Option` are distinct

The installed stdlib determines lookup return types. Common stdlib lookups in
this repository return `Result(value, Nil)`:

```gleam
import gleam/dict
import gleam/list
import gleam/result

let assert Ok(first) = list.first(values)
let first_or_zero = list.first(values) |> result.unwrap(0)
let assert Ok(value) = dict.get(from: values_by_name, get: "answer")
```

Do not pass `option.None` as the default to `result.unwrap`; the default must be
the successful value type.

`Option` is appropriate whenever absence carries no error information, whether
in an argument, field, or return value. Import it explicitly:

```gleam
import gleam/option

fn configured_name(enabled: Bool) -> option.Option(String) {
  case enabled {
    True -> option.Some("verde")
    False -> option.None
  }
}
```

Use `Result(Option(value), error)` when failure and successful absence are both
meaningful states. Convert deliberately with `option.to_result` and
`option.from_result`; verify those functions against the installed stdlib.

## No function calls in guards

This does not compile:

```gleam
case path {
  value if string.ends_with(value, "/") -> "directory"
  _ -> "file"
}
```

Compute the call first:

```gleam
let is_directory = string.ends_with(path, "/")
case is_directory {
  True -> "directory"
  False -> "file"
}
```

Do not maintain a memorised exhaustive list of guard expressions. Let the
compiler decide whether an operator or expression is supported; the stable rule
is that function calls are forbidden.

## Variant patterns follow their definitions

A positional variant requires positional patterns with the correct arity:

```gleam
pub type Node {
  Element(String, List(String), List(Node))
  Text(String)
}

case node {
  Element(_, _, children) -> children
  Text(_) -> []
}
```

A labelled definition permits labelled patterns, but every field is still
required. Labels can make ignored fields explicit without relying on position:

```gleam
pub type Node {
  Element(tag: String, attributes: List(String), children: List(Node))
  Text(content: String)
}

case node {
  Element(children: children, tag: _, attributes: _) -> children
  Text(content: _) -> []
}
```

Inspect the type definition before constructing or matching a dependency's
variant. Do not guess its arity or whether its fields are positional or
labelled.

## Type, module, identifier, and comment syntax

| Incorrect | Correct | Reason |
|---|---|---|
| `fn int.to_string(n) { ... }` | `fn int_to_string(n) { ... }` | A function name cannot contain `.`. |
| `error: my_error()` | `error: my_error` | Parentheses after a type describe a function type. |
| `my/dir/mod.Type` | `import my/dir/mod` then `mod.Type` | Module paths are imported, not written inline in a type. |
| `fn _unused() { ... }` | `fn unused() { ... }` | A top-level function name cannot begin with `_`. |
| `/* comment */` or `%% comment` | `// comment` | Gleam has line, documentation, and module comments, not block or Erlang comments. |

`#` starts tuple syntax such as `#(1, 2)`; it does not start a comment.
