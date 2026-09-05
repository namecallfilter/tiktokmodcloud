import { getDownloadPageUrl, resolveFylioDownload } from "./scrapers/index.ts";
import { type DownloadType } from "./types.ts";
import { downloadFile } from "./download.ts";
import { formatBytes } from "./format.ts";
import { logger as rootLogger } from "./logger.ts";

const logger = rootLogger.child({ module: "cli" });

interface CheckOutput {
	readonly version: string;
	readonly suffix: string | null;
	readonly fileName: string;
	readonly fileSize: string;
}

interface ParsedVersion {
	readonly version: string;
	readonly suffix: string | null;
}

export function parseVersion(fileName: string): ParsedVersion {
	const parts = fileName.replace(/\.apk$/i, "").split("_");
	const version = parts[0]!;
	const lastPart = parts.length > 1 ? parts.at(-1) : undefined;
	const suffix = lastPart && !["plugin", "universal"].includes(lastPart.toLowerCase()) ? lastPart : null;
	return { version, suffix };
}

export async function handleAction(
	type: DownloadType,
	check: boolean,
	download: boolean,
	jsonOutput: boolean,
): Promise<void> {
	logger.info({ type }, "resolving download page");
	const pageUrl = await getDownloadPageUrl(type);

	logger.info({ type, pageUrl }, "resolving fylio download info");
	const info = await resolveFylioDownload(pageUrl);
	logger.debug({ fileName: info.fileName, fileSize: info.fileSize, links: info.links.length }, "resolved info");

	if (check) {
		const { version, suffix } = parseVersion(info.fileName);

		if (jsonOutput) {
			const output: CheckOutput = {
				version,
				suffix,
				fileName: info.fileName,
				fileSize: formatBytes(info.fileSize),
			};

			console.log(JSON.stringify(output));
		} else {
			logger.info({ version }, "version");
			logger.info({ file: info.fileName }, "file");
		}
	}

	if (download) {
		if (!info.links.length) throw new Error("No download links available");
		logger.info({ fileName: info.fileName }, "starting download");
		const errors: unknown[] = [];
		for (const url of info.links) {
			try {
				await downloadFile(url, pageUrl, info.fileName, { expectedSize: info.fileSize });
				return;
			} catch (error) {
				errors.push(error);
				logger.warn({ err: error, mirror: errors.length }, "download mirror failed");
			}
		}
		throw new AggregateError(errors, `All ${info.links.length} download mirrors failed for ${info.fileName}`);
	}
}
