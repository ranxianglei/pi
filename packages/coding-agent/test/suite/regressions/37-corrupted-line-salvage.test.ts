import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEntriesFromFile } from "../../../src/core/session-manager.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function writeSession(lines: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-salvage-"));
	tempDirs.push(dir);
	const file = join(dir, "session.jsonl");
	writeFileSync(file, lines.join("\n") + "\n", "utf8");
	return file;
}

const header = JSON.stringify({
	type: "session",
	version: 1,
	id: "salvage-test-session",
	timestamp: "2026-01-01T00:00:00.000Z",
	cwd: "/tmp",
});

function messageEntry(id: string, parentId: string | null, text: string): string {
	return JSON.stringify({
		type: "message",
		id,
		parentId,
		timestamp: "2026-01-01T00:00:01.000Z",
		message: { id, role: "user", content: [{ type: "text", text }] },
	});
}

describe("corrupted session line salvage (issue 37)", () => {
	it("recovers an entry prefixed with garbage bytes instead of dropping it", () => {
		// 230 bytes of spaces and NULs before a valid JSON payload, as produced
		// by concurrent appenders racing on the same session file.
		const garbage = `${" ".repeat(115)}${"\x00".repeat(115)}`;
		const file = writeSession([
			header,
			messageEntry("m1", null, "first"),
			`${garbage}${messageEntry("m2", "m1", "second")}`,
			messageEntry("m3", "m2", "third"),
		]);

		const entries = loadEntriesFromFile(file);

		expect(entries.map((entry) => entry.id)).toEqual(["salvage-test-session", "m1", "m2", "m3"]);
	});

	it("still drops lines that contain no recoverable JSON object entry", () => {
		const file = writeSession([header, messageEntry("m1", null, "first"), "not json at all"]);

		const entries = loadEntriesFromFile(file);

		expect(entries.map((entry) => entry.id)).toEqual(["salvage-test-session", "m1"]);
	});

	it("drops salvage results that do not look like session entries", () => {
		const file = writeSession([header, `garbage ${JSON.stringify({ notAnEntry: true })}`]);

		const entries = loadEntriesFromFile(file);

		expect(entries.map((entry) => entry.id)).toEqual(["salvage-test-session"]);
	});
});
