use anyhow::Result;
use serde::Serialize;
use wreq::Client;

use crate::{
	fylio::{download_file, resolve_download_links},
	scrape::{DownloadType, get_download_page},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckOutput {
	version: String,
	suffix: Option<String>,
	file_name: String,
	file_size: String,
}

pub async fn handle_action(
	client: &Client, download_type: DownloadType, check: bool, download: bool, json_output: bool,
) -> Result<()> {
	let page = get_download_page(client, download_type).await?;
	let file_name = &page.page_data.file_name;

	if check {
		let version = file_name.split('_').next().unwrap_or(file_name);
		let suffix = file_name
			.rsplit('_')
			.next()
			.map(|s| s.strip_suffix(".apk").unwrap_or(s))
			.filter(|&s| s != "plugin" && s != "universal")
			.map(str::to_string);

		if json_output {
			let output = CheckOutput {
				version: version.to_string(),
				suffix,
				file_name: file_name.clone(),
				file_size: page.page_data.file_size_label.clone(),
			};
			println!("{}", serde_json::to_string(&output)?);
		} else {
			println!("Version: {version}");
			println!("File: {file_name}");
		}
	}

	if download {
		let links =
			resolve_download_links(client, &page.page_url, &page.page_data.click_id).await?;
		download_file(client, &links[0], &page.page_url, file_name).await?;
	}

	Ok(())
}
