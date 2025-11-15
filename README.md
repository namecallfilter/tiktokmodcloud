# TikTokModCloud Downloader

CLI tool to download the latest TikTok Mod and Plugin APK files from TikTokModCloud.

## Setup

1. Install [Rust](https://www.rust-lang.org/tools/install)

2. Create a `.env` file:
   ```env
   CAPSOLVER_KEY=your_capsolver_api_key
   ```

3. Build:
   ```bash
   cargo build --release
   ```

## Usage

```bash
# Check version
tiktokmodcloud mod --check
tiktokmodcloud plugin --check

# Download
tiktokmodcloud mod --download
tiktokmodcloud plugin --download

# Both at once
tiktokmodcloud both --check
tiktokmodcloud both --download

# JSON output
tiktokmodcloud mod --check --json
```

## Requirements

- CapSolver API key from [capsolver.com](https://capsolver.com)
