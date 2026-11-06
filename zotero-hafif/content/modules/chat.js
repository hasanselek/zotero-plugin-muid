/* Yapay zekâ sohbet paneli (⌘J). Sağ panelin yerine açılır: kütüphanede kayıt panelinin,
 * okuyucuda not/bilgi panelinin yerine. Sekme değişince panel doğru yere taşınır.
 * Yanıtlar akış hâlinde gelir; araç adımları, düşünme özeti ve atıflar ([[ANAHTAR, s. N]])
 * ayrı ayrı gösterilir. Model çıktısı hiçbir zaman innerHTML ile yazılmaz; küçük bir
 * Markdown çözümleyicisi DOM düğümleri kurar. */

Hafif.modules.chat = {
	_ui: new WeakMap(),
	_observer: null,
	HTML: "http://www.w3.org/1999/xhtml",

	SUGGEST: {
		reader: ["Bu metni özetle: ana iddia, yöntem, sonuç", "Bu sayfadaki temel kavramları açıkla", "Kütüphanemdeki diğer kaynaklar bu konuda ne diyor?", "Bu eserdeki önemli alıntıları sayfalarıyla çıkar"],
		library: ["Kütüphanemde bu konuda neler var: ", "Seçili kayıtları karşılaştır", "Son bir ayda yaptığım sarı vurguları özetle", "Notlarımda geçen kaynakları listele"],
	},

	// ---- Açma / kapama ----

	toggle(win = Zotero.getMainWindow()) {
		let ui = this._ensure(win);
		if (ui.visible) this.hide(win);
		else this.show(win);
	},

	show(win = Zotero.getMainWindow(), { prompt, send } = {}) {
		let ui = this._ensure(win);
		ui.visible = true;
		this._place(win);
		this._refreshContext(ui);
		if (prompt != null) {
			ui.input.value = prompt;
			this._autosize(ui);
		}
		win.setTimeout(() => ui.input.focus(), 30);
		if (send) this.send(win);
	},

	/** Okuyucuda seçili metni (ya da alan görselini) bir sonraki soruya ekler ve paneli açar. */
	askAboutSelection(win, text, { page, image } = {}) {
		let ui = this._ensure(win);
		ui.selection = String(text || "").trim().slice(0, 4000) || null;
		ui.selectionPage = page || null;
		ui.images = image ? [image] : [];
		this.show(win);
	},

	QUICK: [
		["Açıkla", "Seçtiğim kısmı bağlamıyla birlikte açıkla; terimleri ve göndermeleri aç."],
		["Türkçeye çevir", "Seçtiğim kısmı akademik Türkçeye çevir; Arapça terimleri parantez içinde koru."],
		["Kütüphanemde", "Kütüphanemdeki diğer kaynaklar bu konuda ne diyor? Destekleyen ve karşı çıkanları atıflarıyla göster."],
		["Vurgula", "Bu kısmı PDF'te sarıyla vurgula ve kısa bir yorum ekle."],
	],

	hide(win = Zotero.getMainWindow()) {
		let ui = this._ui.get(win);
		if (!ui) return;
		ui.visible = false;
		this._place(win);
	},

	/** Paneli seçili sekmeye uygun yere taşır, kardeş öğeleri gizler ya da geri getirir. */
	_place(win) {
		let ui = this._ui.get(win);
		if (!ui) return;
		let doc = win.document;
		let library = win.Zotero_Tabs.selectedType === "library";
		let targets = { library: doc.getElementById("zotero-item-pane"), reader: doc.getElementById("zotero-context-pane") };
		for (let [loc, pane] of Object.entries(targets)) {
			let mount = ui.mounts[loc];
			if (!pane || !mount) continue;
			let active = ui.visible && (loc === "library") === library;
			for (let el of pane.children) {
				if (el === mount) continue;
				if (active) el.style.display = "none";
				else el.style.removeProperty("display");
			}
			mount.style.display = active ? "" : "none";
			if (active) {
				if (mount.firstChild !== ui.root) mount.append(ui.root);
				if (loc === "library" && win.ZoteroPane.itemPane?.collapsed) {
					ui.uncollapsed = "library";
					win.ZoteroPane.itemPane.collapsed = false;
					win.ZoteroPane.updateLayoutConstraints();
				}
				if (loc === "reader" && win.ZoteroContextPane?.collapsed) {
					ui.uncollapsed = "reader";
					win.ZoteroContextPane.collapsed = false;
				}
			}
		}
		if (!ui.visible && ui.uncollapsed) {
			// Panel açılırken kapalıydıysa kapanırken yine kapat
			if (ui.uncollapsed === "library") {
				win.ZoteroPane.itemPane.collapsed = true;
				win.ZoteroPane.updateLayoutConstraints();
			}
			else if (win.ZoteroContextPane) win.ZoteroContextPane.collapsed = true;
			ui.uncollapsed = null;
		}
		if (ui.visible) this._refreshContext(ui);
	},

	_watchTabs() {
		if (this._observer) return;
		this._observer = Zotero.Notifier.registerObserver({
			notify: (event, type) => {
				if (type !== "tab" || !["select", "load"].includes(event)) return;
				for (let win of Zotero.getMainWindows()) {
					if (this._ui.get(win)?.visible) win.setTimeout(() => this._place(win), 0);
				}
			},
		}, ["tab"], "hafif-chat");
	},

	destroy(win) {
		let ui = this._ui.get(win);
		if (!ui) return;
		ui.abort?.abort();
		ui.visible = false;
		this._place(win);
		for (let m of Object.values(ui.mounts)) m?.remove();
		ui.style.remove();
		this._ui.delete(win);
	},

	shutdown() {
		for (let win of Zotero.getMainWindows()) this.destroy(win);
		if (this._observer) Zotero.Notifier.unregisterObserver(this._observer);
		this._observer = null;
	},

	// ---- Kurulum ----

	h(doc, tag, cls, text) {
		let el = doc.createElementNS(this.HTML, tag);
		if (cls) el.className = cls;
		if (text != null) el.textContent = text;
		return el;
	},

	_ensure(win) {
		let ui = this._ui.get(win);
		if (ui) return ui;
		this._watchTabs();
		let doc = win.document;
		let h = (tag, cls, text) => this.h(doc, tag, cls, text);

		let style = h("style");
		style.textContent = this.CSS;
		doc.documentElement.append(style);

		let mounts = {};
		for (let [loc, id] of [["library", "zotero-item-pane"], ["reader", "zotero-context-pane"]]) {
			let pane = doc.getElementById(id);
			if (!pane) continue;
			let m = doc.createXULElement("vbox");
			m.id = "hafif-chat-" + loc;
			m.className = "hafif-chat-mount";
			m.style.display = "none";
			pane.append(m);
			mounts[loc] = m;
		}

		let root = h("div", "hc");
		// Üst çubuk
		let head = h("div", "hc-head");
		let histBtn = h("button", "hc-ib", "☰");
		histBtn.title = "Sohbet geçmişi";
		let title = h("div", "hc-title", "Yeni sohbet");
		let newBtn = h("button", "hc-ib", "＋");
		newBtn.title = "Yeni sohbet";
		let closeBtn = h("button", "hc-ib", "✕");
		closeBtn.title = "Kapat (⌘J)";
		head.append(histBtn, title, newBtn, closeBtn);

		// Geçmiş çekmecesi
		let drawer = h("div", "hc-drawer hidden");
		let dSearch = h("input", "hc-dsearch");
		dSearch.placeholder = "Sohbetlerde ara…";
		let dList = h("div", "hc-dlist");
		drawer.append(dSearch, dList);

		let list = h("div", "hc-list");
		let empty = h("div", "hc-empty");

		// Yazma alanı
		let composer = h("div", "hc-composer");
		let ctxBar = h("div", "hc-ctx");
		let input = h("textarea", "hc-input");
		input.rows = 1;
		input.placeholder = "Kütüphanenize ya da açık belgeye sorun…";
		input.setAttribute("dir", "auto");
		let row = h("div", "hc-row");
		let model = h("select", "hc-model");
		model.title = "Model";
		let usage = h("span", "hc-usage");
		let sendBtn = h("button", "hc-send", "↑");
		sendBtn.title = "Gönder (↵) · Yeni satır: ⇧↵";
		row.append(model, usage, sendBtn);
		composer.append(ctxBar, input, row);

		root.append(head, drawer, list, empty, composer);

		ui = { win, doc, root, style, mounts, head, title, drawer, dSearch, dList, list, empty, ctxBar, input, model, usage, sendBtn, visible: false, thread: null, running: false, useContext: true };
		this._ui.set(win, ui);

		closeBtn.addEventListener("click", () => this.hide(win));
		newBtn.addEventListener("click", () => this.newThread(ui));
		histBtn.addEventListener("click", () => this._toggleDrawer(ui));
		dSearch.addEventListener("input", () => this._renderDrawer(ui));
		input.addEventListener("input", () => this._autosize(ui));
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
				e.preventDefault();
				this.send(win);
			}
			else if (e.key === "Escape" && ui.running) {
				e.preventDefault();
				ui.abort?.abort();
			}
		});
		sendBtn.addEventListener("click", () => (ui.running ? ui.abort?.abort() : this.send(win)));
		model.addEventListener("change", () => {
			let [p, ...rest] = model.value.split(":");
			Hafif.load("llm").setCurrent(p, rest.join(":"));
			if (ui.thread) ui.thread.model = { provider: p, model: rest.join(":") };
		});
		list.addEventListener("click", (e) => this._onListClick(ui, e));

		this.newThread(ui);
		this._fillModels(ui);
		return ui;
	},

	_autosize(ui) {
		ui.input.style.height = "auto";
		ui.input.style.height = Math.min(200, ui.input.scrollHeight) + "px";
	},

	// ---- Model seçici ----

	_modelValue(ui) {
		let t = ui.thread?.model || Hafif.load("llm").current();
		return `${t.provider}:${t.model}`;
	},

	_fillModels(ui) {
		let llm = Hafif.load("llm");
		let sel = ui.model;
		sel.replaceChildren();
		let cur = this._modelValue(ui);
		let fav = this._favorites();
		let providers = llm.configured();
		let seen = new Set();
		let add = (parent, p, m) => {
			let o = this.h(ui.doc, "option", null, m.name && m.name !== m.id ? `${m.name}` : m.id);
			o.value = `${p}:${m.id}`;
			o.title = m.id;
			parent.append(o);
			seen.add(o.value);
		};
		if (fav.length) {
			let g = this.h(ui.doc, "optgroup");
			g.label = "Sık kullanılanlar";
			for (let v of fav) {
				let [p, ...rest] = v.split(":");
				if (!llm.provider(p)) continue;
				add(g, p, { id: rest.join(":") });
			}
			sel.append(g);
		}
		for (let p of providers) {
			let conf = llm.provider(p);
			let models = llm.models(p);
			if (!models.length) continue;
			let g = this.h(ui.doc, "optgroup");
			g.label = conf.label;
			for (let m of models) if (!seen.has(`${p}:${m.id}`)) add(g, p, m);
			sel.append(g);
		}
		if (!seen.has(cur)) {
			let [p, ...rest] = cur.split(":");
			add(sel, p, { id: rest.join(":") });
		}
		if (!providers.length) {
			let o = this.h(ui.doc, "option", null, "⚠︎ Sağlayıcı yok — Ayarlar › Hafif › Yapay zekâ");
			o.value = cur;
			sel.prepend(o);
		}
		sel.value = cur;
	},

	_favorites() {
		try {
			return JSON.parse(Hafif.pref("aiFavorites") || "[]");
		}
		catch (e) {
			return [];
		}
	},

	// ---- Bağlam çubuğu ----

	_refreshContext(ui) {
		let ctx = Hafif.load("libtools").viewContext(ui.win);
		ui.context = ctx;
		ui.ctxBar.replaceChildren();
		let chip = (icon, text, tip) => {
			let c = this.h(ui.doc, "span", "hc-chip" + (ui.useContext ? "" : " off"));
			c.title = (tip || text) + (ui.useContext ? " — soruya eklenir (kapatmak için tıklayın)" : " — eklenmiyor (açmak için tıklayın)");
			c.append(this.h(ui.doc, "span", "i", icon), this.h(ui.doc, "span", "t", text));
			c.addEventListener("click", () => {
				ui.useContext = !ui.useContext;
				this._refreshContext(ui);
			});
			ui.ctxBar.append(c);
		};
		let T = Hafif.load("libtools");
		if (ctx?.kind === "reader") {
			let label = `${T.creatorsShort(ctx.item, 1)} ${T.year(ctx.item)}`.trim() || ctx.item.getDisplayTitle();
			chip("📄", label + (ctx.page ? `, s. ${ctx.pageLabel || ctx.page}` : ""), ctx.item.getDisplayTitle());
		}
		else if (ctx?.items?.length) {
			let n = ctx.items.length;
			chip("▤", n === 1 ? (ctx.items[0].getDisplayTitle?.() || "1 kayıt").slice(0, 50) : `${n} kayıt seçili`);
		}
		else if (ctx?.collection) chip("🗂", ctx.collection.name);
		if (ui.images?.length) {
			let c = this.h(ui.doc, "span", "hc-chip");
			c.title = "Görsel bir sonraki soruya eklenecek — kaldırmak için tıklayın";
			c.append(this.h(ui.doc, "span", "i", "🖼"), this.h(ui.doc, "span", "t", "Seçili alan (görsel)"));
			c.addEventListener("click", () => {
				ui.images = [];
				this._refreshContext(ui);
			});
			ui.ctxBar.append(c);
		}
		ui.quick?.remove();
		ui.quick = null;
		if (ui.selection || ui.images?.length) {
			let q = ui.quick = this.h(ui.doc, "div", "hc-quick");
			for (let [label, prompt] of this.QUICK) {
				let b = this.h(ui.doc, "button", "hc-qb", label);
				b.addEventListener("click", () => {
					ui.input.value = prompt;
					this.send(ui.win);
				});
				q.append(b);
			}
			ui.ctxBar.after(q);
		}
		if (ui.selection) {
			let c = this.h(ui.doc, "span", "hc-chip");
			c.title = ui.selection + " — kaldırmak için tıklayın";
			c.append(this.h(ui.doc, "span", "i", "❝"), this.h(ui.doc, "span", "t", ui.selection.slice(0, 60)));
			c.addEventListener("click", () => {
				ui.selection = null;
				this._refreshContext(ui);
			});
			ui.ctxBar.append(c);
		}
		this._renderEmpty(ui);
	},

	_renderEmpty(ui) {
		let has = ui.thread?.messages.length;
		ui.empty.classList.toggle("hidden", !!has);
		ui.list.classList.toggle("hidden", !has);
		if (has) return;
		ui.empty.replaceChildren();
		let llm = Hafif.load("llm");
		let logo = this.h(ui.doc, "div", "hc-logo", "✦");
		let t = this.h(ui.doc, "div", "hc-etitle", "Araştırma asistanı");
		let d = this.h(ui.doc, "div", "hc-edesc", llm.configured().length
			? "Kütüphanenizde arar, PDF'leri okur, vurgu ve notlarınıza bakar; cevapları sayfa atıflarıyla verir."
			: "Başlamak için Zotero Ayarları › Hafif › Yapay zekâ bölümünden bir sağlayıcının API anahtarını girin (ya da Ollama/LM Studio'yu açın).");
		ui.empty.append(logo, t, d);
		let kind = ui.context?.kind === "reader" ? "reader" : "library";
		for (let s of this.SUGGEST[kind]) {
			let b = this.h(ui.doc, "button", "hc-sug", s);
			b.addEventListener("click", () => {
				ui.input.value = s;
				this._autosize(ui);
				if (!s.endsWith(": ")) this.send(ui.win);
				else ui.input.focus();
			});
			ui.empty.append(b);
		}
	},

	// ---- Sohbetler ----

	newThread(ui) {
		if (ui.running) return;
		ui.thread = Hafif.load("agent").newThread();
		ui.thread.model = Hafif.load("llm").current();
		ui.title.textContent = "Yeni sohbet";
		ui.list.replaceChildren();
		ui.usage.textContent = "";
		this._fillModels(ui);
		this._refreshContext(ui);
		ui.drawer.classList.add("hidden");
		ui.input.focus();
	},

	async openThread(ui, id) {
		if (ui.running) return;
		let t = await Hafif.load("agent").load(id);
		ui.thread = t;
		ui.title.textContent = t.title || "(başlıksız)";
		ui.drawer.classList.add("hidden");
		this._fillModels(ui);
		this._renderThread(ui);
		this._showUsage(ui, t.usage);
	},

	async _toggleDrawer(ui) {
		let open = ui.drawer.classList.toggle("hidden") === false;
		if (open) {
			ui.dSearch.value = "";
			await this._renderDrawer(ui);
			ui.dSearch.focus();
		}
	},

	async _renderDrawer(ui) {
		let all = await Hafif.load("agent").list();
		let q = Hafif.load("search").normalize(ui.dSearch.value);
		ui.dList.replaceChildren();
		let rows = all.filter(t => !q || Hafif.modules.search.normalize(t.title).includes(q));
		if (!rows.length) ui.dList.append(this.h(ui.doc, "div", "hc-dnone", all.length ? "Eşleşen sohbet yok." : "Henüz kayıtlı sohbet yok."));
		for (let t of rows.slice(0, 300)) {
			let r = this.h(ui.doc, "div", "hc-drow" + (t.id === ui.thread?.id ? " cur" : ""));
			let tt = this.h(ui.doc, "div", "t", t.title);
			tt.setAttribute("dir", "auto");
			let d = this.h(ui.doc, "div", "d", new Date(t.updated).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }));
			let del = this.h(ui.doc, "button", "hc-ib x", "✕");
			del.title = "Sil";
			del.addEventListener("click", async (e) => {
				e.stopPropagation();
				if (!Services.prompt.confirm(ui.win, "Sohbeti sil", `“${t.title}” silinsin mi?`)) return;
				await Hafif.load("agent").remove(t.id);
				if (ui.thread?.id === t.id) this.newThread(ui);
				this._renderDrawer(ui);
			});
			r.append(tt, d, del);
			r.addEventListener("click", () => this.openThread(ui, t.id));
			ui.dList.append(r);
		}
	},

	// ---- Gönderme ----

	async send(win = Zotero.getMainWindow(), opts = {}) {
		let ui = this._ensure(win);
		let text = (opts.text ?? ui.input.value).trim();
		if (!text || ui.running) return;
		if (!Hafif.load("llm").configured().length && !Hafif.load("llm").keys().anthropic) {
			Hafif.toast("Önce Ayarlar › Hafif › Yapay zekâ bölümünden bir API anahtarı girin.", 5000);
			return;
		}
		ui.input.value = "";
		this._autosize(ui);
		this._refreshContext(ui);
		let selection = opts.selection || ui.selection || null;
		let selectionPage = ui.selectionPage;
		let images = opts.images || (ui.images?.length ? ui.images : null);
		ui.selection = null;
		ui.selectionPage = null;
		ui.images = [];
		let ctx = ui.useContext ? { ...ui.context, selection, selectionPage } : (selection ? { selection, selectionPage } : null);
		let thread = ui.thread;
		ui.title.textContent = thread.title || text.slice(0, 80);

		// Kullanıcı balonu
		this._renderEmpty(ui);
		ui.list.classList.remove("hidden");
		ui.empty.classList.add("hidden");
		ui.list.append(this._userBubble(ui, text, ctx));

		let ac = new ui.win.AbortController();
		ui.abort = ac;
		this._setRunning(ui, true);
		let turn = this._turnEl(ui);
		ui.list.append(turn.el);
		this._scroll(ui, true);

		let cur = null; // akan metin bölümü
		let think = null;
		let pending = false;
		let flush = () => {
			pending = false;
			if (cur) this._renderMarkdown(ui, cur.body, cur.text);
			if (think) think.body.textContent = think.text;
			this._scroll(ui);
		};
		let schedule = () => {
			if (!pending) {
				pending = true;
				ui.win.requestAnimationFrame(flush);
			}
		};
		try {
			await Hafif.load("agent").run(thread, text, {
				context: ctx,
				images: images || undefined,
				signal: ac.signal,
				on: {
					onStep: () => {
						cur = null;
						think = null;
						turn.status.textContent = "Düşünüyor…";
					},
					onThinking: (d) => {
						if (!think) {
							think = this._thinkEl(ui);
							turn.body.append(think.el);
							cur = null;
						}
						think.text += d;
						schedule();
					},
					onText: (d) => {
						if (!cur) {
							cur = { text: "", body: this.h(ui.doc, "div", "hc-md") };
							turn.body.append(cur.body);
							think = null;
						}
						cur.text += d;
						turn.status.textContent = "Yazıyor…";
						schedule();
					},
					onToolStart: (call) => {
						cur = null;
						think = null;
						let s = this._toolEl(ui, call);
						turn.tools.set(call.id, s);
						turn.body.append(s.el);
						turn.status.textContent = s.label + "…";
						this._scroll(ui);
					},
					onToolEnd: (call, out, isError) => {
						let s = turn.tools.get(call.id);
						if (s) this._finishTool(ui, s, out, isError);
					},
					onApprove: (call, preview) => {
						let s = turn.tools.get(call.id);
						turn.status.textContent = "Onayınızı bekliyor…";
						return this._approvalCard(ui, s?.el || turn.body, preview, ac.signal);
					},
					onUndo: (call, label, fn) => {
						let s = turn.tools.get(call.id);
						this._undoButton(ui, s?.el || turn.body, label, fn);
					},
					onUsage: (u) => this._showUsage(ui, { input: (thread.usage?.input || 0) + u.input, output: (thread.usage?.output || 0) + u.output }),
				},
			});
		}
		catch (e) {
			let aborted = ac.signal.aborted || e.name === "AbortError";
			// Boş kalan son asistan mesajını at, sohbeti tutarlı bırak
			let last = thread.messages[thread.messages.length - 1];
			if (last?.role === "assistant" && !last.content.length) thread.messages.pop();
			Hafif.load("agent").repair(thread);
			if (!aborted) {
				Zotero.logError(e);
				let err = this.h(ui.doc, "div", "hc-error", e.message || String(e));
				turn.body.append(err);
				let last2 = thread.messages[thread.messages.length - 1];
				if (last2?.role === "assistant") last2.content = [{ type: "text", text: "_Hata: " + (e.message || e) + "_" }];
			}
			else turn.body.append(this.h(ui.doc, "div", "hc-note", "Durduruldu."));
			try {
				await Hafif.load("agent").save(thread);
			}
			catch (e2) {
				Zotero.logError(e2);
			}
		}
		finally {
			flush();
			this._setRunning(ui, false);
			turn.status.remove();
			this._addTurnActions(ui, turn);
			ui.title.textContent = thread.title || "Sohbet";
			ui.abort = null;
		}
	},

	_setRunning(ui, on) {
		ui.running = on;
		ui.root.classList.toggle("running", on);
		ui.sendBtn.textContent = on ? "■" : "↑";
		ui.sendBtn.title = on ? "Durdur (esc)" : "Gönder (↵) · Yeni satır: ⇧↵";
		ui.model.disabled = on;
	},

	_showUsage(ui, u) {
		if (!u || !(u.input || u.output)) {
			ui.usage.textContent = "";
			return;
		}
		let k = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "b" : String(n));
		ui.usage.textContent = `${k(u.input)} → ${k(u.output)}`;
		ui.usage.title = `Bu sohbette: ${u.input} girdi, ${u.output} çıktı jetonu`;
	},

	_scroll(ui, force) {
		let l = ui.list;
		if (force || l.scrollHeight - l.scrollTop - l.clientHeight < 120) l.scrollTop = l.scrollHeight;
	},

	// ---- Mesaj öğeleri ----

	_userBubble(ui, text, ctx) {
		let el = this.h(ui.doc, "div", "hc-user");
		let b = this.h(ui.doc, "div", "hc-ubody", text);
		b.setAttribute("dir", "auto");
		el.append(b);
		if (ctx?.kind === "reader") {
			let T = Hafif.load("libtools");
			el.append(this.h(ui.doc, "div", "hc-uctx", `📄 ${T.creatorsShort(ctx.item, 1)} ${T.year(ctx.item)}${ctx.page ? ", s. " + (ctx.pageLabel || ctx.page) : ""}`));
		}
		else if (ctx?.items?.length) el.append(this.h(ui.doc, "div", "hc-uctx", `▤ ${ctx.items.length} kayıt`));
		if (ctx?.selection) {
			let q = this.h(ui.doc, "div", "hc-uctx sel", "“" + ctx.selection.slice(0, 160) + (ctx.selection.length > 160 ? "…" : "") + "”");
			q.setAttribute("dir", "auto");
			el.append(q);
		}
		return el;
	},

	_turnEl(ui) {
		let el = this.h(ui.doc, "div", "hc-turn");
		let body = this.h(ui.doc, "div", "hc-tbody");
		let status = this.h(ui.doc, "div", "hc-status", "Düşünüyor…");
		el.append(body, status);
		return { el, body, status, tools: new Map() };
	},

	_thinkEl(ui) {
		let el = this.h(ui.doc, "details", "hc-think");
		let sum = this.h(ui.doc, "summary", null, "Düşünme");
		let body = this.h(ui.doc, "div", "hc-tbody2");
		body.setAttribute("dir", "auto");
		el.append(sum, body);
		return { el, body, text: "" };
	},

	_toolEl(ui, call) {
		let tool = Hafif.load("agent").tools().find(t => t.name === call.name);
		let label;
		try {
			label = tool ? tool.label(call.input || {}) : call.name;
		}
		catch (e) {
			label = call.name;
		}
		let el = this.h(ui.doc, "details", "hc-tool run");
		let sum = this.h(ui.doc, "summary");
		sum.append(this.h(ui.doc, "span", "dot"), this.h(ui.doc, "span", "lbl", label), this.h(ui.doc, "span", "res"));
		let pre = this.h(ui.doc, "pre", "hc-pre");
		el.append(sum, pre);
		return { el, sum, pre, label, call };
	},

	_finishTool(ui, s, out, isError) {
		s.el.classList.remove("run");
		s.el.classList.toggle("err", !!isError);
		let res = s.sum.querySelector(".res");
		res.textContent = isError ? " — hata" : this._resultHint(out);
		s.pre.textContent = (s.call.input && Object.keys(s.call.input).length ? "Girdi: " + JSON.stringify(s.call.input) + "\n\n" : "") + (out.length > 6000 ? out.slice(0, 6000) + "\n…" : out);
	},

	/** Değişiklik önizlemesi ve Ekle/Vazgeç düğmeleri; kullanıcının kararıyla çözülür. */
	_approvalCard(ui, anchor, preview, signal) {
		let doc = ui.doc;
		let h = (tag, cls, text) => this.h(doc, tag, cls, text);
		let card = h("div", "hc-approve");
		card.append(h("div", "hc-ap-title", preview.title || "Onay gerekiyor"));
		let list = h("div", "hc-ap-list");
		for (let it of preview.items || []) {
			let row = h("div", "hc-ap-item");
			let sw = h("span", "hc-ap-sw" + (it.color ? "" : " none"));
			if (it.color) sw.style.background = it.color;
			let body = h("div", "hc-ap-body");
			let t = h("div", "hc-ap-text", "“" + it.text + "”");
			t.setAttribute("dir", "auto");
			body.append(t, h("div", "hc-ap-meta", it.meta || ""));
			if (it.comment) {
				let c = h("div", "hc-ap-comment", it.comment);
				c.setAttribute("dir", "auto");
				body.append(c);
			}
			row.append(sw, body);
			list.append(row);
		}
		card.append(list);
		if (preview.note) card.append(h("div", "hc-ap-note", preview.note));
		let bar = h("div", "hc-ap-bar");
		let yes = h("button", "hc-ap-yes", preview.yes || "Ekle");
		let no = h("button", "hc-ap-no", "Vazgeç");
		bar.append(yes, no);
		card.append(bar);
		if (anchor.localName === "details") {
			anchor.open = true;
			anchor.after(card);
		}
		else anchor.append(card);
		this._scroll(ui, true);
		return new Promise((resolve) => {
			let done = (v) => {
				yes.disabled = no.disabled = true;
				bar.replaceChildren(h("span", "hc-ap-done", v ? "✓ Onaylandı" : "✕ Vazgeçildi"));
				card.classList.add("done");
				resolve(v);
			};
			yes.addEventListener("click", () => done(true), { once: true });
			no.addEventListener("click", () => done(false), { once: true });
			signal?.addEventListener("abort", () => done(false), { once: true });
			yes.focus();
		});
	},

	_undoButton(ui, anchor, label, fn) {
		let b = this.h(ui.doc, "button", "hc-undo", "↶ " + label);
		b.addEventListener("click", Hafif.safe(async () => {
			b.disabled = true;
			await fn();
			b.textContent = "Geri alındı";
			Hafif.toast("Geri alındı.");
		}));
		// Onay kartının (ya da araç satırının) hemen altına
		let card = anchor.nextElementSibling?.classList?.contains("hc-approve") ? anchor.nextElementSibling : null;
		if (card) card.after(b);
		else if (anchor.localName === "details") anchor.after(b);
		else anchor.append(b);
	},

	_resultHint(out) {
		try {
			let j = JSON.parse(out);
			if (j.toplam != null) return ` — ${j.toplam} sonuç`;
			if (Array.isArray(j)) return ` — ${j.length} sonuç`;
			if (j.eşleşmeler) return ` — ${j.eşleşmeler.length} yer`;
			if (j.vurgular) return ` — ${j.vurgular.length} vurgu`;
		}
		catch (e) {}
		let m = out.match(/toplam (\d+) (sayfa|bölüm)/);
		if (m) return ` — ${m[1]} ${m[2]}lık belge`;
		return out.length < 80 ? " — " + out.replace(/\s+/g, " ") : "";
	},

	/** Kayıtlı bir sohbeti baştan çizer. */
	_renderThread(ui) {
		ui.list.replaceChildren();
		let turn = null;
		let results = new Map();
		for (let m of ui.thread.messages) {
			if (m.role === "user" && m.toolResults) for (let r of m.content) results.set(r.id, r);
		}
		for (let m of ui.thread.messages) {
			if (m.role === "user" && !m.toolResults) {
				if (turn) this._addTurnActions(ui, turn);
				ui.list.append(this._userBubble(ui, m.display || m.content.find(b => b.type === "text")?.text || ""));
				turn = this._turnEl(ui);
				turn.status.remove();
				ui.list.append(turn.el);
			}
			else if (m.role === "assistant" && turn) {
				for (let b of m.content) {
					if (b.type === "thinking" && b.thinking) {
						let t = this._thinkEl(ui);
						t.body.textContent = b.thinking;
						turn.body.append(t.el);
					}
					else if (b.type === "text" && b.text) {
						let d = this.h(ui.doc, "div", "hc-md");
						this._renderMarkdown(ui, d, b.text);
						turn.body.append(d);
					}
					else if (b.type === "tool_use") {
						let s = this._toolEl(ui, b);
						let r = results.get(b.id);
						if (r) this._finishTool(ui, s, r.content, r.isError);
						turn.body.append(s.el);
					}
				}
			}
		}
		if (turn) this._addTurnActions(ui, turn);
		this._renderEmpty(ui);
		ui.list.scrollTop = ui.list.scrollHeight;
	},

	_addTurnActions(ui, turn) {
		if (turn.el.querySelector(".hc-actions")) return;
		let mds = [...turn.body.querySelectorAll(".hc-md")];
		if (!mds.length) return;
		let bar = this.h(ui.doc, "div", "hc-actions");
		let btn = (label, tip, fn) => {
			let b = this.h(ui.doc, "button", "hc-ab", label);
			b.title = tip;
			b.addEventListener("click", Hafif.safe(fn));
			bar.append(b);
		};
		btn("⧉ Kopyala", "Yanıtı biçimiyle kopyala", () => {
			let { html, text } = this._export(ui, mds);
			Hafif.copy(html, text, "Yanıt kopyalandı.");
		});
		btn("✎ Not olarak kaydet", "Yanıtı yeni bir Zotero notu olarak kaydet", () => this._saveNote(ui, mds));
		let tables = mds.flatMap(md => [...md.querySelectorAll("table")]);
		if (tables.length) {
			btn("▦ Tabloyu kopyala", "Tabloyu Excel/Word'e yapıştırmak için kopyala", () => {
				Hafif.copy(this._tableHTML(tables[0]), this._tableRows(tables[0]).map(r => r.join("\t")).join("\n"), "Tablo kopyalandı.");
			});
			btn("⇩ CSV", "Tabloyu CSV dosyası olarak kaydet", () => this._saveCSV(ui, tables[0]));
		}
		turn.el.append(bar);
	},

	/** Tablo satırları: atıf düğmeleri metne çevrilir. */
	_tableRows(table) {
		return [...table.querySelectorAll("tr")].map(tr => [...tr.children].map(td => {
			let c = td.cloneNode(true);
			for (let b of c.querySelectorAll(".hc-cite")) b.replaceWith(c.ownerDocument.createTextNode(" (" + b.dataset.text + ")"));
			return c.textContent.replace(/\s+/g, " ").trim();
		}));
	},

	_tableHTML(table) {
		let rows = this._tableRows(table);
		let esc = (s) => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
		return `<table border="1">${rows.map((r, i) => `<tr>${r.map(c => i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`).join("")}</tr>`).join("")}</table>`;
	},

	async _saveCSV(ui, table) {
		let rows = this._tableRows(table);
		let csv = "\ufeff" + rows.map(r => r.map(c => /[",\n;]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(",")).join("\r\n");
		let { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
		let fp = new FilePicker();
		fp.init(ui.win, "Tabloyu kaydet", fp.modeSave);
		fp.appendFilter("CSV", "*.csv");
		fp.defaultString = (ui.thread?.title || "tablo").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) + ".csv";
		if (await fp.show() === fp.returnCancel) return;
		await IOUtils.writeUTF8(fp.file, csv);
		Hafif.toast("Tablo kaydedildi.");
	},

	/** Yanıtı not/pano için dışa aktarır: atıf düğmeleri düz metin atfa çevrilir. */
	_export(ui, mds) {
		let wrap = this.h(ui.doc, "div");
		for (let md of mds) wrap.append(md.cloneNode(true));
		for (let c of wrap.querySelectorAll(".hc-cite")) c.replaceWith(ui.doc.createTextNode(" (" + c.dataset.text + ")"));
		for (let b of wrap.querySelectorAll("button")) b.remove();
		let html = new ui.win.XMLSerializer().serializeToString(wrap).replace(/ xmlns="[^"]*"/g, "").replace(/ class="[^"]*"/g, "");
		return { html, text: wrap.textContent };
	},

	async _saveNote(ui, mds) {
		let { html } = this._export(ui, mds);
		let note = new Zotero.Item("note");
		let ctx = ui.context;
		let parent = ctx?.kind === "reader" ? ctx.item : null;
		note.libraryID = parent?.libraryID ?? Zotero.Libraries.userLibraryID;
		if (parent?.isRegularItem()) note.parentID = parent.id;
		let q = ui.thread?.title ? `<h1>${Hafif.load("notes")._esc(ui.thread.title)}</h1>` : "";
		note.setNote(`<div data-schema-version="9">${q}${html}</div>`);
		await note.saveTx();
		Hafif.toast(parent ? "Yanıt, kaydın altına not olarak eklendi." : "Yanıt yeni bir not olarak kaydedildi.");
	},

	// ---- Atıflar ----

	_onListClick(ui, e) {
		let c = e.target.closest?.(".hc-cite");
		if (c) {
			e.preventDefault();
			return this.openCitation(ui.win, c.dataset.key, c.dataset.page, c.dataset.quote);
		}
		let a = e.target.closest?.("a[data-href]");
		if (a) {
			e.preventDefault();
			Zotero.launchURL(a.dataset.href);
		}
	},

	/** Kaydın PDF eki (eşzamanlı). */
	_pdfOf(key) {
		try {
			let T = Hafif.load("libtools");
			let it = T.byKey(key);
			if (it.isPDFAttachment?.()) return it;
			let top = T.top(it);
			for (let id of top.getAttachments?.() || []) {
				let a = Zotero.Items.get(id);
				if (a?.isPDFAttachment() && !a.deleted) return a;
			}
		}
		catch (e) {}
		return null;
	},

	_printed(key, page) {
		let att = this._pdfOf(key);
		return att ? Hafif.load("pdfsvc").labelSync(att, page - 1) : String(page);
	},

	/** Sayfa etiketleri bellekte yoksa arka planda yükler, gelince düğmeyi günceller. */
	_ensureLabels(key, done) {
		let att = this._pdfOf(key);
		if (!att) return;
		let svc = Hafif.load("pdfsvc");
		if (svc._labels.has(att.libraryID + "/" + att.key)) return;
		svc.labels(att).then(() => done()).catch(() => {});
	},

	async openCitation(win, key, page, quote) {
		let T = Hafif.load("libtools");
		let item;
		try {
			item = T.byKey(key);
		}
		catch (e) {
			return Hafif.toast(e.message);
		}
		let n = parseInt(page);
		if (n) {
			let att = await T.documentOf(item);
			if (att?.isPDFAttachment()) {
				// Alıntı varsa PDF'te tam yerini bul: okuyucu o bölgeyi kısa süre vurgular
				let loc = quote ? await Hafif.load("pdfsvc").findQuote(att, n - 1, quote, { spread: 2 }) : null;
				let location = loc ? { position: { pageIndex: loc.pageIndex, rects: loc.rects } } : { pageIndex: n - 1 };
				await Zotero.Reader.open(att.id, location);
				return;
			}
		}
		let top = T.top(item);
		win.Zotero_Tabs.select("zotero-pane");
		await win.ZoteroPane.selectItem(top.id);
	},

	_citeLabel(key) {
		let T = Hafif.load("libtools");
		try {
			let top = T.top(T.byKey(key));
			if (top.isNote()) return top.getNoteTitle().slice(0, 30) || "not";
			let a = T.creatorsShort(top, 1).split(";")[0];
			let y = T.year(top);
			return [a, y].filter(Boolean).join(" ") || top.getField("title").slice(0, 30);
		}
		catch (e) {
			return null;
		}
	},

	// ---- Markdown ----

	/** Basit Markdown → DOM: başlık, paragraf, liste, alıntı, kod, tablo, kalın/eğik, bağlantı, atıf. */
	_renderMarkdown(ui, el, src) {
		let doc = ui.doc;
		let h = (tag, cls, text) => this.h(doc, tag, cls, text);
		el.replaceChildren();
		let lines = String(src).replace(/\r/g, "").split("\n");
		let i = 0;
		let para = [];
		let flushPara = () => {
			if (!para.length) return;
			let p = h("p");
			p.setAttribute("dir", "auto");
			this._inline(ui, p, para.join("\n"));
			el.append(p);
			para = [];
		};
		while (i < lines.length) {
			let line = lines[i];
			let m;
			if (/^```/.test(line)) {
				flushPara();
				let code = [];
				i++;
				while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
				i++;
				el.append(h("pre", "hc-code", code.join("\n")));
				continue;
			}
			if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
				flushPara();
				let hd = h("h" + Math.min(6, m[1].length + 2));
				hd.setAttribute("dir", "auto");
				this._inline(ui, hd, m[2]);
				el.append(hd);
				i++;
				continue;
			}
			if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
				flushPara();
				el.append(h("hr"));
				i++;
				continue;
			}
			if (/^\s*>/.test(line)) {
				flushPara();
				let q = [];
				while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
				let bq = h("blockquote");
				bq.setAttribute("dir", "auto");
				this._renderMarkdown(ui, bq, q.join("\n"));
				el.append(bq);
				continue;
			}
			if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
				flushPara();
				let cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
				let table = h("table");
				let tr = h("tr");
				for (let c of cells(line)) {
					let th = h("th");
					this._inline(ui, th, c);
					tr.append(th);
				}
				table.append(tr);
				i += 2;
				while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
					let r = h("tr");
					for (let c of cells(lines[i++])) {
						let td = h("td");
						td.setAttribute("dir", "auto");
						this._inline(ui, td, c);
						r.append(td);
					}
					table.append(r);
				}
				let wrap = h("div", "hc-tablewrap");
				wrap.append(table);
				el.append(wrap);
				continue;
			}
			if ((m = line.match(/^(\s*)([-*+]|\d+[.)])\s+/))) {
				flushPara();
				let ordered = /\d/.test(m[2]);
				let list = h(ordered ? "ol" : "ul");
				let base = m[1].length;
				while (i < lines.length) {
					let lm = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
					if (!lm) {
						// Liste öğesinin devam satırı
						if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && list.lastChild) {
							list.lastChild.append(doc.createTextNode(" "));
							this._inline(ui, list.lastChild, lines[i].trim());
							i++;
							continue;
						}
						break;
					}
					// Aynı düzeyde liste türü değişince (madde ↔ numara) yeni liste başlar
					if (lm[1].length <= base + 1 && /\d/.test(lm[2]) !== ordered) break;
					if (lm[1].length > base + 1 && list.lastChild) {
						// İç içe liste
						let sub = [];
						while (i < lines.length && (lines[i].match(/^(\s*)/)[1].length > base + 1) && lines[i].trim()) sub.push(lines[i++].slice(base + 2));
						let wrap = h("div");
						this._renderMarkdown(ui, wrap, sub.join("\n"));
						list.lastChild.append(...wrap.childNodes);
						continue;
					}
					let li = h("li");
					li.setAttribute("dir", "auto");
					this._inline(ui, li, lm[3]);
					list.append(li);
					i++;
				}
				el.append(list);
				continue;
			}
			if (!line.trim()) {
				flushPara();
				i++;
				continue;
			}
			para.push(line);
			i++;
		}
		flushPara();
	},

	/** Satır içi öğeler: **kalın**, *eğik*, `kod`, [bağlantı](url), [[ANAHTAR, s. N]] atıfı. */
	_inline(ui, el, text) {
		let doc = ui.doc;
		let re = /(\[\[([A-Za-z0-9]{8})(?:\s*[,;|:]\s*(?:s\.|p\.|pp\.|sayfa)?\s*([\w\-–]+))?(?:\s*[,;|]\s*["“”«„]([^"“”»\]]{2,600})["“”»])?\]\])|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|(\*([^*\s][^*]*?)\*)|(_([^_\s][^_]*?)_(?![\p{L}\p{N}]))|(\n)/gu;
		let last = 0;
		let m;
		while ((m = re.exec(text))) {
			if (m.index > last) el.append(doc.createTextNode(text.slice(last, m.index)));
			if (m[1]) {
				let key = m[2].toUpperCase();
				let page = m[3];
				let quote = m[4];
				let label = this._citeLabel(key);
				if (label) {
					let b = this.h(doc, "button", "hc-cite" + (quote ? " q" : ""));
					b.dataset.key = key;
					if (page) b.dataset.page = page;
					if (quote) b.dataset.quote = quote;
					let setText = () => {
						// PDF sayfası yerine kitabın basılı sayfa numarası gösterilir (biliniyorsa)
						let printed = page && /^\d+$/.test(page) ? this._printed(key, +page) : page;
						b.textContent = printed ? `${label}, s. ${printed}` : label;
						b.dataset.text = b.textContent;
					};
					setText();
					this._ensureLabels(key, setText);
					b.title = quote ? `“${quote}”\n— tıklayınca PDF'te bu cümle vurgulanır` : page ? "PDF'i bu sayfada aç" : "Kaydı göster";
					el.append(b);
				}
				else el.append(doc.createTextNode(m[0]));
			}
			else if (m[5]) {
				let s = this.h(doc, "strong");
				this._inline(ui, s, m[6]);
				el.append(s);
			}
			else if (m[7]) {
				let s = this.h(doc, "strong");
				this._inline(ui, s, m[8]);
				el.append(s);
			}
			else if (m[9]) el.append(this.h(doc, "code", null, m[10]));
			else if (m[11]) {
				let a = this.h(doc, "a", null, m[12]);
				a.dataset.href = m[13];
				a.href = "#";
				a.title = m[13];
				el.append(a);
			}
			else if (m[14]) {
				let s = this.h(doc, "em");
				this._inline(ui, s, m[15]);
				el.append(s);
			}
			else if (m[16]) {
				let s = this.h(doc, "em");
				this._inline(ui, s, m[17]);
				el.append(s);
			}
			else if (m[18]) el.append(this.h(doc, "br"));
			last = re.lastIndex;
		}
		if (last < text.length) el.append(doc.createTextNode(text.slice(last)));
	},

	CSS: `
.hafif-chat-mount { flex: 1; min-width: 0; min-height: 0; height: 100%; }
#zotero-item-pane > .hafif-chat-mount, #zotero-context-pane > .hafif-chat-mount { width: 100%; }
.hc { --hc-accent: #8a5a2b; --hc-soft: color-mix(in srgb, var(--hc-accent) 12%, transparent); --hc-line: var(--fill-quinary, #8883); --hc-muted: var(--fill-secondary, #777);
	display: flex; flex-direction: column; height: 100%; min-height: 0; width: 100%; background: var(--material-sidepane, var(--material-background, Canvas)); color: var(--fill-primary, CanvasText); font: message-box; font-size: 13px; }
@media (prefers-color-scheme: dark) { .hc { --hc-accent: #d9a466; } }
.hc .hidden { display: none !important; }
.hc button { font: inherit; color: inherit; cursor: pointer; }
.hc-head { display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--hc-line); min-height: 38px; }
.hc-title { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hc-ib { border: 0; background: none; width: 26px; height: 26px; border-radius: 6px; font-size: 14px; color: var(--hc-muted) !important; flex: none; }
.hc-ib:hover { background: var(--fill-quinary, #8882); color: var(--fill-primary) !important; }
.hc-drawer { border-bottom: 1px solid var(--hc-line); max-height: 45%; display: flex; flex-direction: column; background: var(--material-background, Canvas); }
.hc-dsearch { margin: 6px 8px; padding: 4px 8px; border: 1px solid var(--hc-line); border-radius: 6px; background: transparent; color: inherit; font: inherit; }
.hc-dlist { overflow-y: auto; padding-bottom: 6px; }
.hc-drow { display: grid; grid-template-columns: 1fr auto auto; gap: 6px; align-items: center; padding: 5px 10px; cursor: default; }
.hc-drow:hover, .hc-drow.cur { background: var(--hc-soft); }
.hc-drow .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hc-drow .d { font-size: 11px; color: var(--hc-muted); }
.hc-drow .x { width: 20px; height: 20px; font-size: 11px; opacity: 0; }
.hc-drow:hover .x { opacity: 1; }
.hc-dnone { padding: 10px; color: var(--hc-muted); font-style: italic; }
.hc-list { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.hc-empty { flex: 1; min-height: 0; overflow-y: auto; padding: 28px 18px; display: flex; flex-direction: column; align-items: stretch; gap: 8px; }
.hc-logo { font-size: 26px; color: var(--hc-accent); text-align: center; }
.hc-etitle { font-weight: 650; font-size: 15px; text-align: center; }
.hc-edesc { color: var(--hc-muted); text-align: center; line-height: 1.45; margin-bottom: 10px; }
.hc-sug { text-align: start; border: 1px solid var(--hc-line); background: none; border-radius: 8px; padding: 7px 10px; line-height: 1.35; }
.hc-sug:hover { border-color: var(--hc-accent); background: var(--hc-soft); }
.hc-user { align-self: flex-end; max-width: 88%; background: var(--hc-soft); border-radius: 12px 12px 3px 12px; padding: 7px 11px; }
.hc-ubody { white-space: pre-wrap; line-height: 1.45; user-select: text; }
.hc-uctx { font-size: 11px; color: var(--hc-muted); margin-top: 3px; }
.hc-uctx.sel { font-style: italic; }
.hc-turn { display: flex; flex-direction: column; gap: 6px; }
.hc-tbody { display: flex; flex-direction: column; gap: 6px; }
.hc-status { font-size: 12px; color: var(--hc-muted); font-style: italic; }
.hc-status::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--hc-accent); margin-inline-end: 6px; animation: hc-pulse 1s infinite alternate; }
@keyframes hc-pulse { from { opacity: .25; } to { opacity: 1; } }
.hc-tool, .hc-think { border: 1px solid var(--hc-line); border-radius: 7px; font-size: 12px; }
.hc-tool summary, .hc-think summary { padding: 4px 8px; cursor: pointer; color: var(--hc-muted); list-style: none; display: flex; gap: 6px; align-items: center; }
.hc-tool summary::-webkit-details-marker { display: none; }
.hc-tool .dot { width: 7px; height: 7px; border-radius: 50%; background: #5fb236; flex: none; }
.hc-tool.run .dot { background: var(--hc-accent); animation: hc-pulse .6s infinite alternate; }
.hc-tool.err .dot { background: #d64545; }
.hc-tool .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.hc-tool .res { flex: none; opacity: .8; }
.hc-pre { margin: 0; padding: 6px 8px; max-height: 260px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-size: 11px; border-top: 1px solid var(--hc-line); user-select: text; }
.hc-think summary::before { content: "◌"; }
.hc-tbody2 { padding: 6px 9px; white-space: pre-wrap; color: var(--hc-muted); font-size: 12px; line-height: 1.45; max-height: 240px; overflow: auto; border-top: 1px solid var(--hc-line); user-select: text; }
.hc-md { line-height: 1.55; user-select: text; word-wrap: break-word; }
.hc-md > :first-child { margin-top: 0; }
.hc-md > :last-child { margin-bottom: 0; }
.hc-md p { margin: .5em 0; }
.hc-md h3, .hc-md h4, .hc-md h5, .hc-md h6 { margin: .9em 0 .35em; line-height: 1.3; }
.hc-md h3 { font-size: 1.15em; } .hc-md h4 { font-size: 1.05em; } .hc-md h5, .hc-md h6 { font-size: 1em; }
.hc-md ul, .hc-md ol { margin: .4em 0; padding-inline-start: 1.4em; }
.hc-md li { margin: .2em 0; }
.hc-md blockquote { margin: .5em 0; padding: .2em .8em; border-inline-start: 3px solid var(--hc-accent); background: var(--hc-soft); border-radius: 0 6px 6px 0; }
.hc-md code { font-family: ui-monospace, Menlo, monospace; font-size: .9em; background: var(--fill-quinary, #8882); padding: 0 .3em; border-radius: 4px; }
.hc-code { font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; background: var(--fill-quinary, #8881); padding: 8px; border-radius: 6px; overflow-x: auto; white-space: pre; }
.hc-tablewrap { overflow-x: auto; margin: .5em 0; }
.hc-md table { border-collapse: collapse; font-size: 12px; }
.hc-md th, .hc-md td { border: 1px solid var(--hc-line); padding: 3px 6px; text-align: start; vertical-align: top; }
.hc-md th { background: var(--hc-soft); }
.hc-md a { color: var(--hc-accent); }
.hc-md hr { border: 0; border-top: 1px solid var(--hc-line); margin: .8em 0; }
.hc-cite { border: 0; background: var(--hc-soft); color: var(--hc-accent) !important; border-radius: 9px; padding: 0 6px; margin: 0 1px; font-size: .82em; font-weight: 600; line-height: 1.5; white-space: nowrap; vertical-align: baseline; }
.hc-cite:hover { background: var(--hc-accent); color: #fff !important; }
.hc-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.hc-cite.q { border-bottom: 1px dotted var(--hc-accent); border-radius: 9px 9px 4px 4px; }
.hc-approve { border: 1px solid var(--hc-accent); border-radius: 9px; padding: 8px 10px; background: var(--hc-soft); display: flex; flex-direction: column; gap: 6px; }
.hc-approve.done { border-color: var(--hc-line); background: none; }
.hc-ap-title { font-weight: 650; font-size: 12.5px; }
.hc-ap-list { display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow-y: auto; }
.hc-ap-item { display: flex; gap: 8px; align-items: flex-start; }
.hc-ap-sw { width: 10px; height: 10px; border-radius: 3px; margin-top: 4px; flex: none; }
.hc-ap-sw.none { width: 3px; border-radius: 2px; align-self: stretch; height: auto; margin: 2px 0; background: var(--hc-accent); opacity: .5; }
.hc-ap-text { white-space: pre-wrap; }
.hc-ap-body { flex: 1; min-width: 0; }
.hc-ap-text { font-size: 12px; line-height: 1.45; user-select: text; }
.hc-ap-meta { font-size: 11px; color: var(--hc-muted); }
.hc-ap-comment { font-size: 11.5px; margin-top: 2px; padding-inline-start: 8px; border-inline-start: 2px solid var(--hc-line); }
.hc-ap-note { font-size: 11.5px; color: var(--hc-muted); font-style: italic; }
.hc-ap-bar { display: flex; gap: 6px; }
.hc-ap-yes { border: 0; background: var(--hc-accent); color: #fff !important; border-radius: 6px; padding: 4px 14px; font-weight: 600; }
.hc-ap-no { border: 1px solid var(--hc-line); background: none; border-radius: 6px; padding: 4px 12px; }
.hc-ap-done { font-size: 11.5px; color: var(--hc-muted); }
.hc-undo { align-self: flex-start; border: 1px solid var(--hc-line); background: none; border-radius: 6px; padding: 2px 9px; font-size: 11.5px !important; color: var(--hc-muted) !important; }
.hc-undo:hover:not(:disabled) { border-color: var(--hc-accent); color: var(--fill-primary) !important; }
.hc-quick { display: flex; gap: 4px; flex-wrap: wrap; }
.hc-qb { border: 1px solid var(--hc-line); background: none; border-radius: 12px; padding: 2px 10px; font-size: 11.5px !important; }
.hc-qb:hover { border-color: var(--hc-accent); background: var(--hc-soft); }
.hc-ab { border: 0; background: none; color: var(--hc-muted) !important; font-size: 11.5px !important; padding: 2px 6px; border-radius: 5px; }
.hc-ab:hover { background: var(--fill-quinary, #8882); color: var(--fill-primary) !important; }
.hc-error { color: #d64545; background: color-mix(in srgb, #d64545 10%, transparent); border-radius: 7px; padding: 6px 9px; font-size: 12px; user-select: text; }
.hc-note { color: var(--hc-muted); font-size: 12px; font-style: italic; }
.hc-composer { border-top: 1px solid var(--hc-line); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.hc-ctx { display: flex; gap: 4px; flex-wrap: wrap; }
.hc-ctx:empty { display: none; }
.hc-chip { display: inline-flex; gap: 4px; align-items: center; max-width: 100%; font-size: 11.5px; border: 1px solid var(--hc-line); border-radius: 10px; padding: 1px 8px; cursor: pointer; }
.hc-chip .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hc-chip.off { opacity: .45; text-decoration: line-through; }
.hc-input { resize: none; border: 1px solid var(--hc-line); border-radius: 9px; padding: 7px 9px; font: inherit; color: inherit; background: var(--material-background, Canvas); min-height: 34px; max-height: 200px; line-height: 1.4; }
.hc-input:focus { outline: none; border-color: var(--hc-accent); }
.hc-row { display: flex; gap: 6px; align-items: center; }
.hc-model { flex: 1; min-width: 0; max-width: 260px; font-size: 11.5px; }
.hc-usage { flex: 1; font-size: 10.5px; color: var(--hc-muted); text-align: end; font-variant-numeric: tabular-nums; }
.hc-send { width: 30px; height: 30px; border-radius: 50%; border: 0; background: var(--hc-accent); color: #fff !important; font-size: 15px; font-weight: 700; flex: none; }
.hc.running .hc-send { background: #d64545; font-size: 11px; }
`,
};
