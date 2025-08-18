import { Api } from "telegram";

import { createClient, getModDownload, getPluginDownload } from "./telegram";
import { downloadFile, getVerificationCookie } from "./utils";

const arg = process.argv[2];

if (arg !== "mod" && arg !== "plugin") {
	console.error("Usage: tsx index.ts [mod|plugin]");
	process.exit(1);
}

// const client = await createClient();

// const channel = await client.getEntity("TikTokModCloud");
// const messages = await client.getMessages(channel, {
// 	filter: new Api.InputMessagesFilterUrl(),
// 	limit: 10,
// });

if (arg === "mod") {
	const [downloadLink, referer] = await getModDownload();
	await downloadFile(downloadLink, referer);
}

if (arg === "plugin") {
	const [downloadLink, referer] = await getPluginDownload();
	await downloadFile(downloadLink, referer);
}

// client.disconnect();
