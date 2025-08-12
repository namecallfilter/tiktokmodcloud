import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import dotenv from "dotenv";
import { request } from "./utils";
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

export async function getModDownload() {
	// const latestMod = messages.find((message) => {
	// 	return message.message?.startsWith("TikTokMod") && !message.message?.includes("(Asia)");
	// });

	// if (!latestMod) {
	// 	throw new Error("No TikTokMod found in messages");
	// }

	// const urlShortener = await latestMod.getButtons().then((b) => b?.[b.length - 1]?.[0]?.url);
	// console.log("URL Shortener:", urlShortener);
	// const redirectUrl = await request(urlShortener!).then((text) => {
	// 	const match = text.match(locationRegex);
	// 	return match ? match[1] : null;
	// });
	// console.log("Redirect URL:", redirectUrl);

	const mirrorUrl = await request("https://apkw.ru/en/download/tik-tok-mod/", "https://apkw.ru/en/tiktok-mod-27-1-3-for-android/")
		.then((text) => {
			const match = text.match(/href='[^']*?filename=([^'&]+)[^>]*?>MIRROR 1<\/a>/);
			return match ? match[1] : null;
		})
		.then((filename) => {
			if (filename) {
				return `https://recut.ru/${filename}`;
			}
			return null;
		});
	console.log("Mirror URL:", mirrorUrl);

	const modsfireUrl = await request(mirrorUrl!).then((text) => {
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

export async function getPluginDownload() {
	// const latestPlugin = messages.find((message) => {
	// 	return message.message?.startsWith("TikTok Plugin");
	// });

	// if (!latestPlugin) {
	// 	throw new Error("No TikTok Plugin found in messages");
	// }

	// const urlShortener = await latestPlugin.getButtons().then((b) => b?.[b.length - 1]?.[0]?.url);
	// console.log("URL Shortener:", urlShortener);

	const mirrorUrl = await request("https://apkw.ru/en/download/tik-tok-plugin/", "https://apkw.ru/en/download/tik-tok-mod/")
		.then((text) => {
			const match = text.match(/href='[^']*?filename=([^'&]+)[^>]*?>MIRROR<\/a>/);
			return match ? match[1] : null;
		})
		.then((filename) => {
			if (filename) {
				return `https://recut.ru/${filename}`;
			}
			return null;
		});

	console.log("Mirror URL:", mirrorUrl);

	const modsfireUrl = await request(mirrorUrl!).then((text) => {
		const match = text.match(locationRegex);
		return match ? match[1] : null;
	});
	console.log("Modsfire URL:", modsfireUrl);

	if (!modsfireUrl) {
		throw new Error("Failed to retrieve Modsfire URL for plugin");
	}

	const directDownloadLink = modsfireUrl?.replace(/\/([^\/]*)$/, "/d/$1");
	return [directDownloadLink, modsfireUrl];
}
