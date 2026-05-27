A personal AI agents nix flake.

It configures various projects for my personal use/taste.

Key components:
microsandbox - run kvm sandboxes to wrap ai coding agents
llm-agents.nix - a nix flake that builds various ai coding agents and tooling for nix
pi - coding agent (provided by llm-agents.nix)
sops - encrypt secrets to store in the repo. Must only be decrypted at runtime NOT nix evaluation time.

Guidelines:
- reference upstream files in flake inputs or fetchURL etc. NEVER local paths

Knowledge lookup:
There's a folder `knowledge` that contains documentation and cloned repos of dependendent projects.
