import { createClient, getModDownload, getPluginDownload } from "./telegram";
import { downloadFile } from "./utils";
import { Api } from "telegram";

const client = await createClient();

const channel = await client.getEntity("TikTokModCloud");
const messages = await client.getMessages(channel, {
	filter: new Api.InputMessagesFilterUrl(),
	limit: 10,
});

{
	const [downloadLink, referer] = await getModDownload(messages);
	await downloadFile(downloadLink, referer);
}

{
	const [downloadLink, referer] = await getPluginDownload(messages);
	await downloadFile(downloadLink, referer);
}
