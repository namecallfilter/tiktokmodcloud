import { createSession, type Session } from "wreq-js";
import { BROWSER } from "./config.ts";

let sharedSession: Session | undefined;

export async function getSharedSession(): Promise<Session> {
	if (!sharedSession) {
		sharedSession = await createSession(BROWSER);
	}
	return sharedSession;
}
