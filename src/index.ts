import { Clerc } from "@clerc/core";
import { helpPlugin } from "@clerc/plugin-help";
import { strictFlagsPlugin } from "@clerc/plugin-strict-flags";
import { notFoundPlugin } from "@clerc/plugin-not-found";
import { versionPlugin } from "@clerc/plugin-version";
import { handleAction } from "./cli.ts";
import { type DownloadType, DOWNLOAD_TYPES } from "./types.ts";
import { logger } from "./logger.ts";
import { closeSharedSession } from "./http.ts";

const actionFlags = {
	check: {
		type: Boolean,
		short: "c",
		description: "Check for the latest version",
	},
	download: {
		type: Boolean,
		short: "d",
		description: "Download the latest version",
	},
	json: {
		type: Boolean,
		description: "Output information as JSON",
	},
} as const;

async function run(
	command: DownloadType | "both",
	flags: { check: boolean; download: boolean; json: boolean },
): Promise<void> {
	if (!flags.check && !flags.download) {
		throw new Error("One of --check or --download is required");
	}

	const types = command === "both" ? DOWNLOAD_TYPES : [command];

	for (const type of types) {
		logger.debug({ type, check: flags.check, download: flags.download }, "handling action");
		await handleAction(type, flags.check, flags.download, flags.json);
	}
}

try {
	await Clerc.create()
		.name("tiktokmodcloud")
		.scriptName("tiktokmodcloud")
		.description("TikTok Mod Cloud CLI")
		.version("0.1.0")
		.use(helpPlugin())
		.use(versionPlugin())
		.use(strictFlagsPlugin())
		.use(notFoundPlugin())
		.errorHandler((error) => {
			logger.error({ err: error }, error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		})
		.command("mod", "Handle TikTok Mod", { flags: actionFlags })
		.command("plugin", "Handle TikTok Plugin", { flags: actionFlags })
		.command("both", "Handle both Mod and Plugin", { flags: actionFlags })
		.on("mod", (ctx) => run("mod", ctx.flags))
		.on("plugin", (ctx) => run("plugin", ctx.flags))
		.on("both", (ctx) => run("both", ctx.flags))
		.parse();
} finally {
	await closeSharedSession();
}
