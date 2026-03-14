export const DOWNLOAD_TYPES = ["mod", "plugin"] as const;
export type DownloadType = (typeof DOWNLOAD_TYPES)[number];

export interface DownloadInfo {
	readonly fileName: string;
	readonly fileSize: number;
	readonly fileMime: string;
	readonly links: readonly string[];
}
