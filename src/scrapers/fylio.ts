import { Parser } from "htmlparser2";
import { createFromReadableStream } from "@lazarv/rsc/client";
import { getSharedSession } from "../http.ts";
import { type DownloadInfo } from "../types.ts";
import { logger as rootLogger } from "../logger.ts";

const logger = rootLogger.child({ module: "scrape:fylio" });

function findProp(obj: unknown, key: string, visited = new WeakSet<object>()): unknown {
	if (obj === null || typeof obj !== "object") return undefined;
	if (visited.has(obj)) return undefined;
	visited.add(obj);

	if (Object.hasOwn(obj, key)) return (obj as Record<string, unknown>)[key];

	for (const value of Object.values(obj)) {
		const found = findProp(value, key, visited);
		if (found !== undefined) return found;
	}
	return undefined;
}

const NEXT_F_PUSH_RE = /^\s*self\.__next_f\.push\(\s*(\[.*\])\s*\)\s*;?\s*$/s;

export function extractRscPayload(html: string): string {
	const chunks: string[] = [];
	let isScript = false;
	let scriptContent = "";

	const parser = new Parser({
		onopentagname(name) {
			isScript = name === "script";
			scriptContent = "";
		},
		ontext(text) {
			if (isScript) scriptContent += text;
		},
		onclosetag(name) {
			if (name === "script" && scriptContent) {
				const match = NEXT_F_PUSH_RE.exec(scriptContent);
				if (match) {
					try {
						const [type, data] = JSON.parse(match[1]!) as unknown[];
						if (type === 1 && typeof data === "string" && data) chunks.push(data);
					} catch (e) {
						logger.debug(
							{ err: e, snippet: scriptContent.slice(0, 100) },
							"skipping malformed RSC script tag",
						);
					}
				}
			}
			isScript = false;
		},
	});

	parser.write(html);
	parser.end();

	if (!chunks.length) throw new Error("No RSC payload found in page");
	return chunks.join("");
}

async function deserializeRsc(html: string): Promise<unknown> {
	return createFromReadableStream(new Response(extractRscPayload(html)).body!);
}

async function fetchHtml(url: string): Promise<string> {
	const session = await getSharedSession();
	const res = await session.fetch(url);
	if (!res.ok) {
		await res.body?.cancel();
		throw new Error(`HTTP ${res.status} fetching ${url}`);
	}
	return res.text();
}

const FYLIO_BASE_URL = "https://fylio.com";

export function parseFylioDownloadInfo(tree: unknown): DownloadInfo {
	const links = findProp(tree, "links");
	const fileName = findProp(tree, "fileName");
	const fileSize = findProp(tree, "fileSize");
	const fileMime = findProp(tree, "fileMime");

	if (!Array.isArray(links) || !links.length) throw new Error("No download links found in the RSC payload");
	if (
		!links.every((link): link is string => {
			if (typeof link !== "string") return false;
			try {
				const url = new URL(link);
				return url.protocol === "https:" || url.protocol === "http:";
			} catch {
				return false;
			}
		})
	) {
		throw new Error("Invalid download links in the RSC payload");
	}
	if (
		typeof fileName !== "string" ||
		!fileName.trim() ||
		typeof fileSize !== "number" ||
		!Number.isSafeInteger(fileSize) ||
		fileSize < 0 ||
		typeof fileMime !== "string" ||
		!fileMime.trim()
	) {
		throw new Error("Missing or invalid file metadata in the RSC payload");
	}

	return { fileName, fileSize, fileMime, links };
}

export async function resolveFylioDownload(url: string): Promise<DownloadInfo> {
	const initHtml = await fetchHtml(url);
	const initTree = await deserializeRsc(initHtml);

	const clickId = findProp(initTree, "clickId");
	if (typeof clickId !== "string" || !clickId) {
		throw new Error(`Failed to extract clickId for: ${url}`);
	}

	const getHtml = await fetchHtml(`${FYLIO_BASE_URL}/get/${encodeURIComponent(clickId)}`);
	const getTree = await deserializeRsc(getHtml);
	return parseFylioDownloadInfo(getTree);
}
