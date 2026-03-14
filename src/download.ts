import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getSharedSession } from "./http.ts";
import { OUTPUT_DIR } from "./config.ts";
import { formatBytes } from "./format.ts";
import { logger as rootLogger } from "./logger.ts";

const logger = rootLogger.child({ module: "download" });

export async function downloadFile(url: string, referer: string, fileName: string): Promise<string> {
	const session = await getSharedSession();
	const res = await session.fetch(url, { headers: { Referer: referer } });

	if (!res.ok) throw new Error(`Download failed: ${res.status}`);

	const body = res.body;
	if (!body) throw new Error("Response body is empty");

	const totalBytes = Number(res.headers.get("content-length")) || undefined;

	await mkdir(OUTPUT_DIR, { recursive: true });
	const filePath = join(OUTPUT_DIR, fileName);

	logger.info({ fileName, totalBytes: totalBytes ?? "unknown" }, "downloading");

	const startTime = performance.now();
	let downloaded = 0;
	const chunks: Uint8Array[] = [];

	for await (const chunk of body) {
		chunks.push(chunk);
		downloaded += chunk.length;

		const elapsed = (performance.now() - startTime) / 1000;
		const speed = elapsed > 0 ? downloaded / elapsed : 0;

		if (totalBytes) {
			const pct = ((downloaded / totalBytes) * 100).toFixed(1);
			process.stderr.write(
				`\r  ${formatBytes(downloaded)}/${formatBytes(totalBytes)} (${pct}%) ${formatBytes(speed)}/s`,
			);
		} else {
			process.stderr.write(`\r  ${formatBytes(downloaded)} ${formatBytes(speed)}/s`);
		}
	}

	process.stderr.write("\n");

	await Bun.write(filePath, new Blob(chunks));
	logger.info({ filePath, downloaded }, "download complete");

	return filePath;
}
