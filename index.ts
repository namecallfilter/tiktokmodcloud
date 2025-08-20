import { boolean, command, flag, run, subcommands } from "cmd-ts";

import { getModDownload, getPluginDownload } from "./telegram";
import { downloadFile, extractDataInitialPage } from "./utils";

const commonFlags = {
	check: flag({
		long: "check",
		short: "c",
		type: boolean,
		description: "Check for the latest version",
		defaultValue: () => false,
	}),
	download: flag({
		long: "download",
		short: "d",
		type: boolean,
		description: "Download the latest version",
		defaultValue: () => false,
	}),
};

async function handleAction(getDownloadDetails: () => Promise<string[]>, args: { check: boolean; download: boolean }) {
	if (!args.check && !args.download) {
		console.error("Error: Please specify an action: --check (-c) or --download (-d).");
		return;
	}
	if (args.check && args.download) {
		console.error("Error: --check and --download cannot be used together.");
		return;
	}

	if (args.check) {
		const [, referer] = await getDownloadDetails();
		const { fileId } = await extractDataInitialPage(referer);
		console.log(fileId.split("_")[0]);
	}

	if (args.download) {
		const [downloadLink, referer] = await getDownloadDetails();
		await downloadFile(downloadLink, referer);
	}
}

const modCommand = command({
	name: "mod",
	description: "Select the mod",
	args: commonFlags,
	handler: (args) => handleAction(getModDownload, args),
});

const pluginCommand = command({
	name: "plugin",
	description: "Select the plugin",
	args: commonFlags,
	handler: (args) => handleAction(getPluginDownload, args),
});

const app = subcommands({
	name: "tiktokmodcloud",
	cmds: { mod: modCommand, plugin: pluginCommand },
});

run(app, process.argv.slice(2));

// const client = await createClient();

// const channel = await client.getEntity("TikTokModCloud");
// const messages = await client.getMessages(channel, {
// 	filter: new Api.InputMessagesFilterUrl(),
// 	limit: 10,
// });

// client.disconnect();
