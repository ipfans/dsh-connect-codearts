import { LlmAdapter, LlmError, QUOTA_EXCEEDED_CODE, ReasoningEffortId, attributionHeaders, resolveImageAttachmentAccess, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import { createECDH, createHash, createHmac, createPrivateKey, generateKeyPairSync, randomBytes, randomUUID, sign, timingSafeEqual } from "node:crypto";
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import { createServer } from "node:http";
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
// src/oauth.ts
const TOKEN_URL = "https://sts.cn-north-4.myhuaweicloud.com/v1/oauth2/tokens";
const PORTAL_URL = "https://codearts.huaweicloud.com/portal/authorize";
const CLIENT_ID = "codearts-agent";
const LOGIN_TTL = 9e5;
var OAuthError = class extends Error {};
var LoginRequiredError = class extends OAuthError {
	constructor() {
		super("CodeArts authorization expired or was rejected; sign in again");
	}
};
function validPrivateKey(value) {
	const key = object(value);
	if (key?.["kty"] !== "EC" || key["crv"] !== "P-256") return false;
	if (![
		"x",
		"y",
		"d"
	].every((field) => typeof key[field] === "string" && /^[A-Za-z0-9_-]{43}$/u.test(key[field]))) return false;
	try {
		const pair = createECDH("prime256v1");
		pair.setPrivateKey(Buffer.from(String(key["d"]), "base64url"));
		const publicKey = pair.getPublicKey();
		return publicKey.subarray(1, 33).toString("base64url") === key["x"] && publicKey.subarray(33).toString("base64url") === key["y"];
	} catch {
		return false;
	}
}
function dpopProof(privateKey, now = Date.now()) {
	if (!validPrivateKey(privateKey)) throw new OAuthError("Invalid saved OAuth proof key; sign in again");
	const { kty, crv, x, y } = privateKey;
	const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const input = `${encode({
		alg: "ES256",
		typ: "dpop+jwt",
		jwk: {
			kty,
			crv,
			x,
			y
		}
	})}.${encode({
		htm: "POST",
		htu: TOKEN_URL,
		iat: Math.floor(now / 1e3),
		jti: randomUUID()
	})}`;
	const signature = sign("sha256", Buffer.from(input), {
		key: createPrivateKey({
			key: privateKey,
			format: "jwk"
		}),
		dsaEncoding: "ieee-p1363"
	});
	const order = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
	const s = BigInt(`0x${signature.subarray(32).toString("hex")}`);
	if (s > order / 2n) Buffer.from((order - s).toString(16).padStart(64, "0"), "hex").copy(signature, 32);
	return `${input}.${signature.toString("base64url")}`;
}
function tokenString(value) {
	return typeof value === "string" && value.length > 0 && value.length <= 32768 && /^[\x21-\x7e]+$/u.test(value);
}
var OAuthClient = class {
	fetcher;
	now;
	constructor(fetcher = globalThis.fetch, now = Date.now) {
		this.fetcher = fetcher;
		this.now = now;
	}
	async exchange(code, verifier, port, privateKey, signal) {
		return this.tokens(new URLSearchParams({
			client_id: CLIENT_ID,
			code,
			code_verifier: verifier,
			grant_type: "authorization_code",
			redirect_uri: `http://127.0.0.1:${port}/oauth/callback`
		}), {
			clientId: CLIENT_ID,
			verifier,
			privateKey,
			loginId: randomUUID()
		}, signal);
	}
	async refresh(credentials, signal) {
		const grant = credentials.oauth;
		return this.tokens(new URLSearchParams({
			client_id: grant.clientId,
			code_verifier: grant.verifier,
			grant_type: "refresh_token",
			refresh_token: grant.refreshToken
		}), grant, signal);
	}
	async tokens(form, binding, signal) {
		let response;
		try {
			response = await this.fetcher(TOKEN_URL, {
				method: "POST",
				redirect: "error",
				body: form.toString(),
				headers: {
					"content-type": "application/x-www-form-urlencoded",
					dpop: dpopProof(binding.privateKey, this.now())
				},
				signal: AbortSignal.any([AbortSignal.timeout(3e4), ...signal ? [signal] : []])
			});
		} catch {
			throw new OAuthError(signal?.aborted ? "CodeArts authorization was cancelled" : "CodeArts token request failed; check connectivity and retry");
		}
		const data = object(await response.json().catch(() => void 0));
		const errorCode = data?.["error_code"];
		if (!response.ok || data?.["error"] || errorCode != null && !["0", "0000"].includes(String(errorCode))) {
			const reason = [
				data?.["error"],
				errorCode,
				data?.["error_msg"]
			].join(" ");
			if (form.get("grant_type") === "refresh_token" && /invalid_grant|ExpiredRefreshToken|InvalidDPoPHeader|invalid client id|has been used|refresh.token.*expired/iu.test(reason)) throw new LoginRequiredError();
			throw new OAuthError(`CodeArts token exchange failed (HTTP ${response.status}); retry authorization`);
		}
		const credentials = object(data?.["credentials"]);
		const ak = credentials?.["access_key_id"], sk = credentials?.["secret_access_key"], securityToken = credentials?.["security_token"];
		const refreshToken = data?.["refresh_token"];
		const expiresAt = Date.parse(String(credentials?.["expiration"] ?? ""));
		let userId = text(data?.["user_id"]) ?? binding.userId;
		let domainId = text(data?.["domain_id"]) ?? binding.domainId;
		let userName = text(data?.["user_name"]) ?? binding.userName;
		if (!tokenString(ak) || !tokenString(sk) || !tokenString(securityToken) || !tokenString(refreshToken) || !Number.isFinite(expiresAt) || expiresAt <= this.now()) throw new OAuthError("CodeArts returned incomplete OAuth credentials; sign in again");
		if (!userId || !domainId) ({userId, domainId, userName} = await this.identity(ak, sk, securityToken, signal));
		userName ??= userId;
		if (binding.userId && binding.userId !== userId || binding.domainId && binding.domainId !== domainId) throw new OAuthError("CodeArts token renewal returned a different account; sign in again");
		return {
			ak,
			sk,
			oauth: {
				loginId: binding.loginId,
				clientId: binding.clientId,
				verifier: binding.verifier,
				privateKey: binding.privateKey,
				userId,
				domainId,
				userName,
				securityToken,
				refreshToken,
				expiresAt
			}
		};
	}
	async identity(ak, sk, securityToken, signal) {
		for (const target of ["https://sts.cn-north-4.myhuaweicloud.com/v5/caller-identity", "https://snap-access.cn-north-4.myhuaweicloud.com/snap-manager/v1/current/user"]) try {
			const url = new URL(target);
			const headers = signRequest({
				ak,
				sk
			}, "GET", url, /* @__PURE__ */ new Uint8Array(), {
				"x-security-token": securityToken,
				"x-language": "zh-cn"
			});
			const response = await this.fetcher(url, {
				headers,
				redirect: "error",
				signal: AbortSignal.any([AbortSignal.timeout(3e4), ...signal ? [signal] : []])
			});
			const data = object(await response.json());
			const userId = text(data?.["principal_id"]) ?? text(data?.["user_id"]);
			const domainId = text(data?.["account_id"]) ?? text(data?.["domain_id"]);
			if (response.ok && userId && domainId) {
				const urn = text(data?.["principal_urn"]);
				return {
					userId,
					domainId,
					userName: text(data?.["user_name"]) ?? (urn?.includes(":user:") ? urn.split(":user:")[1] : userId)
				};
			}
		} catch {
			if (signal?.aborted) break;
		}
		throw new OAuthError("CodeArts could not verify the signed-in account identity; sign in again");
	}
};
var OAuthLogin = class {
	client;
	save;
	now;
	session;
	state = { state: "idle" };
	starting = false;
	constructor(client, save, now = Date.now) {
		this.client = client;
		this.save = save;
		this.now = now;
	}
	status() {
		return { ...this.state };
	}
	async start(accountId) {
		if (this.session || this.starting) throw new OAuthError("Finish or cancel the current login first");
		this.starting = true;
		const verifier = randomBytes(64).toString("base64url");
		const challenge = createHash("sha256").update(verifier).digest("base64url");
		const session = {
			server: createServer((req, res) => {
				this.callback(session, req, res);
			}),
			controller: new AbortController(),
			port: 0,
			ticket: randomBytes(16).toString("hex"),
			verifier,
			privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" }),
			exchanging: false,
			...accountId === void 0 ? {} : { accountId }
		};
		this.session = session;
		try {
			await new Promise((resolve, reject) => {
				session.server.once("error", reject);
				session.server.listen(0, "127.0.0.1", resolve);
			});
			if (this.session !== session) {
				session.server.close();
				return;
			}
			const address = session.server.address();
			if (!address || typeof address === "string") throw new OAuthError("Could not start the local OAuth callback");
			session.port = address.port;
			const url = new URL(PORTAL_URL);
			url.search = new URLSearchParams({
				theme: "2",
				locale: "zh-cn",
				uri_scheme: CLIENT_ID,
				client_id: CLIENT_ID,
				port: String(session.port),
				code_challenge: challenge,
				code_challenge_method: "SHA-256",
				ticket_id: session.ticket,
				"plugin-name": "snap_AIIDE",
				"plugin-version": "5.2.0"
			}).toString();
			this.state = {
				state: "pending",
				authUrl: url.href,
				expiresAt: this.now() + LOGIN_TTL,
				...accountId === void 0 ? {} : { accountId }
			};
			session.server.unref();
			session.timer = setTimeout(() => {
				this.finish(session, {
					state: "error",
					error: "CodeArts login expired; start again"
				});
			}, LOGIN_TTL);
			session.timer.unref();
		} catch {
			this.finish(session, {
				state: "error",
				error: "Could not start the local OAuth callback; retry login"
			});
			throw new OAuthError("Could not start the local OAuth callback; retry login");
		} finally {
			this.starting = false;
		}
	}
	cancel() {
		if (this.session) this.finish(this.session, { state: "idle" });
		else this.state = { state: "idle" };
	}
	finish(session, state) {
		if (this.session !== session) return;
		this.state = state;
		this.session = void 0;
		clearTimeout(session.timer);
		session.controller.abort();
		session.server.close();
		session.server.closeAllConnections();
	}
	async callback(session, req, res) {
		const reply = (status, message) => {
			res.writeHead(status, {
				"content-type": "text/plain; charset=utf-8",
				"cache-control": "no-store",
				"referrer-policy": "no-referrer",
				"content-security-policy": "default-src 'none'",
				"x-content-type-options": "nosniff"
			});
			res.end(message);
		};
		try {
			if (this.session !== session || this.now() >= (this.state.expiresAt ?? 0)) {
				reply(410, "Login expired.");
				return;
			}
			if (req.headers.host !== `127.0.0.1:${session.port}` || req.socket.remoteAddress !== "127.0.0.1") {
				reply(403, "Invalid callback host.");
				return;
			}
			if (req.headers.origin && req.headers.origin !== new URL("https://codearts.huaweicloud.com/portal/authorize").origin) {
				reply(403, "Invalid callback origin.");
				return;
			}
			const url = new URL(req.url ?? "/", `http://127.0.0.1:${session.port}`);
			if (url.pathname !== "/oauth/callback") {
				reply(404, "Unknown callback.");
				return;
			}
			if (req.method !== "GET") {
				reply(405, "GET is required.");
				return;
			}
			const ticket = url.searchParams.get("ticket_id");
			const secret = url.searchParams.get("secret");
			if (ticket && ticket !== session.ticket || session.secret && secret && secret !== session.secret) {
				reply(403, "Callback does not match this login.");
				return;
			}
			const code = url.searchParams.get("code");
			if (!code) {
				const next = new URL(url.searchParams.get("redirect") ?? "");
				if (!secret || secret.length > 1024 || next.origin !== new URL("https://codearts.huaweicloud.com/portal/authorize").origin || next.username || next.password || next.searchParams.get("ticket_id") !== session.ticket) {
					reply(403, "Invalid authorization redirect.");
					return;
				}
				session.secret = secret;
				res.writeHead(307, {
					location: next.href,
					"cache-control": "no-store",
					"referrer-policy": "no-referrer"
				});
				res.end();
				return;
			}
			if (!tokenString(code) || session.exchanging) {
				reply(409, "Authorization is already being processed.");
				return;
			}
			session.exchanging = true;
			let credentials;
			try {
				credentials = await this.client.exchange(code, session.verifier, session.port, session.privateKey, session.controller.signal);
			} catch (error) {
				session.exchanging = false;
				if (this.session === session) this.state = {
					...this.state,
					error: error instanceof OAuthError ? error.message : "CodeArts authorization failed; retry login"
				};
				reply(400, "Authorization code was rejected. Return to CodeArts settings and retry login.");
				return;
			}
			if (this.session !== session) {
				reply(410, "Login cancelled.");
				return;
			}
			await this.save(credentials, session.accountId, session.controller.signal);
			reply(200, "CodeArts login completed. You can close this page and return to DeepSeek Harness. 登录完成，可以关闭此页面。");
			res.once("finish", () => {
				this.finish(session, { state: "complete" });
			});
		} catch {
			if (!res.headersSent) reply(400, "Could not complete login. Return to CodeArts settings and retry.");
			if (session.exchanging) this.finish(session, {
				state: "error",
				error: "Could not save OAuth credentials; sign in again"
			});
		}
	}
};
// src/accounts.ts
const ACCOUNTS_KEY = credentialKey("dsh-connect-codearts", "accounts");
const emptyAccounts = () => ({
	version: 2,
	accounts: [],
	activeId: null,
	autoClaim: true
});
const accountIdentity = (account) => `${account.id}:${account.oauth?.loginId ?? "legacy"}`;
var AccountDataError = class extends Error {};
function parseState(record) {
	if (record === void 0) return emptyAccounts();
	const wrapped = object(record);
	const payload = object(wrapped?.["payload"]);
	if (wrapped?.["kind"] !== "grant" || ![1, 2].includes(Number(payload?.["version"])) || !Array.isArray(payload?.["accounts"])) throw new AccountDataError("CodeArts credential record is invalid; existing data was preserved");
	const accounts = [];
	for (const value of payload["accounts"]) {
		const row = object(value);
		if (!row || ![
			"id",
			"label",
			"ak",
			"sk"
		].every((key) => text(row[key]))) throw new AccountDataError("CodeArts credential record contains an invalid account");
		let oauth;
		if (payload["version"] === 2 && row["oauth"] !== void 0) {
			const grant = object(row["oauth"]);
			if (!grant || ![
				"loginId",
				"userId",
				"domainId",
				"userName",
				"securityToken",
				"refreshToken",
				"clientId",
				"verifier"
			].every((key) => text(grant[key])) || typeof grant["expiresAt"] !== "number" || !Number.isFinite(grant["expiresAt"]) || grant["expiresAt"] <= 0 || !validPrivateKey(grant["privateKey"]) || grant["needsLogin"] !== void 0 && typeof grant["needsLogin"] !== "boolean") throw new AccountDataError("CodeArts credential record contains invalid OAuth credentials");
			oauth = {
				loginId: String(grant["loginId"]),
				userId: String(grant["userId"]),
				domainId: String(grant["domainId"]),
				userName: String(grant["userName"]),
				securityToken: String(grant["securityToken"]),
				refreshToken: String(grant["refreshToken"]),
				clientId: String(grant["clientId"]),
				verifier: String(grant["verifier"]),
				expiresAt: grant["expiresAt"],
				privateKey: grant["privateKey"],
				...grant["needsLogin"] === true ? { needsLogin: true } : {}
			};
		}
		accounts.push({
			id: String(row["id"]),
			label: String(row["label"]),
			ak: String(row["ak"]),
			sk: String(row["sk"]),
			...oauth ? { oauth } : {}
		});
	}
	if (new Set(accounts.map((a) => a.id)).size !== accounts.length) throw new AccountDataError("CodeArts credential record contains duplicate accounts");
	const activeId = payload["activeId"];
	if (activeId !== null && (typeof activeId !== "string" || !accounts.some((a) => a.id === activeId))) throw new AccountDataError("CodeArts credential record has an invalid selected account");
	if (payload["version"] === 2 && typeof payload["autoClaim"] !== "boolean") throw new AccountDataError("CodeArts credential record contains invalid preferences");
	return {
		version: 2,
		accounts,
		activeId,
		autoClaim: payload["version"] === 1 ? true : payload["autoClaim"] === true
	};
}
function publicAccounts(state) {
	return state.accounts.map(({ id, label, oauth }) => ({
		id,
		label,
		authState: !oauth ? "legacy" : oauth.needsLogin ? "login-required" : "ready",
		benefits: {},
		...oauth ? {
			userName: oauth.userName,
			expiresAt: oauth.expiresAt
		} : {}
	}));
}
var Accounts = class {
	credentials;
	now;
	refreshing = /* @__PURE__ */ new Map();
	unsaved = /* @__PURE__ */ new Map();
	constructor(credentials, now = Date.now) {
		this.credentials = credentials;
		this.now = now;
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
				if (await mutate(state) === false) return void 0;
				return {
					kind: "grant",
					payload: JSON.parse(JSON.stringify(state))
				};
			});
		} catch (error) {
			if (error instanceof AccountDataError || error instanceof OAuthError) throw error;
			throw new Error("CodeArts credential storage could not be updated");
		}
	}
	async login(credentials, id, signal) {
		await this.change((state) => {
			if (signal?.aborted) throw new OAuthError("CodeArts login was cancelled");
			const sameUser = state.accounts.find((a) => a.oauth?.userId === credentials.oauth.userId && a.oauth.domainId === credentials.oauth.domainId);
			const previous = id === void 0 ? sameUser : state.accounts.find((a) => a.id === id);
			if (id !== void 0 && !previous) throw new AccountDataError("Account no longer exists");
			if (sameUser && previous && sameUser.id !== previous.id) throw new AccountDataError("This Huawei account is already saved; sign in from its existing entry");
			if (previous?.oauth && (previous.oauth.userId !== credentials.oauth.userId || previous.oauth.domainId !== credentials.oauth.domainId)) throw new AccountDataError("Sign in with the same Huawei account, or add a new account");
			const account = {
				...credentials,
				id: previous?.id ?? randomUUID(),
				label: previous?.label ?? credentials.oauth.userName
			};
			if (previous) state.accounts[state.accounts.indexOf(previous)] = account;
			else state.accounts.push(account);
			if (!state.accounts.find((a) => a.id === state.activeId)?.oauth) state.activeId = account.id;
		});
	}
	async rename(id, value) {
		const label = value.trim();
		if (!label || label.length > 100) throw new AccountDataError("Account name must contain 1–100 characters");
		await this.change((state) => {
			this.find(state, id).label = label;
		});
	}
	async select(id) {
		await this.change((state) => {
			const account = this.find(state, id);
			if (!account.oauth || account.oauth.needsLogin) throw new LoginRequiredError();
			state.activeId = id;
		});
	}
	async remove(id) {
		await this.change((state) => {
			this.find(state, id);
			state.accounts = state.accounts.filter((a) => a.id !== id);
			if (state.activeId === id) state.activeId = null;
		});
		for (const key of this.unsaved.keys()) if (key.startsWith(`${id}:`)) this.unsaved.delete(key);
	}
	async setAutoClaim(enabled) {
		await this.change((state) => {
			state.autoClaim = enabled;
		});
	}
	find(state, id) {
		const account = state.accounts.find((a) => a.id === id);
		if (!account) throw new AccountDataError("Account no longer exists");
		return account;
	}
	async authorize(expected, refresh) {
		const key = accountIdentity(expected);
		const check = (state) => {
			const current = this.find(state, expected.id);
			if (accountIdentity(current) !== key) throw new AccountDataError("Account authorization changed; retry the request");
			if (!current.oauth || current.oauth.needsLogin) throw new LoginRequiredError();
			return current;
		};
		const current = check(await this.read());
		if (!this.unsaved.has(key) && current.oauth.expiresAt - this.now() > 6e5) return current;
		const running = this.refreshing.get(key);
		if (running) return running;
		const run = (async () => {
			let result;
			let failure;
			await this.change(async (state) => {
				const account = check(state);
				const pending = this.unsaved.get(key);
				if (!pending && account.oauth.expiresAt - this.now() > 6e5) {
					result = account;
					return false;
				}
				let renewed;
				try {
					renewed = pending ?? await refresh(account);
				} catch (error) {
					if (!(error instanceof LoginRequiredError)) throw error;
					account.oauth.needsLogin = true;
					failure = error;
					return;
				}
				this.unsaved.set(key, renewed);
				result = {
					...account,
					...renewed
				};
				state.accounts[state.accounts.indexOf(account)] = result;
			});
			this.unsaved.delete(key);
			if (failure) throw failure;
			return result;
		})().finally(() => {
			this.refreshing.delete(key);
		});
		this.refreshing.set(key, run);
		return run;
	}
};
// src/types.ts
const PROVIDER_ID = "codearts";
const ENTRY_ID = "llm-codearts";
const STATUS_PATH = "/api/codearts/status";
const ACTION_PATH = "/api/codearts/action";
const REASONING_EFFORTS = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
const FALLBACK_REASONING = {
	strengths: [
		"none",
		"low",
		"high",
		"max"
	],
	default_strength: "none"
};
// src/upstream.ts
const SNAP_BASE = "https://snap-access.cn-north-4.myhuaweicloud.com";
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
	for (const value of [
		account?.ak,
		account?.sk,
		account?.oauth?.securityToken,
		account?.oauth?.refreshToken,
		account?.oauth?.verifier,
		account?.oauth?.privateKey.d
	]) if (value) result = result.replaceAll(value, "[redacted]");
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
	if (/rate.limit|tpm.limit|concurren|限流|并发/iu.test(message)) return 429;
	if (/signature|unauthorized|authentication|access.?key|签名|认证/iu.test(message)) return 401;
	if (/permission|forbidden|权限/iu.test(message)) return 403;
	return 502;
}
function parseModels(rows) {
	const models = [];
	const issues = [];
	for (const value of rows) {
		const row = object(value);
		const id = text(row?.["model_id"]) ?? text(row?.["model_alias"]);
		if (!row || !id || !/^[\x21-\x7e]{1,256}$/u.test(id)) {
			issues.push("A model was skipped because its ID is missing or invalid");
			continue;
		}
		const params = object(row["model_parameters"]) ?? row;
		const contextWindow = params?.["context_window"];
		const maxTokens = params?.["max_tokens"];
		if (!positive(contextWindow) || !positive(maxTokens)) {
			issues.push(`${id}: context_window or max_tokens is missing or invalid`);
			continue;
		}
		if (models.some((m) => m.upstreamId === id)) continue;
		const rawCredit = row["credit"] ?? params["credit"];
		const rates = [...new Set((Array.isArray(rawCredit) ? rawCredit : [rawCredit]).map((item) => {
			const value = object(item)?.["ratio_display"];
			return typeof value === "number" ? value : typeof value === "string" && /^\d+(?:\.\d+)?x?$/u.test(value.trim()) ? Number(value.trim().replace(/x$/u, "")) : NaN;
		}).filter((value) => Number.isFinite(value) && value >= 0))];
		models.push({
			id: `agent/${id}`,
			upstreamId: id,
			name: text(row["model_alias"]) ?? text(row["model_name"]) ?? id,
			contextWindow,
			maxTokens: Math.min(maxTokens, contextWindow),
			supportsImages: params?.["supports_images"] === true,
			...rates.length ? { creditRates: rates } : {}
		});
	}
	return {
		models,
		issues
	};
}
var CodeArtsClient = class {
	fetcher;
	accounts;
	oauth;
	controller = new AbortController();
	constructor(fetcher = globalThis.fetch, accounts, oauth = new OAuthClient(fetcher)) {
		this.fetcher = fetcher;
		this.accounts = accounts;
		this.oauth = oauth;
	}
	async authorize(account) {
		try {
			if (!account.oauth || account.oauth.needsLogin) throw new LoginRequiredError();
			if (this.accounts) return await this.accounts.authorize(account, (credentials) => this.oauth.refresh(credentials, this.controller.signal));
			if (account.oauth.expiresAt <= Date.now()) throw new LoginRequiredError();
			return account;
		} catch (error) {
			throw new CodeArtsError(redact(error instanceof Error ? error.message : "CodeArts authorization failed", account), error instanceof LoginRequiredError ? 401 : 503, "authorization_error");
		}
	}
	close() {
		this.controller.abort();
	}
	async request(account, method, target, body = /* @__PURE__ */ new Uint8Array(), extra = {}, signal, timeoutMs = 3e4) {
		const url = new URL(target);
		if (url.origin !== "https://snap-access.cn-north-4.myhuaweicloud.com" || url.username || url.password) throw new CodeArtsError("CodeArts request destination is not allowed", 400);
		signal?.throwIfAborted();
		const current = await this.authorize(account);
		signal?.throwIfAborted();
		const headers = signRequest(current, method, url, body, {
			...extra,
			"x-security-token": current.oauth.securityToken
		});
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
	async json(account, method, target, extra = {}, signal, body) {
		const current = await this.authorize(account);
		const response = await this.request(current, method, target, body === void 0 ? /* @__PURE__ */ new Uint8Array() : new TextEncoder().encode(JSON.stringify(body)), extra, signal);
		const data = await response.json().catch(() => void 0);
		const error = businessError(data);
		if (!response.ok || error) {
			const message = redact(error?.message ?? `CodeArts HTTP ${response.status}`, current);
			throw new CodeArtsError(message, response.ok ? businessStatus(message) : response.status, error?.code);
		}
		const result = object(data);
		if (!result) throw new CodeArtsError("CodeArts returned an invalid JSON document");
		if (target.startsWith(`https://snap-access.cn-north-4.myhuaweicloud.com/v1/ops/`) && result["code"] !== 0) throw new CodeArtsError(redact(text(result["message"]) ?? "CodeArts credit activity failed or returned an invalid business code", current), 502);
		return result;
	}
	async models(account, signal) {
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
				let builtin = [];
				try {
					const data = await this.json(account, "GET", `${SNAP_BASE}/v1/model/builtin`, {
						...headers,
						"agent-type": "PromptCenter"
					}, signal);
					if (Array.isArray(data["builtinModels"])) builtin = data["builtinModels"].map(object).filter((row) => row !== void 0);
				} catch (error) {
					if (signal?.aborted) throw error;
					issues.push("Model credit metadata could not be refreshed");
				}
				const parsed = parseModels(rows.map((value) => {
					const row = object(value);
					const supplement = builtin.find((item) => item["model_id"] === row?.["model_id"]);
					return {
						...supplement,
						...row,
						model_parameters: {
							...supplement,
							...object(row?.["model_parameters"])
						},
						credit: row?.["credit"] ?? object(row?.["model_parameters"])?.["credit"] ?? supplement?.["credit"]
					};
				}));
				issues.push(...parsed.issues);
				if (parsed.models.length) {
					let variants = {};
					try {
						const rows = object((await this.json(account, "POST", `${SNAP_BASE}/v1/model/thinking-variants`, {
							...headers,
							"agent-type": "PromptCenter"
						}, signal, { model_names: parsed.models.map((model) => model.upstreamId) }))["variants"]);
						if (!rows) throw new CodeArtsError("CodeArts thinking variants are missing");
						variants = Object.fromEntries(Object.entries(rows).map(([id, value]) => [id.toLowerCase(), value]));
					} catch (error) {
						if (signal?.aborted) throw error;
						issues.push("Thinking effort metadata could not be refreshed; using fallback levels");
					}
					for (const model of parsed.models) {
						const variant = object(variants[model.upstreamId.toLowerCase()]);
						const declared = variant?.["strengths"];
						if (!Array.isArray(declared)) {
							model.reasoning = FALLBACK_REASONING;
							continue;
						}
						const strengths = REASONING_EFFORTS.filter((effort) => declared.includes(effort));
						const defaultStrength = text(variant?.["default_strength"]);
						model.reasoning = {
							strengths,
							...defaultStrength && strengths.some((effort) => effort === defaultStrength) ? { default_strength: defaultStrength } : {}
						};
					}
					return {
						models: parsed.models,
						issues
					};
				}
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
	async subscription(account, signal) {
		return parseSubscription(await this.json(account, "GET", `${SNAP_BASE}/snap-manager/v1/statistics/plugin`, {
			"agent-type": "PromptCenter",
			"x-language": "zh-cn"
		}, signal));
	}
	async credit(account, method, path, signal, body) {
		return (await this.json(account, method, `${SNAP_BASE}/v1/ops/${path}`, {
			"agent-type": "PromptCenter",
			"x-language": "zh-cn"
		}, signal, body))["data"];
	}
	async claim(account, signal, now = Date.now()) {
		const data = object(await this.credit(account, "GET", "delivery?channel=IDE", signal));
		if (!Array.isArray(data?.["items"])) throw new CodeArtsError("CodeArts credit activity list is missing");
		const results = [];
		for (const value of data["items"]) {
			const item = object(value);
			const id = item?.["campaignId"];
			if (!item || id !== 1 && id !== 4 || item["benefitUnit"] !== void 0 && item["benefitUnit"] !== "CREDIT") continue;
			const status = text(item["status"])?.trim() ?? "";
			const result = {
				campaignId: id,
				title: text(item["title"]) ?? (id === 1 ? "Daily check-in" : "New user reward"),
				status,
				ok: true,
				message: ""
			};
			results.push(result);
			const extra = object(item["extra"]);
			const start = Date.parse(String(extra?.["startTime"] ?? "")), end = Date.parse(String(extra?.["endTime"] ?? ""));
			if (Number.isFinite(end) && now >= end) {
				result.message = "Campaign ended";
				continue;
			}
			if (Number.isFinite(start) && now < start) {
				result.message = "Campaign has not started";
				continue;
			}
			if (status === "CONFIRMED" || status === "CONSUMED") {
				result.message = "Already claimed";
				continue;
			}
			if (!status) {
				result.message = "Not eligible";
				continue;
			}
			try {
				if (status === "ELIGIBLE" && item["claimable"] === true) {
					await this.credit(account, "POST", "claim", signal, {
						campaignId: id,
						channel: "IDE",
						idempotentKey: `claim_${id}_${now}`
					});
					result.status = "CLAIMED";
					const amount = number(item["pendingTotalAmount"]) ?? number(item["benefitAmount"]);
					if (amount !== void 0) result.credits = amount;
				} else if (status !== "CLAIMED") {
					result.ok = false;
					result.message = "Not claimable yet; retry later";
					continue;
				}
				await this.credit(account, "POST", "confirm", signal, { campaignId: id });
				result.status = "CONFIRMED";
				result.message = status === "CLAIMED" ? "Confirmation completed" : "Claim completed";
			} catch (error) {
				if (signal?.aborted) throw error;
				result.ok = false;
				result.message = redact(error instanceof Error ? error.message : "Credit activity failed", account);
			}
		}
		return results;
	}
};
function number(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
function creditAmount(row) {
	const result = {};
	for (const [field, key] of [
		["total", "package_credit_amount"],
		["used", "package_credit_used"],
		["remaining", "package_credit_remain"],
		["expiring", "package_credit_expiring_amount"]
	]) {
		const value = number(row[key]);
		if (value !== void 0) result[field] = value;
	}
	return result;
}
function parseSubscription(data) {
	const metrics = Array.isArray(data["metrics"]) ? data["metrics"].map(object).filter((row) => row !== void 0) : [];
	const total = metrics.find((row) => row["name"] === "usageTotalPackageCredit");
	const plan = object(data["package"]);
	if (!plan && !total) throw new CodeArtsError("CodeArts subscription data is missing");
	if (plan?.["is_credit_package"] === true && (!total || Object.keys(creditAmount(total)).length === 0)) throw new CodeArtsError("CodeArts credit balance is missing");
	const result = {
		...total ? creditAmount(total) : {},
		packages: []
	};
	for (const [field, value] of [
		["name", plan?.["package_name_cn"]],
		["nameEn", plan?.["package_name_en"]],
		["status", plan?.["status"]],
		["periodEnd", data["end_date"]]
	]) {
		const content = text(value);
		if (content) result[field] = content;
	}
	if (typeof plan?.["is_credit_package"] === "boolean") result.isCreditPackage = plan["is_credit_package"];
	for (const [kind, key] of [
		["basic", "usageBasicPackageCredit"],
		["ondemand", "usageOnDemandPackageCredit"],
		["bonus", "usageBonusPackageCredit"]
	]) {
		const row = metrics.find((row) => row["name"] === key);
		if (row) result.packages.push({
			kind,
			...creditAmount(row)
		});
	}
	return result;
}
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
		const status = error?.code === "TM.00001041" ? 429 : response.status;
		onFailure?.(new CodeArtsError(redact(error?.message ?? `CodeArts HTTP ${response.status}`, account), status, error?.code), response.headers.get("retry-after"));
		return new Response(JSON.stringify({ error: {
			message: redact(error?.message ?? `CodeArts HTTP ${response.status}`, account),
			type: "codearts_error",
			code: error?.code ?? `http_${response.status}`
		} }), {
			status,
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
	const sessionId = `ses_${createHash("sha256").update(JSON.stringify([account.oauth?.domainId, account.oauth?.userId])).digest("hex").slice(0, 32)}`;
	return async (input, init) => {
		if (new URL(input instanceof Request ? input.url : String(input)).href !== "https://snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions" || init?.method?.toUpperCase() !== "POST" || typeof init.body !== "string") throw new CodeArtsError("Unsupported CodeArts chat request", 400);
		const payload = object(JSON.parse(init.body));
		const model = models.find((m) => m.id === payload?.["model"]);
		if (!payload || !model) throw new CodeArtsError("This model is not available for the selected account", 404, "model_not_found");
		payload["model"] = model.upstreamId;
		payload["stream"] = true;
		const extra = {
			...attributionHeaders(),
			"x-ot-session-id": sessionId,
			"user-session-id": sessionId
		};
		try {
			const current = await client.authorize(account);
			return await normalizeResponse(await client.request(current, "POST", CHAT_URL, encoder.encode(JSON.stringify(payload)), extra, init.signal ?? void 0, 6e5), model, current, onFailure);
		} catch (error) {
			if (error instanceof CodeArtsError) onFailure?.(error);
			throw error;
		}
	};
}
// src/adapter.ts
const RETRY_POLICY = resolveRetryPolicy(void 0, "CodeArts retry policy");
function piAdapter(snapshot, options, onFailure) {
	const base = openAICompletionsApi();
	const models = snapshot.models.map((info) => ({
		id: info.id,
		name: `${info.name} · CodeArts`,
		api: "openai-completions",
		provider: PROVIDER_ID,
		baseUrl: `${SNAP_BASE}/api/v2`,
		input: info.supportsImages ? ["text", "image"] : ["text"],
		reasoning: (info.reasoning ?? FALLBACK_REASONING).strengths.length > 0,
		thinkingLevelMap: Object.fromEntries(REASONING_EFFORTS.map((effort) => [effort === "none" ? "off" : effort, (info.reasoning ?? FALLBACK_REASONING).strengths.includes(effort) ? effort : null])),
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
			supportsReasoningEffort: true
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
		const snapshot = this.options.snapshot();
		const adapter = piAdapter(snapshot, this.options, (error, retryAfter) => {
			const delay = retryAfter == null ? NaN : /^\d+(?:\.\d+)?$/u.test(retryAfter.trim()) ? Number(retryAfter) * 1e3 : Date.parse(retryAfter) - Date.now();
			failure = {
				message: error.message,
				code: error.code === "stream_truncated" ? "TRANSPORT" : failureCode(error.status),
				status: error.status,
				...Number.isFinite(delay) && delay > 0 ? { providerRetryAfterMs: delay } : {}
			};
		});
		const variant = (id) => snapshot.models.find((model) => model.id === id)?.reasoning ?? FALLBACK_REASONING;
		function describe(model) {
			if (!model.reasoning) return model;
			const defaultStrength = variant(model.id).default_strength;
			return {
				...model,
				reasoning: {
					efforts: model.reasoning.efforts.map((effort) => effort.id === "off" ? {
						id: ReasoningEffortId("none"),
						name: "None"
					} : effort),
					...defaultStrength ? { defaultEffort: ReasoningEffortId(defaultStrength) } : {}
				}
			};
		}
		async function* wrap(options, stream) {
			const { strengths, default_strength } = variant(options.model);
			const effort = options.reasoningEffort ?? default_strength;
			if (effort !== void 0 && !strengths.includes(effort)) throw new LlmError(`CodeArts model "${options.model}" does not support reasoning effort "${effort}"`, "UNSUPPORTED_REASONING_EFFORT");
			const normalized = effort === void 0 ? options : {
				...options,
				reasoningEffort: ReasoningEffortId(effort === "none" ? "off" : effort)
			};
			for await (const chunk of stream(normalized)) if (chunk.type === "finish" && chunk.reason.kind === "error" && failure) yield {
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
			wrap,
			describe
		};
	}
	listModels(provider) {
		return this.call().adapter.listModels(provider);
	}
	async resolveModel(provider, model, signal) {
		const { adapter, describe } = this.call();
		return describe(await adapter.resolveModel(provider, model, signal));
	}
	imageRequestTarget(provider, model, image) {
		return this.call().adapter.imageRequestTarget(provider, model, image);
	}
	async prepareCall(provider, model, signal) {
		const { adapter, wrap, describe } = this.call();
		const prepared = await adapter.prepareCall(provider, model, signal);
		return {
			model: describe(prepared.model),
			stream: (options) => wrap(options, prepared.stream)
		};
	}
	stream(options) {
		const { adapter, wrap } = this.call();
		return wrap(options, (options) => adapter.stream(options));
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
	if (action === "rename") {
		const label = text(row["label"]);
		if (!label || label.length > 100) throw new CodeArtsError("Account name must contain 1–100 characters", 400);
		if (!text(row["id"]) || String(row["id"]).length > 256) throw new CodeArtsError("Invalid account ID", 400);
		return {
			action,
			label,
			id: String(row["id"])
		};
	}
	if ((action === "remove" || action === "select") && text(row["id"]) && String(row["id"]).length <= 256) return {
		action,
		id: String(row["id"])
	};
	if ((action === "refresh" || action === "claim") && text(row["accountId"]) && String(row["accountId"]).length <= 256) return {
		action,
		accountId: String(row["accountId"])
	};
	if (action === "login" && (row["accountId"] === void 0 || text(row["accountId"]) && String(row["accountId"]).length <= 256)) return {
		action,
		...row["accountId"] === void 0 ? {} : { accountId: String(row["accountId"]) }
	};
	if (action === "cancel-login") return { action };
	if (action === "auto-claim" && typeof row["enabled"] === "boolean") return {
		action,
		enabled: row["enabled"]
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
const emptyCatalog = () => ({
	models: [],
	issues: []
});
const identity = accountIdentity;
var CodeArtsRuntime = class {
	accounts;
	client;
	now;
	state = emptyAccounts();
	currentIdentity;
	currentCatalog = emptyCatalog();
	currentSnapshot = {
		account: void 0,
		models: []
	};
	catalogs = /* @__PURE__ */ new Map();
	benefits = /* @__PURE__ */ new Map();
	claimAttempts = /* @__PURE__ */ new Map();
	inflight = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Set();
	controller = new AbortController();
	syncGeneration = 0;
	closed = false;
	login;
	constructor(accounts, client, now = Date.now) {
		this.accounts = accounts;
		this.client = client;
		this.now = now;
		this.login = new OAuthLogin(client.oauth, async (credentials, accountId, signal) => {
			if (this.closed) throw new Error("CodeArts plugin is stopping");
			await accounts.login(credentials, accountId, signal);
			this.maintain().catch(() => {});
		}, now);
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
			models: this.currentCatalog.models
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
				this.state = emptyAccounts();
				this.currentIdentity = void 0;
				this.currentSnapshot = {
					account: void 0,
					models: []
				};
				this.currentCatalog = emptyCatalog();
				this.publish();
			}
			throw error;
		}
		if (this.closed || generation !== this.syncGeneration) return;
		this.state = state;
		const keys = new Set(state.accounts.map(identity));
		for (const cache of [
			this.catalogs,
			this.benefits,
			this.claimAttempts
		]) for (const key of cache.keys()) if (!keys.has(key)) cache.delete(key);
		const account = state.accounts.find((a) => a.id === state.activeId && a.oauth && !a.oauth.needsLogin);
		const key = account === void 0 ? void 0 : identity(account);
		if (key === this.currentIdentity) {
			this.currentSnapshot = {
				account,
				models: this.currentCatalog.models
			};
			return;
		}
		this.currentIdentity = key;
		this.currentSnapshot = {
			account,
			models: []
		};
		this.currentCatalog = key === void 0 ? emptyCatalog() : this.catalogs.get(key) ?? emptyCatalog();
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
		await this.join(`catalog:${key}`, async () => {
			const previous = this.catalogs.get(key);
			if (!force && previous?.fetchedAt !== void 0 && this.now() - previous.fetchedAt < 3e5) return;
			let value;
			try {
				value = {
					...await this.client.models(account, this.controller.signal),
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
			if (!this.current(account)) return;
			this.catalogs.set(key, value);
			if (key === this.currentIdentity) {
				this.currentCatalog = value;
				this.publish();
			}
		});
	}
	current(account) {
		return !this.closed && this.state.accounts.some((value) => identity(value) === identity(account));
	}
	async refreshBenefits(account, force = false) {
		const key = identity(account);
		await this.join(`benefits:${key}`, async () => {
			const previous = this.benefits.get(key) ?? {};
			if (!force && previous.fetchedAt !== void 0 && this.now() - previous.fetchedAt < 3e5) return;
			let update;
			try {
				update = {
					subscription: await this.client.subscription(account, this.controller.signal),
					fetchedAt: this.now()
				};
			} catch (error) {
				update = { error: redact(error instanceof Error ? error.message : "Subscription lookup failed", account) };
			}
			if (!this.current(account)) return;
			const next = {
				...this.benefits.get(key),
				...update
			};
			if (!update.error) delete next.error;
			this.benefits.set(key, next);
		});
	}
	async claim(account) {
		const key = identity(account);
		await this.join(`claim:${key}`, async () => {
			this.claimAttempts.set(key, this.now());
			let update;
			try {
				update = {
					claims: await this.client.claim(account, this.controller.signal, this.now()),
					checkedAt: this.now()
				};
			} catch (error) {
				update = { claimError: redact(error instanceof Error ? error.message : "Credit claim failed", account) };
			}
			if (!this.current(account)) return;
			const next = {
				...this.benefits.get(key),
				...update
			};
			if (!update.claimError) delete next.claimError;
			this.benefits.set(key, next);
			await this.refreshBenefits(account, true);
		});
	}
	async maintain() {
		if (this.closed) return;
		await this.join("maintenance", async () => {
			await this.sync();
			for (const account of this.state.accounts) {
				if (!this.current(account) || !account.oauth || account.oauth.needsLogin) continue;
				try {
					await this.client.authorize(account);
				} catch {
					continue;
				}
				const attempted = this.claimAttempts.get(identity(account));
				if (this.state.autoClaim && (attempted === void 0 || this.now() - attempted >= 18e5)) await this.claim(account);
				else await this.refreshBenefits(account);
			}
			await this.sync();
			await this.refresh();
		});
	}
	async action(action) {
		if (this.closed) throw new Error("CodeArts plugin is stopping");
		switch (action.action) {
			case "rename":
				await this.accounts.rename(action.id, action.label);
				break;
			case "select":
				await this.accounts.select(action.id);
				break;
			case "remove":
				if (this.login.status().accountId === action.id) this.login.cancel();
				await this.accounts.remove(action.id);
				break;
			case "login":
				await this.sync();
				if (action.accountId !== void 0 && !this.state.accounts.some((account) => account.id === action.accountId)) throw new Error("Account no longer exists");
				await this.login.start(action.accountId);
				return;
			case "cancel-login":
				this.login.cancel();
				return;
			case "auto-claim":
				await this.accounts.setAutoClaim(action.enabled);
				break;
			case "claim":
			case "refresh": {
				await this.sync();
				const account = this.currentSnapshot.account;
				if (account?.id !== action.accountId) throw new Error("The selected account changed or requires login; refresh this page and try again");
				if (action.action === "claim") await this.claim(account);
				else await Promise.all([this.refresh(true, action.accountId), this.refreshBenefits(account, true)]);
				return;
			}
		}
		await this.sync();
		await this.refresh();
		if (this.currentSnapshot.account) await this.refreshBenefits(this.currentSnapshot.account);
		if (action.action === "auto-claim" && action.enabled) this.maintain().catch(() => {});
	}
	async status(actionToken) {
		await this.sync();
		return {
			accounts: publicAccounts(this.state).map((account) => ({
				...account,
				benefits: this.benefits.get(identity(this.state.accounts.find((row) => row.id === account.id))) ?? {}
			})),
			activeId: this.state.activeId,
			catalog: this.currentCatalog,
			actionToken,
			autoClaim: this.state.autoClaim,
			login: this.login.status()
		};
	}
	close() {
		this.closed = true;
		this.controller.abort(/* @__PURE__ */ new Error("CodeArts plugin stopped"));
		this.login.cancel();
		this.client.close();
		this.listeners.clear();
		this.catalogs.clear();
		this.benefits.clear();
		this.claimAttempts.clear();
		this.state = emptyAccounts();
		this.currentSnapshot = {
			account: void 0,
			models: []
		};
	}
};
// src/index.ts
const name = "@ipfans/dsh-connect-codearts";
const inject = ["llm", "credentials"];
const Config = z.object({});
function apply(ctx) {
	const accounts = new Accounts(ctx.credentials);
	const runtime = new CodeArtsRuntime(accounts, new CodeArtsClient(globalThis.fetch, accounts));
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
			await runtime.maintain();
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
