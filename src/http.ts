import { createSession, type Session } from "wreq-js";
import { BROWSER } from "./config.ts";

let sharedSession: Promise<Session> | undefined;

export async function getSharedSession(): Promise<Session> {
	if (!sharedSession) {
		const pendingSession = createSession(BROWSER).catch((error: unknown) => {
			if (sharedSession === pendingSession) sharedSession = undefined;
			throw error;
		});
		sharedSession = pendingSession;
	}
	return sharedSession;
}

export async function closeSharedSession(): Promise<void> {
	const pendingSession = sharedSession;
	sharedSession = undefined;
	if (pendingSession) {
		const session = await pendingSession;
		await session.close();
	}
}
