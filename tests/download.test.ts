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

function mockResponse(response: Response) {
	const fetch = mock(async () => response as unknown as WreqResponse);
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
		mockResponse(chunkedResponse(["short"], { "content-length": "100" }));

		await expect(
			downloadFile("https://example.com/file", "https://example.com", "mod.apk", { outputDirectory: directory }),
		).rejects.toThrow("Incomplete download");
		expect(await readFile(join(directory, "mod.apk"), "utf8")).toBe("previous complete download");
		expect(await readdir(directory)).toEqual(["mod.apk"]);
	});

	test("removes the temporary file when the response stream fails", async () => {
		function* interrupted() {
			yield new TextEncoder().encode("partial");
			throw new Error("connection interrupted");
		}
		mockResponse(new Response(ReadableStream.from(interrupted())));

		await expect(
			downloadFile("https://example.com/file", "https://example.com", "mod.apk", { outputDirectory: directory }),
		).rejects.toThrow("connection interrupted");
		expect(await readdir(directory)).toEqual([]);
	});

	test("rejects a response smaller than the source metadata even when Content-Length matches", async () => {
		mockResponse(chunkedResponse(["wrong file"], { "content-length": "10" }));
		await expect(
			downloadFile("https://example.com/file", "https://example.com", "mod.apk", {
				outputDirectory: directory,
				expectedSize: 100,
			}),
		).rejects.toThrow("does not match source metadata");
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
