use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result, bail};
use futures_util::StreamExt;
use indicatif::{ProgressBar, ProgressStyle};
use scraper::{Html, Selector};
use serde::Deserialize;
use tokio::{
	fs::File,
	io::{AsyncWriteExt, BufWriter},
};
use tracing::{debug, info};
use wreq::Client;

#[derive(Debug)]
pub struct PageData {
	pub file_name: String,
	pub file_size_label: String,
	pub click_id: String,
}

pub async fn fetch_page_data(client: &Client, url: &str) -> Result<PageData> {
	debug!(url, "Fetching Fylio page data");

	let response = client.get(url).header("Referer", url).send().await?;
	if !response.status().is_success() {
		bail!("Failed to fetch Fylio page: {}", response.status());
	}

	let html = response.text().await?;
	let document = Html::parse_document(&html);

	let file_name = document
		.select(&Selector::parse(r#"meta[property="og:title"]"#).expect("valid CSS selector"))
		.next()
		.and_then(|el| el.value().attr("content"))
		.and_then(strip_fylio_title_suffix)
		.or(extract_rsc_prop(&html, "fileName").as_deref())
		.map(strip_download_prefix)
		.filter(|s| !s.is_empty())
		.context("Failed to extract file name from Fylio page")?
		.to_string();

	let file_size_label = document
		.select(&Selector::parse(r#"meta[name="description"]"#).expect("valid CSS selector"))
		.next()
		.and_then(|el| el.value().attr("content"))
		.and_then(extract_parenthesized)
		.context("Failed to extract file size from Fylio page")?
		.to_string();

	let click_id = extract_rsc_prop(&html, "clickId")
		.or_else(|| extract_click_id_from_url(&html))
		.context("Failed to extract click ID from Fylio page")?;

	Ok(PageData {
		file_name,
		file_size_label,
		click_id,
	})
}

pub async fn resolve_download_links(
	client: &Client, page_url: &str, click_id: &str,
) -> Result<Vec<String>> {
	let url = format!("https://fylio.com/get/{click_id}");
	let response = client.get(&url).header("Referer", page_url).send().await?;
	if !response.status().is_success() {
		bail!("Failed to fetch Fylio /get page: {}", response.status());
	}

	let html = response.text().await?;
	extract_cdn_links(&html)
}

pub async fn download_file(
	client: &Client, url: &str, referer: &str, filename: &str,
) -> Result<PathBuf> {
	debug!(url, referer, "Starting download");

	let response = client.get(url).header("Referer", referer).send().await?;
	if !response.status().is_success() {
		bail!("Download failed: {}", response.status());
	}

	let pb = match response.content_length() {
		Some(size) => {
			let pb = ProgressBar::new(size);
			pb.set_style(
				ProgressStyle::default_bar()
					.template("{msg}\n{spinner:.green} [{elapsed_precise}] [{wide_bar:.cyan/blue}] {bytes}/{total_bytes} ({bytes_per_sec}, {eta})")?
					.progress_chars("#>-"),
			);
			pb
		}
		None => {
			let pb = ProgressBar::new_spinner();
			pb.set_style(ProgressStyle::default_spinner().template(
				"{msg}\n{spinner:.green} [{elapsed_precise}] {bytes} ({bytes_per_sec})",
			)?);
			pb
		}
	};
	pb.set_message(format!("Downloading {filename}..."));

	let path = Path::new("./apks").join(filename);
	tokio::fs::create_dir_all("./apks").await?;

	let file = File::create(&path).await?;
	let mut writer = BufWriter::new(file);
	let mut downloaded = 0u64;
	let mut stream = response.bytes_stream();

	while let Some(chunk) = stream.next().await {
		let chunk = chunk?;
		writer.write_all(&chunk).await?;
		downloaded += chunk.len() as u64;
		pb.set_position(downloaded);
	}

	writer.flush().await?;
	pb.finish_with_message(format!("Downloaded: {}", path.display()));
	info!(path = %path.display(), "Download complete");

	Ok(path)
}

fn strip_fylio_title_suffix(title: &str) -> Option<&str> {
	title
		.split_once(" - Fylio")
		.or_else(|| title.split_once(" \u{2014} Fylio"))
		.map(|(prefix, _)| prefix)
}

fn strip_download_prefix(s: &str) -> &str {
	s.trim().strip_prefix("Download ").unwrap_or(s.trim())
}

fn extract_parenthesized(s: &str) -> Option<&str> {
	let start = s.find('(')? + 1;
	let end = start + s[start..].find(')')?;
	Some(s[start..end].trim())
}

fn extract_rsc_prop(html: &str, key: &str) -> Option<String> {
	for (needle, terminator) in [
		(format!("{key}\\\":\\\""), "\\\""),
		(format!("{key}\":\""), "\""),
	] {
		if let Some(start) = html.find(&needle) {
			let rest = &html[start + needle.len()..];
			if let Some(end) = rest.find(terminator) {
				return Some(rest[..end].replace("\\u0026", "&"));
			}
		}
	}
	None
}

fn extract_click_id_from_url(html: &str) -> Option<String> {
	let start = html.find("click_id=")? + "click_id=".len();
	let candidate = html.get(start..start + 36)?;
	candidate
		.chars()
		.all(|c| c.is_ascii_hexdigit() || c == '-')
		.then(|| candidate.to_string())
}

#[derive(Deserialize)]
struct DownloadComponentProps {
	links: Vec<String>,
}

fn extract_cdn_links(html: &str) -> Result<Vec<String>> {
	let document = Html::parse_document(html);

	for element in document.select(&Selector::parse("script").expect("valid CSS selector")) {
		let text = element.text().collect::<String>();
		if !text.contains("__next_f.push") || !text.contains("\\\"links\\\"") {
			continue;
		}

		let mut pos = 0;
		while let Some(offset) = text[pos..].find("self.__next_f.push(") {
			let start = pos + offset;
			let call = &text[start..];

			let Some(str_start) = call.find("[1,\"") else {
				pos = start + 1;
				continue;
			};

			let payload = &call[str_start + 4..];
			let Some(end) = payload.find("\"])") else {
				pos = start + 1;
				continue;
			};

			let raw = &payload[..end];
			if !raw.contains("\\\"links\\\"") {
				pos = start + offset + 1;
				continue;
			}

			let unescaped = unescape_js_string(raw);
			if let Some(links) = find_links_in_rsc_payload(&unescaped)
				&& !links.is_empty()
			{
				return Ok(links);
			}

			pos = start + offset + 1;
		}
	}

	bail!("No download links found on the Fylio /get page")
}

fn unescape_js_string(s: &str) -> String {
	let mut out = String::with_capacity(s.len());
	let mut chars = s.chars();

	while let Some(c) = chars.next() {
		if c != '\\' {
			out.push(c);
			continue;
		}
		match chars.next() {
			Some('"') => out.push('"'),
			Some('\\') => out.push('\\'),
			Some('/') => out.push('/'),
			Some('n') => out.push('\n'),
			Some('r') => out.push('\r'),
			Some('t') => out.push('\t'),
			Some('u') => {
				let hex: String = chars.by_ref().take(4).collect();
				if let Ok(cp) = u32::from_str_radix(&hex, 16)
					&& let Some(ch) = char::from_u32(cp)
				{
					out.push(ch);
				}
			}
			Some(other) => {
				out.push('\\');
				out.push(other);
			}
			None => out.push('\\'),
		}
	}

	out
}

fn find_links_in_rsc_payload(payload: &str) -> Option<Vec<String>> {
	let pos = payload.find("\"links\":[")?;
	let obj_start = payload[..pos].rfind('{')?;
	let obj_slice = &payload[obj_start..];
	let obj_end = find_matching_brace(obj_slice)?;
	let props: DownloadComponentProps = serde_json::from_str(&obj_slice[..=obj_end]).ok()?;
	Some(props.links)
}

fn find_matching_brace(s: &str) -> Option<usize> {
	let mut depth = 0i32;
	let mut in_string = false;
	let mut escaped = false;

	for (i, c) in s.char_indices() {
		if in_string {
			if c == '\\' && !escaped {
				escaped = true;
				continue;
			}
			if c == '"' && !escaped {
				in_string = false;
			}
			escaped = false;
			continue;
		}
		match c {
			'"' => in_string = true,
			'{' | '[' => depth += 1,
			'}' | ']' => {
				depth -= 1;
				if depth == 0 {
					return Some(i);
				}
			}
			_ => {}
		}
	}

	None
}
