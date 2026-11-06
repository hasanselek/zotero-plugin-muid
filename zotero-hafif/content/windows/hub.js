/* Hafif Merkezi penceresi. Bütün veri Hafif modüllerinden gelir (annots, reading, project, lint);
 * pencere yalnızca gösterir. Metinler textContent ile yazılır (innerHTML kullanılmaz). */

var HafifHub = {
	tab: null,
	sel: new Set(),
	anns: [],
	shown: 300,
	deck: [],
	pos: 0,
	lintReport: [],

	init() {
		this.Hafif = Zotero.Hafif;
		let $ = this.$ = (id) => document.getElementById(id);
		let nav = $("tabs");
		for (let [id, label] of this.Hafif.load("hub").TABS) {
			let b = this.h("button", null, label);
			b.dataset.tab = id;
			b.addEventListener("click", () => this.show(id));
			nav.append(b);
		}
		// Kütüphaneler
		for (let lib of Zotero.Libraries.getAll().filter(l => ["user", "group"].includes(l.libraryType))) {
			let o = this.h("option", null, lib.name);
			o.value = lib.libraryID;
			$("library").append(o);
		}
		$("library").value = Zotero.getActiveZoteroPane()?.getSelectedLibraryID?.() || Zotero.Libraries.userLibraryID;
		$("library").addEventListener("change", () => {
			this._loaded = {};
			this.show(this.tab, true);
		});
		this._loaded = {};
		this.initAnnots();
		this.initReview();
		this.initProjects();
		this.initLint();
		document.addEventListener("keydown", (e) => this.onKey(e));
		let arg = window.arguments?.[0];
		this.show(arg?.tab || "annots");
	},

	libraryID() {
		return +this.$("library").value;
	},

	h(tag, cls, text) {
		let el = document.createElement(tag);
		if (cls) el.className = cls;
		if (text != null) el.textContent = text;
		return el;
	},

	safe(fn) {
		return (...a) => Promise.resolve().then(() => fn(...a)).catch((e) => {
			Zotero.logError(e);
			this.Hafif.toast("Hata: " + e.message, 5000);
		});
	},

	show(tab, force) {
		this.tab = tab;
		this.Hafif.pref("hubTab", tab);
		for (let b of this.$("tabs").children) b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false");
		for (let p of document.querySelectorAll(".pane")) p.classList.toggle("on", p.id === "pane-" + tab);
		if (force || !this._loaded[tab]) {
			this._loaded[tab] = true;
			let run = { annots: () => this.loadAnnots(), review: () => this.loadReview(), reading: () => this.loadReading(), projects: () => this.loadProjects(), lint: () => this.fillScopes() }[tab];
			this.safe(run)();
		}
	},

	onKey(e) {
		if (this.tab !== "review" || e.target.closest?.("input, select, textarea")) return;
		let k = { 1: "r-yes", 2: "r-no", 3: "r-open", 0: "r-skip" }[e.key];
		if (k) {
			e.preventDefault();
			this.$(k).click();
		}
	},

	/** Ana pencerede kaydı seçer ve öne getirir. */
	async reveal(item) {
		let win = Zotero.getMainWindow();
		win.focus();
		win.Zotero_Tabs.select("zotero-pane");
		await win.ZoteroPane.selectItem(item.id);
	},

	// ---- Vurgular ----

	initAnnots() {
		let A = this.Hafif.load("annots");
		let $ = this.$;
		this.colorsOn = new Set();
		let meanings = A.meanings();
		for (let [hex, name] of A.COLORS) {
			let c = this.h("span", "chip");
			c.style.background = hex;
			c.title = name + (meanings[hex] ? " — " + meanings[hex] : "");
			c.addEventListener("click", () => {
				c.classList.toggle("on");
				c.classList.contains("on") ? this.colorsOn.add(hex) : this.colorsOn.delete(hex);
				this.safe(() => this.loadAnnots())();
			});
			$("a-colors").append(c);
		}
		let reload = () => this.safe(() => this.loadAnnots())();
		let t;
		$("a-q").addEventListener("input", () => {
			clearTimeout(t);
			t = setTimeout(reload, 250);
		});
		for (let id of ["a-type", "a-since", "a-col"]) $(id).addEventListener("change", reload);
		$("a-all").addEventListener("click", () => {
			let all = this.sel.size < this.anns.length;
			this.sel = all ? new Set(this.anns.map(a => a.id)) : new Set();
			this.renderAnnots();
		});
		$("a-copy").addEventListener("click", () => {
			let list = this.selectedOrAll();
			Zotero.Utilities.Internal.copyTextToClipboard(A.toMarkdown(list));
			this.Hafif.toast(`${list.length} vurgu Markdown olarak kopyalandı.`, 1800);
		});
		$("a-save").addEventListener("click", this.safe(async () => {
			let list = this.selectedOrAll();
			let { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
			let fp = new FilePicker();
			fp.init(window, "Vurguları kaydet", fp.modeSave);
			fp.appendFilter("Markdown", "*.md");
			fp.defaultString = "vurgular.md";
			if (await fp.show() === fp.returnCancel) return;
			await IOUtils.writeUTF8(fp.file, A.toMarkdown(list));
			this.Hafif.toast(`${list.length} vurgu kaydedildi.`);
		}));
		$("a-send").addEventListener("click", this.safe(async () => {
			let list = this.selectedOrAll();
			if (!list.length) return;
			await A.sendToNote(list);
		}));
	},

	selectedOrAll() {
		return this.sel.size ? this.anns.filter(a => this.sel.has(a.id)) : this.anns;
	},

	fillCollections() {
		let sel = this.$("a-col");
		let cur = sel.value;
		sel.replaceChildren(Object.assign(this.h("option", null, "Bütün koleksiyonlar"), { value: "" }));
		let walk = (cols, depth) => {
			for (let c of cols.sort((a, b) => a.name.localeCompare(b.name, "tr"))) {
				let o = this.h("option", null, "  ".repeat(depth) + c.name);
				o.value = c.id;
				sel.append(o);
				walk(c.getChildCollections(false), depth + 1);
			}
		};
		walk(Zotero.Collections.getByLibrary(this.libraryID(), false), 0);
		sel.value = cur;
	},

	async loadAnnots() {
		let A = this.Hafif.load("annots");
		let $ = this.$;
		if (!this._colsFilled || this._colsLib !== this.libraryID()) {
			this.fillCollections();
			this._colsFilled = true;
			this._colsLib = this.libraryID();
		}
		let days = +$("a-since").value;
		this.anns = await A.query({
			libraryID: this.libraryID(),
			colors: [...this.colorsOn],
			types: $("a-type").value ? [$("a-type").value] : undefined,
			text: $("a-q").value.trim() || undefined,
			since: days ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace("T", " ") : undefined,
			collectionID: +$("a-col").value || undefined,
		});
		this.sel = new Set([...this.sel].filter(id => this.anns.some(a => a.id === id)));
		this.shown = 300;
		this.renderAnnots();
	},

	renderAnnots() {
		let A = this.Hafif.load("annots");
		let D = this.Hafif.load("notedoc");
		let list = this.$("a-list");
		list.replaceChildren();
		if (!this.anns.length) list.append(this.h("div", "empty", "Ölçütlere uyan vurgu yok."));
		let labels = new Map();
		for (let a of this.anns.slice(0, this.shown)) {
			let card = this.h("div", "ann" + (this.sel.has(a.id) ? " sel" : ""));
			let c = this.h("div", "c");
			c.style.background = a.color || "var(--line)";
			let body = this.h("div");
			if (a.text) {
				let t = this.h("div", "t", a.text);
				if (D.isRTL(a.text)) t.setAttribute("dir", "rtl");
				body.append(t);
			}
			if (a.comment) body.append(this.h("div", "cm", a.comment));
			if (!labels.has(a.topID)) labels.set(a.topID, A.sourceLabel(a.topID));
			let m = this.h("div", "m");
			m.append(this.h("b", null, labels.get(a.topID)), document.createTextNode(` · s. ${a.page || "?"} · ${String(a.added).slice(0, 10)}`));
			let mean = A.meaning(a.color);
			if (mean) m.append(this.h("span", "tag", mean));
			if (a.type !== "highlight") m.append(this.h("span", "tag", A.TYPE_LABELS[a.type] || a.type));
			body.append(m);
			let go = this.h("button", "link go", "Aç ↗");
			go.title = "PDF'te bu vurguda aç";
			go.addEventListener("click", (e) => {
				e.stopPropagation();
				this.safe(() => A.open(a))();
			});
			card.append(c, body, go);
			card.addEventListener("click", () => {
				this.sel.has(a.id) ? this.sel.delete(a.id) : this.sel.add(a.id);
				card.classList.toggle("sel");
				this.countAnnots();
			});
			card.addEventListener("dblclick", () => this.safe(() => A.open(a))());
			list.append(card);
		}
		if (this.anns.length > this.shown) {
			let more = this.h("button", null, `Daha fazla göster (${this.anns.length - this.shown} kaldı)`);
			more.addEventListener("click", () => {
				this.shown += 300;
				this.renderAnnots();
			});
			list.append(more);
		}
		this.countAnnots();
	},

	countAnnots() {
		let n = this.anns.length;
		this.$("a-count").textContent = `${n} vurgu` + (this.sel.size ? ` · ${this.sel.size} seçili` : " · seçim yoksa düğmeler hepsine uygulanır");
	},

	// ---- Tekrar ----

	initReview() {
		let A = this.Hafif.load("annots");
		let $ = this.$;
		let cur = () => this.deck[this.pos];
		let next = () => {
			this.pos++;
			this.renderCard();
		};
		$("r-yes").addEventListener("click", this.safe(async () => {
			if (!cur()) return;
			await A.grade(cur(), true);
			next();
		}));
		$("r-no").addEventListener("click", this.safe(async () => {
			if (!cur()) return;
			await A.grade(cur(), false);
			next();
		}));
		$("r-skip").addEventListener("click", this.safe(async () => {
			if (!cur()) return;
			await A.skip(cur());
			next();
		}));
		$("r-open").addEventListener("click", this.safe(() => cur() && A.open(cur())));
	},

	async loadReview() {
		let A = this.Hafif.load("annots");
		let d = await A.dueToday(this.libraryID());
		this.deck = [...d.due, ...d.fresh];
		this.pos = 0;
		this.reviewInfo = d;
		this.renderCard();
	},

	renderCard() {
		let A = this.Hafif.load("annots");
		let D = this.Hafif.load("notedoc");
		let card = this.$("r-card");
		card.replaceChildren();
		let a = this.deck[this.pos];
		let info = this.reviewInfo || { total: 0, known: 0 };
		this.$("r-progress").textContent = this.deck.length
			? `${Math.min(this.pos + 1, this.deck.length)} / ${this.deck.length} · havuzda ${info.total} vurgu, ${info.known} tanesi tekrar sırasında`
			: `Bugün tekrar edilecek vurgu yok · havuzda ${info.total} vurgu`;
		for (let id of ["r-yes", "r-no", "r-skip", "r-open"]) this.$(id).disabled = !a;
		if (!a) {
			card.append(this.h("div", "t", this.deck.length ? "Bugünlük bu kadar. Yarın görüşmek üzere." : "Tekrar edilecek bir şey yok. Okurken vurgu yaptıkça burası dolar."));
			return;
		}
		let bar = this.h("div", "bar-c");
		bar.style.background = a.color || "var(--line)";
		let t = this.h("div", "t", a.text || "");
		if (D.isRTL(a.text || "")) t.setAttribute("dir", "rtl");
		card.append(bar, t);
		if (a.comment) card.append(this.h("div", "cm", a.comment));
		let m = this.h("div", "m", `${A.sourceLabel(a.topID)} · s. ${a.page || "?"}`);
		let mean = A.meaning(a.color);
		if (mean) m.append(this.h("span", "tag", mean));
		card.append(m);
	},

	// ---- Okuma ----

	async loadReading() {
		let R = this.Hafif.load("reading");
		let $ = this.$;
		let all = (await R.all()).filter(r => r.att.libraryID === this.libraryID());
		let daily = await R.daily(14);
		let week = daily.slice(-7).reduce((s, d) => s + d.ms, 0);
		let total = all.reduce((s, r) => s + r.ms, 0);
		let stats = $("g-stats");
		stats.replaceChildren();
		let stat = (v, k) => {
			let s = this.h("div", "stat");
			s.append(this.h("b", null, v), this.h("span", "muted", k));
			stats.append(s);
		};
		stat(R.fmt(week), "son 7 gün");
		stat(R.fmt(total), "toplam okuma");
		stat(String(all.length), "eser açıldı");
		stat(String(all.filter(r => r.progress >= 0.95).length), "eser bitti");
		if (this.Hafif.pref("readingTrack") === false) stat("kapalı", "okuma takibi (Ayarlar › Okuma)");
		let chart = $("g-chart");
		chart.replaceChildren();
		let max = Math.max(1, ...daily.map(d => d.ms));
		for (let d of daily) {
			let col = this.h("div", "d");
			let bar = this.h("i");
			bar.style.height = Math.round((d.ms / max) * 85) + "%";
			bar.title = `${d.day}: ${R.fmt(d.ms)}`;
			col.append(bar, this.h("span", null, d.day.slice(8)));
			chart.append(col);
		}
		let list = $("g-list");
		list.replaceChildren();
		if (!all.length) list.append(this.h("div", "empty", "Henüz okuma kaydı yok. Okuyucuda bir PDF açıp okudukça burada görünür."));
		for (let r of all) {
			let row = this.h("div", "row");
			let title = this.h("div", null, r.top.getDisplayTitle());
			let prog = this.h("div", "prog");
			let fill = this.h("i");
			fill.style.width = Math.round(r.progress * 100) + "%";
			prog.append(fill);
			prog.title = r.count ? `%${Math.round(r.progress * 100)} (${r.seen.length}/${r.count} sayfa)` : `${r.seen.length} sayfa`;
			row.append(title, prog, this.h("span", "muted", R.fmt(r.ms)), this.h("span", "muted", R.ago(r.last)));
			row.addEventListener("click", this.safe(() => Zotero.Reader.open(r.att.id, r.page != null ? { pageIndex: r.page } : null)));
			list.append(row);
		}
	},

	// ---- Projeler ----

	initProjects() {
		this.$("p-new").addEventListener("click", this.safe(async () => {
			let win = Zotero.getMainWindow();
			win.focus();
			await this.Hafif.load("project").create(win);
			window.focus();
			this.loadProjects();
		}));
	},

	async loadProjects() {
		let P = this.Hafif.load("project");
		let D = this.Hafif.load("notedoc");
		let list = this.$("p-list");
		list.replaceChildren();
		let projects = P.list().filter(p => p.libraryID === this.libraryID());
		if (!projects.length) list.append(this.h("div", "empty", "Henüz yazım projesi yok. Bir makale, tez ya da bölüm için “Yeni yazım projesi” ile başlayın."));
		let active = P.active();
		let win = Zotero.getMainWindow();
		for (let p of projects) {
			let box = this.h("div", "proj" + (p.id === active?.id ? " active" : ""));
			let h3 = this.h("h3", null, p.name);
			if (p.id === active?.id) h3.append(this.h("span", "tag", "etkin"));
			let note = P.draft(p);
			let col = P._collection(p);
			let meta = this.h("div", "muted", `${P.KINDS[p.kind]?.label || ""} · ${Zotero.Styles.get(p.style)?.title || "stil yok"} · ${col?.getChildItems(false, false).filter(i => i.isRegularItem()).length || 0} kaynak`);
			box.append(h3, meta);
			if (note) {
				let doc = await D.parse(note.getNote());
				box.append(this.h("div", "muted small", `${D.wordCount(doc.blocks).toLocaleString("tr-TR")} sözcük · ${D.citations(doc.blocks).length} atıf · ${D.citedItems(doc.blocks).length} farklı eser`));
			}
			let acts = this.h("div", "acts");
			let act = (label, fn, primary) => {
				let b = this.h("button", primary ? "primary" : null, label);
				b.addEventListener("click", this.safe(async () => {
					win.focus();
					await fn();
					this.loadProjects();
				}));
				acts.append(b);
			};
			if (p.id !== active?.id) act("Etkin yap", () => P.activate(p), true);
			act("Taslağı aç", () => P.open(win, p));
			act("Durum…", () => P.status(win, p));
			act("Kaynakçayı yenile", () => P.updateBibliography(win, p));
			act("Dışa aktar…", () => P.exportDraft(win, p));
			act("Stil…", async () => {
				P.activate(p, { quiet: true });
				await P.changeStyle(win, p);
			});
			act("Listeden çıkar", () => {
				if (Services.prompt.confirm(window, "Projeyi listeden çıkar", `“${p.name}” proje listesinden çıkarılsın mı? Koleksiyon ve taslak notu silinmez.`)) P.remove(p.id);
			});
			box.append(acts);
			list.append(box);
		}
	},

	// ---- Künye denetimi ----

	initLint() {
		let $ = this.$;
		$("l-run").addEventListener("click", this.safe(() => this.runLint()));
		$("l-info").addEventListener("change", () => this.renderLint());
		$("l-fix").addEventListener("click", this.safe(async () => {
			let items = this.lintReport.filter(r => r.issues.some(i => i.fix)).map(r => r.item);
			let n = await this.Hafif.load("lint").fix(items);
			this.Hafif.toast(`${n} kayıt düzeltildi.`);
			await this.runLint();
		}));
	},

	fillScopes() {
		let sel = this.$("l-scope");
		sel.replaceChildren();
		let pane = Zotero.getActiveZoteroPane();
		let add = (v, label) => {
			let o = this.h("option", null, label);
			o.value = v;
			sel.append(o);
		};
		let selected = (pane?.getSelectedItems?.() || []).filter(i => i.isRegularItem());
		if (selected.length) add("sel", `Seçili ${selected.length} kayıt`);
		let col = pane?.getSelectedCollection?.();
		if (col) add("col:" + col.id, `“${col.name}” koleksiyonu`);
		for (let p of this.Hafif.load("project").list().filter(x => x.libraryID === this.libraryID())) {
			let c = this.Hafif.modules.project._collection(p);
			if (c) add("col:" + c.id, `Proje: ${p.name}`);
		}
		add("lib", "Bütün kütüphane");
	},

	async runLint() {
		let L = this.Hafif.load("lint");
		let v = this.$("l-scope").value;
		let items;
		if (v === "sel") items = Zotero.getActiveZoteroPane().getSelectedItems().filter(i => i.isRegularItem());
		else if (v?.startsWith("col:")) items = Zotero.Collections.get(+v.slice(4)).getChildItems(false, false).filter(i => i.isRegularItem());
		else items = (await Zotero.Items.getAll(this.libraryID(), true, false)).filter(i => i.isRegularItem());
		this.$("l-count").textContent = `${items.length} kayıt denetleniyor…`;
		await Zotero.Promise.delay(10);
		this.lintReport = L.checkItems(items);
		this.lintTotal = items.length;
		this.renderLint();
	},

	renderLint() {
		let list = this.$("l-list");
		list.replaceChildren();
		let showInfo = this.$("l-info").checked;
		let shown = 0;
		let fixable = 0;
		for (let r of this.lintReport) {
			let issues = r.issues.filter(i => showInfo || i.level !== "info");
			if (!issues.length) continue;
			shown++;
			if (r.issues.some(i => i.fix)) fixable++;
			let box = this.h("div", "li");
			let head = this.h("div", "h");
			head.append(this.h("b", null, r.item.getDisplayTitle()), this.h("span", "muted small", Zotero.ItemTypes.getLocalizedString(r.item.itemTypeID)));
			let show = this.h("button", "link", "Kaydı göster");
			show.addEventListener("click", this.safe(() => this.reveal(r.item)));
			head.append(show);
			if (r.issues.some(i => i.fix)) {
				let fx = this.h("button", "link", "Düzelt");
				fx.addEventListener("click", this.safe(async () => {
					await this.Hafif.load("lint").fix([r.item]);
					r.issues = this.Hafif.modules.lint.check(this.Hafif.modules.lint.snapshot(r.item));
					this.renderLint();
				}));
				head.append(fx);
			}
			box.append(head);
			for (let i of issues) {
				let row = this.h("div", "issue");
				row.append(this.h("span", "lv " + i.level, { error: "✕", warn: "!", info: "i" }[i.level]), this.h("span", null, i.msg + (i.fix ? " (düzeltilebilir)" : "")));
				box.append(row);
			}
			list.append(box);
		}
		if (!shown) list.append(this.h("div", "empty", this.lintTotal ? "Sorun bulunmadı." : "Kapsamı seçip “Denetle”ye basın."));
		this.$("l-fix").disabled = !fixable;
		this.$("l-count").textContent = this.lintTotal != null ? `${this.lintTotal} kayıt denetlendi · ${shown} kayıtta sorun · ${fixable} tanesi otomatik düzeltilebilir` : "";
	},
};

window.addEventListener("load", () => {
	try {
		HafifHub.init();
	}
	catch (e) {
		Zotero.logError(e);
		document.body.textContent = "Hafif Merkezi açılamadı: " + e.message;
	}
});
