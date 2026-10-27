# GitHub-hosted runners

## Runner labels and specs

### Public repositories

Free and unlimited on public repos. Single-CPU runners run in a container; all others are full VMs.

| OS | CPU | RAM | Storage | Arch | Workflow label |
|---|---|---|---|---|---|
| Linux | 1 | 5 GB | 14 GB | x64 | `ubuntu-slim` |
| Linux | 4 | 16 GB | 14 GB | x64 | `ubuntu-latest`, `ubuntu-24.04`, `ubuntu-22.04` |
| Windows | 4 | 16 GB | 14 GB | x64 | `windows-latest`, `windows-2025`, `windows-2025-vs2026` (preview), `windows-2022` |
| Linux | 4 | 16 GB | 14 GB | arm64 | `ubuntu-24.04-arm`, `ubuntu-22.04-arm` |
| Windows | 4 | 16 GB | 14 GB | arm64 | `windows-11-arm` |
| macOS | 4 | 14 GB | 14 GB | Intel | `macos-15-intel`, `macos-26-intel` |
| macOS | 3 (M1) | 7 GB | 14 GB | arm64 | `macos-latest`, `macos-14`, `macos-15`, `macos-26` |

### Private repositories

Uses account free minutes, then billed per minute.

| OS | CPU | RAM | Storage | Arch | Workflow label |
|---|---|---|---|---|---|
| Linux | 1 | 5 GB | 14 GB | x64 | `ubuntu-slim` |
| Linux | 2 | 8 GB | 14 GB | x64 | `ubuntu-latest`, `ubuntu-24.04`, `ubuntu-22.04` |
| Windows | 2 | 8 GB | 14 GB | x64 | `windows-latest`, `windows-2025`, `windows-2022` |
| Linux | 2 | 8 GB | 14 GB | arm64 | `ubuntu-24.04-arm`, `ubuntu-22.04-arm` |
| Windows | 2 | 8 GB | 14 GB | arm64 | `windows-11-arm` |
| macOS | 4 | 14 GB | 14 GB | Intel | `macos-15-intel`, `macos-26-intel` |
| macOS | 3 (M1) | 7 GB | 14 GB | arm64 | `macos-latest`, `macos-14`, `macos-15`, `macos-26` |

## Key details

**`macos-latest` is arm64 (M1), not Intel.** It has been arm64 since `macos-14`. Use `macos-15-intel` or `macos-26-intel` for Intel macOS.

**`ubuntu-slim`** runs in an unprivileged container (not a full VM). 15-minute job timeout. Minimal tooling. Good for linting, issue automation, and lightweight tasks — not for CI/CD builds. No Docker-in-Docker or filesystem mounting.

## arm64 macOS limitations

- Community actions may not be arm64-compatible and may need manual installation at runtime.
- Nested-virtualization is not supported (Apple Virtualization Framework limitation).
- No static UUID/UDID on arm64 runners. Intel runners have UDID `4203018E-580F-C1B5-9525-B745CECA79EB`. If you need a static UDID (e.g. Apple Developer provisioning), use Intel runners.
