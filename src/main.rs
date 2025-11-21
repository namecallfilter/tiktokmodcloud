use anyhow::Result;
use clap::{Args, Parser, Subcommand};
use dotenvy::dotenv;
use tracing::{Instrument, info_span};
use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt};
use wreq::{Client, redirect};
use wreq_util::Emulation;

use crate::scrape::DownloadType;

mod capsolver;
mod cli;
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
	Mod(ActionArgs),
	/// Select the plugin
	Plugin(ActionArgs),
	/// Both mod and plugin
	Both(ActionArgs),
}

#[derive(Args, Clone, Copy)]
#[group(required = true, multiple = false)]
struct ActionArgs {
	#[arg(short, long, help = "Check for the latest version")]
	check: bool,

	#[arg(short, long, help = "Download the latest version")]
	download: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
	dotenv().ok();

	tracing_subscriber::registry()
		.with(EnvFilter::try_from_default_env().unwrap_or_else(|_| {
			EnvFilter::new(format!("{}={}", env!("CARGO_CRATE_NAME"), "trace"))
		}))
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
		Commands::Mod(args) => {
			cli::handle_action(
				&client,
				DownloadType::Mod,
				args.check,
				args.download,
				json_output,
			)
			.await?;
		}
		Commands::Plugin(args) => {
			cli::handle_action(
				&client,
				DownloadType::Plugin,
				args.check,
				args.download,
				json_output,
			)
			.await?;
		}
		Commands::Both(args) => {
			cli::handle_action(
				&client,
				DownloadType::Mod,
				args.check,
				args.download,
				json_output,
			)
			.instrument(info_span!("both", type = "mod"))
			.await?;

			cli::handle_action(
				&client,
				DownloadType::Plugin,
				args.check,
				args.download,
				json_output,
			)
			.instrument(info_span!("both", type = "plugin"))
			.await?;
		}
	}

	Ok(())
}
