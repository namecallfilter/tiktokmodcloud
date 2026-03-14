import { Parser } from "htmlparser2";
import { createFromReadableStream } from "@lazarv/rsc/client";
import { getSharedSession } from "../http.ts";
import { type DownloadInfo } from "../types.ts";
import { logger as rootLogger } from "../logger.ts";

const logger = rootLogger.child({ module: "scrape:fylio" });

function findProp<T>(obj: unknown, key: string, visited = new WeakSet<object>()): T | undefined {
	if (obj === null || typeof obj !== "object") return undefined;
	if (visited.has(obj)) return undefined;
	visited.add(obj);

	if (key in obj) return (obj as Record<string, unknown>)[key] as T;

	for (const value of Object.values(obj)) {
		const found = findProp<T>(value, key, visited);
		if (found !== undefined) return found;
	}
	return undefined;
}

const NEXT_F_PUSH_RE = /^self\.__next_f\.push\((.+)\)$/s;

function extractRscPayload(html: string): string {
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
						const [type, data] = JSON.parse(match[1]!) as [number, string?];
						if (type === 1 && data) chunks.push(data);
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
	const payload = extractRscPayload(html);
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(payload));
			controller.close();
		},
	});

	return createFromReadableStream(stream);
}

async function fetchHtml(url: string): Promise<string> {
	const session = await getSharedSession();
	const res = await session.fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
	return res.text();
}

const FYLIO_BASE_URL = "https://fylio.com";

export async function resolveFylioDownload(url: string): Promise<DownloadInfo> {
	const initHtml = await fetchHtml(url);
	const initTree = await deserializeRsc(initHtml);

	const clickId = findProp<string>(initTree, "clickId");
	if (!clickId) {
		throw new Error(`Failed to extract clickId for: ${url}`);
	}

	const getHtml = await fetchHtml(`${FYLIO_BASE_URL}/get/${clickId}`);
	const getTree = await deserializeRsc(getHtml);

	const links = findProp<string[]>(getTree, "links");
	const fileName = findProp<string>(getTree, "fileName");
	const fileSize = findProp<number>(getTree, "fileSize");
	const fileMime = findProp<string>(getTree, "fileMime");

	if (!links?.length) throw new Error("No download links found in the RSC payload");
	if (!fileName || fileSize === undefined || !fileMime) {
		throw new Error("Missing file metadata in the RSC payload");
	}

	return { fileName, fileSize, fileMime, links };
}
