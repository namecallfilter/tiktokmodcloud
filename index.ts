import { boolean, command, flag, run, subcommands } from "cmd-ts";

import { DownloadType, getDownloadLinks } from "./scrape";
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
	if (args.check === args.download) {
		console.error("Error: Please specify exactly one action: --check (-c) or --download (-d).");
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
	handler: (args) => handleAction(() => getDownloadLinks(DownloadType.Mod), args),
});

const pluginCommand = command({
	name: "plugin",
	description: "Select the plugin",
	args: commonFlags,
	handler: (args) => handleAction(() => getDownloadLinks(DownloadType.Plugin), args),
});

const testCommand = command({
	name: "test",
	description: "Test's both mod and plugin",
	args: commonFlags,
	handler: async (args) => {
		console.log("--- MOD ---");
		await handleAction(() => getDownloadLinks(DownloadType.Mod), args);
		console.log("\n--- PLUGIN ---");
		await handleAction(() => getDownloadLinks(DownloadType.Plugin), args);
	},
});

const app = subcommands({
	name: "tiktokmodcloud",
	cmds: { mod: modCommand, plugin: pluginCommand, test: testCommand },
});

run(app, process.argv.slice(2));
