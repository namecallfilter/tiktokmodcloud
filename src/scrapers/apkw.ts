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
		onopentagname(name) {
			if (name === "a") {
				inAnchor = true;
				href = undefined;
				text = "";
			}
		},
		onattribute(name, value) {
			if (inAnchor && name === "href") href = value;
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

function findNoreferrerHref(html: string): string | undefined {
	let result: string | undefined;

	const parser = new Parser({
		onopentag(name, attrs) {
			if (!result && name === "a" && attrs["rel"] === "noreferrer" && attrs["href"]) {
				result = attrs["href"];
			}
		},
	});

	parser.write(html);
	parser.end();
	return result;
}

export async function getDownloadPageUrl(type: DownloadType): Promise<string> {
	const startUrl = `${APKW_BASE_URL}/${downloadTypePath(type)}/`;
	logger.debug({ url: startUrl }, "fetching initial page");

	const initRes = await fetchWithRetry(startUrl, startUrl);
	const initHtml = await initRes.text();

	const gateUrl = findAnchorHref(initHtml, (t) => t.includes("UNIVERSAL") || t.includes("Plugin"));
	if (!gateUrl) throw new Error("Failed to find download gate URL");

	logger.debug({ url: gateUrl }, "fetching gate page");

	const gateRes = await fetchWithRetry(gateUrl, startUrl);
	const redirectedUrl = gateRes.url;

	if (redirectedUrl.includes("file-download")) {
		const gateHtml = await gateRes.text();
		const lazyUrl = findNoreferrerHref(gateHtml);
		if (!lazyUrl) throw new Error("Failed to find lazy redirect URL");
		logger.debug({ url: lazyUrl }, "resolved fylio page URL via lazy redirect");
		return lazyUrl;
	}

	logger.debug({ url: redirectedUrl }, "resolved fylio page URL");
	return redirectedUrl;
}
