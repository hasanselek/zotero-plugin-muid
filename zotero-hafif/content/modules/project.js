/* Yazım projeleri: bir makale, tez, kitap bölümü ya da tebliğ için tek çatı.
 * Her proje = bir koleksiyon (kaynaklar) + o koleksiyonda bir taslak notu (bölüm başlıklarıyla)
 * + bir atıf stili. Proje oluşturulunca koleksiyon not hedeflerine eklenir ve taslak "son hedef"
 * olur: okurken yapılan vurgular doğrudan taslağın ilgili bölümüne gider.
 * Etkin proje paletten değiştirilir; kaynakça, durum (sözcük, atıf, kullanılmamış kaynak) ve
 * dışa aktarma (Word/Markdown) projenin stiliyle yapılır. Projeler ayar olarak saklanır (JSON). */

Hafif.modules.project = {
	KINDS: {
		article: { label: "Makale", sections: ["Öz", "Abstract", "Giriş", "I. ", "II. ", "Sonuç", "Kaynakça"] },
		thesis: { label: "Tez", sections: ["Özet", "Abstract", "Önsöz", "Giriş", "Birinci Bölüm: ", "İkinci Bölüm: ", "Üçüncü Bölüm: ", "Sonuç", "Kaynakça"] },
		chapter: { label: "Kitap bölümü", sections: ["Giriş", "I. ", "II. ", "Sonuç", "Kaynakça"] },
		paper: { label: "Tebliğ / bildiri", sections: ["Özet", "Giriş", "Tartışma", "Sonuç", "Kaynakça"] },
		review: { label: "Kitap değerlendirmesi", sections: ["Künye", "Muhteva", "Değerlendirme", "Kaynakça"] },
	},

	// ---- Kayıt ----

	list() {
		try {
			let v = JSON.parse(Hafif.pref("projects") || "[]");
			return Array.isArray(v) ? v.filter(p => this._collection(p)) : [];
		}
		catch (e) {
			return [];
		}
	},

	_save(list) {
		Hafif.pref("projects", JSON.stringify(list));
	},

	active() {
		let id = Hafif.pref("activeProject");
		return this.list().find(p => p.id === id) || null;
	},

	_collection(p) {
		let c = p && Zotero.Collections.getByLibraryAndKey(p.libraryID, p.collectionKey);
		return c && !c.deleted ? c : null;
	},

	draft(p) {
		let n = p && Zotero.Items.getByLibraryAndKey(p.libraryID, p.noteKey);
		return n && n.isNote() && !n.deleted ? n : null;
	},

	/** Not bir projenin taslağıysa o proje. */
	forNote(note) {
		return this.list().find(p => p.libraryID === note.libraryID && p.noteKey === note.key) || null;
	},

	// ---- Oluşturma ----

	async create(win) {
		let A = Hafif.load("actions");
		let name = A._prompt(win, "Yeni yazım projesi", "Projenin (makalenin, tezin…) çalışma başlığı:", "");
		if (!name) return null;
		let kinds = Object.entries(this.KINDS);
		let ki = A._select(win, "Yeni yazım projesi", "Türü:", kinds.map(([, k]) => k.label));
		if (ki == null) return null;
		let [kind, def] = kinds[ki];
		let style = await this._pickStyle(win, Hafif.load("cite").styleID());
		if (style === null) return null;

		let pane = win.ZoteroPane;
		let libraryID = pane?.getSelectedLibraryID?.() || Zotero.Libraries.userLibraryID;
		if (!Zotero.Libraries.get(libraryID).editable) libraryID = Zotero.Libraries.userLibraryID;
		let col = new Zotero.Collection();
		col.libraryID = libraryID;
		col.name = "✎ " + name;
		await col.saveTx();

		let esc = (s) => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
		let html = `<div data-schema-version="9"><h1>${esc(name)}</h1>`
			+ def.sections.map(s => `<h2>${esc(s)}</h2><p></p>`).join("") + "</div>";
		let note = new Zotero.Item("note");
		note.libraryID = libraryID;
		note.setNote(html);
		note.addToCollection(col.id);
		await note.saveTx();

		// Seçili kayıtlar varsa projenin kaynaklarına eklenir
		let selected = (pane?.getSelectedItems?.() || []).filter(i => i.isRegularItem() && i.libraryID === libraryID);
		if (selected.length) await this._addItems(col, selected);

		let p = { id: Zotero.Utilities.randomString(8), name, kind, style, libraryID, collectionKey: col.key, noteKey: note.key, created: new Date().toISOString() };
		this._save([...this.list(), p]);
		let notes = Hafif.load("notes");
		if (!notes.isTarget(col)) notes.toggleTarget(col);
		this.activate(p, { quiet: true });
		await this.open(win, p);
		Hafif.toast(`“${name}” projesi kuruldu: kaynaklar “${col.name}” koleksiyonunda, taslak hazır. Okurken vurgular taslağa gider.`, 6000);
		return p;
	},

	async _pickStyle(win, current) {
		let cite = Hafif.load("cite");
		await cite.ready();
		let styles = Zotero.Styles.getVisible();
		let entries = styles.map(s => ({ title: s.title, meta: (s.class === "note" ? "dipnot" : "metin içi") + (s.styleID === current ? " · şu anki" : ""), data: s.styleID }));
		entries.sort((a, b) => (b.data === current) - (a.data === current) || /isnad/i.test(b.title) - /isnad/i.test(a.title));
		let id = await Hafif.load("actions")._pick(win, "Projenin atıf stili (İSNAD, Chicago…)", entries);
		return id || current;
	},

	// ---- Etkin proje ----

	activate(p, { quiet = false } = {}) {
		Hafif.pref("activeProject", p.id);
		let note = this.draft(p);
		if (note) Hafif.pref("lastTarget", JSON.stringify({ libraryID: note.libraryID, key: note.key, heading: null }));
		if (!quiet) Hafif.toast(`Etkin proje: ${p.name}`, 1800);
	},

	async switch(win) {
		let list = this.list();
		if (!list.length) return this.create(win);
		let cur = this.active();
		let entries = list.map(p => ({ title: p.name, meta: `${this.KINDS[p.kind]?.label || ""}${p.id === cur?.id ? " · etkin" : ""}`, data: p }));
		entries.push({ title: "＋ Yeni yazım projesi…", meta: "", data: "new" });
		let p = await Hafif.load("actions")._pick(win, "Yazım projesi seç", entries);
		if (!p) return;
		if (p === "new") return this.create(win);
		this.activate(p);
		await this.open(win, p);
	},

	/** Projenin koleksiyonunu ve taslağını kütüphanede seçer. */
	async open(win, p = this.active()) {
		if (!p) return Hafif.toast("Etkin proje yok.");
		let col = this._collection(p);
		win.Zotero_Tabs.select("zotero-pane");
		await win.ZoteroPane.collectionsView.selectCollection(col.id);
		let note = this.draft(p);
		if (note) await win.ZoteroPane.selectItem(note.id);
	},

	_need(win) {
		let p = this.active();
		if (!p) Hafif.toast("Önce bir yazım projesi seçin ya da oluşturun (Araçlar › Yeni yazım projesi).", 4000);
		return p;
	},

	async _addItems(col, items) {
		await Zotero.DB.executeTransaction(async () => {
			for (let it of items) {
				it.addToCollection(col.id);
				await it.save();
			}
		});
	},

	/** Seçili kayıtları etkin projenin kaynaklarına ekler. */
	async addSources({ win, items }) {
		let p = this._need(win);
		if (!p) return;
		let col = this._collection(p);
		let tops = Hafif.load("actions")._regular(items).filter(i => i.libraryID === col.libraryID && !i.inCollection(col.id));
		if (!tops.length) return Hafif.toast("Seçili kayıtlar zaten projede (ya da başka kütüphanede).");
		await this._addItems(col, tops);
		Hafif.toast(`${tops.length} kaynak “${p.name}” projesine eklendi.`);
	},

	// ---- Durum ve kaynakça ----

	async status(win, p = this._need(win)) {
		if (!p) return;
		let note = this.draft(p);
		if (!note) return Hafif.toast("Projenin taslak notu bulunamadı.");
		let D = Hafif.load("notedoc");
		let doc = await D.parse(note.getNote());
		let cited = D.citedItems(doc.blocks);
		let citedIDs = new Set(cited.map(i => i.id));
		let sources = this._collection(p).getChildItems(false, false).filter(i => i.isRegularItem());
		let unused = sources.filter(i => !citedIDs.has(i.id));
		let outside = cited.filter(i => !sources.some(s => s.id === i.id));
		let words = D.wordCount(doc.blocks);
		let sections = doc.blocks.filter(b => b.type === "heading" && b.level === 2).length;
		let T = Hafif.load("libtools");
		let entries = [
			{ title: `${words.toLocaleString("tr-TR")} sözcük · ${sections} bölüm · ${D.citations(doc.blocks).length} atıf`, meta: `${p.name} — ${Zotero.Styles.get(p.style)?.title || "stil yok"}`, data: { open: true } },
			{ title: `${sources.length} kaynak projede, ${cited.length} tanesine atıf var`, meta: "↵ taslağı aç", data: { open: true } },
			...unused.map(i => ({ title: "○ " + i.getDisplayTitle(), meta: `atıf yapılmamış kaynak · ${T.creatorsShort?.(i, 2) || ""}`, data: { item: i } })),
			...outside.map(i => ({ title: "↗ " + i.getDisplayTitle(), meta: "taslakta atıf var ama proje koleksiyonunda değil", data: { item: i, add: true } })),
		];
		let pick = await Hafif.load("actions")._pick(win, "Proje durumu", entries);
		if (!pick) return;
		if (pick.open) return this.open(win, p);
		if (pick.add) await this._addItems(this._collection(p), [pick.item]);
		win.Zotero_Tabs.select("zotero-pane");
		await win.ZoteroPane.selectItem(pick.item.id);
	},

	/** Taslağın sonundaki "Kaynakça" bölümünü atıf yapılan eserlerle (projenin stiliyle) yeniler. */
	async updateBibliography(win, p = this._need(win)) {
		if (!p) return;
		let note = this.draft(p);
		if (!note) return Hafif.toast("Projenin taslak notu bulunamadı.");
		let D = Hafif.load("notedoc");
		let doc = await D.parse(note.getNote());
		let items = D.citedItems(doc.blocks);
		if (!items.length) return Hafif.toast("Taslakta henüz atıf yok.");
		let cite = Hafif.load("cite");
		await cite.ready();
		let style = Zotero.Styles.get(p.style);
		let engine = style.getCiteProc(cite.locale(), "html");
		let entries;
		try {
			let html = Zotero.Cite.makeFormattedBibliographyOrCitationList(engine, items, "html");
			entries = [...D._parse(html).querySelectorAll(".csl-entry")].map(e => e.innerHTML);
		}
		finally {
			engine.free?.();
		}
		let N = Hafif.load("notes");
		let dom = N._parse(note.getNote());
		let wrap = N._wrapper(dom);
		let heads = [...wrap.querySelectorAll(":scope > :is(h1, h2, h3)")];
		let h = heads.reverse().find(x => /^(kaynakça|kaynaklar|bibliyografya|bibliography|references)$/i.test(x.textContent.trim()));
		if (!h) {
			h = dom.createElement("h2");
			h.textContent = "Kaynakça";
			wrap.append(h);
		}
		let level = +h.tagName[1];
		for (let el = h.nextElementSibling; el && !(/^H[1-6]$/.test(el.tagName) && +el.tagName[1] <= level);) {
			let next = el.nextElementSibling;
			el.remove();
			el = next;
		}
		let anchor = h;
		for (let e of entries) {
			let para = dom.createElement("p");
			para.setAttribute("data-hafif-bib", "1");
			para.innerHTML = e;
			anchor.after(para);
			anchor = para;
		}
		note.setNote(wrap.outerHTML);
		await note.saveTx();
		Hafif.toast(`Kaynakça yenilendi: ${entries.length} eser (${style.title}).`);
	},

	async exportDraft(win, p = this._need(win)) {
		if (!p) return;
		let note = this.draft(p);
		if (!note) return Hafif.toast("Projenin taslak notu bulunamadı.");
		return Hafif.load("export").exportNote(win, note);
	},

	async changeStyle(win, p = this._need(win)) {
		if (!p) return;
		let style = await this._pickStyle(win, p.style);
		if (!style) return;
		this._save(this.list().map(x => (x.id === p.id ? { ...x, style } : x)));
		Hafif.toast(`“${p.name}” stili: ${Zotero.Styles.get(style)?.title}`);
	},

	/** Projeyi listeden çıkarır (koleksiyon ve taslak silinmez). */
	remove(id) {
		this._save(this.list().filter(p => p.id !== id));
		if (Hafif.pref("activeProject") === id) Hafif.pref("activeProject", "");
	},
};
