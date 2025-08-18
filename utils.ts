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
		// console.log("Warning: Content-Length header not found. Cannot display progress.");
		throw new Error("Content-Length header not found, might not be apk download");
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

	console.log(`Successfully extracted Site key: ${sitekey}, CSRF token: ${csrfToken}, and File ID: ${fileId}`);
	return { csrfToken, fileId, sitekey };
}

async function solveTurnstile(sitekey: string, pageUrl: string): Promise<string> {
	const capsolverKey = process.env.CAPSOLVER_KEY;
	if (!capsolverKey) {
		throw new Error("CAPSOLVER_KEY environment variable is not set.");
	}

	console.log("Checking Capsolver account balance...");

	try {
		const balanceResponse = await fetch("https://api.capsolver.com/getBalance", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ clientKey: capsolverKey }),
		});
		const balanceData = await balanceResponse.json();
		if (balanceData.errorId) {
			console.error(`Failed to get balance: ${balanceData.errorDescription}`);
		} else {
			console.log(`Capsolver Balance: $${balanceData.balance}`);
		}

		console.log("Creating Turnstile CAPTCHA task with Capsolver...");
		const createTaskPayload = {
			clientKey: capsolverKey,
			task: {
				type: "AntiTurnstileTaskProxyLess",
				websiteKey: sitekey,
				websiteURL: pageUrl,
			},
		};

		const createTaskResponse = await fetch("https://api.capsolver.com/createTask", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(createTaskPayload),
		});

		const createTaskData = await createTaskResponse.json();

		if (createTaskData.errorId || !createTaskData.taskId) {
			throw new Error(`Failed to create task: ${createTaskData.errorDescription || "No taskId returned"}`);
		}

		const taskId = createTaskData.taskId;
		console.log(`Task created successfully with ID: ${taskId}`);

		const getResultPayload = {
			clientKey: capsolverKey,
			taskId: taskId,
		};

		while (true) {
			await new Promise((resolve) => setTimeout(resolve, 3000));

			console.log("Polling for task result...");
			const getResultResponse = await fetch("https://api.capsolver.com/getTaskResult", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(getResultPayload),
			});

			const getResultData = await getResultResponse.json();

			if (getResultData.errorId) {
				throw new Error(`Failed to get task result: ${getResultData.errorDescription}`);
			}

			if (getResultData.status === "ready") {
				console.log("Successfully obtained CAPTCHA solution token.");
				return getResultData.solution.token;
			}

			if (getResultData.status === "failed") {
				throw new Error(`Captcha solve failed: ${JSON.stringify(getResultData)}`);
			}
		}
	} catch (error) {
		console.error("An error occurred during the CAPTCHA solving process:", error);
		throw error;
	}
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
