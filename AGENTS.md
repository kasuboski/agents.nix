A personal AI agents nix flake.

It configures various projects for my personal use/taste.

Key components:
microsandbox - run kvm sandboxes to wrap ai coding agents
llm-agents.nix - a nix flake that builds various ai coding agents and tooling for nix
pi - coding agent (provided by llm-agents.nix)
sops - encrypt secrets to store in the repo. Must only be decrypted at runtime NOT nix evaluation time.

Guidelines:
- Sources committed in this repository, including vendored third-party code, may be referenced in-tree. Do not depend on machine-local or sibling checkouts (for example `../some-repo`, `/home/...` repositories, or `knowledge/repos`); external sources must be pinned upstream files in flake inputs or `fetchURL`.

Knowledge lookup:
There's a folder `knowledge` that contains documentation and cloned repos of dependendent projects.

ALWAYS run `nix fmt` before committing.

Before updating flake input pins, read the update guidance in `README.md` and complete its real-build validation.
