import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadableStream } from "node:stream/web";
import type { Response as WreqResponse, Session } from "wreq-js";
import { downloadFile } from "../src/download.ts";
import * as http from "../src/http.ts";

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "tiktokmodcloud-download-test-"));
});

afterEach(async () => {
	mock.restore();
	await rm(directory, { recursive: true, force: true });
});

function mockResponse(response: Response | (() => Response)) {
	const fetch = mock(async () => (typeof response === "function" ? response() : response) as unknown as WreqResponse);
	spyOn(http, "getSharedSession").mockResolvedValue({ fetch } as unknown as Session);
	return fetch;
}

function chunkedResponse(chunks: string[], headers: Record<string, string> = {}): Response {
	return new Response(ReadableStream.from(chunks.map((chunk) => new TextEncoder().encode(chunk))), { headers });
}

describe("downloadFile", () => {
	test("streams a complete response and publishes only the completed file", async () => {
		const fetch = mockResponse(chunkedResponse(["first", "second"], { "content-length": "11" }));
		const path = await downloadFile("https://example.com/file", "https://example.com/page", "mod.apk", {
			outputDirectory: directory,
		});

		expect(await readFile(path, "utf8")).toBe("firstsecond");
		expect(await readdir(directory)).toEqual(["mod.apk"]);
		expect(fetch).toHaveBeenCalledWith("https://example.com/file", {
			headers: { Referer: "https://example.com/page", "Accept-Encoding": "identity" },
		});
	});

	test("cleans up truncated responses and preserves an existing download", async () => {
		await writeFile(join(directory, "mod.apk"), "previous complete download");
		const fetch = mockResponse(chunkedResponse(["short"], { "content-length": "100" }));

		await expect(
			downloadFile("https://example.com/file", "https://example.com", "mod.apk", { outputDirectory: directory }),
		).rejects.toThrow("Incomplete download");
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(await readFile(join(directory, "mod.apk"), "utf8")).toBe("previous complete download");
		expect(await readdir(directory)).toEqual(["mod.apk"]);
	});

	test("stops after three interrupted transfers and removes the temporary files", async () => {
		function* interrupted() {
			yield new TextEncoder().encode("partial");
			throw new Error("connection interrupted");
		}
		const fetch = mockResponse(() => new Response(ReadableStream.from(interrupted())));
		const sleep = spyOn(Bun, "sleep").mockResolvedValue(undefined);

		await expect(
			downloadFile("https://example.com/file", "https://example.com", "mod.apk", { outputDirectory: directory }),
		).rejects.toThrow("Download stream interrupted");
		expect(fetch).toHaveBeenCalledTimes(3);
		expect(sleep.mock.calls).toEqual([[1_000], [2_000]]);
		expect(await readdir(directory)).toEqual([]);
	});

	test("restarts an interrupted transfer and publishes only the complete retry", async () => {
		function* interrupted() {
			yield new TextEncoder().encode("partial");
			throw new Error("stream error received: unexpected internal error encountered");
		}
		await writeFile(join(directory, "mod.apk"), "previous");
		const fetch = mockResponse(chunkedResponse(["complete"], { "content-length": "8" }));
		fetch.mockResolvedValueOnce(new Response(ReadableStream.from(interrupted())) as unknown as WreqResponse);
		const sleep = spyOn(Bun, "sleep").mockImplementation(async () => {
			expect(await readdir(directory)).toEqual(["mod.apk"]);
			expect(await readFile(join(directory, "mod.apk"), "utf8")).toBe("previous");
		});

		const path = await downloadFile("https://example.com/file", "https://example.com", "mod.apk", {
			outputDirectory: directory,
			expectedSize: 8,
		});
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledTimes(1);
		expect(await readFile(path, "utf8")).toBe("complete");
		expect(await readdir(directory)).toEqual(["mod.apk"]);
	});

	test.each([403, 416])("does not retry permanent HTTP %i failures", async (status) => {
		const fetch = mockResponse(new Response("Unavailable", { status }));
		const sleep = spyOn(Bun, "sleep").mockResolvedValue(undefined);
		await expect(
			downloadFile("https://example.com/file", "https://example.com", "mod.apk", { outputDirectory: directory }),
		).rejects.toThrow(`Download failed: ${status}`);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
		expect(await readdir(directory)).toEqual([]);
	});

	test("rejects a response smaller than the source metadata even when Content-Length matches", async () => {
		const fetch = mockResponse(chunkedResponse(["wrong file"], { "content-length": "10" }));
		await expect(
			downloadFile("https://example.com/file", "https://example.com", "mod.apk", {
				outputDirectory: directory,
				expectedSize: 100,
			}),
		).rejects.toThrow("does not match source metadata");
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(await readdir(directory)).toEqual([]);
	});

	test("rejects HTML challenge pages even when the HTTP status is successful", async () => {
		mockResponse(new Response("<html>Verify you are human</html>", { headers: { "content-type": "text/html" } }));

		await expect(
			downloadFile("https://example.com/file", "https://example.com", "mod.apk", { outputDirectory: directory }),
		).rejects.toThrow("HTML page");
		expect(await readdir(directory)).toEqual([]);
	});

	test("rejects empty downloads", async () => {
		mockResponse(chunkedResponse([]));
		await expect(
			downloadFile("https://example.com/file", "https://example.com", "mod.apk", { outputDirectory: directory }),
		).rejects.toThrow("empty");
		expect(await readdir(directory)).toEqual([]);
	});

	test("does not compare decompressed bytes to a compressed content length", async () => {
		mockResponse(chunkedResponse(["decoded content"], { "content-length": "5", "content-encoding": "gzip" }));
		const path = await downloadFile("https://example.com/file", "https://example.com", "mod.apk", {
			outputDirectory: directory,
		});
		expect(await readFile(path, "utf8")).toBe("decoded content");
	});

	test.each(["../escape.apk", "..\\escape.apk", "C:escape.apk", "..", "", "bad\0.apk"])(
		"rejects an unsafe remote filename %j before making a request",
		async (fileName) => {
			const getSession = spyOn(http, "getSharedSession");
			await expect(
				downloadFile("https://example.com/file", "https://example.com", fileName, {
					outputDirectory: directory,
				}),
			).rejects.toThrow("Unsafe download filename");
			expect(getSession).not.toHaveBeenCalled();
			expect(await readdir(directory)).toEqual([]);
		},
	);
});
