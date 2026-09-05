import { describe, expect, test } from "bun:test";
import { extractRscPayload, parseFylioDownloadInfo } from "../src/scrapers/fylio.ts";

const metadata = {
	fileName: "2.45_plugin.apk",
	fileSize: 8261648,
	fileMime: "application/vnd.android.package-archive",
	links: ["https://cdn.fylio.com/u/34/example"],
};

describe("Next.js RSC payload extraction", () => {
	test("concatenates data chunks in order, including whitespace and semicolons", () => {
		const html = `<script>self.__next_f.push([0])</script>
			<script>  self.__next_f.push([1,"first\\n"]) ; </script>
			<script>self.__next_f.push([1,"second\\n"])</script>`;
		expect(extractRscPayload(html)).toBe("first\nsecond\n");
	});

	test("ignores malformed scripts and non-string chunks", () => {
		const html = `<script>self.__next_f.push([1,{}])</script>
			<script>self.__next_f.push([1,invalid])</script>
			<script>self.__next_f.push([1,"valid"])</script>`;
		expect(extractRscPayload(html)).toBe("valid");
	});

	test("reports when no data chunks exist", () => {
		expect(() => extractRscPayload("<script>self.__next_f.push([0])</script>")).toThrow("No RSC payload");
	});
});

describe("Fylio download metadata", () => {
	test("extracts metadata from a nested tree with cycles", () => {
		const tree: { self?: unknown; children: unknown[] } = { children: [{ props: metadata }] };
		tree.self = tree;
		expect(parseFylioDownloadInfo(tree)).toEqual(metadata);
	});

	test("rejects a file size supplied as a string", () => {
		expect(() => parseFylioDownloadInfo({ ...metadata, fileSize: "8261648" })).toThrow("invalid file metadata");
	});

	test.each([{ links: "https://cdn.fylio.com/file" }, { links: ["file:///etc/passwd"] }, { links: ["/relative"] }])(
		"rejects malformed download links: %p",
		({ links }) => {
			expect(() => parseFylioDownloadInfo({ ...metadata, links })).toThrow();
		},
	);
});
