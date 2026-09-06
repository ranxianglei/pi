import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../../../src/core/auth-storage.ts";
import { ModelRuntime } from "../../../src/core/model-runtime.ts";
import type { SessionHeader } from "../../../src/core/session-manager.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";

// References ranxianglei/billion-context-pi#299 (external): importFromJsonl
// dropped extension sidecar files keyed by the session basename, and
// exportToJsonl dropped the parentSession header field.

describe("session import sidecars and export lineage", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

	async function createRuntimeHost(cwd: string) {
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("one")]);

		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
		const modelRuntime = await ModelRuntime.create({
			credentials: authStorage,
			modelsPath: join(cwd, "models.json"),
		});
		const model = faux.getModel();
		modelRuntime.registerProvider(model.provider, {
			baseUrl: model.baseUrl,
			api: model.api,
			models: [
				{
					id: model.id,
					name: model.name,
					api: model.api,
					reasoning: model.reasoning,
					input: model.input,
					cost: model.cost,
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					baseUrl: model.baseUrl,
				},
			],
		});

		const runtimeOptions = {
			agentDir: cwd,
			modelRuntime,
			model: faux.getModel(),
			resourceLoaderOptions: {
				extensionFactories: [],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
			},
		};
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({
			cwd: runtimeCwd,
			sessionManager,
			sessionStartEvent,
		}) => {
			const services = await createAgentSessionServices({
				...runtimeOptions,
				cwd: runtimeCwd,
			});
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: faux.getModel(),
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};
		const runtimeHost = await createAgentSessionRuntime(createRuntime, {
			cwd,
			agentDir: cwd,
			sessionManager: SessionManager.create(cwd),
		});
		await runtimeHost.session.bindExtensions({});

		cleanups.push(async () => {
			await runtimeHost.dispose();
			faux.unregister();
			if (existsSync(cwd)) {
				rmSync(cwd, { recursive: true, force: true });
			}
		});
		return runtimeHost;
	}

	it("importFromJsonl copies extension sidecar files keyed by the session basename", async () => {
		const sourceDir = join(tmpdir(), `pi-import-sidecars-src-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const targetDir = join(tmpdir(), `pi-import-sidecars-dst-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(sourceDir, { recursive: true });
		mkdirSync(targetDir, { recursive: true });
		cleanups.push(() => {
			rmSync(sourceDir, { recursive: true, force: true });
			rmSync(targetDir, { recursive: true, force: true });
		});

		const header: SessionHeader = {
			type: "session",
			version: 3,
			id: "00000000-0000-4000-8000-0000000000a1",
			timestamp: new Date().toISOString(),
			cwd: targetDir,
		};
		const entry = {
			type: "message",
			id: "00000000-0000-4000-8000-0000000000b2",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: { role: "user", content: "hello", timestamp: new Date().toISOString() },
		};
		const sessionFile = join(sourceDir, "imported-session.jsonl");
		writeFileSync(sessionFile, `${JSON.stringify(header)}\n${JSON.stringify(entry)}\n`);
		const sidecarContent = JSON.stringify({ blocks: [{ blockId: "b1" }] });
		writeFileSync(`${sessionFile}.acp.json`, sidecarContent);
		// A sibling that does NOT share the basename must not be copied.
		writeFileSync(join(sourceDir, "unrelated.json"), "{}");

		const runtimeHost = await createRuntimeHost(targetDir);
		const result = await runtimeHost.importFromJsonl(sessionFile);
		expect(result.cancelled).toBe(false);

		const destinationDir = dirname(runtimeHost.session.sessionManager.getSessionFile()!);
		const copied = join(destinationDir, "imported-session.jsonl.acp.json");
		expect(existsSync(copied)).toBe(true);
		expect(readFileSync(copied, "utf8")).toBe(sidecarContent);
		expect(existsSync(join(destinationDir, "unrelated.json"))).toBe(false);
	});

	it("exportToJsonl preserves the parentSession header field", async () => {
		const sourceDir = join(tmpdir(), `pi-export-lineage-src-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const targetDir = join(tmpdir(), `pi-export-lineage-dst-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(sourceDir, { recursive: true });
		mkdirSync(targetDir, { recursive: true });
		cleanups.push(() => {
			rmSync(sourceDir, { recursive: true, force: true });
			rmSync(targetDir, { recursive: true, force: true });
		});

		const parentSession = join(sourceDir, "parent-session.jsonl");
		const header: SessionHeader = {
			type: "session",
			version: 3,
			id: "00000000-0000-4000-8000-0000000000c3",
			timestamp: new Date().toISOString(),
			cwd: targetDir,
			parentSession,
		};
		const entry = {
			type: "message",
			id: "00000000-0000-4000-8000-0000000000d4",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: { role: "user", content: "hello", timestamp: new Date().toISOString() },
		};
		const sessionFile = join(sourceDir, "lineage-session.jsonl");
		writeFileSync(sessionFile, `${JSON.stringify(header)}\n${JSON.stringify(entry)}\n`);

		const runtimeHost = await createRuntimeHost(targetDir);
		const result = await runtimeHost.importFromJsonl(sessionFile);
		expect(result.cancelled).toBe(false);

		const exportedPath = join(targetDir, "exported.jsonl");
		runtimeHost.session.exportToJsonl(exportedPath);
		const exportedHeader = JSON.parse(readFileSync(exportedPath, "utf8").split("\n")[0]!) as SessionHeader;
		expect(exportedHeader.type).toBe("session");
		expect(exportedHeader.parentSession).toBe(parentSession);
	});
});
