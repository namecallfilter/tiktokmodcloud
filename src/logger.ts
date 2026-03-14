import pino from "pino";

const level = process.env.LOG_LEVEL ?? "debug";

export const logger = pino({
	name: "tiktokmodcloud",
	level,
	transport: {
		target: "pino-pretty",
		options: {
			destination: 2,
			colorize: true,
		},
	},
});
