import { describe, expect, test } from "bun:test";
import { findDownloadGateUrl, findLazyDownloadUrl } from "../src/scrapers/apkw.ts";

const baseUrl = "https://apkw.ru/en/file-download/?pack=example";

describe("APKW download gates", () => {
	test("chooses the requested package and resolves relative URLs", () => {
		const html = '<a href="/plugin">Plugin</a><a href="/mod"><svg><use href="#icon" /></svg><b>UNIVERSAL</b></a>';
		expect(findDownloadGateUrl(html, "mod", baseUrl)).toBe("https://apkw.ru/mod");
		expect(findDownloadGateUrl(html, "plugin", baseUrl)).toBe("https://apkw.ru/plugin");
	});

	test("rejects non-HTTP gate URLs", () => {
		expect(() => findDownloadGateUrl('<a href="javascript:alert(1)">Plugin</a>', "plugin", baseUrl)).toThrow(
			"Unsupported download URL protocol",
		);
	});
});

describe("WP Download Manager lazy redirects", () => {
	test("extracts the button embedded in the upstream jQuery script without executing JavaScript", () => {
		const html = `<script>
			throw new Error("Page scripts must never execute");
			$("#wpdm_lazy_download_5377 .progress-bar").animate({width:"100%"}, 10000, function() {
				$('#__procon').html("<a href='/en/download/tik-tok-plugin/?wpdmdl=5377&lazykey=example' rel='noreferrer' class='btn'>Download</a>");
			});
		</script>`;
		expect(findLazyDownloadUrl(html, baseUrl)).toBe(
			"https://apkw.ru/en/download/tik-tok-plugin/?wpdmdl=5377&lazykey=example",
		);
	});

	test("decodes escaped HTML attributes and entities in the script literal", () => {
		const button = '<a href="/download/?wpdmdl=1&amp;lazykey=valid" rel="noopener noreferrer">Download</a>';
		const html = `<script>jQuery("#__procon").html(${JSON.stringify(button)});</script>`;
		expect(findLazyDownloadUrl(html, baseUrl)).toBe("https://apkw.ru/download/?wpdmdl=1&lazykey=valid");
	});

	test("ignores unrelated noreferrer links and accepts a direct Fylio anchor", () => {
		const html = `<a href="https://cookiedatabase.org/tcf/purposes/" rel="noreferrer">Privacy</a>
			<a href="https://fylio.com/d/example" rel="noopener noreferrer">Download</a>`;
		expect(findLazyDownloadUrl(html, baseUrl)).toBe("https://fylio.com/d/example");
	});

	test("does not accept another host's lazykey or non-download Fylio links", () => {
		const html = `<a href="https://example.com/?lazykey=example" rel="noreferrer">Ad</a>
			<a href="https://fylio.com/privacy" rel="noreferrer">Privacy</a>`;
		expect(findLazyDownloadUrl(html, baseUrl)).toBeUndefined();
	});

	test("ignores unrelated html() calls", () => {
		const button = "<a href='https://fylio.com/d/advertisement'>Ad</a>";
		expect(
			findLazyDownloadUrl(`<script>$('#advertisement').html(${JSON.stringify(button)})</script>`, baseUrl),
		).toBeUndefined();
	});
});
