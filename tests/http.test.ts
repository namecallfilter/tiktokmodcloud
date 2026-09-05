import { afterEach, expect, spyOn, test } from "bun:test";
import * as wreq from "wreq-js";
import { closeSharedSession, getSharedSession } from "../src/http.ts";

afterEach(closeSharedSession);

test("concurrent callers reuse the same initialized HTTP session", async () => {
	const [first, second] = await Promise.all([getSharedSession(), getSharedSession()]);
	expect(first).toBe(second);
	expect(await getSharedSession()).toBe(first);
});

test("a failed initialization can be retried", async () => {
	const create = spyOn(wreq, "createSession").mockRejectedValueOnce(new Error("Initialization failed"));
	try {
		await expect(getSharedSession()).rejects.toThrow("Initialization failed");
	} finally {
		create.mockRestore();
	}
	const session = await getSharedSession();
	expect(session).toBeDefined();
});
