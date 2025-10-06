import dotenv from "dotenv";

dotenv.config({ quiet: true });

const locationRegex = /document\.location\.href\s*=\s*['"](.*?)['"]/;
const gateRegex = /href='([^']*)'[^>]*?>\s*MIRROR(?:\s+\d+)?\s*<\/a>/;
const lazyRedirectRegex = /href='([^']*)'[^>]rel='noreferrer'/;

export enum DownloadType {
	Mod = "tik-tok-mod",
	Plugin = "tik-tok-plugin",
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delay = 2000) {
	for (let i = 0; i < retries; i++) {
		try {
			const response = await fetch(url, options);
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			return response;
		} catch (error) {
			console.error(`Attempt ${i + 1} failed: ${(error as Error).message}. Retrying in ${delay / 1000}s...`);

			if (i < retries - 1) {
				await new Promise((res) => setTimeout(res, delay));
			} else {
				throw error;
			}
		}
	}

	throw new Error("Fetch failed after all retries.");
}

export async function getDownloadLinks(path: DownloadType) {
	const startUrl = `https://apkw.ru/en/download/${path}/`;
	const fetchOptions = {
		referrer: startUrl,
		headers: {
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
		},
	};

	console.log(`Fetching initial page: ${startUrl}`);

	const gatePageText = await fetchWithRetry(startUrl, fetchOptions).then((res) => res.text());
	const gateMatch = gatePageText.match(gateRegex);
	if (!gateMatch || !gateMatch[1]) {
		throw new Error("Failed to find the mirror gate URL.");
	}

	const gateUrl = gateMatch[1];
	console.log(`Fetching gate page: ${gateUrl}`);

	let mirrorUrl: string;
	const gateResponse = await fetchWithRetry(gateUrl, fetchOptions);

	if (gateResponse.url.includes("file-download")) {
		const lazyRedirectPageText = await gateResponse.text();
		const lazyRedirectMatch = lazyRedirectPageText.match(lazyRedirectRegex);

		if (!lazyRedirectMatch || !lazyRedirectMatch[1]) {
			throw new Error("Failed to find the lazy redirect URL.");
		}

		const lazyRedirectUrl = lazyRedirectMatch[1];
		console.log(`Resolving final mirror URL from: ${lazyRedirectUrl}`);

		const mirrorResponse = await fetchWithRetry(lazyRedirectUrl, fetchOptions);
		mirrorUrl = mirrorResponse.url;
	} else {
		mirrorUrl = gateResponse.url;
	}

	console.log(`Mirror URL: ${mirrorUrl}`);

	const modsfirePageText = await fetchWithRetry(mirrorUrl, fetchOptions).then((res) => res.text());
	const locationMatch = modsfirePageText.match(locationRegex);

	if (!locationMatch || !locationMatch[1]) {
		throw new Error("Failed to find the final Modsfire URL.");
	}

	const modsfireUrl = locationMatch[1];
	console.log(`Modsfire URL: ${modsfireUrl}`);

	const directDownloadLink = modsfireUrl.replace(/\/([^\/]*)$/, "/d/$1");
	return [directDownloadLink, modsfireUrl];
}
