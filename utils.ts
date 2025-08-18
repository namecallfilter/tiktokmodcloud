import { CapMonsterCloudClientFactory, ClientOptions, TurnstileRequest } from "@zennolab_com/capmonstercloud-client";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { ReadableStream } from "node:stream/web";

dotenv.config();

export async function downloadFile(
	downloadUrl: string,
	referer: string,
	outputDir: string = "./apks",
): Promise<string> {
	const cookie = await getVerificationCookie(referer);

	console.log(`Starting download from ${downloadUrl}`);
	const response = await fetch(downloadUrl, {
		redirect: "follow",
		headers: {
			Cookie: cookie,
			Referer: referer,
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to download file: ${response.statusText}`);
	}

	const totalSize = Number(response.headers.get("content-length") || 0);
	if (totalSize === 0) {
		console.log("Warning: Content-Length header not found. Cannot display progress.");
	}

	const finalUrl = response.url;
	const filename = new URL(finalUrl).pathname.split("/").pop() || "downloaded_file";
	const filePath = path.join(outputDir, filename);

	fs.mkdirSync(outputDir, { recursive: true });

	const fileStream = fs.createWriteStream(filePath);

	if (!response.body) {
		throw new Error("Response body is null");
	}

	const sourceStream = Readable.fromWeb(response.body as ReadableStream<any>);

	let downloadedSize = 0;
	let lastLoggedPercentage = -1;

	sourceStream.on("data", (chunk) => {
		downloadedSize += chunk.length;
		if (totalSize > 0) {
			const percentage = Math.floor((downloadedSize / totalSize) * 100);
			if (percentage !== lastLoggedPercentage) {
				process.stdout.write(`\rDownloading... ${percentage}%`);
				lastLoggedPercentage = percentage;
			}
		}
	});

	sourceStream.pipe(fileStream);

	return new Promise((resolve, reject) => {
		fileStream.on("finish", () => {
			process.stdout.write(`\rFile downloaded successfully: ${filePath}\n`);
			resolve(filePath);
		});
		fileStream.on("error", (error) => {
			console.error(`\nError downloading file: ${error.message}`);
			reject(error);
		});
	});
}

function formatCookieHeader(setCookieHeader: string): string {
	const cookies = setCookieHeader.split(/, /);
	const cookiePairs = cookies.map((cookie) => {
		return cookie.split(";")[0];
	});
	return cookiePairs.join("; ");
}

function extractDataFromHtml(html: string) {
	const csrfTokenMatch = html.match(/<input[^>]+name="_token"[^>]+value="([^"]+)"/);
	const fileIdMatch = html.match(/<input[^>]+id="file_id"[^>]+value="([^"]+)"/);
	const sitekeyMatch = html.match(/class="cf-turnstile"[^>]+data-sitekey="([^"]+)"/);

	const csrfToken = csrfTokenMatch?.[1];
	const fileId = fileIdMatch?.[1];
	const sitekey = sitekeyMatch?.[1];

	if (!csrfToken || !fileId || !sitekey) {
		console.error({
			foundCsrf: !!csrfToken,
			foundFileId: !!fileId,
			foundSitekey: !!sitekey,
		});
		throw new Error("Failed to extract required CSRF token, File ID, or Sitekey from the page.");
	}

	console.log(`Successfully extracted CSRF token: ${csrfToken}, and File ID: ${fileId}`);
	return { csrfToken, fileId, sitekey };
}

async function solveTurnstile(sitekey: string, pageUrl: string): Promise<string> {
	const capmonsterKey = process.env.CAPMONSTER_KEY;
	if (!capmonsterKey) {
		throw new Error("CAPMONSTER_KEY environment variable is not set.");
	}

	const cmcClient = CapMonsterCloudClientFactory.Create(new ClientOptions({ clientKey: capmonsterKey }));

	console.log("Solving Turnstile CAPTCHA...");
	const turnstileRequest = new TurnstileRequest({
		websiteURL: pageUrl,
		websiteKey: sitekey,
		userAgent:
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/5.37.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
	});

	const solveResponse = await cmcClient.Solve(turnstileRequest);
	const solutionToken = solveResponse?.solution?.token;

	if (!solutionToken) {
		throw new Error("Failed to obtain a solution token from CapMonster.");
	}

	console.log("Successfully obtained CAPTCHA solution token.");
	return solutionToken;
}

export async function getVerificationCookie(pageUrl: string): Promise<string> {
	console.log(`Fetching initial page data from: ${pageUrl}`);
	const pageResponse = await fetch(pageUrl);
	if (!pageResponse.ok) {
		throw new Error(`Failed to fetch page: ${pageResponse.status} ${pageResponse.statusText}`);
	}

	const initialCookies = pageResponse.headers.getSetCookie();
	const cookieString = initialCookies.map((c) => c.split(";")[0]).join("; ");
	const pageHtml = await pageResponse.text();

	const { csrfToken, fileId, sitekey } = extractDataFromHtml(pageHtml);
	const captchaToken = await solveTurnstile(sitekey, pageUrl);

	console.log("Verifying captcha solution with the website...");
	const verifyResponse = await fetch("https://modsfire.com/verify-cf-captcha", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-CSRF-TOKEN": csrfToken,
			Cookie: cookieString,
		},
		body: JSON.stringify({
			token: captchaToken,
			file_id: fileId,
		}),
	});

	if (!verifyResponse.ok) {
		throw new Error(`Failed to verify captcha: ${verifyResponse.status} ${verifyResponse.statusText}`);
	}

	const responseData = await verifyResponse.json();

	// 5. Check for success and return the final cookie
	if (responseData.success) {
		const finalCookie = verifyResponse.headers.get("Set-Cookie");
		if (!finalCookie) {
			throw new Error("Verification was successful, but no 'Set-Cookie' header was returned.");
		}
		console.log("Successfully obtained verification cookie!");
		return formatCookieHeader(finalCookie);
	} else {
		throw new Error(`Website rejected the verification: ${JSON.stringify(responseData)}`);
	}
}
