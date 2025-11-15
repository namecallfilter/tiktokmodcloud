use anyhow::{Result, bail};
use clap::{Parser, Subcommand};
use dotenvy::dotenv;
use scrape::{DownloadType, get_download_links};
use serde::Serialize;
use tracing::{Instrument, info_span};
use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt};
use utils::{download_file, extract_data_initial_page};
use wreq::{Client, redirect};
use wreq_util::Emulation;

use crate::utils::InitialPageData;

mod capsolver;
mod error;
mod scrape;
mod utils;

#[derive(Parser)]
#[command(name = "tiktokmodcloud")]
#[command(about = "TikTok Mod Cloud CLI", long_about = None)]
struct Cli {
	#[command(subcommand)]
	command: Commands,

	#[arg(long, global = true, help = "Output information as JSON")]
	json: bool,
}

#[derive(Subcommand)]
enum Commands {
	/// Select the mod
	Mod {
		#[arg(short, long, help = "Check for the latest version")]
		check: bool,

		#[arg(short, long, help = "Download the latest version")]
		download: bool,
	},
	/// Select the plugin
	Plugin {
		#[arg(short, long, help = "Check for the latest version")]
		check: bool,

		#[arg(short, long, help = "Download the latest version")]
		download: bool,
	},
	/// Both mod and plugin
	Both {
		#[arg(short, long, help = "Check for the latest versions")]
		check: bool,

		#[arg(short, long, help = "Download the latest versions")]
		download: bool,
	},
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckOutput {
	version: String,
	upload_date: String,
	date_tag: String,
}

async fn handle_action(
	client: &Client, download_type: DownloadType, check: bool, download: bool, json_output: bool,
) -> Result<()> {
	if check == download {
		bail!("Error: Please specify exactly one action: --check (-c) or --download (-d).");
	}

	let (download_link, referer) = get_download_links(client, download_type).await?;

	if check {
		let InitialPageData {
			file_id,
			file_upload_date,
			..
		} = extract_data_initial_page(client, &referer).await?;

		let version = file_id.split('_').next().unwrap_or(&file_id);

		if json_output {
			let mut date_tag = file_upload_date.replace([':', ' ', '-'], "");
			if date_tag.len() == 12 {
				date_tag.insert(8, '-');
			}

			let output = CheckOutput {
				version: version.to_string(),
				upload_date: file_upload_date.clone(),
				date_tag,
			};

			println!("{}", serde_json::to_string(&output)?);
		} else {
			println!("Version: {}", version);
			println!("Upload Date: {}", file_upload_date)
		}
	}

	if download {
		download_file(client, &download_link, &referer, None).await?;
	}

	Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
	dotenv().ok();

	tracing_subscriber::registry()
		.with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("trace")))
		.with(
			fmt::layer()
				.with_target(true)
				.with_thread_ids(false)
				.with_file(true)
				.with_line_number(true)
				.with_writer(std::io::stderr)
				.without_time(),
		)
		.init();

	let cli = Cli::parse();
	let json_output = cli.json;

	let client = Client::builder()
		.emulation(Emulation::Chrome142)
		.redirect(redirect::Policy::limited(10))
		.cookie_store(true)
		.build()?;

	match cli.command {
		Commands::Mod { check, download } => {
			handle_action(&client, DownloadType::Mod, check, download, json_output).await?;
		}
		Commands::Plugin { check, download } => {
			handle_action(&client, DownloadType::Plugin, check, download, json_output).await?;
		}
		Commands::Both { check, download } => {
			handle_action(&client, DownloadType::Mod, check, download, json_output)
				.instrument(info_span!("both", type = "mod"))
				.await?;

			handle_action(&client, DownloadType::Plugin, check, download, json_output)
				.instrument(info_span!("both", type = "plugin"))
				.await?;
		}
	}

	Ok(())
}
