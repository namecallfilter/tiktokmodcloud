import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { ReadableStream } from "node:stream/web";

export async function downloadFile(
	downloadUrl: string,
	referer: string,
	outputDir: string = "./apks",
): Promise<string> {
	console.log(`Starting download from ${downloadUrl}`);
	const response = await fetch(downloadUrl, {
		referrer: referer,
	});

	if (!response.ok) {
		throw new Error(`Failed to download file: ${response.statusText}`);
	}

	const totalSize = Number(response.headers.get("content-length") || 0);
	if (totalSize === 0) {
		console.log("Warning: Content-Length header not found. Cannot display progress.");
	}

	const finalUrl = response.url;
	const filename = new URL(finalUrl).pathname.split("/").pop() || "downloaded_file";
	const filePath = path.join(outputDir, filename);

	fs.mkdirSync(outputDir, { recursive: true });

	const fileStream = fs.createWriteStream(filePath);

	if (!response.body) {
		throw new Error("Response body is null");
	}

	const sourceStream = Readable.fromWeb(response.body as ReadableStream<any>);

	let downloadedSize = 0;
	let lastLoggedPercentage = -1;

	sourceStream.on("data", (chunk) => {
		downloadedSize += chunk.length;
		if (totalSize > 0) {
			const percentage = Math.floor((downloadedSize / totalSize) * 100);
			if (percentage >= lastLoggedPercentage + 1) {
				process.stdout.write(`\rDownloading... ${percentage}%`);
				lastLoggedPercentage = percentage;
			}
		}
	});

	sourceStream.pipe(fileStream);

	return new Promise((resolve, reject) => {
		fileStream.on("finish", () => {
			process.stdout.write(`\rFile downloaded successfully: ${filePath}\n`);
			resolve(filePath);
		});
		fileStream.on("error", (error) => {
			console.error(`\nError downloading file: ${error.message}`);
			reject(error);
		});
	});
}
