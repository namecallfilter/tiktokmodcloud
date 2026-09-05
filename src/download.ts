import { SingleBar, Presets } from "cli-progress";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { getSharedSession } from "./http.ts";
import { OUTPUT_DIR } from "./config.ts";
import { formatBytes } from "./format.ts";
import { logger as rootLogger } from "./logger.ts";

const logger = rootLogger.child({ module: "download" });

const isTTY = process.stderr.isTTY === true;

class TransferError extends Error {}

interface DownloadOptions {
	outputDirectory?: string;
	expectedSize?: number;
}

export async function downloadFile(
	url: string,
	referer: string,
	fileName: string,
	options: DownloadOptions = {},
): Promise<string> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await downloadAttempt(url, referer, fileName, options);
		} catch (error) {
			if (!(error instanceof TransferError) || attempt >= 3) throw error;
			logger.warn({ err: error, attempt }, "download interrupted; retrying from the beginning");
			await Bun.sleep(attempt * 1_000);
		}
	}
}

async function downloadAttempt(
	url: string,
	referer: string,
	fileName: string,
	{ outputDirectory = OUTPUT_DIR, expectedSize }: DownloadOptions,
): Promise<string> {
	if (
		!fileName.trim() ||
		fileName === "." ||
		fileName === ".." ||
		/[\\/:]/.test(fileName) ||
		[...fileName].some((character) => character.charCodeAt(0) < 32)
	) {
		throw new Error(`Unsafe download filename: ${JSON.stringify(fileName)}`);
	}
	if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize <= 0)) {
		throw new Error("Expected download size must be a positive integer");
	}

	const session = await getSharedSession();
	const res = await session
		.fetch(url, { headers: { Referer: referer, "Accept-Encoding": "identity" } })
		.catch((cause) => {
			throw new TransferError("Download connection failed", { cause });
		});

	if (!res.ok) {
		await res.body?.cancel();
		throw new Error(`Download failed: ${res.status}`);
	}

	const body = res.body;
	if (!body) throw new Error("Response body is empty");

	if (res.headers.get("content-type")?.toLowerCase().includes("text/html")) {
		await body.cancel();
		throw new Error("Download returned an HTML page instead of a file");
	}

	// Encoded content lengths describe the compressed transfer, not the decoded body.
	const encoding = res.headers.get("content-encoding");
	const contentLength = encoding && encoding !== "identity" ? null : res.headers.get("content-length");
	const parsedLength = contentLength === null ? NaN : Number(contentLength);
	const totalBytes = Number.isSafeInteger(parsedLength) && parsedLength >= 0 ? parsedLength : undefined;
	const progressTotal = expectedSize ?? totalBytes;
	const filePath = join(outputDirectory, fileName);
	const temporaryPath = join(outputDirectory, `.${fileName}.${randomUUID()}.part`);

	logger.info({ fileName, totalBytes: totalBytes || "unknown" }, "downloading");

	const bar = new SingleBar(
		{
			stream: process.stderr,
			clearOnComplete: false,
			hideCursor: isTTY,
			noTTYOutput: !isTTY,
			notTTYSchedule: 10_000,
			format: isTTY
				? "  {bar} {percentage}% | {received}/{totalSize} | {speed}/s"
				: "  {received}/{totalSize} ({percentage}%) {speed}/s",
		},
		Presets.shades_classic,
	);

	bar.start(progressTotal || 1, 0, {
		received: formatBytes(0),
		totalSize: progressTotal ? formatBytes(progressTotal) : "???",
		speed: "0 B",
	});

	const startTime = performance.now();
	let downloaded = 0;
	try {
		await mkdir(outputDirectory, { recursive: true });
		await pipeline(
			async function* () {
				const reader = body.getReader();
				try {
					while (true) {
						const { done, value: chunk } = await reader.read().catch((cause) => {
							throw new TransferError("Download stream interrupted", { cause });
						});
						if (done) break;
						downloaded += chunk.length;
						if (totalBytes !== undefined && downloaded > totalBytes) {
							throw new Error(`Download exceeded its expected size of ${totalBytes} bytes`);
						}
						if (expectedSize !== undefined && downloaded > expectedSize) {
							throw new Error(`Download exceeded the source file size of ${expectedSize} bytes`);
						}

						const elapsed = (performance.now() - startTime) / 1000;
						bar.update(progressTotal ? downloaded : 1, {
							received: formatBytes(downloaded),
							totalSize: progressTotal ? formatBytes(progressTotal) : "???",
							speed: formatBytes(elapsed > 0 ? downloaded / elapsed : 0),
						});
						yield chunk;
					}
				} finally {
					reader.releaseLock();
				}
			},
			createWriteStream(temporaryPath, { flags: "wx" }),
		);

		if (downloaded === 0) throw new Error("Downloaded file is empty");
		if (totalBytes !== undefined && downloaded !== totalBytes) {
			throw new Error(`Incomplete download: expected ${totalBytes} bytes, received ${downloaded}`);
		}
		if (expectedSize !== undefined && downloaded !== expectedSize) {
			throw new Error(
				`Download size does not match source metadata: expected ${expectedSize} bytes, received ${downloaded}`,
			);
		}

		await rename(temporaryPath, filePath);
	} finally {
		bar.stop();
		await body.cancel().catch(() => {});
		await rm(temporaryPath, { force: true });
	}

	if (!isTTY) {
		const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
		logger.info({ fileName, size: formatBytes(downloaded), elapsed: `${elapsed}s` }, "download finished");
	}

	logger.info({ filePath, downloaded }, "download complete");

	return filePath;
}
