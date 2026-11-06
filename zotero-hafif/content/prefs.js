/* Hafif ayarlar bölümü (Zotero Ayarları içinde). Her değişiklik hemen kaydedilir. */

var HafifPrefs = {
	init() {
		let $ = (id) => document.getElementById(id);
		let Hafif = Zotero.Hafif;
		if (!Hafif || !$("hafif-searchKey")) return false;
		this.$ = $;
		this.Hafif = Hafif;
		this.A = Hafif.load("actions");
		let pref = this.pref = (k, v) => Hafif.pref(k, v);

		this.buildNav();

		let text = (id, key, fallback = "") => {
			let el = $(id);
			el.value = pref(key) || fallback;
			el.addEventListener("change", () => pref(key, el.value.trim()));
		};
		let check = (id, key, def = false) => {
			let el = $(id);
			let v = pref(key);
			el.checked = v === undefined ? def : !!v;
			el.addEventListener("change", () => pref(key, el.checked));
		};

		text("hafif-searchKey", "searchKey", "P");
		check("hafif-autoAppend", "autoAppend");
		check("hafif-moveByCollection", "moveByCollection");
		check("hafif-selfTest", "selfTest");
		check("hafif-quickLook", "quickLook", true);
		text("hafif-quoteTemplate", "quoteTemplate");
		text("hafif-moveDir", "moveDir");
		text("hafif-aiEffort", "aiEffort", "medium");
		text("hafif-aiInstructions", "aiInstructions");
		text("hafif-aiProfile", "aiProfile");
		$("hafif-aiProfile").placeholder = Hafif.load("agent").DEFAULT_PROFILE;
		check("hafif-aiWebSearch", "aiWebSearch");
		check("hafif-aiAutoApprove", "aiAutoApprove");
		check("hafif-aiExternal", "aiExternal", true);
		check("hafif-embedFulltext", "aiEmbedFulltext");
		check("hafif-embedAuto", "aiEmbedAuto", true);

		let lf = $("hafif-leftFloat");
		lf.checked = pref("leftFloat") === true;
		lf.addEventListener("change", () => {
			if ((pref("leftFloat") === true) !== lf.checked) Hafif.load("leftfloat").toggleEnabled();
		});
		let np = $("hafif-notePreview");
		np.checked = pref("notePreview") !== false;
		np.addEventListener("change", () => {
			pref("notePreview", np.checked);
			if (np.checked) for (let i of Hafif.load("compat").noteEditors()) Hafif.load("notepreview").attach(i);
			else Hafif.modules.notepreview?.detachAll();
		});

		let outline = $("hafif-noteOutline");
		outline.checked = pref("noteOutline") !== false;
		outline.addEventListener("change", () => {
			if ((pref("noteOutline") !== false) !== outline.checked) Hafif.load("notetoc").toggleEnabled();
		});

		$("hafif-quote-reset").addEventListener("click", (e) => {
			e.preventDefault();
			Services.prefs.getBranch("extensions.hafif.").clearUserPref("quoteTemplate");
			$("hafif-quoteTemplate").value = pref("quoteTemplate") || "";
		});

		$("hafif-collections").textContent = Hafif.load("notes").getCollections().map(c => c.name).join(", ") || "(henüz yok)";

		let sel = $("hafif-citeStyle");
		Hafif.load("cite").ready().then(() => {
			for (let s of Zotero.Styles.getVisible()) {
				let o = this.h("option", null, s.title);
				o.value = s.styleID;
				sel.append(o);
			}
			sel.value = Hafif.load("cite").styleID();
		});
		sel.addEventListener("change", () => pref("citeStyle", sel.value));

		$("hafif-moveDir-pick").addEventListener("click", async () => {
			let dir = await Hafif.load("move").pickFolder(window);
			if (dir) {
				$("hafif-moveDir").value = dir;
				pref("moveDir", dir);
			}
		});

		this.initAI();
		this.initMCP();
		this.initActions();
		this.initRules();
		this.initReadTags();
		this.initTemplates();
		this.initScripts();
		this.initPanel();
		this.initIO();
		this.initPerf();
		this.initReading();
		return true;
	},

	initReading() {
		let Hafif = this.Hafif;
		let check = (id, key, def) => {
			let el = this.$(id);
			let v = this.pref(key);
			el.checked = v === undefined ? def : !!v;
			el.addEventListener("change", () => {
				this.pref(key, el.checked);
				if (key === "readingTrack") {
					if (el.checked) Hafif.load("reading").start();
					else Hafif.modules.reading?.stop();
				}
			});
		};
		check("hafif-readingTrack", "readingTrack", true);
		check("hafif-readingSection", "readingSection", true);
		check("hafif-readingAutoState", "readingAutoState", true);
		check("hafif-readingAutoRead", "readingAutoRead", false);
		let rn = this.$("hafif-reviewNew");
		rn.value = this.pref("reviewNew") ?? 10;
		rn.addEventListener("change", () => this.pref("reviewNew", Math.max(0, Math.min(100, parseInt(rn.value, 10) || 0))));
		let A = Hafif.load("annots");
		let box = this.$("hafif-colors");
		let meanings = A.meanings();
		for (let [hex, name] of A.COLORS) {
			let lab = this.h("label", null);
			let dot = this.h("span");
			dot.style.cssText = `display: inline-block; width: 12px; height: 12px; border-radius: 3px; background: ${hex}; margin-inline-end: 6px; vertical-align: -1px;`;
			lab.append(dot, document.createTextNode(name));
			let input = this.h("input");
			input.value = meanings[hex] || "";
			input.placeholder = "anlamı yok";
			input.addEventListener("change", () => A.setMeaning(hex, input.value.trim()));
			box.append(lab, input);
		}
	},

	initPerf() {
		let out = this.$("hafif-perf-out");
		this.$("hafif-perf").addEventListener("click", () => {
			let p = this.Hafif.perf;
			let mods = Object.entries(p.modules).sort((a, b) => b[1] - a[1]);
			let total = mods.reduce((s, [, ms]) => s + ms, 0);
			out.textContent = [
				`Zotero ${Zotero.version} · Hafif ${this.Hafif.version}`,
				`Açılış (çekirdek): ${p.startup ?? "?"} ms`,
				`Pencere kurulumu: ${p.windows.join(", ") || "?"} ms`,
				`Yüklü modüller: ${mods.length} (toplam ${Math.round(total)} ms)`,
				...mods.map(([n, ms]) => `  ${n.padEnd(14)} ${ms} ms`),
			].join("\n");
			out.hidden = false;
		});
	},

	h(tag, cls, text) {
		let el = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
		if (cls) el.className = cls;
		if (text != null) el.textContent = text;
		return el;
	},

	json(key, value) {
		this.pref(key, JSON.stringify(value));
	},

	/** Ayarlarda arama: eşleşmeyen bölümler gizlenir (harekeden ve Türkçe harflerden bağımsız). */
	initSearch() {
		let S = this.Hafif.load("search");
		let input = this.$("hafif-pref-search");
		let sections = [...document.querySelectorAll("#hafif-prefs section[data-title]")];
		input.addEventListener("input", () => {
			let q = S.normalize(input.value.trim());
			for (let sec of sections) sec.hidden = !!q && !S.normalize(sec.textContent + " " + [...sec.querySelectorAll("input, textarea")].map(i => i.placeholder || "").join(" ")).includes(q);
		});
	},

	buildNav() {
		this.initSearch();
		let nav = this.$("hafif-nav");
		for (let sec of document.querySelectorAll("#hafif-prefs section[data-title]")) {
			let a = this.h("a", null, sec.dataset.title);
			a.addEventListener("click", () => sec.scrollIntoView({ behavior: "smooth", block: "start" }));
			nav.append(a);
		}
	},

	// ---- Eylemler ve kısayollar ----

	RESERVED() {
		let k = String(this.pref("searchKey") || "P").toUpperCase();
		return { [`accel+shift+${k}`]: "Hızlı arama", "accel+shift+T": "Etiket gezgini", "accel+shift+E": "Sekme yöneticisi", "accel+shift+C": "Zotero: kaynakça kopyala", "accel+shift+A": "Zotero: atıf kopyala", "accel+W": "Zotero: sekmeyi kapat", "accel+F": "Zotero: ara", "accel+Z": "Geri al" };
	},

	initActions() {
		this.$("hafif-act-filter").addEventListener("input", () => this.renderActions());
		this.$("hafif-act-reset").addEventListener("click", () => {
			if (!Services.prompt.confirm(window, "Hafif", "Bütün eylem kısayolları varsayılana dönsün mü?")) return;
			Services.prefs.getBranch("extensions.hafif.").clearUserPref("actionKeys");
			this.renderActions();
		});
		this.renderActions();
	},

	renderActions() {
		let A = this.A;
		let keys = A.keys();
		let menus = A.menus();
		let q = this.Hafif.load("search").normalize(this.$("hafif-act-filter").value);
		let box = this.$("hafif-actions");
		box.replaceChildren();
		this.$("hafif-palette-key").textContent = A.prettyKey(keys.palette) || "(kısayolsuz)";
		let groups = Object.fromEntries(A.GROUPS);
		// Aynı kısayol iki eylemde ya da Zotero'nun bilinen kısayolunda mı?
		let used = {};
		for (let [id, c] of Object.entries(keys)) if (c) (used[c] = used[c] || []).push(id);
		let reserved = this.RESERVED();

		for (let [gid, gname] of A.GROUPS) {
			let list = A.all().filter(a => a.group === gid)
				.filter(a => !q || this.Hafif.modules.search.normalize(a.name + " " + a.desc + " " + gname).includes(q));
			if (!list.length) continue;
			box.append(this.h("div", "hf-sub", groups[gid]));
			for (let a of list) {
				let row = this.h("div", "hf-act");
				let info = this.h("div");
				info.append(this.h("div", "n", a.name), this.h("div", "d", a.desc));

				let combo = keys[a.id] || "";
				let btn = this.h("button", "hf-key" + (combo ? "" : " empty"), combo ? A.prettyKey(combo) : "Kısayol ver");
				let clash = combo && ((used[combo] || []).length > 1 ? "Başka bir eylemde de var" : reserved[combo]);
				if (clash) {
					btn.classList.add("clash");
					btn.title = "Çakışma: " + clash;
				}
				else btn.title = "Tıklayıp tuşlara basın · ⌫ sil · esc vazgeç";
				btn.addEventListener("click", () => this.recordKey(btn, a.id));

				let menu = this.h("label", "hf-menu");
				if (a.items || a.script) {
					let cb = this.h("input");
					cb.type = "checkbox";
					cb.checked = a.script ? !!a.script.menu : !!menus[a.id];
					cb.addEventListener("change", () => {
						if (a.script) {
							let list = A.scripts();
							let s = list.find(x => x.id === a.script.id);
							if (s) s.menu = cb.checked;
							this.json("actionScripts", list);
						}
						else {
							let m = A.menus();
							m[a.id] = cb.checked;
							this.json("actionMenu", m);
						}
					});
					menu.append(cb, this.h("span", null, "Menüde"));
				}
				row.append(info, btn, menu);
				box.append(row);
			}
		}
		if (!box.children.length) box.append(this.h("div", "hf-empty", "Eşleşen eylem yok."));
	},

	recordKey(btn, id) {
		let A = this.A;
		btn.classList.add("rec");
		btn.textContent = "Tuşlara basın…";
		let done = (combo) => {
			btn.removeEventListener("keydown", onKey, true);
			btn.removeEventListener("blur", onBlur);
			if (combo !== undefined) {
				let keys = A.keys();
				if (combo) {
					// Aynı kısayol başka eylemdeyse oradan alınır
					for (let [k, v] of Object.entries(keys)) if (v === combo && k !== id) delete keys[k];
					keys[id] = combo;
				}
				else keys[id] = "";
				this.json("actionKeys", keys);
			}
			this.renderActions();
		};
		let onKey = (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (e.key === "Escape") return done(undefined);
			if (e.key === "Backspace" || e.key === "Delete") {
				if (!e.metaKey && !e.ctrlKey && !e.altKey) return done("");
			}
			let combo = A.comboFromEvent(e);
			if (!combo) {
				btn.textContent = "Bir değiştirici tuşla birlikte (⌘ ⌥ ⌃)…";
				return;
			}
			let r = this.RESERVED()[combo];
			if (r && !Services.prompt.confirm(window, "Kısayol çakışması", `${A.prettyKey(combo)} şu anda “${r}” için kullanılıyor. Yine de atansın mı?`)) return done(undefined);
			done(combo);
		};
		let onBlur = () => done(undefined);
		btn.addEventListener("keydown", onKey, true);
		btn.addEventListener("blur", onBlur);
		btn.focus();
	},

	// ---- Otomatik kurallar ----

	initRules() {
		this.$("hafif-rule-add").addEventListener("click", () => {
			let rules = this.A.rules();
			rules.push({ on: "itemAdd", do: "addTag", value: "", enabled: true });
			this.json("actionRules", rules);
			this.renderRules();
		});
		this.$("hafif-rule-presets").addEventListener("click", () => {
			let rules = this.A.rules();
			let names = this.A.tagNames();
			let presets = [
				{ on: "itemAdd", do: "addTag", value: names.toRead, enabled: true },
				{ on: "fileOpen", do: "action", value: "markReading", enabled: true },
			];
			for (let p of presets) {
				if (!rules.some(r => r.on === p.on && r.do === p.do && r.value === p.value)) rules.push(p);
			}
			this.json("actionRules", rules);
			this.renderRules();
		});
		this.renderRules();
	},

	renderRules() {
		let A = this.A;
		let box = this.$("hafif-rules");
		box.replaceChildren();
		let rules = A.rules();
		if (!rules.length) {
			box.append(this.h("div", "hf-empty", "Henüz kural yok."));
			return;
		}
		let save = () => this.json("actionRules", rules);
		let select = (options, value, onChange) => {
			let s = this.h("select");
			for (let [v, label] of options) {
				let o = this.h("option", null, label);
				o.value = v;
				s.append(o);
			}
			s.value = value;
			s.addEventListener("change", () => onChange(s.value));
			return s;
		};
		rules.forEach((r, i) => {
			let row = this.h("div", "hf-rule");
			let on = this.h("input");
			on.type = "checkbox";
			on.checked = r.enabled !== false;
			on.title = "Etkin";
			on.addEventListener("change", () => { r.enabled = on.checked; save(); });

			let when = select(A.TRIGGERS, r.on, (v) => { r.on = v; save(); });
			let what = select(A.RULE_ACTIONS, r.do, (v) => {
				r.do = v;
				r.value = v === "action" ? "markReading" : "";
				save();
				this.renderRules();
			});
			let value;
			if (r.do === "action") {
				let autos = A.all().filter(a => a.auto).map(a => [a.id, a.name]);
				value = select(autos, r.value, (v) => { r.value = v; save(); });
			}
			else {
				value = this.h("input");
				value.placeholder = r.do === "setLanguage" ? "ör. tr" : "etiket adı";
				value.value = r.value || "";
				value.style.flex = "1";
				value.addEventListener("change", () => { r.value = value.value.trim(); save(); });
			}
			let del = this.h("button", "hf-x", "✕");
			del.title = "Kuralı sil";
			del.addEventListener("click", () => {
				rules.splice(i, 1);
				save();
				this.renderRules();
			});
			row.append(on, this.h("span", "w", "Ne zaman"), when, this.h("span", "w", "→"), what, value, del);
			box.append(row);
		});
	},

	// ---- Okuma etiketleri ----

	initReadTags() {
		let names = this.A.tagNames();
		for (let k of ["toRead", "reading", "read"]) {
			let el = this.$("hafif-tag-" + k);
			el.value = names[k];
			el.addEventListener("change", () => {
				let cur = this.A.tagNames();
				cur[k] = el.value.trim();
				this.json("readTags", cur);
			});
		}
	},

	// ---- Not şablonları ----

	initTemplates() {
		this.$("hafif-tpl-add").addEventListener("click", () => {
			let list = this.Hafif.load("notes").templates();
			list.push({ name: "Yeni şablon", html: "<h1>{{başlık}}</h1>\n<h2>Giriş</h2>\n<p></p>" });
			this.pref("templates", JSON.stringify(list));
			this.renderTemplates();
		});
		this.renderTemplates();
	},

	renderTemplates() {
		let box = this.$("hafif-templates");
		box.replaceChildren();
		let list = this.Hafif.load("notes").templates().map(t => ({ ...t }));
		let save = () => {
			if (list.some(t => !t.name.trim() || !t.html.trim())) {
				this.$("hafif-templates-err").textContent = "Her şablonun adı ve içeriği olmalı; boş olan kaydedilmedi.";
				return;
			}
			this.$("hafif-templates-err").textContent = "";
			this.pref("templates", JSON.stringify(list));
		};
		list.forEach((t, i) => {
			let card = this.h("div", "hf-script");
			let head = this.h("div", "head");
			let name = this.h("input", "name");
			name.value = t.name;
			name.addEventListener("change", () => { t.name = name.value.trim(); save(); });
			let del = this.h("button", "hf-x", "✕");
			del.title = "Şablonu sil";
			del.addEventListener("click", () => {
				if (list.length === 1) return (this.$("hafif-templates-err").textContent = "En az bir şablon kalmalı.");
				list.splice(i, 1);
				save();
				this.renderTemplates();
			});
			head.append(name, del);
			let html = this.h("textarea");
			html.value = t.html.replace(/></g, ">\n<");
			html.style.minHeight = "70px";
			html.addEventListener("change", () => { t.html = html.value.replace(/>\s*\n\s*</g, "><").trim(); save(); });
			card.append(head, html);
			box.append(card);
		});
	},

	// ---- Özel betikler ----

	EXAMPLE: {
		name: "Kaynakları yıla göre etiketle",
		desc: "Seçili kayıtlara yüzyıl etiketi ekler (ör. “#20. yy”).",
		code: "for (let it of items) {\n\tlet y = parseInt(it.getField(\"date\", true, true));\n\tif (!y) continue;\n\tit.addTag(\"#\" + Math.ceil(y / 100) + \". yy\");\n\tawait it.saveTx();\n}\nreturn items.length + \" kayıt etiketlendi\";",
		menu: true,
	},

	initScripts() {
		let add = (s) => {
			let list = this.A.scripts();
			list.push({ id: "s" + Date.now().toString(36), ...s });
			this.json("actionScripts", list);
			this.renderScripts();
			this.renderActions();
		};
		this.$("hafif-script-add").addEventListener("click", () => add({ name: "Yeni betik", desc: "", code: "// items: seçili kayıtlar\nreturn items.length + \" kayıt seçili\";", menu: false }));
		this.$("hafif-script-example").addEventListener("click", () => add({ ...this.EXAMPLE }));
		this.renderScripts();
	},

	renderScripts() {
		let A = this.A;
		let box = this.$("hafif-scripts");
		box.replaceChildren();
		let list = A.scripts();
		if (!list.length) {
			box.append(this.h("div", "hf-empty", "Henüz betik yok."));
			return;
		}
		let save = () => {
			this.json("actionScripts", list);
			this.renderActions();
		};
		list.forEach((s, i) => {
			let card = this.h("div", "hf-script");
			let head = this.h("div", "head");
			let name = this.h("input", "name");
			name.value = s.name || "";
			name.placeholder = "Betik adı";
			name.addEventListener("change", () => { s.name = name.value.trim(); save(); });
			let test = this.h("button", null, "▶ Dene");
			test.title = "Zotero'da şu an seçili kayıtlar üzerinde çalıştırır";
			let msg = this.h("span", "hf-ok");
			test.addEventListener("click", async () => {
				try {
					let r = await A.runScript(s, A.context(Zotero.getMainWindow()));
					msg.className = "hf-ok";
					msg.textContent = "Çalıştı" + (typeof r === "string" ? ": " + r : "");
				}
				catch (e) {
					msg.className = "hf-err";
					msg.textContent = "Hata: " + e.message;
				}
			});
			let del = this.h("button", "hf-x", "✕");
			del.title = "Betiği sil";
			del.addEventListener("click", () => {
				if (!Services.prompt.confirm(window, "Hafif", `“${s.name}” betiği silinsin mi?`)) return;
				list.splice(i, 1);
				let keys = A.keys();
				delete keys["script:" + s.id];
				this.json("actionKeys", keys);
				save();
				this.renderScripts();
			});
			head.append(name, test, msg, del);
			let desc = this.h("input");
			desc.placeholder = "Kısa açıklama (eylem listesinde görünür)";
			desc.value = s.desc || "";
			desc.style.width = "100%";
			desc.style.margin = "6px 0";
			desc.addEventListener("change", () => { s.desc = desc.value.trim(); save(); });
			let code = this.h("textarea");
			code.value = s.code || "";
			code.spellcheck = false;
			code.addEventListener("change", () => { s.code = code.value; save(); });
			code.addEventListener("keydown", (e) => {
				if (e.key === "Tab" && !e.shiftKey) {
					e.preventDefault();
					let p = code.selectionStart;
					code.setRangeText("\t", p, code.selectionEnd, "end");
				}
			});
			card.append(head, desc, code);
			box.append(card);
		});
	},

	// ---- Sade bilgi paneli ----

	initPanel() {
		let panel = this.Hafif.load("panel");
		let box = this.$("hafif-panel-sections");
		for (let [id, name] of panel.SECTIONS) {
			let l = this.h("label", "hf-check");
			let cb = this.h("input");
			cb.type = "checkbox";
			cb.checked = !panel.isHidden(id);
			cb.addEventListener("change", () => {
				if (cb.checked === panel.isHidden(id)) panel.toggle(id);
			});
			l.append(cb, this.h("span", null, name));
			box.append(l);
		}
	},

	// ---- Dışa / içe aktarma ----

	initIO() {
		let msg = this.$("hafif-io-msg");
		let say = (t, err) => {
			msg.className = err ? "hf-err" : "hf-ok";
			msg.textContent = t;
		};
		let branch = Services.prefs.getBranch("extensions.hafif.");
		this.$("hafif-export").addEventListener("click", () => {
			let out = {};
			for (let k of branch.getChildList("")) {
				if (["aiKey", "aiKeys", "aiCustom", "lastTarget", "noteOutlineState", "aiModelCache", "mcpToken"].includes(k)) continue;
				out[k] = this.pref(k);
			}
			this.Hafif.copy(null, JSON.stringify(out, null, 2));
			say(`${Object.keys(out).length} ayar panoya kopyalandı.`);
		});
		this.$("hafif-import").addEventListener("click", () => {
			let v = { value: "" };
			if (!Services.prompt.prompt(window, "Ayarları içe aktar", "Dışa aktarılan JSON'u yapıştırın:", v, null, {})) return;
			try {
				let data = JSON.parse(v.value);
				let n = 0;
				for (let [k, val] of Object.entries(data)) {
					if (!/^\w+$/.test(k) || ["aiKey", "aiKeys", "aiCustom"].includes(k)) continue;
					if (["string", "boolean", "number"].includes(typeof val)) {
						this.pref(k, val);
						n++;
					}
				}
				say(`${n} ayar içe aktarıldı. Metin alanlarının yenilenmesi için Ayarlar'ı kapatıp açın.`);
				this.renderActions();
				this.renderRules();
				this.renderScripts();
				this.renderTemplates();
			}
			catch (e) {
				say("İçe aktarılamadı: " + e.message, true);
			}
		});
	},
};

// MCP, yapay zekâ ve anlamsal dizin bölümleri prefs-ai.js'te
Object.assign(HafifPrefs, HafifPrefsAI);

(function tryInit(n) {
	if (!HafifPrefs.init() && n < 50) setTimeout(() => tryInit(n + 1), 50);
})(0);
