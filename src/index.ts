import { Clerc } from "@clerc/core";
import { helpPlugin } from "@clerc/plugin-help";
import { friendlyErrorPlugin } from "@clerc/plugin-friendly-error";
import { handleAction } from "./cli.ts";
import { type DownloadType, DOWNLOAD_TYPES } from "./types.ts";
import { logger } from "./logger.ts";

const actionFlags = {
	check: {
		type: Boolean,
		alias: "c",
		description: "Check for the latest version",
	},
	download: {
		type: Boolean,
		alias: "d",
		description: "Download the latest version",
	},
	json: {
		type: Boolean,
		description: "Output information as JSON",
	},
} as const;

function isDownloadType(value: string): value is DownloadType {
	return (DOWNLOAD_TYPES as readonly string[]).includes(value);
}

async function run(command: string, flags: { check: boolean; download: boolean; json: boolean }): Promise<void> {
	if (!flags.check && !flags.download) {
		console.error("Error: one of --check or --download is required");
		process.exit(1);
	}

	const types: DownloadType[] = command === "both" ? [...DOWNLOAD_TYPES] : [];

	if (command !== "both") {
		if (!isDownloadType(command)) {
			throw new Error(`Unknown download type: ${command}`);
		}
		types.push(command);
	}

	for (const type of types) {
		logger.debug({ type, check: flags.check, download: flags.download }, "handling action");
		await handleAction(type, flags.check, flags.download, flags.json);
	}
}

await Clerc.create()
	.name("tiktokmodcloud")
	.scriptName("tiktokmodcloud")
	.description("TikTok Mod Cloud CLI")
	.version("0.1.0")
	.use(helpPlugin())
	.use(friendlyErrorPlugin())
	.command("mod", "Handle TikTok Mod", { flags: actionFlags })
	.command("plugin", "Handle TikTok Plugin", { flags: actionFlags })
	.command("both", "Handle both Mod and Plugin", { flags: actionFlags })
	.on("mod", (ctx) => run("mod", ctx.flags))
	.on("plugin", (ctx) => run("plugin", ctx.flags))
	.on("both", (ctx) => run("both", ctx.flags))
	.parse();
