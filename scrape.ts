import dotenv from "dotenv";

dotenv.config({ quiet: true });

const locationRegex = /document\.location\.href\s*=\s*['"](.*?)['"]/;
const gateRegex = /href='([^']*)'[^>]*?>\s*MIRROR(?:\s+\d+)?\s*<\/a>/;
const lazyRedirectRegex = /href='([^']*)'[^>]rel='noreferrer'/;

export enum DownloadType {
	Mod = "tik-tok-mod",
	Plugin = "tik-tok-plugin",
}

export async function getDownloadLinks(path: DownloadType) {
	const startUrl = `https://apkw.ru/en/download/${path}/`;
	const fetchOptions = { referrer: startUrl };

	console.log(`Fetching initial page: ${startUrl}`);
	const gatePageText = await fetch(startUrl, fetchOptions).then((res) => res.text());
	const gateMatch = gatePageText.match(gateRegex);
	if (!gateMatch || !gateMatch[1]) {
		throw new Error("Failed to find the mirror gate URL.");
	}
	const gateUrl = gateMatch[1];

	console.log(`Fetching gate page: ${gateUrl}`);
	const lazyRedirectPageText = await fetch(gateUrl, fetchOptions).then((res) => res.text());
	const lazyRedirectMatch = lazyRedirectPageText.match(lazyRedirectRegex);
	if (!lazyRedirectMatch || !lazyRedirectMatch[1]) {
		throw new Error("Failed to find the lazy redirect URL.");
	}
	const lazyRedirectUrl = lazyRedirectMatch[1];

	console.log(`Resolving final mirror URL from: ${lazyRedirectUrl}`);
	const mirrorResponse = await fetch(lazyRedirectUrl, fetchOptions);
	const mirrorUrl = mirrorResponse.url;
	console.log(`Mirror URL: ${mirrorUrl}`);

	const modsfirePageText = await fetch(mirrorUrl).then((res) => res.text());
	const locationMatch = modsfirePageText.match(locationRegex);
	if (!locationMatch || !locationMatch[1]) {
		throw new Error("Failed to find the final Modsfire URL.");
	}
	const modsfireUrl = locationMatch[1];
	console.log(`Modsfire URL: ${modsfireUrl}`);

	const directDownloadLink = modsfireUrl.replace(/\/([^\/]*)$/, "/d/$1");
	return [directDownloadLink, modsfireUrl];
}
