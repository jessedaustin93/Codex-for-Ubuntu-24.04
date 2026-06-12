# Codex Linux

Codex Linux is an Ubuntu 24.04 desktop client built around the official
`codex app-server` interface. It provides a desktop workflow for local Codex
threads while reusing the CLI's authentication, configuration, approvals,
tools, and memory files.

## What works

- Connects to `codex app-server` over JSONL/stdio.
- Starts, resumes, lists, and interrupts Codex threads.
- Streams assistant text and tool activity.
- Displays and answers approval requests.
- Opens workspaces with a native directory picker.
- Searches the same memory files stored under `~/.codex/memories`.
- Enables Codex memories in `~/.codex/config.toml`.
- Builds both an AppImage and a Debian package.

The app does not copy private OpenAI desktop code. It is an independent client
using the public Codex app-server protocol, which is the supported interface
for rich local clients.

## Ubuntu 24.04 setup

```bash
git clone https://github.com/jessedaustin93/Codex-for-Ubuntu-24.04.git codex-linux
cd codex-linux
chmod +x scripts/install-ubuntu.sh
./scripts/install-ubuntu.sh
codex login
```

Then install the generated package:

```bash
sudo apt install ./dist/Codex-Linux-0.1.0-amd64.deb
```

Or run the AppImage directly:

```bash
chmod +x dist/Codex-Linux-0.1.0-x86_64.AppImage
./dist/Codex-Linux-0.1.0-x86_64.AppImage
```

## Development

Requirements:

- Ubuntu 24.04
- Node.js 20 or newer
- Official Codex CLI available as `codex`
- A completed `codex login`

```bash
npm install
npm start
```

Run checks:

```bash
npm run check
```

Build Linux packages:

```bash
npm run dist
```

The repository also includes an Ubuntu 24.04 GitHub Actions workflow that runs
checks and publishes the AppImage and Debian package as workflow artifacts.

## Memory compatibility

Codex Linux reads memory directly from the current Codex home:

```text
${CODEX_HOME:-~/.codex}/memories
```

The memory toggle updates `[features].memories` in:

```text
${CODEX_HOME:-~/.codex}/config.toml
```

This means the CLI, this client, and other Codex surfaces can use the same local
memory state. Required repository rules should still live in `AGENTS.md`.

## Security model

- Renderer code has no Node.js access.
- Electron context isolation and sandboxing are enabled.
- Codex commands run through the official app-server process.
- Approval decisions are returned to app-server rather than executed directly
  by the renderer.
- The default intended policy is workspace write with approvals on request.

## Protocol compatibility

`codex app-server` is currently experimental and can evolve between CLI
versions. Generate version-matched schemas when updating the integration:

```bash
codex app-server generate-ts --out ./schemas
codex app-server generate-json-schema --out ./schemas
```
