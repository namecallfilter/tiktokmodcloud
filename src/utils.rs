use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result, bail};
use chrono::{Duration, Local, NaiveDateTime};
use futures_util::StreamExt;
use indicatif::{ProgressBar, ProgressStyle};
use regex::Regex;
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
	pub file_upload_date: String,
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

pub async fn download_file(
	client: &Client, download_url: &str, referer: &str, output_dir: Option<&str>,
) -> Result<PathBuf> {
	let output_dir = output_dir.unwrap_or("./apks");
	get_verification_cookie(client, referer).await?;

	debug!("Starting download from {}", download_url);

	let response = client
		.get(download_url)
		.header("Referer", referer)
		.send()
		.await?;

	if !response.status().is_success() {
		bail!(UtilsError::DownloadFile(response.status()));
	}

	let total_size = response
		.content_length()
		.context("Content-Length header not found, might not be apk download")?;

	let pb = ProgressBar::new(total_size);
	pb.set_style(ProgressStyle::default_bar()
			.template("{msg}\n{spinner:.green} [{elapsed_precise}] [{wide_bar:.cyan/blue}] {bytes}/{total_bytes} ({bytes_per_sec}, {eta})")?
			.progress_chars("#>-"));
	pb.set_message("Downloading...");

	let final_url = response.uri().to_string();
	let filename = final_url
		.split('/')
		.next_back()
		.unwrap_or("downloaded_file")
		.split('?')
		.next()
		.unwrap_or("downloaded_file")
		.to_string();

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

// TODO: Switch out regex for html parser

pub async fn extract_data_initial_page(client: &Client, url: &str) -> Result<InitialPageData> {
	debug!("Fetching initial page data from: {}", url);

	let page_response = client.get(url).send().await?;

	if !page_response.status().is_success() {
		bail!(UtilsError::FetchPage(page_response.status()));
	}

	let page_html = page_response.text().await?;

	let csrf_regex = Regex::new(r#"<input[^>]+name="_token"[^>]+value="([^"]+)""#)?;
	let csrf_token = csrf_regex
		.captures(&page_html)
		.and_then(|cap| cap.get(1))
		.context("Failed to extract CSRF token")?
		.as_str()
		.to_string();

	let file_id_regex = Regex::new(r#"<input[^>]+id="file_id"[^>]+value="([^"]+)""#)?;
	let file_id = file_id_regex
		.captures(&page_html)
		.and_then(|cap| cap.get(1))
		.context("Failed to extract File ID")?
		.as_str()
		.to_string();

	let date_html_regex =
		Regex::new(r#"(?s)data-bs-original-title="File upload date".*?<p>\s*(.*?)\s*</p>"#)?;
	let raw_date_text = date_html_regex
		.captures(&page_html)
		.and_then(|cap| cap.get(1))
		.context("Failed to find File Upload Date HTML block")?
		.as_str();

	let file_upload_date =
		parse_upload_date(raw_date_text).context("Failed to parse date string")?;

	let sitekey_regex = Regex::new(r#"class="cf-turnstile"[^>]+data-sitekey="([^"]+)""#)?;
	let sitekey = sitekey_regex
		.captures(&page_html)
		.and_then(|cap| cap.get(1))
		.context("Failed to extract Sitekey")?
		.as_str()
		.to_string();

	let initial_page_data = InitialPageData {
		csrf_token,
		file_id,
		file_upload_date,
		sitekey,
	};

	trace!(
		"Successfully fetched initial page data: {:#?}",
		initial_page_data
	);

	Ok(initial_page_data)
}

fn parse_upload_date(raw_text: &str) -> Result<String> {
	let text = raw_text.trim();

	if NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M").is_ok() {
		return Ok(text.to_string());
	}

	let relative_regex = Regex::new(r"(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago")?;

	if let Some(caps) = relative_regex.captures(text) {
		let amount: i64 = caps[1].parse()?;
		let unit = &caps[2];

		let now = Local::now().naive_local();

		let duration = match unit {
			"second" => Duration::seconds(amount),
			"minute" => Duration::minutes(amount),
			"hour" => Duration::hours(amount),
			"day" => Duration::days(amount),
			"week" => Duration::weeks(amount),
			"month" => Duration::days(amount * 30),
			"year" => Duration::days(amount * 365),
			_ => Duration::zero(),
		};

		let final_date = now - duration;
		return Ok(final_date.format("%Y-%m-%d %H:%M").to_string());
	}

	bail!("Date format not recognized: {}", text)
}

pub async fn get_verification_cookie(client: &Client, page_url: &str) -> Result<()> {
	let InitialPageData {
		csrf_token,
		file_id,
		sitekey,
		..
	} = extract_data_initial_page(client, page_url).await?;

	let captcha_token = solve_turnstile(sitekey, page_url.to_string()).await?;

	debug!("Verifying captcha solution with the website...");

	let verify_payload = VerifyPayload {
		token: captcha_token,
		file_id,
	};

	let verify_response = client
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

		Ok(())
	} else {
		bail!(UtilsError::VerificationRejection);
	}
}
