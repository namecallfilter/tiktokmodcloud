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
	const [modDownloadLink, referer] = await getModDownload(messages);
	await downloadFile(modDownloadLink, referer);
}

{
	const [pluginDownloadLink, referer] = await getPluginDownload(messages);
	await downloadFile(pluginDownloadLink, referer);
}
