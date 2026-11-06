/* Literatür Ara penceresi: YÖK Tez, DergiPark, TDV İslâm Ansiklopedisi ve OpenAlex'te süzgeçli
 * ve doğal dilde arama; sonuçları tam künyeyle (varsa PDF'iyle) Zotero'ya ekleme. */

var LitSearch = {
	results: [],
	bySource: {},
	tab: "all",
	cur: null,
	running: false,

	init() {
		this.Hafif = Zotero.Hafif;
		this.S = this.Hafif.load("sources");
		let $ = (id) => document.getElementById(id);
		this.$ = $;
		// Kaynak düğmeleri
		let off = new Set(this._json("litOff", []));
		for (let [id, s] of Object.entries(this.S.SOURCES)) {
			let b = this.h("span", "src" + (off.has(id) ? " off" : ""), s.label);
			b.dataset.id = id;
			b.title = "Bu kaynakta ara / arama";
			b.addEventListener("click", () => {
				b.classList.toggle("off");
				this.Hafif.pref("litOff", JSON.stringify([...document.querySelectorAll(".src.off")].map(x => x.dataset.id)));
			});
			$("srcs").append(b);
		}
		let field = $("field");
		field.append(this._opt("any", "Hepsi"));
		for (let [k, f] of Object.entries(this.S.FIELDS)) field.append(this._opt(k, f.label));
		// Varsayılanlar: son kullanılan süzgeçler
		let last = this._json("litLast", {});
		for (let k of ["docType", "thesisType", "field", "language", "searchIn"]) if (last[k]) $(k).value = last[k];
		$("ai").checked = this.Hafif.pref("litAI") !== false && this.Hafif.load("llm").configured().length > 0;
		$("ai").addEventListener("change", () => this.Hafif.pref("litAI", $("ai").checked));
		this._fillTargets();
		$("go").addEventListener("click", () => this.run());
		$("q").addEventListener("keydown", (e) => {
			if (e.key === "Enter") this.run();
		});
		$("addSel").addEventListener("click", () => this.addSelected());
		$("list").addEventListener("click", (e) => this._onListClick(e));
		$("list").addEventListener("change", () => this._updateAddBtn());
		let a = window.arguments?.[0];
		if (a?.query) {
			$("q").value = a.query;
			this.run();
		}
		$("q").focus();
		this.ready = true;
	},

	/** Kütüphane içinde açıldığında: dönüş düğmesi ve güncel hedef koleksiyon. */
	embedded(onClose) {
		this.isEmbedded = true;
		this.onClose = onClose;
		if (!this.$("back")) {
			let b = this.h("button", null, "✕ Kütüphaneye dön");
			b.id = "back";
			b.title = "Kayıt listesine dön (esc)";
			b.addEventListener("click", () => this.onClose?.());
			this.$("qrow").append(b);
			document.addEventListener("keydown", (e) => {
				// Bir kutuya yazarken esc kutuya aittir
				if (e.key === "Escape" && !e.defaultPrevented && !/^(input|select|textarea)$/i.test(document.activeElement?.localName || "")) this.onClose?.();
			});
		}
		this._fillTargets();
	},

	h(tag, cls, text) {
		let e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = text;
		return e;
	},

	_opt(v, t) {
		let o = this.h("option", null, t);
		o.value = v;
		return o;
	},

	_json(k, d) {
		try {
			return JSON.parse(this.Hafif.pref(k) || "null") ?? d;
		}
		catch (e) {
			return d;
		}
	},

	_fillTargets() {
		let sel = this.$("target");
		sel.replaceChildren();
		let pane = Zotero.getActiveZoteroPane();
		let cur = pane?.getSelectedCollection?.();
		for (let lib of Zotero.Libraries.getAll().filter(l => l.libraryType === "user" || (l.libraryType === "group" && l.editable))) {
			sel.append(this._opt(`L${lib.libraryID}`, lib.name));
			let walk = (cols, depth) => {
				for (let c of cols.sort((x, y) => x.name.localeCompare(y.name, "tr"))) {
					sel.append(this._opt(`C${c.id}`, "  ".repeat(depth) + "↳ " + c.name));
					walk(c.getChildCollections(false), depth + 1);
				}
			};
			walk(Zotero.Collections.getByLibrary(lib.libraryID, false), 1);
		}
		sel.value = cur ? `C${cur.id}` : `L${Zotero.Libraries.userLibraryID}`;
	},

	_target() {
		let v = this.$("target").value;
		if (v.startsWith("C")) {
			let c = Zotero.Collections.get(+v.slice(1));
			return { collection: c, libraryID: c.libraryID };
		}
		return { libraryID: +v.slice(1) };
	},

	_params() {
		let $ = this.$;
		let num = (id) => parseInt($(id).value) || null;
		return {
			query: $("q").value.trim(),
			sources: [...document.querySelectorAll(".src:not(.off)")].map(x => x.dataset.id),
			docType: $("docType").value, thesisType: $("thesisType").value, field: $("field").value,
			yearFrom: num("yearFrom"), yearTo: num("yearTo"), language: $("language").value,
			searchIn: $("searchIn").value, fullTextOnly: $("fullTextOnly").checked, limit: 25,
		};
	},

	_apply(p) {
		let $ = this.$;
		for (let k of ["docType", "thesisType", "field", "language", "searchIn"]) if (p[k]) $(k).value = p[k];
		$("yearFrom").value = p.yearFrom || "";
		$("yearTo").value = p.yearTo || "";
		$("fullTextOnly").checked = !!p.fullTextOnly;
		if (p.sources?.length) for (let b of document.querySelectorAll(".src")) b.classList.toggle("off", !p.sources.includes(b.dataset.id));
	},

	status(t, busy) {
		let s = this.$("status");
		s.textContent = t || "";
		s.classList.toggle("spin", !!busy);
	},

	async run() {
		if (this.running) return;
		let $ = this.$;
		let raw = $("q").value.trim();
		if (!raw) return;
		this.running = true;
		$("go").disabled = true;
		let p = this._params();
		try {
			// Doğal dil: istek süzgeçlere çevrilir, süzgeçler ekranda gösterilir ve değiştirilebilir
			let words = raw.split(/\s+/).length;
			if ($("ai").checked && words >= 3) {
				this.status("İstek yorumlanıyor…", true);
				try {
					let j = await this.S.interpret(raw);
					this._apply(j);
					p = { ...this._params(), query: j.query || raw, englishQuery: j.englishQuery };
					this._showInterp(j);
				}
				catch (e) {
					this._showInterp(null, "Yorumlanamadı (" + e.message + "); yazdığınız gibi aranıyor.");
				}
			}
			else $("interp").classList.add("hidden");
			this.Hafif.pref("litLast", JSON.stringify({ docType: p.docType, thesisType: p.thesisType, field: p.field, language: p.language, searchIn: p.searchIn }));
			if (!p.sources.length) throw new Error("En az bir kaynak seçin.");
			this.results = [];
			this.bySource = {};
			this.tab = "all";
			this.cur = null;
			$("detail").classList.add("hidden");
			this._renderTabs(p.sources);
			this._render();
			this.status("Aranıyor: " + p.sources.map(s => this.S.SOURCES[s].label).join(", ") + "…", true);
			let t0 = Date.now();
			await this.S.search(p, {
				onSource: (s, r) => {
					this.bySource[s] = r;
					if (r.hits) this.results.push(...r.hits);
					this._renderTabs(p.sources);
					this._render();
				},
			});
			this.status(`${this.results.length} sonuç · ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
		}
		catch (e) {
			this.status("");
			this.$("list").replaceChildren(this.h("div", "note err", e.message));
		}
		finally {
			this.running = false;
			$("go").disabled = false;
		}
	},

	_showInterp(j, err) {
		let box = this.$("interp");
		box.replaceChildren();
		box.classList.remove("hidden");
		if (!j) {
			box.append(this.h("span", null, err));
			return;
		}
		box.append(this.h("span", null, "✦ Anlaşılan:"));
		let F = this.S.FIELDS;
		let chips = [
			`“${j.query}”`,
			j.docType && j.docType !== "any" && { thesis: "tez", article: "makale", encyclopedia: "ansiklopedi maddesi", book: "kitap" }[j.docType],
			j.thesisType && j.thesisType !== "any" && { yl: "yüksek lisans", doktora: "doktora" }[j.thesisType],
			j.field && j.field !== "any" && F[j.field]?.label,
			(j.yearFrom || j.yearTo) && `${j.yearFrom || "…"}–${j.yearTo || "…"}`,
			j.language && j.language !== "any" && { tr: "Türkçe", ar: "Arapça", en: "İngilizce" }[j.language],
			j.searchIn && j.searchIn !== "all" && { title: "başlıkta", abstract: "özette", keywords: "anahtar kelimede", author: "yazarda", advisor: "danışmanda" }[j.searchIn],
			j.englishQuery && `EN: ${j.englishQuery}`,
		].filter(Boolean);
		for (let c of chips) box.append(this.h("span", "chip", c));
		box.append(this.h("span", null, " — süzgeçleri değiştirip yeniden arayabilirsiniz"));
	},

	_renderTabs(sources) {
		let tabs = this.$("tabs");
		tabs.replaceChildren();
		let mk = (id, label, n, cls = "") => {
			let b = this.h("button", "tab " + cls + (this.tab === id ? " on" : ""));
			b.append(label);
			if (n != null) b.append(this.h("span", "n", String(n)));
			b.addEventListener("click", () => {
				this.tab = id;
				this._renderTabs(sources);
				this._render();
			});
			tabs.append(b);
		};
		mk("all", "Hepsi", this.results.length);
		for (let s of sources) {
			let r = this.bySource[s];
			let label = this.S.SOURCES[s].label;
			if (!r) mk(s, label + " …", null);
			else if (r.error) mk(s, label + " ⚠", null, "err");
			else mk(s, label, r.total != null && r.total > (r.count || 0) ? `${r.count}/${r.total}` : r.count);
		}
	},

	_visible() {
		return this.tab === "all" ? this.results : this.results.filter(h => h.source === this.tab);
	},

	_render() {
		let list = this.$("list");
		let rows = this._visible();
		list.replaceChildren();
		let srcs = this.tab === "all" ? Object.keys(this.bySource) : [this.tab];
		for (let s of srcs) {
			let r = this.bySource[s];
			if (r?.error) list.append(this.h("div", "note err", `${this.S.SOURCES[s].label}: ${r.error}`));
			else if (r?.note) list.append(this.h("div", "note", `${this.S.SOURCES[s].label}: ${r.note}`));
		}
		if (!rows.length) {
			if (!srcs.length || srcs.every(s => this.bySource[s] && !this.bySource[s].error)) list.append(this.h("div", "note", this.running ? "" : "Sonuç yok. Terimleri ya da süzgeçleri genişletin."));
			this._updateAddBtn();
			return;
		}
		for (let h of rows) list.append(this._row(h));
		this._updateAddBtn();
	},

	_typeLabel(h) {
		if (h.type === "thesis") return h.thesisType || "Tez";
		return { article: "Makale", encyclopedia: "Madde", book: "Kitap" }[h.type] || "Eser";
	},

	_row(h) {
		let row = this.h("div", "row" + (this.cur === h ? " cur" : ""));
		row._hit = h;
		let cb = this.h("input");
		cb.type = "checkbox";
		cb.disabled = !!h.added;
		let body = this.h("div");
		let t = this.h("div", "t", h.title || "(başlıksız)");
		t.dir = "auto";
		body.append(t);
		if (h.title2) {
			let t2 = this.h("div", "t2", h.title2);
			t2.dir = "auto";
			body.append(t2);
		}
		let meta = [h.authors?.slice(0, 3).join("; "), h.year, h.venue, h.advisor && "Danışman: " + h.advisor].filter(Boolean).join(" · ");
		if (meta) body.append(this.h("div", "m", meta));
		if (h.abstract) {
			let sn = this.h("div", "snip", h.abstract);
			sn.dir = "auto";
			body.append(sn);
		}
		let badges = this.h("div", "badges");
		badges.append(this.h("span", "b src-" + h.source, this.S.SOURCES[h.source].label));
		badges.append(this.h("span", "b", this._typeLabel(h)));
		if (h.pdf) badges.append(this.h("span", "b pdf", "PDF"));
		if (h.added) badges.append(this.h("span", "b added", "Eklendi ✓"));
		else if (h.inLibrary) badges.append(this.h("span", "b lib", "Kütüphanede"));
		row.append(cb, body, badges);
		return row;
	},

	_onListClick(e) {
		let row = e.target.closest(".row");
		if (!row || e.target.localName === "input") return;
		this.cur = row._hit;
		for (let r of document.querySelectorAll(".row.cur")) r.classList.remove("cur");
		row.classList.add("cur");
		this._detail(row._hit);
	},

	_detail(h) {
		let d = this.$("detail");
		d.classList.remove("hidden");
		d.replaceChildren();
		let t = this.h("h2", null, h.title);
		t.dir = "auto";
		d.append(t);
		if (h.title2) {
			let t2 = this.h("div", "meta", h.title2);
			t2.dir = "auto";
			d.append(t2);
		}
		d.append(this.h("div", "meta", [this.S.SOURCES[h.source].label, this._typeLabel(h), h.year].filter(Boolean).join(" · ")));
		let acts = this.h("div", "acts");
		let add = this.h("button", "primary", h.added ? "Eklendi ✓" : "Kütüphaneye ekle");
		add.disabled = !!h.added;
		add.addEventListener("click", () => this.addHits([h]));
		if (h.added && h.items?.length) {
			let show = this.h("button", null, "Kütüphanede göster");
			show.addEventListener("click", async () => {
				this.onClose?.();
				await Zotero.getActiveZoteroPane()?.selectItem(h.items[0].id);
			});
			acts.append(show);
		}
		let open = this.h("button", null, "Sayfayı aç");
		open.addEventListener("click", () => Zotero.launchURL(h.url));
		acts.append(add, open);
		if (h.pdf && /^https?:/.test(h.pdf)) {
			let pdf = this.h("button", null, "PDF");
			pdf.addEventListener("click", () => Zotero.launchURL(h.pdf));
			acts.append(pdf);
		}
		d.append(acts);
		let dl = this.h("dl");
		let row = (k, v) => {
			if (!v) return;
			dl.append(this.h("dt", null, k));
			let dd = this.h("dd", null, v);
			dd.dir = "auto";
			dl.append(dd);
		};
		row("Yazar", h.authors?.join("; "));
		row(h.type === "thesis" ? "Kurum" : "Yayın", h.venue);
		row("Danışman", h.advisor);
		row("Konu", h.subject);
		row("Dil", h.lang);
		row("Cilt / sayı", [h.volume, h.issue].filter(Boolean).join(" / "));
		row("Sayfa", h.pages);
		row("DOI", h.doi);
		row("Atıf", h.cited != null ? String(h.cited) : "");
		row("Tez No", h.no);
		if (h.inLibrary) row("Durum", "Bu eser kütüphanenizde görünüyor");
		d.append(dl);
		if (h.abstract) {
			let a = this.h("div", "abs", h.abstract);
			a.dir = "auto";
			d.append(a);
		}
	},

	_updateAddBtn() {
		let n = document.querySelectorAll(".row input:checked").length;
		let b = this.$("addSel");
		b.disabled = !n;
		b.textContent = n ? `Seçilenleri ekle (${n})` : "Seçilenleri ekle";
	},

	addSelected() {
		let hits = [...document.querySelectorAll(".row")].filter(r => r.querySelector("input:checked")).map(r => r._hit);
		return this.addHits(hits);
	},

	async addHits(hits) {
		hits = hits.filter(h => !h.added);
		if (!hits.length) return;
		let target = this._target();
		let warnings = [];
		let done = 0;
		this.$("addSel").disabled = true;
		for (let h of hits) {
			this.status(`Ekleniyor (${done + 1}/${hits.length}): ${h.title.slice(0, 60)}…`, true);
			try {
				let r = await this.S.importHit(h, target);
				h.added = true;
				h.items = r.items;
				warnings.push(...r.warnings.map(w => `${h.title.slice(0, 40)}: ${w}`));
				done++;
			}
			catch (e) {
				warnings.push(`${h.title.slice(0, 40)}: ${e.message}`);
			}
		}
		this._render();
		if (this.cur) this._detail(this.cur);
		this.status(`${done} eser eklendi` + (warnings.length ? ` · ${warnings.length} uyarı` : ""));
		if (warnings.length) Services.prompt.alert(window, "Literatür Ara", warnings.join("\n\n"));
		// Ayrı penceredeyken son eklenen kütüphanede seçili gelsin (gömülüyken “Kütüphanede göster” var)
		let last = hits.findLast?.(h => h.items?.length)?.items[0];
		if (last && !this.isEmbedded) Zotero.getActiveZoteroPane()?.selectItem(last.id).catch(() => {});
	},
};

window.addEventListener("load", () => {
	try {
		LitSearch.init();
	}
	catch (e) {
		Zotero.logError(e);
		document.body.textContent = "Literatür Ara açılamadı: " + e.message;
	}
});
