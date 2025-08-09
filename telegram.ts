import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import dotenv from "dotenv";
// import readline from "readline";

dotenv.config();

const locationRegex = /document\.location\.href\s*=\s*['"](.*?)['"]/;

const appId = Number(process.env.APP_ID);
const apiHash = process.env.API_HASH!;
const stringSession = new StringSession(process.env.SESSION);

export async function createClient() {
	const client = new TelegramClient(stringSession, appId, apiHash, {
		connectionRetries: 5,
	});

	await client.connect();

	return client;
}

export async function getModDownload(messages: Api.Message[]) {
	const latestMod = messages.find((message) => {
		return message.message?.startsWith("TikTokMod") && !message.message?.includes("(Asia)");
	});

	if (!latestMod) {
		throw new Error("No TikTokMod found in messages");
	}

	const urlShortener = await latestMod.getButtons().then((b) => b?.[b.length - 1]?.[0]?.url);
	console.log("URL Shortener:", urlShortener);
	const redirectUrl = await fetch(urlShortener!)
		.then((res) => res.text())
		.then((text) => {
			const match = text.match(locationRegex);
			return match ? match[1] : null;
		});
	console.log("Redirect URL:", redirectUrl);

	const mirrorUrl = await fetch(redirectUrl!)
		.then((res) => res.text())
		.then((text) => {
			const match = text.match(/<span\s+class="pseudo-link js-link"\s+data-href="(.*?)"[^>]*>MIRROR 1<\/span>/);
			return match ? match[1] : null;
		})
		.then((url) => {
			if (url) {
				const decodedUrl = atob(url.split("?")[0].split("/").pop() ?? "");
				return decodedUrl;
			}
			return null;
		});
	console.log("Mirror URL:", mirrorUrl);

	const modsfireUrl = await fetch(mirrorUrl!)
		.then((res) => res.text())
		.then((text) => {
			const match = text.match(locationRegex);
			return match ? match[1] : null;
		});

	if (!modsfireUrl) {
		throw new Error("Failed to retrieve Modsfire URL");
	}

	console.log("Modsfire URL:", modsfireUrl);

	const directDownloadLink = modsfireUrl?.replace(/\/([^\/]*)$/, "/d/$1");
	return [directDownloadLink, modsfireUrl];
}

export async function getPluginDownload(messages: Api.Message[]) {
	const latestPlugin = messages.find((message) => {
		return message.message?.startsWith("TikTok Plugin");
	});

	if (!latestPlugin) {
		throw new Error("No TikTok Plugin found in messages");
	}

	const urlShortener = await latestPlugin.getButtons().then((b) => b?.[b.length - 1]?.[0]?.url);
	console.log("URL Shortener:", urlShortener);
	const modsfireUrl = await fetch(urlShortener!)
		.then((res) => res.text())
		.then((text) => {
			const match = text.match(locationRegex);
			return match ? match[1] : null;
		});

	if (!modsfireUrl) {
		throw new Error("Failed to retrieve Modsfire URL for plugin");
	}

	console.log("Modsfire URL:", modsfireUrl);

	const directDownloadLink = modsfireUrl?.replace(/\/([^\/]*)$/, "/d/$1");
	return [directDownloadLink, modsfireUrl];
}
