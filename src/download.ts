import { SingleBar, Presets } from "cli-progress";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getSharedSession } from "./http.ts";
import { OUTPUT_DIR } from "./config.ts";
import { formatBytes } from "./format.ts";
import { logger as rootLogger } from "./logger.ts";

const logger = rootLogger.child({ module: "download" });

const isTTY = process.stderr.isTTY === true;

export async function downloadFile(url: string, referer: string, fileName: string): Promise<string> {
	const session = await getSharedSession();
	const res = await session.fetch(url, { headers: { Referer: referer } });

	if (!res.ok) throw new Error(`Download failed: ${res.status}`);

	const body = res.body;
	if (!body) throw new Error("Response body is empty");

	const totalBytes = Number(res.headers.get("content-length")) || 0;

	await mkdir(OUTPUT_DIR, { recursive: true });
	const filePath = join(OUTPUT_DIR, fileName);

	logger.info({ fileName, totalBytes: totalBytes || "unknown" }, "downloading");

	const bar = new SingleBar(
		{
			stream: process.stderr,
			clearOnComplete: false,
			hideCursor: isTTY,
			noTTYOutput: !isTTY,
			notTTYSchedule: 10_000,
			format: isTTY
				? "  {bar} {percentage}% | {received}/{total} | {speed}/s"
				: "  {received}/{total} ({percentage}%) {speed}/s",
			formatValue: (value, _options, type) => {
				switch (type) {
					case "percentage":
						return String(value);
					default:
						return String(value);
				}
			},
		},
		Presets.shades_classic,
	);

	bar.start(totalBytes || 1, 0, {
		received: formatBytes(0),
		total: totalBytes ? formatBytes(totalBytes) : "???",
		speed: "0 B",
	});

	const startTime = performance.now();
	let downloaded = 0;
	const chunks: Uint8Array[] = [];

	for await (const chunk of body) {
		chunks.push(chunk);
		downloaded += chunk.length;

		const elapsed = (performance.now() - startTime) / 1000;
		const speed = elapsed > 0 ? downloaded / elapsed : 0;

		bar.update(totalBytes ? downloaded : 1, {
			received: formatBytes(downloaded),
			total: totalBytes ? formatBytes(totalBytes) : "???",
			speed: formatBytes(speed),
		});
	}

	bar.stop();

	if (!isTTY) {
		const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
		logger.info({ fileName, size: formatBytes(downloaded), elapsed: `${elapsed}s` }, "download finished");
	}

	await Bun.write(filePath, new Blob(chunks));
	logger.info({ filePath, downloaded }, "download complete");

	return filePath;
}
