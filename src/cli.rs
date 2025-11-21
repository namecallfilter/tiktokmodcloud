use anyhow::Result;
use serde::Serialize;
use wreq::Client;

use crate::{
	scrape::{DownloadType, get_download_links},
	utils::{Downloader, InitialPageData, extract_data_initial_page},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CheckOutput {
	version: String,
	suffix: Option<String>,
}

pub(crate) async fn handle_action(
	client: &Client, download_type: DownloadType, check: bool, download: bool, json_output: bool,
) -> Result<()> {
	let (download_link, referer) = get_download_links(client, download_type).await?;

	if check {
		let InitialPageData { file_id, .. } = extract_data_initial_page(client, &referer).await?;

		let version = file_id.split('_').next().unwrap_or(&file_id);
		let suffix = file_id
			.rsplit('_')
			.next()
			.map(|s| s.strip_suffix(".apk").unwrap_or(s))
			.filter(|&s| s != "plugin" && s != "universal")
			.map(|s| s.to_string());

		if json_output {
			let output = CheckOutput {
				version: version.to_string(),
				suffix,
			};

			println!("{}", serde_json::to_string(&output)?);
		} else {
			println!("Version: {}", version);
		}
	}

	if download {
		let downloader = Downloader::new(client.clone());
		let verified_downloader = downloader.verify(&referer).await?;
		verified_downloader
			.download_file(&download_link, &referer, None)
			.await?;
	}

	Ok(())
}
