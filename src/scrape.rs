use anyhow::{Context as _, Result};
use rand::RngExt;
use scraper::{Html, Selector};
use tracing::{debug, warn};
use wreq::Client;

use crate::fylio::{PageData, fetch_page_data};

const MAX_RETRY_DELAY_MS: u64 = 60_000;

#[derive(Debug, Clone, Copy)]
pub enum DownloadType {
	Mod,
	Plugin,
}

impl DownloadType {
	fn as_path(self) -> &'static str {
		match self {
			Self::Mod => "tik-tok-mod",
			Self::Plugin => "tik-tok-plugin",
		}
	}
}

#[derive(Debug)]
pub struct DownloadPage {
	pub page_url: String,
	pub page_data: PageData,
}

pub async fn get_download_page(
	client: &Client, download_type: DownloadType,
) -> Result<DownloadPage> {
	let start_url = format!("https://apkw.ru/en/download/{}/", download_type.as_path());
	debug!(url = %start_url, "Fetching initial page");

	let html = get_with_retry(client, &start_url, &start_url, 5)
		.await?
		.text()
		.await?;

	let document = Html::parse_document(&html);
	let selector = Selector::parse("a").expect("valid selector");

	let gate_url = document
		.select(&selector)
		.find(|el| {
			let text = el.text().collect::<String>();
			text.contains("UNIVERSAL") || text.contains("Plugin")
		})
		.and_then(|el| el.value().attr("href"))
		.context("Failed to find download gate URL")?
		.to_string();

	debug!(url = %gate_url, "Fetching gate page");

	let gate_response = get_with_retry(client, &gate_url, &start_url, 5).await?;
	let redirected_url = gate_response.uri().to_string();

	let page_url = if redirected_url.contains("file-download") {
		let text = gate_response.text().await?;
		let doc = Html::parse_document(&text);
		let sel = Selector::parse("a[rel='noreferrer']").expect("valid selector");
		doc.select(&sel)
			.next()
			.and_then(|el| el.value().attr("href"))
			.context("Failed to find lazy redirect URL")?
			.to_string()
	} else {
		redirected_url
	};

	debug!(url = %page_url, "Resolved Fylio page URL");

	let page_data = fetch_page_data(client, &page_url).await?;
	Ok(DownloadPage {
		page_url,
		page_data,
	})
}

async fn get_with_retry(
	client: &Client, url: &str, referer: &str, retries: u32,
) -> Result<wreq::Response> {
	let mut last_error = None;
	let mut delay_ms = 5_000u64;

	for attempt in 0..retries {
		match client.get(url).header("Referer", referer).send().await {
			Ok(resp) if resp.status().is_success() => return Ok(resp),
			Ok(resp) => {
				let status = resp.status();
				let reason = status.canonical_reason().unwrap_or("unknown");
				warn!(attempt = attempt + 1, status = %status, reason, "Request failed");
				last_error = Some(anyhow::anyhow!(
					"Request to {url} failed: {status} {reason}"
				));
			}
			Err(e) => {
				warn!(attempt = attempt + 1, error = %e, "Request error");
				last_error = Some(anyhow::anyhow!("Request to {url} failed: {e}"));
			}
		}

		if attempt + 1 < retries {
			let jitter = rand::rng().random_range(0..=1000u64);
			tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms + jitter)).await;
			delay_ms = delay_ms.saturating_mul(2).min(MAX_RETRY_DELAY_MS);
		}
	}

	Err(last_error
		.unwrap_or_else(|| anyhow::anyhow!("Request to {url} failed after {retries} attempts")))
}
