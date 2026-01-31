# TikTok Mod Cloud CLI

A Rust-based CLI tool to check and download the latest TikTok mods and plugins from TikTokModCloud.

## Features

- **Check for updates**: Quickly check the latest version available.
- **Automated Downloads**: Scrapes download links and handles CAPTCHAs automatically.
- **Progress Tracking**: Real-time progress bar for downloads.
- **JSON Output**: Optional JSON format for integration with other tools.

## Prerequisites

- **Rust**: Ensure you have the latest stable Rust toolchain installed.
- **CapSolver API Key**: This tool uses [CapSolver](https://www.capsolver.com/) to solve Turnstile CAPTCHAs. You need an active API key.

## Configuration

Create a `.env` file in the root directory and add your CapSolver API key:

```env
CAPSOLVER_KEY=your_capsolver_api_key_here
```

## Usage

### Commands

- `mod`: Handle TikTok Mod.
- `plugin`: Handle TikTok Plugin.
- `both`: Handle both Mod and Plugin sequentially.

### Flags

- `-c, --check`: Check for the latest version.
- `-d, --download`: Download the latest version.
- `--json`: Output information as JSON.

### Examples

Check for the latest TikTok Mod:
```bash
cargo run -- mod --check
```

Download both Mod and Plugin:
```bash
cargo run -- both --download
```

## Legal and Ethical Disclaimer

This tool is for educational and research purposes only. Automating CAPTCHA solving and scraping software download sites may violate terms of service or local laws. Use this tool responsibly and at your own risk. The authors are not responsible for any misuse or legal consequences.

## License

This project is licensed under the MIT License.
