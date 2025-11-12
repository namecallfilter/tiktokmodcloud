use anyhow::Result;
use clap::{Parser, Subcommand};
use dotenvy::dotenv;

mod capsolver;
mod scrape;
mod utils;

use scrape::{DownloadType, get_download_links};
use utils::{download_file, extract_data_initial_page};

use crate::utils::InitialPage;

#[derive(Parser)]
#[command(name = "tiktokmodcloud")]
#[command(about = "TikTok Mod Cloud CLI", long_about = None)]
struct Cli {
	#[command(subcommand)]
	command: Commands,
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
	/// Test's both mod and plugin
	Test {
		#[arg(short, long, help = "Check for the latest versions")]
		check: bool,

		#[arg(short, long, help = "Download the latest versions")]
		download: bool,
	},
}

async fn handle_action(download_type: DownloadType, check: bool, download: bool) -> Result<()> {
	if check == download {
		anyhow::bail!("Error: Please specify exactly one action: --check (-c) or --download (-d).");
	}

	let (download_link, referer) = get_download_links(download_type).await?;

	if check {
		let InitialPage {
			file_id,
			file_upload_date,
			..
		} = extract_data_initial_page(&referer).await?;

		let version = file_id.split('_').next().unwrap_or(&file_id);

		println!("{} | {}", version, file_upload_date);
	}

	if download {
		download_file(&download_link, &referer, None).await?;
	}

	Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
	dotenv().ok();

	let cli = Cli::parse();

	match cli.command {
		Commands::Mod { check, download } => {
			handle_action(DownloadType::Mod, check, download).await?;
		}
		Commands::Plugin { check, download } => {
			handle_action(DownloadType::Plugin, check, download).await?;
		}
		Commands::Test { check, download } => {
			println!("--- MOD ---");
			handle_action(DownloadType::Mod, check, download).await?;
			println!("\n--- PLUGIN ---");
			handle_action(DownloadType::Plugin, check, download).await?;
		}
	}

	Ok(())
}
