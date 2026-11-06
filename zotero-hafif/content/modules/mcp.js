/* MCP sunucusu: Claude Desktop, Claude Code ve diğer MCP istemcilerine kütüphaneyi açar.
 * Zotero'nun yerel sunucusuna (127.0.0.1:23119) /hafif/mcp uç noktası eklenir; MCP'nin
 * “Streamable HTTP” taşıması JSON yanıtlarla uygulanır.
 * Güvenlik: Zotero yalnızca bu bilgisayardan gelen isteği kabul eder ve tarayıcı isteklerini
 * kendisi engeller; ayrıca her istek ayarlarda üretilen erişim anahtarını taşımalıdır.
 * Araçlar okuyucudur; ayarlarda izin verilirse yeni not oluşturma da açılır (var olanı değiştirmez). */

Hafif.modules.mcp = {
	PATH: "/hafif/mcp",
	PROTOCOLS: ["2025-06-18", "2025-03-26", "2024-11-05"],
	READ_TOOLS: ["search_library", "fulltext_search", "semantic_search", "get_item", "read_document", "search_in_document",
		"list_collections", "list_collection_items", "list_tags", "search_notes", "read_note", "find_annotations", "view_page"],

	enabled() {
		return Hafif.pref("mcpEnabled") === true;
	},

	token() {
		let t = Hafif.pref("mcpToken");
		if (!t) {
			t = Zotero.Utilities.randomString(32, "abcdefghijkmnopqrstuvwxyz23456789");
			Hafif.pref("mcpToken", t);
		}
		return t;
	},

	url() {
		return `http://127.0.0.1:${Zotero.Prefs.get("httpServer.port") || 23119}${this.PATH}`;
	},

	register() {
		if (!this.enabled()) return this.unregister();
		let M = this;
		let Endpoint = function () {};
		Endpoint.prototype = {
			supportedMethods: ["POST", "GET", "DELETE"],
			supportedDataTypes: ["application/json"],
			init: async function (req) {
				return M.handle(req);
			},
		};
		Zotero.Server.Endpoints[this.PATH] = Endpoint;
		Hafif.log("MCP sunucusu açık: " + this.url());
	},

	unregister() {
		delete Zotero.Server.Endpoints[this.PATH];
	},

	shutdown() {
		this.unregister();
	},

	_tools() {
		let all = Hafif.load("agent").tools();
		let names = new Set(this.READ_TOOLS);
		if (Hafif.pref("mcpWrite") === true) names.add("create_note");
		return all.filter(t => names.has(t.name));
	},

	_json(status, obj, extra = {}) {
		return [status, { "Content-Type": "application/json; charset=utf-8", ...extra }, obj == null ? "" : JSON.stringify(obj)];
	},

	async handle(req) {
		if (!this.enabled()) return [404, "text/plain", "MCP kapalı\n"];
		let auth = req.headers?.authorization || "";
		if (auth !== "Bearer " + this.token()) return [401, "text/plain", "Yetkisiz: Authorization: Bearer <anahtar> gerekli\n"];
		if (req.method === "GET") return [405, "text/plain", "Bu sunucu SSE akışı açmaz; POST kullanın.\n"];
		if (req.method === "DELETE") return [200, "text/plain", ""];
		let msg = req.data;
		if (Array.isArray(msg)) {
			let out = [];
			for (let m of msg) {
				let r = await this._rpc(m);
				if (r) out.push(r);
			}
			return out.length ? this._json(200, out) : [202, "text/plain", ""];
		}
		let r = await this._rpc(msg);
		return r ? this._json(200, r) : [202, "text/plain", ""];
	},

	/** Tek JSON-RPC iletisi; bildirimlere (id yok) yanıt verilmez. */
	async _rpc(m) {
		if (!m || m.jsonrpc !== "2.0") return { jsonrpc: "2.0", id: m?.id ?? null, error: { code: -32600, message: "Geçersiz istek" } };
		let ok = (result) => ({ jsonrpc: "2.0", id: m.id, result });
		let err = (code, message) => ({ jsonrpc: "2.0", id: m.id, error: { code, message } });
		if (m.id === undefined) return null;
		try {
			switch (m.method) {
				case "initialize": {
					let v = m.params?.protocolVersion;
					return ok({
						protocolVersion: this.PROTOCOLS.includes(v) ? v : this.PROTOCOLS[0],
						capabilities: { tools: { listChanged: false } },
						serverInfo: { name: "zotero-hafif", title: "Zotero (Hafif)", version: Hafif.version },
						instructions: "Kullanıcının Zotero kütüphanesi. Kayıtlara 8 karakterlik anahtarla başvurulur. Önce search_library / semantic_search ile ara, read_document ile sayfa sayfa oku; atıflarda kayıt anahtarı ve PDF sayfasını belirt.",
					});
				}
				case "ping":
					return ok({});
				case "tools/list":
					return ok({
						tools: this._tools().map(t => ({
							name: t.name,
							description: t.description,
							inputSchema: t.parameters?.type ? t.parameters : { type: "object", properties: {} },
							annotations: t.name === "create_note" ? { readOnlyHint: false, destructiveHint: false } : { readOnlyHint: true },
						})),
					});
				case "tools/call": {
					let name = m.params?.name;
					let tool = this._tools().find(t => t.name === name);
					if (!tool) return err(-32602, "Bilinmeyen ya da kapalı araç: " + name);
					try {
						// Dış istemcide onay kartı yok: yalnızca ekleyici araçlar açıktır
						let out = await tool.run(m.params?.arguments || {}, {});
						let content = [];
						if (out && typeof out === "object") {
							content.push({ type: "text", text: out.text || "" });
							for (let i of out.images || []) content.push({ type: "image", data: i.data, mimeType: i.mediaType });
						}
						else content.push({ type: "text", text: String(out ?? "") });
						return ok({ content, isError: false });
					}
					catch (e) {
						return ok({ content: [{ type: "text", text: "Hata: " + (e.message || e) }], isError: true });
					}
				}
				case "resources/list":
					return ok({ resources: [] });
				case "prompts/list":
					return ok({ prompts: [] });
				default:
					return err(-32601, "Desteklenmeyen yöntem: " + m.method);
			}
		}
		catch (e) {
			return err(-32603, e.message || String(e));
		}
	},

	/** İstemci yapılandırmaları (ayarlarda kopyalanır). */
	configs() {
		let url = this.url();
		let token = this.token();
		return {
			claudeCode: `claude mcp add --transport http zotero ${url} --header "Authorization: Bearer ${token}"`,
			claudeDesktop: JSON.stringify({
				mcpServers: {
					zotero: { command: "npx", args: ["-y", "mcp-remote", url, "--header", `Authorization: Bearer ${token}`] },
				},
			}, null, 2),
		};
	},
};
