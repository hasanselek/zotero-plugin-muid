/* Dil modeli sağlayıcıları: tek arayüz, üç tel biçimi.
 *   anthropic  — Anthropic Messages API (Claude)
 *   openai     — OpenAI Chat Completions ve uyumluları (OpenAI, OpenRouter, Mistral, DeepSeek, Groq,
 *                xAI, Ollama, LM Studio, kendi sunucunuz)
 *   gemini     — Google Gemini generateContent
 * Sohbet içte Anthropic'e benzer tek biçimde tutulur:
 *   { role: "user"|"assistant", content: [
 *       {type:"text", text} | {type:"image", mediaType, data} | {type:"thinking", thinking, signature}
 *       | {type:"tool_use", id, name, input, meta?} | {type:"tool_result", id, name, content, isError} ] }
 * ve her istekte sağlayıcının biçimine çevrilir. Zotero eklentisinde SDK paketlenemediği için
 * istekler ham HTTP ile, akış (SSE) hâlinde yapılır. */

Hafif.modules.llm = {
	ANTHROPIC_VERSION: "2026-10-21",

	PROVIDERS: {
		anthropic: { label: "Anthropic (Claude)", format: "anthropic", base: "https://api.anthropic.com/v1", key: true, keyUrl: "https://console.anthropic.com/settings/keys" },
		openai: { label: "OpenAI", format: "openai", base: "https://api.openai.com/v1", key: true, keyUrl: "https://platform.openai.com/api-keys" },
		google: { label: "Google Gemini", format: "gemini", base: "https://generativelanguage.googleapis.com/v1beta", key: true, keyUrl: "https://aistudio.google.com/apikey" },
		openrouter: { label: "OpenRouter (yüzlerce model)", format: "openai", base: "https://openrouter.ai/api/v1", key: true, keyUrl: "https://openrouter.ai/keys" },
		mistral: { label: "Mistral", format: "openai", base: "https://api.mistral.ai/v1", key: true, keyUrl: "https://console.mistral.ai/api-keys" },
		deepseek: { label: "DeepSeek", format: "openai", base: "https://api.deepseek.com/v1", key: true, keyUrl: "https://platform.deepseek.com/api_keys" },
		groq: { label: "Groq", format: "openai", base: "https://api.groq.com/openai/v1", key: true, keyUrl: "https://console.groq.com/keys" },
		xai: { label: "xAI (Grok)", format: "openai", base: "https://api.x.ai/v1", key: true, keyUrl: "https://console.x.ai" },
		ollama: { label: "Ollama (bu bilgisayarda)", format: "openai", base: "http://localhost:11434/v1", key: false, local: true },
		lmstudio: { label: "LM Studio (bu bilgisayarda)", format: "openai", base: "http://localhost:1234/v1", key: false, local: true },
		// Yalnızca anlamsal arama (gömme) için; sohbet modeli listesinde görünmez
		voyage: { label: "Voyage AI (yalnızca anlamsal arama)", format: "voyage", base: "https://api.voyageai.com/v1", key: true, keyUrl: "https://dash.voyageai.com/api-keys", embedOnly: true },
	},

	/** Her sağlayıcı için önerilen model (liste çekilmeden önce de seçilebilsin). */
	DEFAULT_MODELS: {
		anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
		openai: [],
		google: [],
		openrouter: [],
		mistral: [],
		deepseek: [],
		groq: [],
		xai: [],
		ollama: [],
		lmstudio: [],
	},

	// ---- Ayarlar ----

	_json(key, fallback) {
		try {
			return JSON.parse(Hafif.pref(key) || "null") ?? fallback;
		}
		catch (e) {
			return fallback;
		}
	},

	keys() {
		let k = this._json("aiKeys", {});
		// Eski tek anahtar ayarı
		if (!k.anthropic && Hafif.pref("aiKey")) k.anthropic = Hafif.pref("aiKey");
		return k;
	},

	setKey(provider, value) {
		let k = this._json("aiKeys", {});
		if (value) k[provider] = value;
		else delete k[provider];
		Hafif.pref("aiKeys", JSON.stringify(k));
		if (provider === "anthropic") Hafif.pref("aiKey", value || "");
	},

	bases() {
		return this._json("aiBases", {});
	},

	/** Kendi eklediğiniz uç noktalar: [{ id, label, base, format: "openai"|"anthropic", key }] */
	custom() {
		return this._json("aiCustom", []);
	},

	/** Sağlayıcı yapılandırması (yerleşik ya da özel). */
	provider(id) {
		let p = this.PROVIDERS[id];
		if (p) return { id, ...p, base: (this.bases()[id] || p.base).replace(/\/+$/, ""), apiKey: this.keys()[id] || "" };
		let c = this.custom().find(x => x.id === id);
		if (c) return { id, label: c.label || c.base, format: c.format || "openai", base: (c.base || "").replace(/\/+$/, ""), key: !!c.key, apiKey: c.key || "", custom: true };
		return null;
	},

	/** Kullanılabilir sağlayıcılar: anahtarı girilmiş olanlar, yerel olanlar ve özel uç noktalar. */
	configured() {
		let keys = this.keys();
		let out = Object.keys(this.PROVIDERS).filter(id => !this.PROVIDERS[id].embedOnly && (this.PROVIDERS[id].local ? this._json("aiLocal", {})[id] : keys[id]));
		return [...out, ...this.custom().map(c => c.id)];
	},

	/** Seçili model "sağlayıcı:model" biçiminde. */
	current() {
		let v = Hafif.pref("aiChatModel") || "";
		let i = v.indexOf(":");
		if (i > 0) return { provider: v.slice(0, i), model: v.slice(i + 1) };
		return { provider: "anthropic", model: Hafif.pref("aiModel") || "claude-opus-5-5" };
	},

	setCurrent(provider, model) {
		Hafif.pref("aiChatModel", `${provider}:${model}`);
	},

	/** Önbellekteki model listesi: { provider: { at, models: [{id, name}] } } */
	cachedModels() {
		return this._json("aiModelCache", {});
	},

	models(provider) {
		let cached = this.cachedModels()[provider]?.models;
		if (cached?.length) return cached;
		return (this.DEFAULT_MODELS[provider] || []).map(id => ({ id, name: id }));
	},

	// ---- Model listeleri ----

	/** Sağlayıcının API'sinden güncel model listesini çeker ve saklar. */
	async fetchModels(providerID) {
		let p = this.provider(providerID);
		if (!p) throw new Error("Bilinmeyen sağlayıcı: " + providerID);
		let models = [];
		if (p.format === "anthropic") {
			let after = null;
			for (let i = 0; i < 10; i++) {
				let url = `${p.base}/models?limit=100` + (after ? `&after_id=${encodeURIComponent(after)}` : "");
				let r = await this._get(url, this._anthropicHeaders(p));
				models.push(...(r.data || []).map(m => ({ id: m.id, name: m.display_name || m.id, context: m.max_input_tokens })));
				if (!r.has_more) break;
				after = r.last_id;
			}
		}
		else if (p.format === "gemini") {
			let token = "";
			for (let i = 0; i < 10; i++) {
				let r = await this._get(`${p.base}/models?pageSize=1000${token ? "&pageToken=" + token : ""}`, { "x-goog-api-key": p.apiKey });
				for (let m of r.models || []) {
					if (!(m.supportedGenerationMethods || []).includes("generateContent")) continue;
					models.push({ id: m.name.replace(/^models\//, ""), name: m.displayName || m.name, context: m.inputTokenLimit });
				}
				if (!r.nextPageToken) break;
				token = r.nextPageToken;
			}
		}
		else {
			let r = await this._get(`${p.base}/models`, p.apiKey ? { authorization: "Bearer " + p.apiKey } : {});
			let list = r.data || r.models || [];
			models = list.map(m => ({ id: m.id || m.name, name: m.name && m.name !== m.id ? m.name : (m.id || m.name), context: m.context_length || m.context_window }))
				// Sohbet dışı modelleri (ses, görsel üretimi, gömme) ayıkla
				.filter(m => !/(embed|whisper|tts|dall-e|moderation|transcribe|audio|realtime|image-gen|rerank)/i.test(m.id));
		}
		models.sort((a, b) => a.id.localeCompare(b.id));
		let cache = this.cachedModels();
		cache[providerID] = { at: Date.now(), models };
		Hafif.pref("aiModelCache", JSON.stringify(cache));
		return models;
	},

	async _get(url, headers) {
		let res = await fetch(url, { headers });
		let text = await res.text();
		if (!res.ok) throw new Error(this._errMsg(res.status, text));
		return JSON.parse(text);
	},

	_errMsg(status, body) {
		let msg = body;
		try {
			let j = JSON.parse(body);
			msg = j.error?.message || j.error?.error?.message || j.message || (typeof j.error === "string" ? j.error : body);
		}
		catch (e) {}
		let hint = status === 401 || status === 403 ? " — API anahtarını kontrol edin." : status === 429 ? " — hız ya da kota sınırı; biraz sonra deneyin." : "";
		return `API hatası ${status}: ${String(msg).slice(0, 400)}${hint}`;
	},

	// ---- Sohbet ----

	/**
	 * Tek model çağrısı (akışlı). opts: { provider, model, system, messages, tools, signal,
	 *   onText(delta), onThinking(delta), effort, maxTokens }
	 * Dönüş: { content: [blok], stop: "tool_use"|"end"|"max_tokens"|"refusal", usage }
	 */
	async chat(opts) {
		let p = this.provider(opts.provider);
		if (!p) throw new Error("Sağlayıcı bulunamadı: " + opts.provider);
		if (p.key && !p.apiKey && !p.custom) throw new Error(`${p.label} için API anahtarı yok. Zotero Ayarları › Hafif › Yapay zekâ bölümünden girin.`);
		if (p.format === "anthropic") return this._anthropic(p, opts);
		if (p.format === "gemini") return this._gemini(p, opts);
		return this._openai(p, opts);
	},

	/** SSE akışını satır satır okur; her "data:" yükü için fn(json, eventName) çağrılır. */
	async _sse(res, fn) {
		let reader = res.body.getReader();
		let decoder = new TextDecoder();
		let buf = "";
		for (;;) {
			let { value, done } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			let parts = buf.split(/\r?\n\r?\n/);
			buf = parts.pop();
			for (let ev of parts) this._sseEvent(ev, fn);
		}
		if (buf.trim()) this._sseEvent(buf, fn);
	},

	_sseEvent(ev, fn) {
		let name = null;
		let data = [];
		for (let line of ev.split(/\r?\n/)) {
			if (line.startsWith("event:")) name = line.slice(6).trim();
			else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
		}
		let payload = data.join("\n");
		if (!payload || payload === "[DONE]") return;
		let json;
		try {
			json = JSON.parse(payload);
		}
		catch (e) {
			return;
		}
		fn(json, name);
	},

	async _post(url, headers, body, signal) {
		let res = await fetch(url, { method: "POST", signal, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
		if (!res.ok) throw new Error(this._errMsg(res.status, await res.text()));
		return res;
	},

	/** Araç girdisini ayrıştırır; bozuk ya da yarım JSON'da hata nesnesi döner. */
	_parseInput(raw) {
		if (raw == null || raw === "") return {};
		if (typeof raw === "object") return raw;
		try {
			let v = JSON.parse(raw);
			return v && typeof v === "object" && !Array.isArray(v) ? v : { __invalid: "Girdi bir nesne değil" };
		}
		catch (e) {
			return { __invalid: "Girdi geçerli JSON değil: " + e.message };
		}
	},

	// ---- Anthropic ----

	_anthropicHeaders(p) {
		return {
			"x-api-key": p.apiKey,
			"anthropic-version": this.ANTHROPIC_VERSION,
		};
	},

	/** Uyarlamalı düşünme ve çaba ayarını destekleyen Claude modelleri (4.6 ve sonrası). */
	_claudeModern(model) {
		return /claude-(opus|sonnet|haiku|fable|mythos)-(4-[6-9]|[5-9])/.test(model);
	},

	async _anthropic(p, opts) {
		let modern = this._claudeModern(opts.model);
		let tools = (opts.tools || []).map(t => ({ name: t.name, description: t.description, input_schema: t.parameters, eager_input_streaming: true }));
		if (opts.webSearch && modern) {
			tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 5 });
			tools.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: 5 });
		}
		let messages = opts.messages.map(m => ({
			role: m.role,
			content: m.content.map(b => {
				switch (b.type) {
					case "text": return b.text ? { type: "text", text: b.text } : null;
					case "image": return { type: "image", source: { type: "base64", media_type: b.mediaType, data: b.data } };
					// Yalnızca Claude'un ürettiği (imzalı) düşünme blokları geri gider; başka modellerinkiler atlanır
					case "thinking": return b.raw && (b.raw.signature || b.raw.type === "redacted_thinking") ? b.raw : null;
					case "server": return b.raw || null;
					case "tool_use": return { type: "tool_use", id: b.id, name: b.name, input: b.input || {} };
					case "tool_result": return {
						type: "tool_result", tool_use_id: b.id, is_error: !!b.isError,
						content: b.images?.length
							? [{ type: "text", text: b.content || "(görsel)" }, ...b.images.map(i => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.data } }))]
							: b.content,
					};
				}
				return null;
			}).filter(Boolean),
		})).filter(m => m.content.length);
		let body = {
			model: opts.model,
			max_tokens: opts.maxTokens || 32000,
			stream: true,
			system: opts.system,
			messages,
			cache_control: { type: "ephemeral" },
		};
		if (tools.length) body.tools = tools;
		let headers = this._anthropicHeaders(p);
		if (modern) {
			body.thinking = { type: "adaptive", display: "summarized" };
			body.output_config = { effort: opts.effort || "medium" };
			if (/claude-(opus-5|sonnet-5-5|fable-5-1)/.test(opts.model) && !p.custom) {
				headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
				body.fallbacks = "default";
			}
		}
		let res = await this._post(`${p.base}/messages`, headers, body, opts.signal);

		let blocks = [];
		let stop = "end";
		let usage = {};
		let streamErr = null;
		await this._sse(res, (ev) => {
			switch (ev.type) {
				case "message_start":
					usage = ev.message?.usage || {};
					break;
				case "content_block_start": {
					let cb = ev.content_block;
					let b;
					if (cb.type === "text") b = { type: "text", text: cb.text || "" };
					else if (cb.type === "thinking") b = { type: "thinking", thinking: cb.thinking || "", signature: cb.signature || "" };
					else if (cb.type === "redacted_thinking") b = { type: "thinking", raw: cb };
					else if (cb.type === "tool_use") b = { type: "tool_use", id: cb.id, name: cb.name, _json: "" };
					else b = { type: "server", raw: cb, _json: "" };
					blocks[ev.index] = b;
					break;
				}
				case "content_block_delta": {
					let b = blocks[ev.index];
					let d = ev.delta;
					if (!b) break;
					if (d.type === "text_delta") {
						b.text += d.text;
						opts.onText?.(d.text);
					}
					else if (d.type === "thinking_delta") {
						b.thinking += d.thinking;
						opts.onThinking?.(d.thinking);
					}
					else if (d.type === "signature_delta") b.signature = (b.signature || "") + d.signature;
					else if (d.type === "input_json_delta") b._json += d.partial_json;
					else if (d.type === "citations_delta" && b.type === "text") (b.citations = b.citations || []).push(d.citation);
					break;
				}
				case "content_block_stop": {
					let b = blocks[ev.index];
					if (b?.type === "tool_use") {
						b.input = this._parseInput(b._json);
						delete b._json;
					}
					else if (b?.type === "server") {
						if (b._json) b.raw = { ...b.raw, input: this._parseInput(b._json) };
						delete b._json;
					}
					break;
				}
				case "message_delta":
					if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
					if (ev.usage) usage = { ...usage, ...ev.usage };
					break;
				case "error":
					streamErr = new Error(ev.error?.message || "akış hatası");
					break;
			}
		});
		if (streamErr) throw streamErr;
		blocks = blocks.filter(Boolean);
		for (let b of blocks) if (b.type === "thinking" && !b.raw) b.raw = { type: "thinking", thinking: b.thinking, signature: b.signature };
		return {
			content: blocks,
			stop: stop === "tool_use" ? "tool_use" : stop === "max_tokens" ? "max_tokens" : stop === "refusal" ? "refusal" : stop === "pause_turn" ? "pause" : "end",
			usage: { input: usage.input_tokens, output: usage.output_tokens, cacheRead: usage.cache_read_input_tokens },
		};
	},

	// ---- OpenAI Chat Completions ve uyumluları ----

	async _openai(p, opts) {
		let messages = [];
		if (opts.system) messages.push({ role: "system", content: opts.system });
		for (let m of opts.messages) {
			if (m.role === "user") {
				let results = m.content.filter(b => b.type === "tool_result");
				for (let r of results) messages.push({ role: "tool", tool_call_id: r.id, content: (r.isError ? "HATA: " : "") + r.content });
				// Araç görselleri (sayfa görüntüsü) araç mesajına konamaz: ardından kullanıcı mesajı olarak gider
				let imgs = results.flatMap(r => r.images || []);
				if (imgs.length) {
					messages.push({ role: "user", content: [{ type: "text", text: "Araç sonucundaki sayfa görüntüleri:" }, ...imgs.map(i => ({ type: "image_url", image_url: { url: `data:${i.mediaType};base64,${i.data}` } }))] });
				}
				let parts = m.content.filter(b => b.type === "text" || b.type === "image").map(b => b.type === "text"
					? { type: "text", text: b.text }
					: { type: "image_url", image_url: { url: `data:${b.mediaType};base64,${b.data}` } });
				if (parts.length) messages.push({ role: "user", content: parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts });
			}
			else {
				let text = m.content.filter(b => b.type === "text").map(b => b.text).join("");
				let calls = m.content.filter(b => b.type === "tool_use").map(b => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
				let msg = { role: "assistant", content: text || (calls.length ? null : "") };
				if (calls.length) msg.tool_calls = calls;
				// DeepSeek gibi akıl yürütme içeriği isteyen modeller için
				let reasoning = m.content.filter(b => b.type === "thinking" && b.thinking).map(b => b.thinking).join("");
				if (reasoning && p.id === "deepseek") msg.reasoning_content = reasoning;
				messages.push(msg);
			}
		}
		let body = { model: opts.model, messages, stream: true };
		if (opts.tools?.length) body.tools = opts.tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
		if (p.id === "openai") {
			body.stream_options = { include_usage: true };
			if (/^(o\d|gpt-5)/.test(opts.model)) body.reasoning_effort = opts.effort === "max" || opts.effort === "xhigh" ? "high" : (opts.effort || "medium");
		}
		if (p.id === "openrouter") body.usage = { include: true };
		let headers = p.apiKey ? { authorization: "Bearer " + p.apiKey } : {};
		if (p.id === "openrouter") {
			headers["HTTP-Referer"] = "https://www.zotero.org";
			headers["X-Title"] = "Zotero Hafif";
		}
		let res = await this._post(`${p.base}/chat/completions`, headers, body, opts.signal);

		let text = "";
		let thinking = "";
		let calls = [];
		let finish = null;
		let usage = {};
		await this._sse(res, (ev) => {
			if (ev.error) throw new Error(ev.error.message || JSON.stringify(ev.error));
			if (ev.usage) usage = ev.usage;
			let ch = ev.choices?.[0];
			if (!ch) return;
			let d = ch.delta || ch.message || {};
			let r = d.reasoning_content ?? d.reasoning;
			if (typeof r === "string" && r) {
				thinking += r;
				opts.onThinking?.(r);
			}
			if (typeof d.content === "string" && d.content) {
				text += d.content;
				opts.onText?.(d.content);
			}
			for (let tc of d.tool_calls || []) {
				let i = tc.index ?? calls.length;
				let c = calls[i] = calls[i] || { id: "", name: "", args: "" };
				if (tc.id) c.id = tc.id;
				if (tc.function?.name) c.name += tc.function.name;
				if (tc.function?.arguments) c.args += typeof tc.function.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function.arguments);
			}
			if (ch.finish_reason) finish = ch.finish_reason;
		});
		let content = [];
		if (thinking) content.push({ type: "thinking", thinking });
		if (text) content.push({ type: "text", text });
		calls.filter(Boolean).forEach((c, i) => content.push({ type: "tool_use", id: c.id || `call_${Date.now()}_${i}`, name: c.name, input: this._parseInput(c.args) }));
		let hasCalls = content.some(b => b.type === "tool_use");
		return {
			content,
			stop: hasCalls ? "tool_use" : finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : "end",
			usage: { input: usage.prompt_tokens, output: usage.completion_tokens },
		};
	},

	// ---- Google Gemini ----

	/** Gemini şemaları OpenAPI alt kümesidir: desteklemediği anahtarlar atılır. */
	_geminiSchema(s) {
		if (Array.isArray(s)) return s.map(x => this._geminiSchema(x));
		if (!s || typeof s !== "object") return s;
		let out = {};
		for (let [k, v] of Object.entries(s)) {
			if (["additionalProperties", "$schema", "default", "examples", "const"].includes(k)) continue;
			out[k] = typeof v === "object" ? this._geminiSchema(v) : v;
		}
		return out;
	},

	async _gemini(p, opts) {
		let contents = [];
		for (let m of opts.messages) {
			let parts = [];
			for (let b of m.content) {
				if (b.type === "text" && b.text) parts.push({ text: b.text });
				else if (b.type === "image") parts.push({ inlineData: { mimeType: b.mediaType, data: b.data } });
				else if (b.type === "tool_use") {
					let part = { functionCall: { name: b.name, args: b.input || {} } };
					// Gemini 2.5/3 düşünme imzası aynen geri gönderilmeli
					if (b.meta?.thoughtSignature) part.thoughtSignature = b.meta.thoughtSignature;
					parts.push(part);
				}
				else if (b.type === "tool_result") {
					// Gemini yanıtları sıraya ve ada göre eşler; başka sağlayıcıların kimlikleri gönderilmez
					parts.push({ functionResponse: { name: b.name, response: { content: b.content, error: b.isError || undefined } } });
					for (let i of b.images || []) parts.push({ inlineData: { mimeType: i.mediaType, data: i.data } });
				}
				else if (b.type === "thinking" && b.meta?.thoughtSignature) parts.push({ text: "", thoughtSignature: b.meta.thoughtSignature });
			}
			if (parts.length) contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
		}
		let body = { contents };
		if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
		let decls = (opts.tools || []).map(t => ({ name: t.name, description: t.description, parameters: this._geminiSchema(t.parameters) }));
		body.tools = [];
		if (decls.length) body.tools.push({ functionDeclarations: decls });
		if (opts.webSearch) body.tools.push({ googleSearch: {} });
		if (!body.tools.length) delete body.tools;
		body.generationConfig = { thinkingConfig: { includeThoughts: true } };
		let url = `${p.base}/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`;
		let res = await this._post(url, { "x-goog-api-key": p.apiKey }, body, opts.signal);

		let content = [];
		let finish = null;
		let usage = {};
		let last = (type) => {
			let b = content[content.length - 1];
			if (b?.type === type && !b.meta?.thoughtSignature) return b;
			b = type === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "" };
			content.push(b);
			return b;
		};
		await this._sse(res, (ev) => {
			if (ev.error) throw new Error(ev.error.message || "Gemini hatası");
			if (ev.usageMetadata) usage = ev.usageMetadata;
			let cand = ev.candidates?.[0];
			if (!cand) return;
			if (cand.finishReason) finish = cand.finishReason;
			for (let part of cand.content?.parts || []) {
				if (part.functionCall) {
					content.push({
						type: "tool_use", id: part.functionCall.id || `g_${Date.now()}_${content.length}`,
						name: part.functionCall.name, input: part.functionCall.args || {},
						meta: part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : undefined,
					});
				}
				else if (part.thought && part.text) {
					last("thinking").thinking += part.text;
					opts.onThinking?.(part.text);
				}
				else if (typeof part.text === "string") {
					if (part.text) {
						last("text").text += part.text;
						opts.onText?.(part.text);
					}
					if (part.thoughtSignature) content.push({ type: "thinking", thinking: "", meta: { thoughtSignature: part.thoughtSignature } });
				}
			}
		});
		let hasCalls = content.some(b => b.type === "tool_use");
		return {
			content,
			stop: hasCalls ? "tool_use" : finish === "MAX_TOKENS" ? "max_tokens" : /SAFETY|BLOCK|PROHIBITED/.test(finish || "") ? "refusal" : "end",
			usage: { input: usage.promptTokenCount, output: usage.candidatesTokenCount },
		};
	},

	/** Bağlantı denemesi: model listesi çekilebiliyorsa anahtar ve adres doğrudur. */
	async test(providerID) {
		if (this.PROVIDERS[providerID]?.embedOnly) {
			let p = this.provider(providerID);
			await Hafif.load("embed").embed(["deneme"], { cfg: { provider: providerID, model: Hafif.load("embed").DEFAULTS[providerID]?.model, dims: null } });
			return "Bağlantı çalışıyor.";
		}
		let models = await this.fetchModels(providerID);
		return `${models.length} model bulundu.`;
	},
};
