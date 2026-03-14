export const BROWSER = { browser: "chrome_145", os: "windows" } as const;

export const APKW_BASE_URL = "https://apkw.ru/en/download";

export const RETRY = {
	maxAttempts: 5,
	initialDelayMs: 5_000,
	maxDelayMs: 60_000,
} as const;

export const OUTPUT_DIR = "./apks";
