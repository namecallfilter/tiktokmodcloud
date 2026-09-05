import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { handleAction, parseVersion } from "../src/cli.ts";
import * as downloads from "../src/download.ts";
import * as scrapers from "../src/scrapers/index.ts";

afterEach(() => {
	mock.restore();
});

describe("parseVersion", () => {
	test.each([
		["43.8.4_universal_rev2.apk", "43.8.4", "rev2"],
		["43.8.4.apk", "43.8.4", null],
	])("parses %s without adding the version itself as a suffix", (fileName, version, suffix) => {
		expect(parseVersion(fileName!)).toEqual({ version, suffix });
	});
});

async function runCli(...args: string[]) {
	const child = Bun.spawn([process.execPath, fileURLToPath(new URL("../src/index.ts", import.meta.url)), ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, NO_COLOR: "1", LOG_LEVEL: "info" },
	});
	const [status, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { status, stdout, stderr };
}

describe("CLI invocation", () => {
	test("displays help without connecting to the source", async () => {
		const result = await runCli("--help");
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("tiktokmodcloud");
		expect(result.stderr).toBe("");
	});

	test("exits unsuccessfully when an action is missing", async () => {
		const result = await runCli("mod");
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("--check or --download");
		expect(result.stderr).not.toContain("\u001b[");
	});

	test("rejects unknown flags before connecting to the source", async () => {
		const result = await runCli("mod", "--check", "--jsno");
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("jsno");
	});

	test("rejects unknown commands", async () => {
		const result = await runCli("md", "--check");
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("md");
	});
});

function mockInfo() {
	spyOn(scrapers, "getDownloadPageUrl").mockResolvedValue("https://example.com/page");
	spyOn(scrapers, "resolveFylioDownload").mockResolvedValue({
		fileName: "43.8.4_universal.apk",
		fileSize: 2048,
		fileMime: "application/vnd.android.package-archive",
		links: ["https://example.com/mirror-one", "https://example.com/mirror-two"],
	});
}

describe("handleAction", () => {
	test("tries the next mirror when the first one fails", async () => {
		mockInfo();
		const download = spyOn(downloads, "downloadFile")
			.mockRejectedValueOnce(new Error("HTTP 503"))
			.mockResolvedValueOnce("apks/43.8.4_universal.apk");

		await handleAction("mod", false, true, false);
		expect(download).toHaveBeenCalledTimes(2);
		expect(download).toHaveBeenLastCalledWith(
			"https://example.com/mirror-two",
			"https://example.com/page",
			"43.8.4_universal.apk",
			{ expectedSize: 2048 },
		);
	});

	test("reports failure when every mirror fails", async () => {
		mockInfo();
		spyOn(downloads, "downloadFile").mockRejectedValue(new Error("HTTP 503"));
		await expect(handleAction("mod", false, true, false)).rejects.toThrow("All 2 download mirrors failed");
	});

	test("writes one JSON value to stdout for a version check without downloading", async () => {
		mockInfo();
		const download = spyOn(downloads, "downloadFile");
		const output = spyOn(console, "log").mockImplementation(() => {});

		await handleAction("mod", true, false, true);
		expect(output).toHaveBeenCalledTimes(1);
		expect(JSON.parse(output.mock.calls[0]![0] as string)).toEqual({
			version: "43.8.4",
			suffix: null,
			fileName: "43.8.4_universal.apk",
			fileSize: "2.0 KB",
		});
		expect(download).not.toHaveBeenCalled();
	});
});
