# TikTok Mod Cloud CLI

A TypeScript/Bun CLI tool to check and download the latest TikTok mods and plugins from TikTokModCloud.

## Prerequisites

- [Bun](https://bun.sh/) runtime installed

## Setup

```bash
bun install
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
bun run src/index.ts mod --check
```

Download both Mod and Plugin:

```bash
bun run src/index.ts both --download
```

Check version as JSON:

```bash
bun run src/index.ts mod -c --json
```

## Legal and Ethical Disclaimer

This tool is for educational and research purposes only. Automating CAPTCHA solving and scraping software download sites may violate terms of service or local laws. Use this tool responsibly and at your own risk. The authors are not responsible for any misuse or legal consequences.

## License

This project is licensed under the MIT License.
