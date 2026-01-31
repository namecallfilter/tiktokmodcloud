use std::{
	marker::PhantomData,
	path::{Path, PathBuf},
};

use anyhow::{Context as _, Result, bail};
use futures_util::StreamExt;
use indicatif::{ProgressBar, ProgressStyle};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use tokio::{
	fs::File,
	io::{AsyncWriteExt, BufWriter},
};
use tracing::{debug, info, trace};
use wreq::Client;

use crate::{capsolver::solve_turnstile, error::UtilsError};

#[derive(Debug, Clone)]
pub struct InitialPageData {
	pub csrf_token: String,
	pub file_id: String,
	pub sitekey: String,
}

#[derive(Debug, Deserialize)]
struct VerifyResponse {
	success: bool,
}

#[derive(Debug, Serialize)]
struct VerifyPayload {
	token: String,
	file_id: String,
}

pub struct Unverified;
pub struct Verified;

pub struct Downloader<State = Unverified> {
	client: Client,
	filename: Option<String>,
	phantom: PhantomData<State>,
}

impl Downloader<Unverified> {
	pub fn new(client: Client) -> Self {
		Self {
			client,
			filename: None,
			phantom: PhantomData,
		}
	}

	#[must_use = "Verification returns a new verified Downloader that must be used"]
	pub async fn verify(self, page_url: &str) -> Result<Downloader<Verified>> {
		let InitialPageData {
			csrf_token,
			file_id,
			sitekey,
			..
		} = extract_data_initial_page(&self.client, page_url).await?;

		let captcha_token = solve_turnstile(sitekey, page_url.to_string()).await?;

		debug!("Verifying captcha solution with the website...");

		let verify_payload = VerifyPayload {
			token: captcha_token,
			file_id: file_id.clone(),
		};

		let verify_response = self
			.client
			.post("https://modsfire.com/verify-cf-captcha")
			.header("Content-Type", "application/json")
			.header("X-CSRF-TOKEN", &csrf_token)
			.json(&verify_payload)
			.send()
			.await?;

		if !verify_response.status().is_success() {
			bail!(
				"Failed to verify captcha: {} {}",
				verify_response.status().as_u16(),
				verify_response
					.status()
					.canonical_reason()
					.unwrap_or("Unknown")
			);
		}

		let response_data: VerifyResponse = verify_response.json().await?;

		if response_data.success {
			info!("Successfully obtained verification cookie!");

			Ok(Downloader {
				client: self.client,
				filename: Some(file_id),
				phantom: PhantomData,
			})
		} else {
			bail!(UtilsError::VerificationRejection);
		}
	}
}

impl Downloader<Verified> {
	#[tracing::instrument(skip(self))]
	pub async fn download_file(
		&self, download_url: &str, referer: &str, output_dir: Option<&str>,
	) -> Result<PathBuf> {
		let output_dir = output_dir.unwrap_or("./apks");

		debug!("Starting download from {}", download_url);

		let response = self
			.client
			.get(download_url)
			.header("Referer", referer)
			.send()
			.await?;

		if !response.status().is_success() {
			bail!(UtilsError::DownloadFile(response.status()));
		}

		let total_size = response.content_length();

		let pb = if let Some(size) = total_size {
			let pb = ProgressBar::new(size);
			pb.set_style(ProgressStyle::default_bar()
				.template("{msg}\n{spinner:.green} [{elapsed_precise}] [{wide_bar:.cyan/blue}] {bytes}/{total_bytes} ({bytes_per_sec}, {eta})")?
				.progress_chars("#>-"));
			pb
		} else {
			let pb = ProgressBar::new_spinner();
			pb.set_style(ProgressStyle::default_spinner().template(
				"{msg}\n{spinner:.green} [{elapsed_precise}] {bytes} ({bytes_per_sec})",
			)?);
			pb
		};

		pb.set_message("Downloading...");

		let filename = self.filename.clone().unwrap_or_else(|| {
			let final_url = response.uri().to_string();
			final_url
				.split('/')
				.next_back()
				.unwrap_or("downloaded_file")
				.split('?')
				.next()
				.unwrap_or("downloaded_file")
				.to_string()
		});

		let file_path = Path::new(output_dir).join(&filename);

		tokio::fs::create_dir_all(output_dir).await?;

		let file = File::create(&file_path).await?;
		let mut writer = BufWriter::new(file);

		let mut downloaded_size = 0u64;

		let mut stream = response.bytes_stream();

		while let Some(chunk) = stream.next().await {
			let chunk = chunk?;
			writer.write_all(&chunk).await?;

			downloaded_size += chunk.len() as u64;

			pb.set_position(downloaded_size);
		}

		writer.flush().await?;

		pb.finish_with_message(format!(
			"File downloaded successfully: {}",
			file_path.display()
		));

		info!("Download complete: {}", file_path.display());

		Ok(file_path)
	}
}

pub async fn extract_data_initial_page(client: &Client, url: &str) -> Result<InitialPageData> {
	debug!("Fetching initial page data from: {}", url);

	let page_response = client.get(url).send().await?;

	if !page_response.status().is_success() {
		bail!(UtilsError::FetchPage(page_response.status()));
	}

	let page_html = page_response.text().await?;
	let document = Html::parse_document(&page_html);

	let csrf_selector = Selector::parse(r#"input[name="_token"]"#).expect("Valid CSRF selector");
	let csrf_token = document
		.select(&csrf_selector)
		.next()
		.context("Failed to find CSRF token element")?
		.value()
		.attr("value")
		.context("Failed to extract CSRF token value")?
		.to_string();

	let file_id_selector = Selector::parse(r#"input#file_id"#).expect("Valid File ID selector");
	let file_id = document
		.select(&file_id_selector)
		.next()
		.context("Failed to find File ID element")?
		.value()
		.attr("value")
		.context("Failed to extract File ID value")?
		.to_string();

	let sitekey_selector = Selector::parse(r#".cf-turnstile"#).expect("Valid Sitekey selector");
	let sitekey = document
		.select(&sitekey_selector)
		.next()
		.context("Failed to find Sitekey element")?
		.value()
		.attr("data-sitekey")
		.context("Failed to extract Sitekey value")?
		.to_string();

	let initial_page_data = InitialPageData {
		csrf_token,
		file_id,
		sitekey,
	};

	trace!(
		"Successfully fetched initial page data: {:#?}",
		initial_page_data
	);

	Ok(initial_page_data)
}
