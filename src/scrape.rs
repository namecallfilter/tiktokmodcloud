use anyhow::{Context as _, Result};
use regex::Regex;
use wreq::{Client, redirect};
use wreq_util::Emulation;

#[derive(Debug, Clone, Copy)]
pub enum DownloadType {
	Mod,
	Plugin,
}

impl DownloadType {
	pub fn as_path(&self) -> &str {
		match self {
			DownloadType::Mod => "tik-tok-mod",
			DownloadType::Plugin => "tik-tok-plugin",
		}
	}
}

async fn fetch_with_retry(
	client: &Client, url: &str, referrer: &str, retries: u32,
) -> Result<wreq::Response> {
	let mut last_error = None;
	let mut delay_ms = 5000;

	for i in 0..retries {
		match client.get(url).header("Referer", referrer).send().await {
			Ok(response) => {
				if response.status().is_success() {
					return Ok(response);
				} else {
					let status = response.status();
					let error_msg = format!("HTTP error! status: {}", status);
					eprintln!(
						"Attempt {} failed: {}. Retrying in {}s...",
						i + 1,
						error_msg,
						delay_ms / 1000
					);
					last_error = Some(anyhow::anyhow!(error_msg));
				}
			}
			Err(e) => {
				eprintln!(
					"Attempt {} failed: {}. Retrying in {}s...",
					i + 1,
					e,
					delay_ms / 1000
				);
				last_error = Some(anyhow::anyhow!(e));
			}
		}

		if i < retries {
			tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;

			let multiplier = (4_u64.saturating_sub(i as u64)).max(1);

			delay_ms = delay_ms.saturating_mul(multiplier);
		}
	}

	Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Fetch failed after all retries.")))
}

pub async fn get_download_links(download_type: DownloadType) -> Result<(String, String)> {
	let client = Client::builder()
		.emulation(Emulation::Chrome142)
		.redirect(redirect::Policy::limited(10))
		.build()?;

	let start_url = format!("https://apkw.ru/en/download/{}/", download_type.as_path());

	println!("Fetching initial page: {}", start_url);

	let gate_page_text = fetch_with_retry(&client, &start_url, &start_url, 3)
		.await?
		.text()
		.await?;

	let gate_regex = Regex::new(r"href='([^']*)'[^>]*?>\s*MIRROR(?:\s+\d+)?\s*</a>")?;
	let gate_match = gate_regex
		.captures(&gate_page_text)
		.context("Failed to find the mirror gate URL.")?;

	let gate_url = gate_match
		.get(1)
		.context("Failed to extract gate URL from match")?
		.as_str();

	println!("Fetching gate page: {}", gate_url);

	let gate_response = fetch_with_retry(&client, gate_url, &start_url, 3).await?;
	let gate_url_after_redirect = gate_response.uri().to_string();

	let mirror_url = if gate_url_after_redirect.contains("file-download") {
		let lazy_redirect_page_text = gate_response.text().await?;
		let lazy_redirect_regex = Regex::new(r"href='([^']*)'[^>]rel='noreferrer'")?;
		let lazy_redirect_match = lazy_redirect_regex
			.captures(&lazy_redirect_page_text)
			.context("Failed to find the lazy redirect URL.")?;

		let lazy_redirect_url = lazy_redirect_match
			.get(1)
			.context("Failed to extract lazy redirect URL")?
			.as_str();

		println!("Resolving final mirror URL from: {}", lazy_redirect_url);

		let mirror_response = fetch_with_retry(&client, lazy_redirect_url, &start_url, 3).await?;
		mirror_response.uri().to_string()
	} else {
		gate_url_after_redirect
	};

	println!("Mirror URL: {}", mirror_url);

	let modsfire_page_text = fetch_with_retry(&client, &mirror_url, &start_url, 3)
		.await?
		.text()
		.await?;

	let location_regex = Regex::new(r#"document\.location\.href\s*=\s*['"](.*?)['"]"#)?;
	let location_match = location_regex
		.captures(&modsfire_page_text)
		.context("Failed to find the final Modsfire URL.")?;

	let modsfire_url = location_match
		.get(1)
		.context("Failed to extract modsfire URL")?
		.as_str()
		.to_string();

	println!("Modsfire URL: {}", modsfire_url);

	let direct_download_link = {
		let re = Regex::new(r"/([^/]*)$")?;
		re.replace(&modsfire_url, "/d/$1").to_string()
	};

	Ok((direct_download_link, modsfire_url))
}
