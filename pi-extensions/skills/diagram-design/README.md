# Diagram Design (Pi vendored copy)

Vendored from [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design), upstream commit [`f4547ee95f88e5b28a52517feff6b6c11cc657f9`](https://github.com/cathrynlavery/diagram-design/commit/f4547ee95f88e5b28a52517feff6b6c11cc657f9) (2026-10-08). The skill is MIT licensed; see [LICENSE](LICENSE) and [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## What is included

The complete upstream `skills/diagram-design/` package: `SKILL.md`, its references, templates/examples/assets, and bundled Python utilities. Keeping the package intact preserves its relative links and progressive-disclosure workflow. Pi discovers it through this repository's `./skills` entry in `package.json`; invoke it explicitly as `/skill:diagram-design` or let Pi select it for a matching diagram request.

This is a full diagram-design toolkit: create editorial HTML/SVG diagrams, select among the catalog of visual types, and redraw draw.io, Mermaid, or Excalidraw inputs. The workflow deliberately prefers prose/tables when a diagram adds no value, and includes rules for visual hierarchy, accessible SVG, and import fidelity.

## Tailoring for this repository

- The upstream project already supports Pi. Its skill body and local relative reference links are retained, with one small wording adaptation: import requests use the referenced workflow because this package does not install the upstream slash-command templates.
- This repository vendors **the skill package only**. Upstream plugin manifests, native slash commands/prompt templates, repository-wide verifier/test scripts, and maintenance tooling are not installed. Bundled utilities such as `scripts/self_check.py`, format extractors, and `scripts/export_svg.py` are included. PNG export may require optional Playwright/Chromium; basic authoring has no added dependency.
- Upstream references sometimes describe verifier scripts that live at the upstream repository root. Those repository-only checks are not available in this vendored skill; use the bundled self-check and manual review unless a checker is explicitly present under this directory.
- Generated diagrams use external Google Fonts when online; the HTML, CSS, and SVG are otherwise self-contained.

## Syncing upstream

1. Clone the upstream repository at the desired revision and record the full commit hash here.
2. Replace this directory's contents with upstream `skills/diagram-design/`, preserving this local `README.md` and the upstream root `LICENSE` and `THIRD_PARTY_LICENSES.md`.
3. Reapply and verify the Pi packaging note above (especially references to slash commands and repository-only checkers).
4. Check relative links, run `uv run --python 3.13 python skills/diagram-design/scripts/self_check.py <generated-file>` against a representative diagram, and inspect the diff. Keep the copyright and third-party license notices.
