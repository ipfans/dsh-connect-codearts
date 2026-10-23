import { LlmAdapter, QUOTA_EXCEEDED_CODE, attributionHeaders, resolveImageAttachmentAccess, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
// src/json.ts
function object(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function text(value) {
	return typeof value === "string" && value.trim() !== "" ? value : void 0;
}
function positive(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
// src/accounts.ts
const ACCOUNTS_KEY = credentialKey("dsh-connect-codearts", "accounts");
var AccountDataError = class extends Error {};
function parseState(record) {
	if (record === void 0) return {
		version: 1,
		accounts: [],
		activeId: null
	};
	const wrapped = object(record);
	const payload = object(wrapped?.["payload"]);
	if (wrapped?.["kind"] !== "grant" || payload?.["version"] !== 1 || !Array.isArray(payload["accounts"])) throw new AccountDataError("CodeArts credential record is invalid; existing data was preserved");
	const accounts = [];
	for (const value of payload["accounts"]) {
		const row = object(value);
		if (!row || !text(row["id"]) || !text(row["label"]) || !text(row["ak"]) || !text(row["sk"])) throw new AccountDataError("CodeArts credential record contains an invalid account");
		accounts.push({
			id: String(row["id"]),
			label: String(row["label"]),
			ak: String(row["ak"]),
			sk: String(row["sk"])
		});
	}
	if (new Set(accounts.map((a) => a.id)).size !== accounts.length) throw new AccountDataError("CodeArts credential record contains duplicate accounts");
	const activeId = payload["activeId"];
	if (activeId !== null && (typeof activeId !== "string" || !accounts.some((a) => a.id === activeId))) throw new AccountDataError("CodeArts credential record has an invalid selected account");
	return {
		version: 1,
		accounts,
		activeId
	};
}
function secret(value) {
	const normalized = value.trim();
	if (!normalized || normalized.length > 1024 || /[^\x21-\x7e]/u.test(normalized)) throw new AccountDataError("AK/SK must be non-empty ASCII and contain no whitespace or control characters");
	return normalized;
}
function publicAccounts(state) {
	return state.accounts.map(({ id, label, ak }) => ({
		id,
		label,
		akHint: `••••${ak.slice(-4)}`
	}));
}
var Accounts = class {
	credentials;
	constructor(credentials) {
		this.credentials = credentials;
	}
	async read() {
		try {
			return parseState(await this.credentials.readRecord(ACCOUNTS_KEY));
		} catch (error) {
			if (error instanceof AccountDataError) throw error;
			throw new Error("CodeArts credential storage could not be read");
		}
	}
	async change(mutate) {
		try {
			await this.credentials.modifyRecord(ACCOUNTS_KEY, async (current) => {
				const state = parseState(current);
				mutate(state);
				return {
					kind: "grant",
					payload: {
						version: state.version,
						accounts: state.accounts.map((a) => ({ ...a })),
						activeId: state.activeId
					}
				};
			});
		} catch (error) {
			if (error instanceof AccountDataError) throw error;
			throw new Error("CodeArts credential storage could not be updated");
		}
	}
	async save(input) {
		const label = input.label.trim();
		if (!label || label.length > 100) throw new AccountDataError("Account name must contain 1–100 characters");
		await this.change((state) => {
			const previous = input.id === void 0 ? void 0 : state.accounts.find((a) => a.id === input.id);
			if (input.id !== void 0 && !previous) throw new AccountDataError("Account no longer exists");
			const ak = input.ak === void 0 || input.ak === "" ? previous?.ak : secret(input.ak);
			const sk = input.sk === void 0 || input.sk === "" ? previous?.sk : secret(input.sk);
			if (!ak || !sk) throw new AccountDataError("Both AK and SK are required for a new account");
			if (state.accounts.some((a) => a.ak === ak && a.id !== previous?.id)) throw new AccountDataError("This AK is already saved; edit the existing account");
			const account = {
				id: previous?.id ?? randomUUID(),
				label,
				ak,
				sk
			};
			if (previous) state.accounts[state.accounts.indexOf(previous)] = account;
			else {
				if (state.accounts.length === 0) state.activeId = account.id;
				state.accounts.push(account);
			}
		});
	}
	async select(id) {
		await this.change((state) => {
			if (!state.accounts.some((a) => a.id === id)) throw new AccountDataError("Account no longer exists");
			state.activeId = id;
		});
	}
	async remove(id) {
		await this.change((state) => {
			if (!state.accounts.some((a) => a.id === id)) throw new AccountDataError("Account no longer exists");
			state.accounts = state.accounts.filter((a) => a.id !== id);
			if (state.activeId === id) state.activeId = null;
		});
	}
};
// src/signing.ts
function uriEncode(value) {
	return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
function signRequest(account, method, url, body, extra = {}, now = /* @__PURE__ */ new Date()) {
	const headers = {};
	for (const [key, value] of Object.entries(extra)) headers[key.toLowerCase()] = value.trim();
	headers["host"] = url.host;
	headers["content-type"] = "application/json";
	headers["x-sdk-date"] = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
	const names = Object.keys(headers).sort();
	const path = url.pathname.split("/").map((part) => uriEncode(decodeURIComponent(part))).join("/");
	const canonicalUri = path.endsWith("/") ? path : `${path}/`;
	const query = [...url.searchParams].map(([k, v]) => [uriEncode(k), uriEncode(v)]).sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0).map(([k, v]) => `${k}=${v}`).join("&");
	const hash = (value) => createHash("sha256").update(value).digest("hex");
	const canonical = [
		method.toUpperCase(),
		canonicalUri,
		query,
		names.map((k) => `${k}:${headers[k]}\n`).join(""),
		names.join(";"),
		hash(body)
	].join("\n");
	const toSign = `SDK-HMAC-SHA256\n${headers["x-sdk-date"]}\n${hash(canonical)}`;
	const signature = createHmac("sha256", account.sk).update(toSign).digest("hex");
	headers["authorization"] = `SDK-HMAC-SHA256 Access=${account.ak}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
	return headers;
}
// src/upstream.ts
const SNAP_BASE = "https://snap-access.cn-north-4.myhuaweicloud.com";
const BENEFIT_BASE = "https://opengw.developer.huaweicloud.com";
const CHAT_URL = `${SNAP_BASE}/api/v2/chat/completions`;
var CodeArtsError = class extends Error {
	status;
	code;
	constructor(message, status = 502, code = "upstream_error") {
		super(message);
		this.status = status;
		this.code = code;
		this.name = "CodeArtsError";
	}
};
function redact(message, account) {
	let result = message;
	for (const value of [account?.ak, account?.sk]) if (value) result = result.replaceAll(value, "[redacted]");
	return result.slice(0, 500);
}
function businessError(value) {
	const data = object(value);
	if (!data) return void 0;
	const wrapped = object(data["error"]);
	const code = data["error_code"];
	const failure = code !== void 0 && code !== null && !["0", "0000"].includes(String(code));
	if (data["error"] || failure || code == null && text(data["error_msg"])) return {
		message: text(wrapped?.["message"]) ?? text(data["error_msg"]) ?? text(data["error"]) ?? "CodeArts rejected this request",
		code: String(wrapped?.["code"] ?? code ?? "upstream_error")
	};
}
function businessStatus(message) {
	if (/quota|insufficient.*token|token.*exhaust|余额|额度/iu.test(message)) return 402;
	if (/rate.limit|concurren|限流|并发/iu.test(message)) return 429;
	if (/signature|unauthorized|authentication|access.?key|签名|认证/iu.test(message)) return 401;
	if (/permission|forbidden|权限/iu.test(message)) return 403;
	return 502;
}
function parseModels(rows, channel) {
	const models = [];
	const issues = [];
	for (const value of rows) {
		const row = object(value);
		const id = text(row?.["model_id"]) ?? text(row?.["model_alias"]);
		if (!row || !id || !/^[\x21-\x7e]{1,256}$/u.test(id)) {
			issues.push("A model was skipped because its ID is missing or invalid");
			continue;
		}
		const params = channel === "agent" ? object(row["model_parameters"]) : row;
		const contextWindow = params?.["context_window"];
		const maxTokens = params?.["max_tokens"];
		if (!positive(contextWindow) || !positive(maxTokens)) {
			issues.push(`${id}: context_window or max_tokens is missing or invalid`);
			continue;
		}
		if (models.some((m) => m.upstreamId === id)) continue;
		models.push({
			id: `${channel}/${id}`,
			upstreamId: id,
			channel,
			name: text(row["model_alias"]) ?? text(row["model_name"]) ?? id,
			contextWindow,
			maxTokens: Math.min(maxTokens, contextWindow),
			supportsImages: params?.["supports_images"] === true
		});
	}
	return {
		models,
		issues
	};
}
var CodeArtsClient = class {
	fetcher;
	constructor(fetcher = globalThis.fetch) {
		this.fetcher = fetcher;
	}
	async request(account, method, target, body = /* @__PURE__ */ new Uint8Array(), extra = {}, signal, timeoutMs = 3e4) {
		const url = new URL(target);
		if (!["https://snap-access.cn-north-4.myhuaweicloud.com", "https://opengw.developer.huaweicloud.com"].includes(url.origin) || url.username || url.password) throw new CodeArtsError("CodeArts request destination is not allowed", 400);
		const headers = signRequest(account, method, url, body, extra);
		const deadline = AbortSignal.timeout(timeoutMs);
		const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
		try {
			return await this.fetcher(url, {
				method,
				headers,
				redirect: "error",
				...method === "GET" ? {} : { body: Buffer.from(body) },
				signal: requestSignal
			});
		} catch {
			if (signal?.aborted) throw signal.reason;
			if (deadline.aborted) throw new CodeArtsError("CodeArts request timed out", 504, "timeout");
			throw new CodeArtsError("CodeArts network request failed; check connectivity and proxy settings");
		}
	}
	async json(account, method, target, extra = {}, signal) {
		const response = await this.request(account, method, target, /* @__PURE__ */ new Uint8Array(), extra, signal);
		const data = await response.json().catch(() => void 0);
		const error = businessError(data);
		if (!response.ok || error) {
			const message = redact(error?.message ?? `CodeArts HTTP ${response.status}`, account);
			throw new CodeArtsError(message, response.ok ? businessStatus(message) : response.status, error?.code);
		}
		const result = object(data);
		if (!result) throw new CodeArtsError("CodeArts returned an invalid JSON document");
		return result;
	}
	async models(account, channel, signal) {
		if (channel === "benefit") {
			const rows = object((await this.json(account, "GET", `${BENEFIT_BASE}/api/v1/gateway/config`, {}, signal))["result"])?.["models"];
			if (!Array.isArray(rows)) throw new CodeArtsError("CodeArts benefit model list is missing");
			return parseModels(rows, channel);
		}
		const headers = {
			"agent-type": "AgentCenter",
			"x-language": "zh-cn",
			accept: "application/json"
		};
		const data = await this.json(account, "GET", `${SNAP_BASE}/v1/agent-center/agents/useragents?offset=0&limit=100`, headers, signal);
		if (!Array.isArray(data["agents"])) throw new CodeArtsError("CodeArts AgentCenter list is missing");
		const agents = data["agents"].map(object).filter((a) => a !== void 0).sort((a, b) => Number(b["is_primary_agent"] === true) - Number(a["is_primary_agent"] === true) || Number(a["agent_order"] ?? 999999) - Number(b["agent_order"] ?? 999999));
		const issues = [];
		let lastError;
		for (const agent of agents) {
			const id = text(agent["agent_id"]);
			if (!id) continue;
			try {
				const rows = object((await this.json(account, "GET", `${SNAP_BASE}/v1/agent-center/agents/detail?agent_id=${encodeURIComponent(id)}`, headers, signal))["gpts"])?.["models"];
				if (!Array.isArray(rows)) continue;
				const parsed = parseModels(rows, channel);
				issues.push(...parsed.issues);
				if (parsed.models.length) return {
					models: parsed.models,
					issues
				};
			} catch (error) {
				if (signal?.aborted) throw error;
				lastError = error;
			}
		}
		if (lastError) throw lastError;
		return {
			models: [],
			issues
		};
	}
	async benefit(account, signal) {
		const [balance, claim] = await Promise.allSettled([this.json(account, "GET", `${BENEFIT_BASE}/api/v1/user/tokens/balance`, {}, signal), this.json(account, "GET", `${BENEFIT_BASE}/api/v1/benefit/claim`, {}, signal)]);
		const result = {};
		const errors = [];
		if (balance.status === "fulfilled") {
			const values = object(balance.value["result"]);
			for (const [source, target] of [
				["total_quota", "total"],
				["total_balance", "balance"],
				["used_amount", "used"]
			]) {
				const value = values?.[source];
				if (typeof value === "number" && Number.isFinite(value) && value >= 0) result[target] = value;
			}
			if (result.balance === void 0) errors.push("CodeArts balance response is missing total_balance");
		} else errors.push(redact(String(balance.reason instanceof Error ? balance.reason.message : "Balance query failed"), account));
		if (claim.status === "fulfilled") {
			const value = object(claim.value["result"])?.["create_time"];
			if (typeof value === "number" && Number.isFinite(value) && value > 0) result.claimedAt = value;
		} else errors.push(redact(String(claim.reason instanceof Error ? claim.reason.message : "Check-in status query failed"), account));
		if (errors.length) result.error = errors.join("; ");
		return result;
	}
	async claim(account, signal) {
		await this.json(account, "POST", `${BENEFIT_BASE}/api/v1/benefit/claim`, {}, signal);
	}
};
// src/stream.ts
const encoder = new TextEncoder();
function frame(value) {
	return encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
}
async function* sseEvents(reader) {
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let buffer = "";
	let data = [];
	let event = "";
	let eventBytes = 0;
	try {
		let ended = false;
		while (!ended) {
			const next = await reader.read();
			ended = next.done;
			buffer += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
			if (buffer.length + eventBytes > 8388608) throw new CodeArtsError("CodeArts stream event is too large");
			let match;
			while ((match = /\r\n|\r|\n/u.exec(buffer)) !== null) {
				if (!ended && match[0] === "\r" && match.index === buffer.length - 1) break;
				const line = buffer.slice(0, match.index);
				buffer = buffer.slice(match.index + match[0].length);
				if (line === "") {
					if (data.length) yield {
						data: data.join("\n"),
						event
					};
					data = [];
					event = "";
					eventBytes = 0;
				} else if (line.startsWith("data:")) {
					const value = line.slice(5).replace(/^ /u, "");
					data.push(value);
					eventBytes += value.length;
				} else if (line.startsWith("event:")) event = line.slice(6).trim();
			}
		}
		if (buffer.startsWith("data:")) data.push(buffer.slice(5).replace(/^ /u, ""));
		if (data.length) yield {
			data: data.join("\n"),
			event
		};
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
async function* normalizeSse(reader, model, account) {
	let tools = false;
	let finished = false;
	let meaningful = false;
	let id = "codearts";
	const finish = () => frame({
		id,
		object: "chat.completion.chunk",
		model: model.id,
		choices: [{
			index: 0,
			delta: {},
			finish_reason: tools ? "tool_calls" : "stop"
		}]
	});
	for await (const event of sseEvents(reader)) {
		if (event.data.trim() === "[DONE]") {
			if (!finished && !meaningful) throw new CodeArtsError("CodeArts returned an empty stream");
			if (!finished) yield finish();
			yield encoder.encode("data: [DONE]\n\n");
			return;
		}
		let parsed;
		try {
			parsed = JSON.parse(event.data);
		} catch {
			throw new CodeArtsError("CodeArts returned invalid SSE JSON");
		}
		const chunk = object(parsed);
		const error = businessError(chunk);
		if (error || event.event === "error") {
			const message = redact(error?.message ?? "CodeArts stream failed", account);
			throw new CodeArtsError(message, businessStatus(message), error?.code);
		}
		if (!chunk) throw new CodeArtsError("CodeArts returned an invalid SSE event");
		if (typeof chunk["id"] === "string") id = chunk["id"];
		if (Array.isArray(chunk["choices"])) for (const raw of chunk["choices"]) {
			const choice = object(raw);
			if (!choice) throw new CodeArtsError("CodeArts returned an invalid stream choice");
			const delta = object(choice["delta"]);
			if (Array.isArray(delta?.["tool_calls"]) && delta["tool_calls"].length > 0) tools = true;
			if (tools || typeof delta?.["content"] === "string" && delta["content"] !== "" || typeof delta?.["reasoning_content"] === "string" && delta["reasoning_content"] !== "") meaningful = true;
			const reason = choice["finish_reason"];
			if (reason != null) {
				if (reason === "other" || reason === "stop" && tools) choice["finish_reason"] = tools ? "tool_calls" : "stop";
				finished = true;
			}
		}
		chunk["model"] = model.id;
		yield frame(chunk);
	}
	if (!finished) throw new CodeArtsError("CodeArts stream ended before a completion signal; response may be incomplete", 502, "stream_truncated");
	yield encoder.encode("data: [DONE]\n\n");
}
function asStream(iterator, cancel, onFailure) {
	return new ReadableStream({
		async pull(controller) {
			try {
				const next = await iterator.next();
				if (next.done) controller.close();
				else controller.enqueue(next.value);
			} catch (error) {
				if (error instanceof CodeArtsError) onFailure?.(error);
				controller.error(error);
			}
		},
		async cancel() {
			await cancel();
			await iterator.return(void 0);
		}
	});
}
async function normalizeResponse(response, model, account, onFailure) {
	if (!response.ok) {
		const error = businessError(await response.json().catch(() => void 0));
		onFailure?.(new CodeArtsError(redact(error?.message ?? `CodeArts HTTP ${response.status}`, account), response.status, error?.code), response.headers.get("retry-after"));
		return new Response(JSON.stringify({ error: {
			message: redact(error?.message ?? `CodeArts HTTP ${response.status}`, account),
			type: "codearts_error",
			code: error?.code ?? `http_${response.status}`
		} }), {
			status: response.status,
			headers: {
				"content-type": "application/json",
				...response.headers.has("retry-after") ? { "retry-after": response.headers.get("retry-after") } : {}
			}
		});
	}
	if ((response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream")) {
		if (!response.body) throw new CodeArtsError("CodeArts returned an empty stream");
		const reader = response.body.getReader();
		return new Response(asStream(normalizeSse(reader, model, account), () => reader.cancel(), onFailure), { headers: { "content-type": "text/event-stream" } });
	}
	const data = await response.json().catch(() => void 0);
	const error = businessError(data);
	if (error) {
		const message = redact(error.message, account);
		onFailure?.(new CodeArtsError(message, businessStatus(message), error.code));
		return new Response(JSON.stringify({ error: {
			message,
			code: error.code,
			type: "codearts_error"
		} }), {
			status: businessStatus(message),
			headers: { "content-type": "application/json" }
		});
	}
	const result = object(data);
	if (!result || !Array.isArray(result["choices"]) || !result["choices"].length) throw new CodeArtsError("CodeArts returned an invalid completion");
	const choices = result["choices"].map((value) => {
		const choice = object(value);
		const message = object(choice?.["message"]);
		if (!choice || !message) throw new CodeArtsError("CodeArts completion is missing its message");
		const delta = { ...message };
		if (Array.isArray(message["tool_calls"])) delta["tool_calls"] = message["tool_calls"].map((call, index) => ({
			...object(call),
			index
		}));
		const tools = Array.isArray(message["tool_calls"]) && message["tool_calls"].length > 0;
		const reason = choice["finish_reason"];
		return {
			index: choice["index"] ?? 0,
			delta,
			finish_reason: reason == null || reason === "other" || reason === "stop" && tools ? tools ? "tool_calls" : "stop" : reason
		};
	});
	const chunk = {
		...result,
		object: "chat.completion.chunk",
		model: model.id,
		choices
	};
	return new Response(new Blob([frame(chunk), encoder.encode("data: [DONE]\n\n")]), { headers: { "content-type": "text/event-stream" } });
}
function createChatFetch(client, account, models, onFailure) {
	return async (input, init) => {
		if (new URL(input instanceof Request ? input.url : String(input)).href !== "https://snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions" || init?.method?.toUpperCase() !== "POST" || typeof init.body !== "string") throw new CodeArtsError("Unsupported CodeArts chat request", 400);
		const payload = object(JSON.parse(init.body));
		const model = models.find((m) => m.id === payload?.["model"]);
		if (!payload || !model) throw new CodeArtsError("This model is not available for the selected account", 404, "model_not_found");
		payload["model"] = model.upstreamId;
		payload["stream"] = true;
		const extra = {
			...attributionHeaders(),
			...model.channel === "benefit" ? {
				maas_type: "benefit",
				"model-id": model.upstreamId,
				"model-name": model.upstreamId
			} : {}
		};
		try {
			return await normalizeResponse(await client.request(account, "POST", CHAT_URL, encoder.encode(JSON.stringify(payload)), extra, init.signal ?? void 0, 6e5), model, account, onFailure);
		} catch (error) {
			if (error instanceof CodeArtsError) onFailure?.(error);
			throw error;
		}
	};
}
// src/types.ts
const PROVIDER_ID = "codearts";
const ENTRY_ID = "llm-codearts";
const STATUS_PATH = "/api/codearts/status";
const ACTION_PATH = "/api/codearts/action";
// src/adapter.ts
const RETRY_POLICY = resolveRetryPolicy(void 0, "CodeArts retry policy");
function piAdapter(snapshot, options, onFailure) {
	const base = openAICompletionsApi();
	const models = snapshot.models.map((info) => ({
		id: info.id,
		name: `${info.name} · ${info.channel === "agent" ? "CodeArts" : "CodeArts Benefit"}`,
		api: "openai-completions",
		provider: PROVIDER_ID,
		baseUrl: `${SNAP_BASE}/api/v2`,
		input: info.supportsImages ? ["text", "image"] : ["text"],
		reasoning: false,
		contextWindow: info.contextWindow,
		maxTokens: info.maxTokens,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0
		},
		compat: {
			maxTokensField: "max_tokens",
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false
		}
	}));
	const account = snapshot.account;
	const fetcher = account === void 0 ? async () => {
		throw new Error("No CodeArts account is selected");
	} : createChatFetch(options.client, { ...account }, snapshot.models, onFailure);
	const provider = createProvider({
		id: PROVIDER_ID,
		name: "CodeArts",
		models,
		api: {
			stream: (model, context, streamOptions) => base.stream(model, context, {
				...streamOptions,
				fetch: fetcher
			}),
			streamSimple: (model, context, streamOptions) => base.streamSimple(model, context, {
				...streamOptions,
				fetch: fetcher
			})
		},
		auth: { apiKey: {
			name: "CodeArts managed credentials",
			async resolve({ credential }) {
				return credential?.key ? {
					auth: { apiKey: credential.key },
					source: "CodeArts"
				} : void 0;
			}
		} }
	});
	const profiles = /* @__PURE__ */ new Map([[PROVIDER_ID, {
		provider: PROVIDER_ID,
		displayName: "CodeArts",
		piProvider: provider,
		streamIdleTimeoutMs: 3e5,
		retryPolicy: RETRY_POLICY,
		configuredMaxTokens: /* @__PURE__ */ new Map(),
		modelErrors: /* @__PURE__ */ new Map(),
		maxRequestImageBytes: 20971520,
		requestImagePixelBudget: 4194304,
		requestImageMaxBytes: 1048576
	}]]);
	return new PiAiAdapter({
		profiles: () => profiles,
		auth: {
			credentials: {
				async read() {},
				async list() {
					return [];
				},
				async modify() {
					throw new Error("CodeArts credentials are managed by the CodeArts settings page");
				},
				async delete() {}
			},
			authContext: {
				async env() {},
				async fileExists() {
					return false;
				}
			}
		},
		resolveApiKey: async () => "codearts-managed",
		...options.resolveAttachments ? { resolveAttachments: options.resolveAttachments } : {},
		...options.resolveImageAccess ? { resolveImageAccess: options.resolveImageAccess } : {}
	});
}
function failureCode(status) {
	if (status === 401) return "AUTH";
	if (status === 403) return "PERMISSION_DENIED";
	if (status === 402) return QUOTA_EXCEEDED_CODE;
	if (status === 429) return "RATE_LIMIT";
	if (status === 504) return "TIMEOUT";
	return status >= 500 ? "SERVER" : "INVALID_REQUEST";
}
var CodeArtsAdapter = class extends LlmAdapter {
	options;
	constructor(options) {
		super();
		this.options = options;
	}
	providerInfo() {
		return {
			id: PROVIDER_ID,
			name: "CodeArts"
		};
	}
	providerRetryPolicy() {
		return RETRY_POLICY;
	}
	call() {
		let failure;
		const adapter = piAdapter(this.options.snapshot(), this.options, (error, retryAfter) => {
			const delay = retryAfter == null ? NaN : /^\d+(?:\.\d+)?$/u.test(retryAfter.trim()) ? Number(retryAfter) * 1e3 : Date.parse(retryAfter) - Date.now();
			failure = {
				message: error.message,
				code: error.code === "stream_truncated" ? "TRANSPORT" : failureCode(error.status),
				status: error.status,
				...Number.isFinite(delay) && delay > 0 ? { providerRetryAfterMs: delay } : {}
			};
		});
		async function* wrap(source) {
			for await (const chunk of source) if (chunk.type === "finish" && chunk.reason.kind === "error" && failure) yield {
				...chunk,
				reason: {
					kind: "error",
					failure
				}
			};
			else yield chunk;
		}
		return {
			adapter,
			wrap
		};
	}
	listModels(provider) {
		return this.call().adapter.listModels(provider);
	}
	resolveModel(provider, model, signal) {
		return this.call().adapter.resolveModel(provider, model, signal);
	}
	imageRequestTarget(provider, model, image) {
		return this.call().adapter.imageRequestTarget(provider, model, image);
	}
	async prepareCall(provider, model, signal) {
		const { adapter, wrap } = this.call();
		const prepared = await adapter.prepareCall(provider, model, signal);
		return {
			model: prepared.model,
			stream: (options) => wrap(prepared.stream(options))
		};
	}
	stream(options) {
		const { adapter, wrap } = this.call();
		return wrap(adapter.stream(options));
	}
};
function createCodeArtsAdapter(options) {
	return new CodeArtsAdapter(options);
}
// src/routes.ts
const LOOPBACK = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"localhost",
	"[::1]"
]);
function trustedRequest(req) {
	const host = req.headers.host;
	if (!host) return false;
	try {
		const url = new URL(`http://${host}`);
		if (!LOOPBACK.has(url.hostname) || url.username || url.password || url.pathname !== "/" || url.host.toLowerCase() !== host.trim().toLowerCase()) return false;
		const origin = req.headers.origin;
		if (origin !== void 0) {
			const parsed = new URL(origin);
			if (!["http:", "https:"].includes(parsed.protocol) || !LOOPBACK.has(parsed.hostname)) return false;
			if (parsed.host.toLowerCase() !== url.host.toLowerCase()) return false;
		}
		return true;
	} catch {
		return false;
	}
}
function parseAction(value) {
	const row = object(value);
	if (!row) throw new CodeArtsError("Invalid action", 400);
	const action = row["action"];
	if (action === "save") {
		const label = text(row["label"]);
		if (!label || label.length > 100) throw new CodeArtsError("Account name must contain 1–100 characters", 400);
		for (const key of [
			"id",
			"ak",
			"sk"
		]) if (row[key] !== void 0 && (typeof row[key] !== "string" || row[key].length > 1024)) throw new CodeArtsError("Invalid account fields", 400);
		return {
			action,
			label,
			...row["id"] === void 0 ? {} : { id: String(row["id"]) },
			...row["ak"] === void 0 ? {} : { ak: String(row["ak"]) },
			...row["sk"] === void 0 ? {} : { sk: String(row["sk"]) }
		};
	}
	if ((action === "remove" || action === "select") && text(row["id"])) return {
		action,
		id: String(row["id"])
	};
	if ((action === "refresh" || action === "claim") && text(row["accountId"])) return {
		action,
		accountId: String(row["accountId"])
	};
	throw new CodeArtsError("Invalid action", 400);
}
function json(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end(body);
}
async function readBody(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 16384) {
				reject(new CodeArtsError("Request body too large", 413));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(new CodeArtsError("Invalid JSON body", 400));
			}
		});
		req.on("error", () => reject(new CodeArtsError("Request body could not be read", 400)));
	});
}
function createRoutes(runtime) {
	const token = randomBytes(32).toString("base64url");
	const handler = async (req, res) => {
		try {
			if (!trustedRequest(req)) {
				json(res, 403, { error: "Request origin is not allowed" });
				return;
			}
			const path = (req.url ?? "").split("?")[0];
			if (path === "/api/codearts/status" && req.method === "GET") {
				json(res, 200, await runtime.status(token));
				return;
			}
			if (path !== "/api/codearts/action") {
				json(res, 404, { error: "Unknown CodeArts route" });
				return;
			}
			if (req.method !== "POST") {
				json(res, 405, { error: "POST is required" });
				return;
			}
			if (req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
				json(res, 415, { error: "application/json is required" });
				return;
			}
			const provided = req.headers["x-codearts-action-token"];
			if (typeof provided !== "string" || Buffer.byteLength(provided) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(provided), Buffer.from(token))) {
				json(res, 403, { error: "Invalid action token; reload this page" });
				return;
			}
			await runtime.action(parseAction(await readBody(req)));
			json(res, 200, { ok: true });
		} catch (error) {
			json(res, error instanceof CodeArtsError ? error.status : 400, { error: error instanceof Error ? error.message : "CodeArts operation failed" });
		}
	};
	return {
		token,
		handler
	};
}
// src/runtime.ts
const CHANNELS = ["agent", "benefit"];
const emptyCatalog = () => ({
	agent: {
		models: [],
		issues: []
	},
	benefit: {
		models: [],
		issues: []
	}
});
const identity = (account) => createHash("sha256").update(JSON.stringify([
	account.id,
	account.ak,
	account.sk
])).digest("hex");
var CodeArtsRuntime = class {
	accounts;
	client;
	now;
	state = {
		version: 1,
		accounts: [],
		activeId: null
	};
	currentIdentity;
	currentCatalog = emptyCatalog();
	currentBenefit = {};
	currentSnapshot = {
		account: void 0,
		models: []
	};
	catalogs = /* @__PURE__ */ new Map();
	benefits = /* @__PURE__ */ new Map();
	inflight = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Set();
	controller = new AbortController();
	syncGeneration = 0;
	closed = false;
	constructor(accounts, client, now = Date.now) {
		this.accounts = accounts;
		this.client = client;
		this.now = now;
	}
	snapshot() {
		return this.currentSnapshot;
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	publish() {
		this.currentSnapshot = {
			account: this.currentSnapshot.account,
			models: CHANNELS.flatMap((c) => this.currentCatalog[c].models)
		};
		for (const listener of this.listeners) listener();
	}
	async sync() {
		const generation = ++this.syncGeneration;
		let state;
		try {
			state = await this.accounts.read();
		} catch (error) {
			if (!this.closed && generation === this.syncGeneration) {
				this.state = {
					version: 1,
					accounts: [],
					activeId: null
				};
				this.currentIdentity = void 0;
				this.currentSnapshot = {
					account: void 0,
					models: []
				};
				this.currentCatalog = emptyCatalog();
				this.currentBenefit = {};
				this.publish();
			}
			throw error;
		}
		if (this.closed || generation !== this.syncGeneration) return;
		this.state = state;
		const account = state.accounts.find((a) => a.id === state.activeId);
		const key = account === void 0 ? void 0 : identity(account);
		if (key === this.currentIdentity) return;
		this.currentIdentity = key;
		this.currentSnapshot = {
			account,
			models: []
		};
		this.currentCatalog = emptyCatalog();
		this.currentBenefit = key === void 0 ? {} : this.benefits.get(key)?.value ?? {};
		if (key) for (const channel of CHANNELS) this.currentCatalog[channel] = this.catalogs.get(`${key}/${channel}`) ?? {
			models: [],
			issues: []
		};
		this.publish();
	}
	join(key, run) {
		const existing = this.inflight.get(key);
		if (existing) return existing;
		const promise = run().finally(() => {
			this.inflight.delete(key);
		});
		this.inflight.set(key, promise);
		return promise;
	}
	async refresh(force = false, expectedAccount) {
		if (this.closed) return;
		const account = this.currentSnapshot.account;
		if (expectedAccount !== void 0 && account?.id !== expectedAccount) throw new Error("The selected account changed; refresh this page and try again");
		if (!account) return;
		const key = identity(account);
		await Promise.all([...CHANNELS.map((channel) => this.join(`${key}/${channel}`, async () => {
			const cacheKey = `${key}/${channel}`;
			const previous = this.catalogs.get(cacheKey);
			if (!force && previous?.fetchedAt !== void 0 && this.now() - previous.fetchedAt < 3e5) return;
			let value;
			try {
				value = {
					...await this.client.models(account, channel, this.controller.signal),
					fetchedAt: this.now()
				};
			} catch (error) {
				value = {
					models: previous?.models ?? [],
					issues: previous?.issues ?? [],
					...previous?.fetchedAt === void 0 ? {} : { fetchedAt: previous.fetchedAt },
					error: redact(error instanceof Error ? error.message : "Model discovery failed", account)
				};
			}
			if (this.closed) return;
			this.catalogs.set(cacheKey, value);
			if (key === this.currentIdentity) {
				this.currentCatalog = {
					...this.currentCatalog,
					[channel]: value
				};
				this.publish();
			}
		})), this.join(`${key}/balance`, async () => {
			const previous = this.benefits.get(key);
			if (!force && previous && this.now() - previous.at < 6e4) return;
			const value = await this.client.benefit(account, this.controller.signal).catch((error) => ({ error: redact(error instanceof Error ? error.message : "Balance query failed", account) }));
			if (this.closed) return;
			this.benefits.set(key, {
				value,
				at: this.now()
			});
			if (key === this.currentIdentity) this.currentBenefit = value;
		})]);
	}
	async action(action) {
		if (this.closed) throw new Error("CodeArts plugin is stopping");
		switch (action.action) {
			case "save":
				await this.accounts.save(action);
				break;
			case "select":
				await this.accounts.select(action.id);
				break;
			case "remove":
				await this.accounts.remove(action.id);
				break;
			case "refresh":
				await this.sync();
				await this.refresh(true, action.accountId);
				return;
			case "claim": {
				await this.sync();
				const account = this.currentSnapshot.account;
				if (!account || account.id !== action.accountId) throw new Error("The selected account changed; refresh this page and try again");
				const key = identity(account);
				await this.join(`${key}/claim`, async () => {
					await this.client.claim(account, this.controller.signal);
					await this.inflight.get(`${key}/balance`);
					this.benefits.delete(key);
					if (key === this.currentIdentity) await this.refresh(false, account.id);
				});
				return;
			}
		}
		await this.sync();
		await this.refresh();
	}
	async status(actionToken) {
		await this.sync();
		return {
			accounts: publicAccounts(this.state),
			activeId: this.state.activeId,
			catalog: this.currentCatalog,
			benefit: this.currentBenefit,
			actionToken
		};
	}
	close() {
		this.closed = true;
		this.controller.abort(/* @__PURE__ */ new Error("CodeArts plugin stopped"));
		this.listeners.clear();
		this.catalogs.clear();
		this.benefits.clear();
		this.state = {
			version: 1,
			accounts: [],
			activeId: null
		};
		this.currentSnapshot = {
			account: void 0,
			models: []
		};
	}
};
// src/index.ts
const name = "dsh-connect-codearts";
const inject = ["llm", "credentials"];
const Config = z.object({});
function apply(ctx) {
	const runtime = new CodeArtsRuntime(new Accounts(ctx.credentials), new CodeArtsClient());
	const adapter = createCodeArtsAdapter({
		snapshot: () => runtime.snapshot(),
		client: runtime.client,
		resolveAttachments: () => ctx.get("attachments"),
		resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, (hostPath) => {
			return ctx.get("fs")?.processPathFromHostPath(hostPath);
		}, ref)
	});
	ctx.effect(() => ctx.llm.registerAdapter([PROVIDER_ID], adapter));
	ctx.effect(() => ctx.llm.registerConfigurableProviders([{
		provider: PROVIDER_ID,
		displayName: "CodeArts",
		settingsNs: ENTRY_ID,
		settingsPath: []
	}]));
	ctx.effect(() => runtime.subscribe(() => ctx.emit("llm/adapters-updated")));
	const refresh = async () => {
		try {
			await runtime.sync();
			await runtime.refresh();
		} catch {
			ctx.logger.warn("CodeArts account state could not be loaded; check the credential store");
		}
	};
	ctx.on("credentials/record-updated", (key) => {
		if (key === ACCOUNTS_KEY) refresh();
	});
	ctx.inject(["webServer"], (web) => {
		const routes = createRoutes(runtime);
		for (const path of [STATUS_PATH, ACTION_PATH]) web.effect(() => web.webServer.register({
			kind: "exact",
			path,
			handler: routes.handler
		}));
	});
	ctx.effect(() => {
		refresh();
		const timer = setInterval(() => {
			refresh();
		}, 6e4);
		timer.unref();
		return () => {
			clearInterval(timer);
			runtime.close();
		};
	});
}
export { Config, apply, inject, name };
