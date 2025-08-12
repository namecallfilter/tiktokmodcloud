import { LibCurl } from "@ossiana/node-libcurl";
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from "fs";
import path from "path";

export async function request(url: string, referer: string | null = null) {
	if (!url || typeof url !== "string") {
		throw new Error(`Invalid URL provided to request function: ${url}`);
	}
	const curl = new LibCurl();
	curl.open("GET", url);

	if (referer) {
		curl.setRequestHeader("Referer", referer);
	}

	curl.setRequestHeader(
		"User-Agent",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3"
	);
	curl.setRedirect(true);
	curl.setTimeout(30, 1800);

	await curl.send();
	const statusCode = curl.getResponseStatus();

	if (statusCode >= 200 && statusCode < 300) {
		return curl.getResponseString();
	} else {
		throw new Error(`Request failed with HTTP status code: ${statusCode}`);
	}
}

export async function downloadFile(downloadUrl: string, referer: string, outputDir: string = "./apks"): Promise<string> {
	console.log(`Starting download from ${downloadUrl}`);

	let outputPath: string | null = null;
	const curl = new LibCurl();

	try {
		curl.open("GET", downloadUrl);
		curl.setRequestHeader("Referer", referer);
		curl.setRequestHeader(
			"User-Agent",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3"
		);
		curl.setRedirect(true);
		curl.setTimeout(30, 1800);

		console.log("Downloading... please wait.");

		await curl.send();
		const statusCode = curl.getResponseStatus();

		if (statusCode >= 200 && statusCode < 300) {
			let filename: string | null = null;
			const headers = curl.getResponseHeadersMap();
			const contentDisposition = headers.get("content-disposition");

			if (contentDisposition) {
				const match = /filename="?([^"]+)"?/.exec(contentDisposition);
				if (match && match[1]) {
					filename = path.basename(match[1]);
				}
			}

			if (!filename) {
				const finalUrl = curl.getLastEffectiveUrl();
				filename = path.basename(new URL(finalUrl).pathname);
			}

			if (!filename || filename === "/") {
				throw new Error("Could not determine filename from response headers or URL.");
			}

			if (!existsSync(outputDir)) {
				mkdirSync(outputDir, { recursive: true });
			}
			outputPath = path.join(outputDir, filename);

			console.log(`\nDownload finished successfully. Saving to: ${outputPath}`);

			const responseBody = curl.getResponseBody();
			const fileStream = createWriteStream(outputPath);

			await new Promise((resolve, reject) => {
				fileStream.write(responseBody, (err) => {
					if (err) {
						reject(err);
					} else {
						fileStream.end(resolve);
					}
				});
			});

			console.log(`File saved successfully.`);
			return outputPath;
		} else {
			throw new Error(`Download failed with HTTP status code: ${statusCode}`);
		}
	} catch (error: any) {
		console.error("\nAn error occurred during download:", error.message);

		if (outputPath && existsSync(outputPath)) {
			try {
				unlinkSync(outputPath);
			} catch (e) {}
		}

		throw error;
	}
}
