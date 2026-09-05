# TikTok Mod Cloud CLI

A TypeScript/Bun CLI tool to check and download the latest TikTok mods and plugins from TikTokModCloud.

## Prerequisites

- [Bun](https://bun.sh/) 1.4.1 or newer (CI uses the version in `.bun-version`)

## Setup

```bash
bun install --frozen-lockfile
```

## Usage

### Commands

- `mod` - Handle TikTok Mod
- `plugin` - Handle TikTok Plugin
- `both` - Handle both Mod and Plugin sequentially

### Flags

- `-c, --check` - Check for the latest version
- `-d, --download` - Download the latest version
- `--json` - Output information as JSON
- `-h, --help` - Show help message

### Examples

Check for the latest TikTok Mod:

```bash
bun run cli mod --check
```

Download both Mod and Plugin:

```bash
bun run cli both --download
```

Check version as JSON:

```bash
bun run cli mod -c --json
```

Logs and progress go to stderr, so stdout can be piped directly to a JSON parser. `both --check --json` emits one JSON object per line, in mod then plugin order. Downloads are saved in `./apks`.

## Development

Use Node.js 24 LTS for the formatter and other development tools, in addition to Bun.

```bash
bun run check
bun test
```

`check` runs lint, formatting, and TypeScript checks. Tests live in `tests/` and use local fixtures and simulated responses; they do not download APKs or depend on the upstream sites. Run `bun run format` to format changes.

CI runs these checks on Linux and Windows. The scheduled download workflows additionally check the live upstream sites, whose page structure and availability can change independently of this repository.

After changing dependencies, run `bun install` and commit both `package.json` and `bun.lock`. Weekly Dependabot checks cover Bun packages and GitHub Actions. The experimental RSC decoder is pinned to an exact version so updates are reviewed explicitly.

The HTTP client uses wreq-js's `chrome` alias, which selects its newest supported Chrome profile and advances when wreq-js is updated.

Node type definitions are constrained to the latest 25.x release: `thread-stream` still references `TransferListItem`, which was removed in 26.x. This keeps dependency declarations type-checked without `skipLibCheck`.

## Legal and Ethical Disclaimer

This tool is for educational and research purposes only. Automating CAPTCHA solving and scraping software download sites may violate terms of service or local laws. Use this tool responsibly and at your own risk. The authors are not responsible for any misuse or legal consequences.

## License

This project is licensed under the MIT License.
