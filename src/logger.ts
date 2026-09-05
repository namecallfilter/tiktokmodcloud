import pino from "pino";
import pretty from "pino-pretty";

const level = process.env.LOG_LEVEL ?? "debug";

export const logger = pino(
	{ name: "tiktokmodcloud", level },
	pretty({ destination: 2, sync: true, colorize: process.stderr.isTTY === true && !process.env.NO_COLOR }),
);
