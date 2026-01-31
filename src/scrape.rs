use anyhow::{Context as _, Result};
use rand::Rng;
use regex::Regex;
use scraper::{Html, Selector};
use tracing::{debug, warn};
use wreq::Client;

use crate::error::ScrapeError;

const MAX_DELAY_MS: u64 = 60_000;

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
						attempt = i + 1,
						status = status.as_u16(),
						reason = reason,
						retry_delay_ms = delay_ms,
						"Attempt failed"
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
					attempt = i + 1,
					error = %e,
					retry_delay_ms = delay_ms,
					"Attempt failed with request error"
				);

				last_error = Some(ScrapeError::GetWithRetry(url.to_string(), e.to_string()).into());
			}
		}

		if i + 1 < retries {
			let jitter_ms = rand::rng().random_range(0..=1000);
			tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms + jitter_ms)).await;

			delay_ms = (delay_ms.saturating_mul(2)).min(MAX_DELAY_MS);
		}
	}

	Err(last_error.unwrap_or_else(|| {
		ScrapeError::GetWithRetry(url.to_string(), "No attempts made".to_string()).into()
	}))
}

pub async fn get_download_links(
	client: &Client, download_type: DownloadType,
) -> Result<(String, String)> {
	let start_url = format!("https://apkw.ru/en/download/{}/", download_type.as_path());

	debug!(start_url = %start_url, "Fetching initial page");

	let gate_page_text = get_with_retry(client, &start_url, &start_url, 5)
		.await?
		.text()
		.await?;

	let document = Html::parse_document(&gate_page_text);
	let selector = Selector::parse("a").expect("Valid 'a' selector");

	let gate_url = document
		.select(&selector)
		.find(|el| {
			el.text().collect::<String>().contains("UNIVERSAL")
				|| el.text().collect::<String>().contains("Plugin")
		})
		.and_then(|el| el.value().attr("href"))
		.context("Failed to find mirror gate URL")?
		.to_string();

	debug!(gate_url = %gate_url, "Fetching gate page");

	let gate_response = get_with_retry(client, &gate_url, &start_url, 5).await?;
	let gate_url_after_redirect = gate_response.uri().to_string();

	let mirror_url = if gate_url_after_redirect.contains("file-download") {
		let lazy_redirect_page_text = gate_response.text().await?;
		let lazy_doc = Html::parse_document(&lazy_redirect_page_text);
		let lazy_selector =
			Selector::parse("a[rel='noreferrer']").expect("Valid 'a[rel=noreferrer]' selector");

		let lazy_redirect_url = lazy_doc
			.select(&lazy_selector)
			.next()
			.and_then(|el| el.value().attr("href"))
			.context("Failed to find the lazy redirect URL")?;

		debug!(lazy_redirect_url = %lazy_redirect_url, "Resolving final mirror URL");

		let mirror_response = get_with_retry(client, lazy_redirect_url, &start_url, 5).await?;
		mirror_response.uri().to_string()
	} else {
		gate_url_after_redirect
	};

	debug!(mirror_url = %mirror_url, "Mirror URL");

	let countdown_page_text = get_with_retry(client, &mirror_url, &start_url, 5)
		.await?
		.text()
		.await?;

	let intermediate_regex =
		Regex::new(r#"href\s*=\s*["'](https://go\.linkify\.ru/get/[^"']+)["']"#)?;

	let intermediate_url = intermediate_regex
		.captures(&countdown_page_text)
		.and_then(|cap| cap.get(1))
		.map(|m| m.as_str().to_string())
		.context("Failed to find the intermediate linkify 'get' URL in the countdown script")?;

	debug!(intermediate_url = %intermediate_url, "Fetching intermediate redirect page");

	let final_redirect_page_text = get_with_retry(client, &intermediate_url, &mirror_url, 5)
		.await?
		.text()
		.await?;

	let modsfire_regex =
		Regex::new(r#"window\.location\.replace\(\s*['"](https://modsfire\.com/[^'"]+)['"]\s*\)"#)?;

	let modsfire_url = modsfire_regex
		.captures(&final_redirect_page_text)
		.and_then(|cap| cap.get(1))
		.map(|m| m.as_str().to_string())
		.context("Failed to extract final modsfire URL from intermediate page")?;

	debug!(modsfire_url = %modsfire_url, "Modsfire URL");

	let direct_download_link = {
		let re = Regex::new(r"/([^/]*)$")?;
		re.replace(&modsfire_url, "/d/$1").to_string()
	};

	Ok((direct_download_link, modsfire_url))
}
