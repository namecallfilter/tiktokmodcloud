import { getModDownload, getPluginDownload } from "./telegram";
import { downloadFile, extractDataInitialPage } from "./utils";

const arg = process.argv[2];

if (arg !== "mod" && arg !== "plugin") {
	console.error("Usage: tsx index.ts [mod|plugin]");
	process.exit(1);
}

const arg2 = process.argv[3];
if (arg2 !== "check" && arg2 !== "download") {
	console.error("Usage: tsx index.ts [mod|plugin] [check|download]");
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
	if (arg2 === "check") {
		const { fileId } = await extractDataInitialPage(referer);
		console.log(fileId.split("_")[0]);
	} else {
		await downloadFile(downloadLink, referer);
	}
}

if (arg === "plugin") {
	const [downloadLink, referer] = await getPluginDownload();
	if (arg2 === "check") {
		const { fileId } = await extractDataInitialPage(referer);
		console.log(fileId.split("_")[0]);
	} else {
		await downloadFile(downloadLink, referer);
	}
}

// client.disconnect();
