---
name: share-output
description: Make a user-facing file, report, static site, or local web app accessible to the user. Use after creating an output the user needs to view, or when they ask to open, access, or share an output—especially when the agent may be running remotely.
---

Get an existing output to the user in a form they can actually access. Choose delivery based on where the agent runs relative to the user, not merely where the file exists.

## 1. Establish the execution context

Determine whether the user can access this machine's filesystem and open its browser. Use explicit environment or conversation evidence where available. A path on the agent's machine is not a usable handoff when the agent is remote from the user.

If the context is unclear and changes the delivery choice, ask one concise question: can the user open files on this machine, or do they need a link? Do not assume a local browser-opening command reaches the user's device just because it succeeds on the agent machine.

## 2. Choose the smallest useful delivery method

- **Shared local environment:** Open the file locally if practical, then give its absolute path. If it is a website or app, use its existing local preview workflow.
- **Remote agent, user can reach the machine over their tailnet:** Prefer Tailscale Serve for a file, directory/static site, or local web app. Check `tailscale status` and `tailscale serve status` (and `tailscale serve --help` if syntax is unclear) before changing anything. Confirm Tailscale is connected and suitable for the requested content. Tailnet access is governed by the user's access controls.
- **Remote agent without usable tailnet access:** Use another already-configured sharing method only if available and appropriate. Otherwise explain the limitation and ask which access route the user wants; do not imply an agent-local path is accessible.

Do not upload private or sensitive material to a public service. Treat a tunnel or share link as an access decision: explain who can reach it and ask before creating public exposure. Tailnet-only sharing is private to the tailnet, but still exposes the selected content to tailnet members allowed by its access controls. Ask before persistent sharing unless the user has requested ongoing availability.

## 3. Start sharing

For Tailscale Serve, inspect the local CLI help or current configuration when unsure about supported syntax. Common patterns:

- Serve a directory containing a standalone HTML report and its assets: `tailscale serve /absolute/path/to/output-dir`. Put the intended landing page at `index.html`, or provide the user the exact served path for a differently named file.
- Serve a local web app: `tailscale serve <port>` (for example, `tailscale serve 3000`)
- Keep directory sharing active after the command session ends: `tailscale serve --bg /absolute/path/to/output-dir`

Foreground Serve ends when its process/session ends. Background Serve persists; only use it when the user wants ongoing access, and explain how to stop it (`tailscale serve off`). Remember to clean up your background serve if the user hasn't asked for persistence. Do not change an existing Serve configuration without checking what it currently serves and avoiding disruption to other content.

On macOS, directory/file serving depends on the installed Tailscale variant; some App Store or standalone variants support port proxying but not serving directories. If directory serving fails, use a local HTTP server bound to loopback and proxy its port through Serve if appropriate, or offer another configured method. Avoid elevated privileges unless the CLI specifically requires them.

## 4. Verify and hand off

Verify the server or tunnel started and obtain its actual URL from command output or status. Test the URL when practical. Then tell the user:

- what is available and where it is;
- the exact URL or absolute local path;
- whether it is tailnet-only or otherwise who can access it;
- whether access ends with the session or persists, and how to stop it.

If setup or verification fails, report what happened and offer the next viable option. Never invent a URL or claim the user can access an unverified path.
