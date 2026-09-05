import { type Response as WreqResponse } from "wreq-js";
import { Parser } from "htmlparser2";
import { getSharedSession } from "../http.ts";
import { APKW_BASE_URL, RETRY } from "../config.ts";
import { type DownloadType } from "../types.ts";
import { logger as rootLogger } from "../logger.ts";

const logger = rootLogger.child({ module: "scrape:apkw" });

function downloadTypePath(type: DownloadType): string {
	switch (type) {
		case "mod":
			return "tik-tok-mod";
		case "plugin":
			return "tik-tok-plugin";
		default: {
			const _exhaustive: never = type;
			throw new Error(`Unknown download type: ${_exhaustive}`);
		}
	}
}

async function fetchWithRetry(url: string, referer: string, retries = RETRY.maxAttempts): Promise<WreqResponse> {
	const sess = await getSharedSession();
	let lastError: Error | undefined;
	let delayMs: number = RETRY.initialDelayMs;

	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			const res = await sess.fetch(url, {
				headers: { Referer: referer },
			});
			if (res.ok) return res;

			const reason = res.statusText || "unknown";
			logger.warn({ attempt: attempt + 1, status: res.status, reason, url }, "request failed");
			lastError = new Error(`Request to ${url} failed: ${res.status} ${reason}`);
			await res.body?.cancel();
		} catch (e) {
			logger.warn({ attempt: attempt + 1, err: e, url }, "request error");
			lastError = e instanceof Error ? e : new Error(String(e));
		}

		if (attempt + 1 < retries) {
			const jitter = Math.floor(Math.random() * 1001);
			const sleepMs = delayMs + jitter;
			logger.debug({ sleepMs }, "backing off before retry");
			await Bun.sleep(sleepMs);
			delayMs = Math.min(delayMs * 2, RETRY.maxDelayMs);
		}
	}

	throw new Error(`Request to ${url} failed after ${retries} attempts`, { cause: lastError });
}

function findAnchorHref(html: string, predicate: (text: string) => boolean): string | undefined {
	let inAnchor = false;
	let href: string | undefined;
	let text = "";
	let result: string | undefined;

	const parser = new Parser({
		onopentag(name, attrs) {
			if (name === "a") {
				inAnchor = true;
				href = attrs["href"];
				text = "";
			}
		},
		ontext(data) {
			if (inAnchor) text += data;
		},
		onclosetag(name) {
			if (name === "a" && !result && predicate(text) && href) {
				result = href;
			}
			if (name === "a") inAnchor = false;
		},
	});

	parser.write(html);
	parser.end();
	return result;
}

function resolveHttpUrl(href: string, baseUrl: string): string {
	const url = new URL(href, baseUrl);
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error(`Unsupported download URL protocol: ${url.protocol}`);
	}
	return url.href;
}

export function findDownloadGateUrl(html: string, type: DownloadType, baseUrl: string): string | undefined {
	const label = type === "mod" ? /\buniversal\b/i : /\bplugin\b/i;
	const href = findAnchorHref(html, (text) => label.test(text));
	return href ? resolveHttpUrl(href, baseUrl) : undefined;
}

function findLazyAnchorUrl(html: string, baseUrl: string): string | undefined {
	let result: string | undefined;

	const parser = new Parser({
		onopentag(name, attrs) {
			if (result || name !== "a" || !attrs["href"]) return;
			try {
				const url = new URL(resolveHttpUrl(attrs["href"], baseUrl));
				// Cookie notices and ads also use noreferrer. Only accept a download destination.
				if (
					(url.origin === new URL(baseUrl).origin && url.searchParams.has("lazykey")) ||
					(url.hostname === "fylio.com" && url.pathname.startsWith("/d/"))
				) {
					result = url.href;
				}
			} catch {
				// Unrelated anchors can contain invalid URLs or non-HTTP protocols.
			}
		},
	});

	parser.write(html);
	parser.end();
	return result;
}

export function findLazyDownloadUrl(html: string, baseUrl: string): string | undefined {
	const anchorUrl = findLazyAnchorUrl(html, baseUrl);
	if (anchorUrl) return anchorUrl;

	let result: string | undefined;
	let inScript = false;
	let script = "";
	const parser = new Parser({
		onopentag(name) {
			if (name === "script") {
				inScript = true;
				script = "";
			}
		},
		ontext(text) {
			if (inScript) script += text;
		},
		onclosetag(name) {
			if (name !== "script") return;
			inScript = false;
			if (result) return;
			// WP Download Manager embeds the button in a JSON string passed to jQuery.html().
			// Decode only this literal; never evaluate scripts supplied by the source website.
			const buttonPattern = /(?:\$|jQuery)\(\s*(['"])#__procon\1\s*\)\s*\.html\(\s*("(?:[^"\\]|\\.)*")\s*\)/g;
			for (const match of script.matchAll(buttonPattern)) {
				try {
					result = findLazyAnchorUrl(JSON.parse(match[2]!) as string, baseUrl);
					if (result) return;
				} catch {
					// Ignore malformed literals and continue looking for a valid button.
				}
			}
		},
	});
	parser.end(html);
	return result;
}

export async function getDownloadPageUrl(type: DownloadType): Promise<string> {
	const startUrl = `${APKW_BASE_URL}/${downloadTypePath(type)}/`;
	logger.debug({ url: startUrl }, "fetching initial page");

	const initRes = await fetchWithRetry(startUrl, startUrl);
	const initHtml = await initRes.text();

	const gateUrl = findDownloadGateUrl(initHtml, type, initRes.url || startUrl);
	if (!gateUrl) throw new Error("Failed to find download gate URL");

	logger.debug({ url: gateUrl }, "fetching gate page");

	const gateRes = await fetchWithRetry(gateUrl, startUrl);
	const redirectedUrl = gateRes.url;

	if (new URL(redirectedUrl).pathname.includes("file-download")) {
		const gateHtml = await gateRes.text();
		const lazyUrl = findLazyDownloadUrl(gateHtml, redirectedUrl);
		if (!lazyUrl) throw new Error(`Failed to find lazy redirect URL in ${redirectedUrl}`);
		logger.debug({ url: lazyUrl }, "resolved fylio page URL via lazy redirect");
		return lazyUrl;
	}

	logger.debug({ url: redirectedUrl }, "resolved fylio page URL");
	await gateRes.body?.cancel();
	return redirectedUrl;
}
