use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result, bail};
use futures_util::StreamExt;
use indicatif::{ProgressBar, ProgressStyle};
use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::{
	fs::File,
	io::{AsyncWriteExt, BufWriter},
};
use tracing::{debug, info, trace};
use wreq::{Client, redirect};
use wreq_util::Emulation;

use crate::{capsolver::solve_turnstile, error::UtilsError};

#[derive(Debug, Clone)]
pub struct InitialPageData {
	pub cookie: String,
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
	download_url: &str, referer: &str, output_dir: Option<&str>,
) -> Result<PathBuf> {
	let output_dir = output_dir.unwrap_or("./apks");
	let cookie = get_verification_cookie(referer).await?;

	debug!("Starting download from {}", download_url);

	let client = Client::builder()
		.emulation(Emulation::Chrome142)
		.redirect(redirect::Policy::limited(10))
		.build()?;

	let response = client
		.get(download_url)
		.header("Cookie", &cookie)
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

pub async fn extract_data_initial_page(url: &str) -> Result<InitialPageData> {
	debug!("Fetching initial page data from: {}", url);

	let client = Client::builder().emulation(Emulation::Chrome142).build()?;

	let page_response = client.get(url).send().await?;

	if !page_response.status().is_success() {
		bail!(UtilsError::FetchPage(page_response.status()));
	}

	let initial_cookies: Vec<String> = page_response
		.headers()
		.get_all("set-cookie")
		.iter()
		.filter_map(|v| v.to_str().ok().map(|s| s.to_string()))
		.collect();

	let cookie = initial_cookies
		.iter()
		.map(|c| c.split(';').next().unwrap_or(""))
		.collect::<Vec<_>>()
		.join("; ");

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

	let file_upload_date_regex = Regex::new(r#"(?:^|\D)(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?:$|\D)"#)?;
	let file_upload_date = file_upload_date_regex
		.captures(&page_html)
		.and_then(|cap| cap.get(1))
		.context("Failed to extract File ID")?
		.as_str()
		.to_string();

	let sitekey_regex = Regex::new(r#"class="cf-turnstile"[^>]+data-sitekey="([^"]+)""#)?;
	let sitekey = sitekey_regex
		.captures(&page_html)
		.and_then(|cap| cap.get(1))
		.context("Failed to extract Sitekey")?
		.as_str()
		.to_string();

	let initial_page_data = InitialPageData {
		cookie,
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

pub async fn get_verification_cookie(page_url: &str) -> Result<String> {
	let InitialPageData {
		cookie,
		csrf_token,
		file_id,
		sitekey,
		..
	} = extract_data_initial_page(page_url).await?;

	let captcha_token = solve_turnstile(sitekey, page_url.to_string()).await?;

	debug!("Verifying captcha solution with the website...");

	let client = Client::builder().emulation(Emulation::Chrome142).build()?;

	let verify_payload = VerifyPayload {
		token: captcha_token,
		file_id,
	};

	let verify_response = client
		.post("https://modsfire.com/verify-cf-captcha")
		.header("Content-Type", "application/json")
		.header("X-CSRF-TOKEN", &csrf_token)
		.header("Cookie", &cookie)
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

	let final_cookies: Vec<String> = verify_response
		.headers()
		.get_all("set-cookie")
		.iter()
		.filter_map(|v| {
			v.to_str()
				.ok()
				.map(|s| s.split(';').next().unwrap_or("").to_string())
		})
		.collect();

	let response_data: VerifyResponse = verify_response.json().await?;

	if response_data.success {
		if final_cookies.is_empty() {
			bail!(UtilsError::VerificationNoSetCookie);
		}

		info!("Successfully obtained verification cookie!");

		Ok(final_cookies.join("; "))
	} else {
		bail!(UtilsError::VerificationRejection);
	}
}
