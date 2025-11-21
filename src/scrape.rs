use anyhow::{Context as _, Result};
use rand::Rng;
use regex::Regex;
use scraper::{Html, Selector};
use tracing::{debug, warn};
use wreq::Client;

use crate::error::ScrapeError;

const MAX_DELAY_MS: u64 = 60_000;

#[derive(Debug, Clone, Copy)]
pub(crate) enum DownloadType {
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

async fn get_with_retry(
	client: &Client, url: &str, referrer: &str, retries: u32,
) -> Result<wreq::Response> {
	let mut last_error = None;
	let mut delay_ms = 5000;

	for i in 0..retries {
		match client.get(url).header("Referer", referrer).send().await {
			Ok(response) => {
				if !response.status().is_success() {
					let status = response.status();
					let reason = status.canonical_reason().unwrap_or("Unknown Status");

					warn!(
						"Attempt {} failed with status {}: {}. Retrying in {}ms...",
						i + 1,
						status.as_u16(),
						reason,
						delay_ms
					);

					last_error = Some(
						ScrapeError::GetWithRetry(
							url.to_string(),
							format!("Server responded with {}: {}", status.as_u16(), reason),
						)
						.into(),
					);
				} else {
					return Ok(response);
				}
			}
			Err(e) => {
				warn!(
					"Attempt {} failed with request error: {}. Retrying in {}ms...",
					i + 1,
					e,
					delay_ms
				);

				last_error = Some(ScrapeError::GetWithRetry(url.to_string(), e.to_string()).into());
			}
		}

		if i < retries {
			let jitter_ms = rand::rng().random_range(0..=1000);
			tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms + jitter_ms)).await;

			delay_ms = (delay_ms.saturating_mul(2)).min(MAX_DELAY_MS);
		}
	}

	Err(last_error.unwrap())
}

pub(crate) async fn get_download_links(
	client: &Client, download_type: DownloadType,
) -> Result<(String, String)> {
	let start_url = format!("https://apkw.ru/en/download/{}/", download_type.as_path());

	debug!("Fetching initial page: {}", start_url);

	let gate_page_text = get_with_retry(client, &start_url, &start_url, 5)
		.await?
		.text()
		.await?;

	let document = Html::parse_document(&gate_page_text);
	let selector = Selector::parse("a").unwrap();

	let gate_url = document
		.select(&selector)
		.find(|el| el.text().collect::<String>().contains("MIRROR"))
		.and_then(|el| el.value().attr("href"))
		.context("Failed to find mirror gate URL")?
		.to_string();

	debug!("Fetching gate page: {}", gate_url);

	let gate_response = get_with_retry(client, &gate_url, &start_url, 5).await?;
	let gate_url_after_redirect = gate_response.uri().to_string();

	let mirror_url = if gate_url_after_redirect.contains("file-download") {
		let lazy_redirect_page_text = gate_response.text().await?;
		let lazy_doc = Html::parse_document(&lazy_redirect_page_text);
		let lazy_selector = Selector::parse("a[rel='noreferrer']").unwrap();

		let lazy_redirect_url = lazy_doc
			.select(&lazy_selector)
			.next()
			.and_then(|el| el.value().attr("href"))
			.context("Failed to find the lazy redirect URL")?;

		debug!("Resolving final mirror URL from: {}", lazy_redirect_url);

		let mirror_response = get_with_retry(client, lazy_redirect_url, &start_url, 5).await?;
		mirror_response.uri().to_string()
	} else {
		gate_url_after_redirect
	};

	debug!("Mirror URL: {}", mirror_url);

	let modsfire_page_text = get_with_retry(client, &mirror_url, &start_url, 5)
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

	debug!("Modsfire URL: {}", modsfire_url);

	let direct_download_link = {
		let re = Regex::new(r"/([^/]*)$")?;
		re.replace(&modsfire_url, "/d/$1").to_string()
	};

	Ok((direct_download_link, modsfire_url))
}
