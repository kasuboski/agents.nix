---
name: gleam
description: Gleam compiler-first coding and project initialization. Use when creating a Gleam project or setting up its Mise/Nix tooling, before writing or editing .gleam files, when refactoring Result/Option control flow, or when Gleam check or format fails.
---

# Gleam: Compiler-First

Use the compiler and installed source as ground truth. Do not write Gleam from
Elixir, Erlang, ML, or remembered package APIs.

## Project initialization

When creating a Gleam project or adding its development tooling, read
[`references/project-init.md`](references/project-init.md) and follow its
bootstrap and validation steps. It provides reusable `mise.toml` and `shell.nix`
templates, including a Glinter-backed precommit gate.

## Tight loop

1. Identify the affected Gleam package and its repository-prescribed check and
   format commands.
2. Before using an uncertain external API, inspect the version installed for
   that package. From the package root, run this skill's
   `scripts/gleam-sig <module> [name ...]`; if dependencies are absent, download
   them using the repository-prescribed command first.
3. Make one coherent edit pass, then run the affected package's check command.
4. Read every diagnostic, fix them together, and repeat until the check passes.
5. Run the repository-prescribed formatter or format check. If it changes code,
   run the check again.

Work is complete only when the prescribed check and formatting commands pass
for every affected Gleam package and every reported diagnostic is addressed.
Follow any stronger repository completion requirements as well.

## Core traps

| Trap | Rule |
|---|---|
| Absence | Inspect the API. Stdlib lookups such as `list.first`, `list.find`, `list.find_map`, and `dict.get` return `Result(_, Nil)` in the installed stdlib. `Option` requires `gleam/option` and is valid when absence itself carries no error information. |
| Guards | Never call a function in a `case` guard. Compute the value before the `case`, use supported guard operators, or perform the call in the clause body. |
| Variant patterns | Match every variant field, using `_` for ignored values. Labels can identify or reorder fields, but they do not permit partial patterns. |
| Types and names | Write `my_error`, not `my_error()`; import a module before referring to `module.Type`; function names cannot contain `.`; top-level function names cannot begin with `_`. |
| Comments | Use `//`, `///`, or `////`. Gleam does not support `/* ... */`, `%%`, or `#` comments. |
| APIs | Do not infer an external function's existence, arity, labels, or return type. Inspect its installed source or compiler output. |

When a diagnostic involves one of these rules, read
[`references/compile-traps.md`](references/compile-traps.md) for valid examples
and caveats before editing.

When choosing between `Result` and `Option`, or flattening nested control flow,
read [`references/control-flow.md`](references/control-flow.md) before editing.

## Installed API lookup

Run the helper from the affected package root so it reads that package's locked
dependencies:

```bash
/path/to/this/skill/scripts/gleam-sig gleam/list first
/path/to/this/skill/scripts/gleam-sig gleam/dynamic/decode field
/path/to/this/skill/scripts/gleam-sig sqlight
```

The helper deliberately has no global fallback: an arbitrary package elsewhere
on disk is not ground truth for the affected package. It prints the source path
and complete multiline function declaration. Read the source around that
location when signatures alone do not establish behaviour.

For CLI syntax, run `gleam help` or `gleam help <command>` using the repository's
configured Gleam version rather than relying on a maintained command list.
