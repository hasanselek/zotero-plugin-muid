/* Hafif ayarları: MCP sunucusu, yapay zekâ sağlayıcıları ve anlamsal dizin bölümleri.
 * prefs.js'ten önce yüklenir; yöntemler HafifPrefs nesnesine eklenir (this = HafifPrefs). */

// eslint-disable-next-line no-unused-vars
var HafifPrefsAI = {
	// ---- MCP ----

	initMCP() {
		let M = this.Hafif.load("mcp");
		let $ = this.$;
		let on = $("hafif-mcpEnabled");
		let write = $("hafif-mcpWrite");
		let msg = $("hafif-mcpMsg");
		let fill = () => {
			$("hafif-mcpUrl").textContent = M.url();
			$("hafif-mcpToken").value = M.enabled() ? M.token() : "";
			for (let id of ["hafif-mcpCode", "hafif-mcpDesktop", "hafif-mcpTest", "hafif-mcpRenew"]) $(id).disabled = !M.enabled();
		};
		on.checked = M.enabled();
		write.checked = this.pref("mcpWrite") === true;
		on.addEventListener("change", () => {
			this.pref("mcpEnabled", on.checked);
			M.register();
			fill();
		});
		write.addEventListener("change", () => this.pref("mcpWrite", write.checked));
		$("hafif-mcpRenew").addEventListener("click", () => {
			if (!Services.prompt.confirm(window, "Hafif", "Yeni anahtar üretilsin mi? Eski anahtarla yapılandırılmış istemciler çalışmaz, yapılandırmayı yeniden kopyalamanız gerekir.")) return;
			this.pref("mcpToken", "");
			fill();
		});
		$("hafif-mcpCode").addEventListener("click", () => this.Hafif.copy(null, M.configs().claudeCode, "Komut kopyalandı."));
		$("hafif-mcpDesktop").addEventListener("click", () => this.Hafif.copy(null, M.configs().claudeDesktop, "Yapılandırma kopyalandı."));
		$("hafif-mcpTest").addEventListener("click", async () => {
			msg.className = "hf-ok";
			msg.textContent = "…";
			try {
				let res = await fetch(M.url(), {
					method: "POST",
					// Zotero tarayıcı kimlikli istekleri engeller; ayarlar penceresinin isteği bu başlıkla geçer
					headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer " + M.token(), "zotero-allowed-request": "1" },
					body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
				});
				let j = await res.json();
				msg.textContent = `✓ Çalışıyor: ${j.result.tools.length} araç`;
			}
			catch (e) {
				msg.className = "hf-err";
				msg.textContent = "Bağlanılamadı: " + e.message + " (Zotero Ayarları › Gelişmiş'te yerel API/bağlayıcı sunucusu kapalı olabilir)";
			}
		});
		fill();
	},

	// ---- Yapay zekâ sağlayıcıları ----

	initAI() {
		this.llm = this.Hafif.load("llm");
		this.$("hafif-aiDefault").addEventListener("change", (e) => {
			let [p, ...m] = e.target.value.split(":");
			this.llm.setCurrent(p, m.join(":"));
		});
		this.$("hafif-custom-add").addEventListener("click", () => {
			let list = this.llm.custom();
			list.push({ id: "c" + Date.now().toString(36), label: "Yeni uç nokta", base: "", format: "openai", key: "" });
			this.json("aiCustom", list);
			this.renderCustom();
		});
		this.renderProviders();
		this.renderCustom();
		this.fillDefaultModel();
		this.initEmbed();
	},

	// ---- Anlamsal dizin ----

	initEmbed() {
		let E = this.Hafif.load("embed");
		let llm = this.llm;
		let sel = this.$("hafif-embedProvider");
		let model = this.$("hafif-embedModel");
		let opts = [["", "— kapalı —"], ...["ollama", "lmstudio", "google", "openai", "voyage", "mistral"].map(id => [id, llm.PROVIDERS[id].label]),
			...llm.custom().filter(c => (c.format || "openai") === "openai").map(c => [c.id, c.label || c.base])];
		for (let [v, l] of opts) {
			let o = this.h("option", null, l);
			o.value = v;
			sel.append(o);
		}
		let cur = (this.pref("aiEmbed") || "").split(":");
		sel.value = cur[0] || "";
		model.value = cur.slice(1).join(":") || E.DEFAULTS[cur[0]]?.model || "";
		let save = () => {
			if (!sel.value) this.pref("aiEmbed", "");
			else this.pref("aiEmbed", `${sel.value}:${model.value.trim() || E.DEFAULTS[sel.value]?.model || ""}`);
			E._mem = null;
			this.embedStatus();
		};
		sel.addEventListener("change", () => {
			model.value = E.DEFAULTS[sel.value]?.model || "";
			save();
		});
		model.addEventListener("change", save);
		this.$("hafif-embedBuild").addEventListener("click", () => this.buildEmbed());
		this.$("hafif-embedStop").addEventListener("click", () => this._embedAbort?.abort());
		this.$("hafif-embedDelete").addEventListener("click", async () => {
			let cfg = E.config();
			if (!cfg || !Services.prompt.confirm(window, "Hafif", "Bu modelin anlamsal dizini silinsin mi? (Kütüphaneniz etkilenmez.)")) return;
			await IOUtils.remove(E._dir(cfg), { recursive: true, ignoreAbsent: true });
			E._mem = null;
			this.embedStatus();
		});
		this.embedStatus();
	},

	async embedStatus(extra) {
		let el = this.$("hafif-embedStatus");
		if (!el) return;
		let st = await this.Hafif.load("embed").status();
		if (!st.configured) {
			el.textContent = "Kapalı. Bir sağlayıcı seçin.";
			return;
		}
		let when = st.at ? new Date(st.at).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
		el.textContent = extra || (st.chunks
			? `Dizinde ${st.items} kayıt, ${st.chunks} parça (${st.text} tam metin parçası) · son güncelleme ${when} · model ${st.cfg.model}`
			: `Model ${st.cfg.model} — dizin henüz kurulmadı.`);
	},

	async buildEmbed() {
		let E = this.Hafif.load("embed");
		let build = this.$("hafif-embedBuild");
		let stop = this.$("hafif-embedStop");
		let ac = this._embedAbort = new AbortController();
		build.disabled = true;
		stop.hidden = false;
		let t0 = Date.now();
		try {
			let r = await E.update({
				signal: ac.signal,
				onProgress: ({ phase, done, total }) => {
					let eta = "";
					if (total && done) {
						let left = (Date.now() - t0) / done * (total - done) / 1000;
						eta = left > 90 ? ` · ~${Math.round(left / 60)} dk kaldı` : ` · ~${Math.round(left)} sn kaldı`;
					}
					this.embedStatus(total ? `${phase}: ${done}/${total}${eta}` : phase);
				},
			});
			await this.embedStatus();
			let el = this.$("hafif-embedStatus");
			el.textContent += ` — ${r.stopped ? "durduruldu" : "tamam"}: ${r.added} yeni, ${r.kept} değişmedi, ${r.removed} silindi.`;
		}
		catch (e) {
			if (e.name === "AbortError") await this.embedStatus();
			else this.$("hafif-embedStatus").textContent = "Hata: " + e.message;
		}
		finally {
			build.disabled = false;
			stop.hidden = true;
		}
	},

	fillDefaultModel() {
		let sel = this.$("hafif-aiDefault");
		let llm = this.llm;
		let cur = llm.current();
		let curV = `${cur.provider}:${cur.model}`;
		sel.replaceChildren();
		let seen = false;
		for (let p of llm.configured()) {
			let g = this.h("optgroup");
			g.label = llm.provider(p).label;
			for (let m of llm.models(p)) {
				let o = this.h("option", null, m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id);
				o.value = `${p}:${m.id}`;
				if (o.value === curV) seen = true;
				g.append(o);
			}
			if (g.children.length) sel.append(g);
		}
		if (!seen) {
			let o = this.h("option", null, `${cur.model} (${cur.provider})`);
			o.value = curV;
			sel.prepend(o);
		}
		sel.value = curV;
	},

	renderProviders() {
		let llm = this.llm;
		let box = this.$("hafif-providers");
		box.replaceChildren();
		let keys = llm.keys();
		let bases = llm.bases();
		let local = llm._json("aiLocal", {});
		for (let [id, p] of Object.entries(llm.PROVIDERS)) {
			let card = this.h("div", "hf-rule");
			let name = this.h("b", null, p.label);
			name.style.minWidth = "170px";
			card.append(name);
			let status = this.h("span", "hf-ok");
			let cached = llm.cachedModels()[id];
			if (cached?.models?.length) status.textContent = `✓ ${cached.models.length} model`;
			if (p.local) {
				let l = this.h("label", "hf-menu");
				let cb = this.h("input");
				cb.type = "checkbox";
				cb.checked = !!local[id];
				cb.addEventListener("change", () => {
					let cur = llm._json("aiLocal", {});
					cur[id] = cb.checked;
					this.json("aiLocal", cur);
					this.fillDefaultModel();
				});
				l.append(cb, this.h("span", null, "Kullan"));
				let base = this.h("input");
				base.value = bases[id] || p.base;
				base.style.flex = "1";
				base.title = "Sunucu adresi";
				base.addEventListener("change", () => this.setBase(id, base.value.trim(), p.base));
				card.append(l, base);
			}
			else {
				let key = this.h("input");
				key.type = "password";
				key.autocomplete = "off";
				key.placeholder = "API anahtarı";
				key.value = keys[id] || "";
				key.style.flex = "1";
				key.addEventListener("change", async () => {
					await llm.setKey(id, key.value.trim());
					this.fillDefaultModel();
				});
				card.append(key);
				if (p.keyUrl) {
					let a = this.h("a", null, "anahtar al");
					a.href = "#";
					a.style.fontSize = "11.5px";
					a.addEventListener("click", (e) => {
						e.preventDefault();
						Zotero.launchURL(p.keyUrl);
					});
					card.append(a);
				}
			}
			let test = this.h("button", null, "Dene");
			test.title = "Bağlantıyı dener ve model listesini çeker";
			test.addEventListener("click", async () => {
				status.className = "hf-ok";
				status.textContent = "…";
				try {
					status.textContent = "✓ " + await llm.test(id);
					this.fillDefaultModel();
				}
				catch (e) {
					status.className = "hf-err";
					status.textContent = e.message;
				}
			});
			card.append(test, status);
			box.append(card);
		}
	},

	setBase(id, value, def) {
		let b = this.llm.bases();
		if (!value || value === def) delete b[id];
		else b[id] = value;
		this.json("aiBases", b);
	},

	renderCustom() {
		let llm = this.llm;
		let box = this.$("hafif-custom");
		box.replaceChildren();
		let list = llm.custom();
		if (!list.length) box.append(this.h("div", "hf-empty", "Eklenmiş uç nokta yok."));
		let save = () => {
			this.json("aiCustom", list);
			this.fillDefaultModel();
		};
		list.forEach((c, i) => {
			let card = this.h("div", "hf-script");
			let head = this.h("div", "head");
			let name = this.h("input", "name");
			name.value = c.label || "";
			name.placeholder = "Ad";
			name.addEventListener("change", () => { c.label = name.value.trim(); save(); });
			let fmt = this.h("select");
			for (let [v, l] of [["openai", "OpenAI uyumlu"], ["anthropic", "Anthropic uyumlu"]]) {
				let o = this.h("option", null, l);
				o.value = v;
				fmt.append(o);
			}
			fmt.value = c.format || "openai";
			fmt.addEventListener("change", () => { c.format = fmt.value; save(); });
			let status = this.h("span", "hf-ok");
			let test = this.h("button", null, "Dene");
			test.addEventListener("click", async () => {
				status.className = "hf-ok";
				status.textContent = "…";
				try {
					status.textContent = "✓ " + await llm.test(c.id);
					this.fillDefaultModel();
				}
				catch (e) {
					status.className = "hf-err";
					status.textContent = e.message;
				}
			});
			let del = this.h("button", "hf-x", "✕");
			del.title = "Sil";
			del.addEventListener("click", () => {
				list.splice(i, 1);
				save();
				this.renderCustom();
			});
			head.append(name, fmt, test, status, del);
			let row = this.h("div", "hf-row");
			let base = this.h("input");
			base.placeholder = "https://sunucu.adresi/v1";
			base.value = c.base || "";
			base.style.flex = "2";
			base.addEventListener("change", () => { c.base = base.value.trim(); save(); });
			let key = this.h("input");
			key.type = "password";
			key.placeholder = "API anahtarı (gerekmiyorsa boş)";
			key.value = this.llm.customKey(c);
			key.style.flex = "1";
			key.addEventListener("change", async () => { await this.llm.setCustomKey(c, key.value.trim()); save(); });
			row.append(base, key);
			card.append(head, row);
			box.append(card);
		});
	},
};
