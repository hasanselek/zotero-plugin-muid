/* Konu notlarına gönderme.
 * "Notlar" koleksiyonundaki notların başlıkları (h1–h3) birer hedeftir. Okurken seçili metin
 * ya da vurgu, seçilen başlığın bölümünün sonuna atıf ve sayfa bağlantısıyla eklenir.
 * HTML'i Zotero'nun kendi serileştiricisi üretir: (Yazar, yıl, s.) atıfı ve tıklanınca
 * PDF'teki yere giden vurgu bağlantısı Zotero'nun "Nota ekle" çıktısıyla aynıdır. */

Hafif.modules.notes = {
	SENDABLE: ["highlight", "underline", "note", "text"],
	HEADINGS: "h1, h2, h3",
	_queue: Promise.resolve(),

	// ---- Koleksiyon ve hedefler ----

	/** Hedef koleksiyonlar: sağ tık ile seçilenler; hiç seçilmemişse "Notlar" ve "Notlarım". */
	getCollections() {
		let refs = this._collectionRefs();
		let cols = refs.length
			? refs.map(r => Zotero.Collections.getByLibraryAndKey(...this._splitRef(r)))
			: Zotero.Collections.getByLibrary(Zotero.Libraries.userLibraryID, true)
				.filter(c => ["Notlar", "Notlarım"].includes(c.name));
		return cols.filter(c => c && !c.deleted);
	},

	isTarget(collection) {
		return this.getCollections().some(c => c.id === collection.id);
	},

	/** Koleksiyonu hedeflere ekler ya da çıkarır. İlk seçimde varsayılanlar listeye yazılır. */
	toggleTarget(collection) {
		let refs = this.getCollections().map(c => `${c.libraryID}/${c.key}`);
		let ref = `${collection.libraryID}/${collection.key}`;
		let on = !refs.includes(ref);
		refs = on ? [...refs, ref] : refs.filter(r => r !== ref);
		Hafif.pref("notesCollections", JSON.stringify(refs));
		Hafif.toast(`"${collection.name}" ${on ? "not hedeflerine eklendi" : "not hedeflerinden çıkarıldı"}.`);
	},

	_collectionRefs() {
		try {
			let refs = JSON.parse(Hafif.pref("notesCollections") || "[]");
			return Array.isArray(refs) ? refs : [];
		}
		catch (e) {
			return [];
		}
	},

	_splitRef(ref) {
		let [libraryID, key] = ref.split("/");
		return [+libraryID, key];
	},

	async showCollection() {
		let c = this.getCollections()[0];
		if (!c) return Hafif.toast("Henüz not koleksiyonu yok. Bir koleksiyona sağ tıklayıp “Not hedefi olarak kullan” deyin.", 5000);
		Zotero.getMainWindow().Zotero_Tabs.select("zotero-pane");
		await Zotero.getActiveZoteroPane().collectionsView.selectCollection(c.id);
	},

	/** Notun üst düzey başlıkları: { level, text, ordinal } (ordinal: aynı metinli başlıkların sırası). */
	headings(note) {
		let wrap = this._wrapper(this._parse(note.getNote()));
		let seen = {};
		return [...wrap.querySelectorAll(`:scope > :is(${this.HEADINGS})`)].map(h => {
			let text = h.textContent.trim();
			seen[text] = (seen[text] || 0) + 1;
			return { level: +h.tagName[1], text, ordinal: seen[text] - 1 };
		}).filter(h => h.text);
	},

	/**
	 * Gönderme menüsünün ağacı. Düğüm: { label, onCommand } | { label, children } | { separator }.
	 * Okuyucu menüleri olayla eşzamanlı istendiği için tamamen eşzamanlı kurulur.
	 */
	menuTree(send) {
		let nodes = [];
		let last = this._resolve(this._lastTarget());
		if (last) {
			nodes.push({ label: `↻ ${this._targetLabel(last)}`, onCommand: () => send(this._lastTarget()) }, { separator: true });
		}
		let cols = this.getCollections();
		if (!cols.length) {
			nodes.push({ label: "(Not koleksiyonu yok: koleksiyona sağ tık › Not hedefi olarak kullan)", onCommand: () => this.showCollection() });
			return nodes;
		}
		// Tek koleksiyonda notlar doğrudan, birden çoksa koleksiyon başına alt menü olarak listelenir.
		if (cols.length === 1) {
			let sub = this._collectionNodes(cols[0], send);
			return nodes.concat(sub.length ? sub : [{ label: `("${cols[0].name}" boş)`, onCommand: () => this.showCollection() }]);
		}
		for (let col of cols) {
			let sub = this._collectionNodes(col, send);
			nodes.push({ label: "▸ " + col.name, children: sub.length ? sub : [{ label: "(boş)", onCommand: () => {} }] });
		}
		return nodes;
	},

	_collectionNodes(col, send) {
		let nodes = [];
		for (let child of col.getChildCollections(false).sort((a, b) => a.name.localeCompare(b.name, "tr"))) {
			let children = this._collectionNodes(child, send);
			if (children.length) nodes.push({ label: "▸ " + child.name, children });
		}
		let notes = col.getChildItems(false, false).filter(i => i.isNote())
			.sort((a, b) => a.getNoteTitle().localeCompare(b.getNoteTitle(), "tr"));
		for (let note of notes) {
			let base = { libraryID: note.libraryID, key: note.key };
			let title = note.getNoteTitle() || "(başlıksız not)";
			let hs = this.headings(note);
			// Notun ilk satırı başlık olarak da sayılır; tek başlık varsa doğrudan nota gönder.
			if (hs.length <= 1) {
				nodes.push({ label: title, onCommand: () => send({ ...base, heading: hs[0] || null }) });
				continue;
			}
			nodes.push({
				label: title,
				children: [
					{ label: "(notun sonuna)", onCommand: () => send({ ...base, heading: null }) },
					{ separator: true },
					...hs.map(h => ({
						label: " ".repeat(h.level - 1) + h.text,
						onCommand: () => send({ ...base, heading: h }),
					})),
				],
			});
		}
		return nodes;
	},

	_lastTarget() {
		try {
			return JSON.parse(Hafif.pref("lastTarget") || "null");
		}
		catch (e) {
			return null;
		}
	},

	_resolve(target) {
		if (!target) return null;
		let note = Zotero.Items.getByLibraryAndKey(target.libraryID, target.key);
		return note && note.isNote() && !note.deleted ? { note, heading: target.heading } : null;
	},

	_targetLabel({ note, heading }) {
		let title = note.getNoteTitle() || "(başlıksız not)";
		return heading && heading.text !== title ? `${title} › ${heading.text}` : title;
	},

	// ---- Gönderme ----

	/** Okuyucuda seçili (vurgulanmamış) metin: vurgu kaydı açmadan atıf ve konum bağlantısıyla gönderir. */
	sendSelection(reader, annotation, target) {
		let json = {
			...annotation,
			type: "highlight",
			color: annotation.color || "#ffd400",
			attachmentItemID: Hafif.load("compat").readerItem(reader).id,
			id: Zotero.DataObjectUtilities.generateKey(),
		};
		return this._enqueue(target, async () => [json]);
	},

	/** Kayıtlı vurgu öğelerini gönderir; hedef notta zaten olanları atlar. */
	sendAnnotations(items, target, { quiet = false } = {}) {
		return this._enqueue(target, async (note) => {
			let html = note.getNote();
			let fresh = this._sort(items).filter(a =>
				this.SENDABLE.includes(a.annotationType)
				&& !html.includes(`annotationKey%22%3A%22${a.key}%22`));
			let jsons = [];
			for (let a of fresh) {
				let j = await Zotero.Annotations.toJSON(a);
				j.attachmentItemID = a.parentID;
				j.id = a.key;
				jsons.push(j);
			}
			if (!jsons.length && !quiet) Hafif.toast("Bu vurgular zaten o notta.");
			return jsons;
		}, quiet);
	},

	/** Seçili kayıtların bütün vurgularını son hedefe gönderir. */
	sendItemsToLast(items) {
		let target = this._lastTarget();
		if (!this._resolve(target)) return Hafif.toast("Önce okuyucudan bir başlığa en az bir kez gönderin.", 4000);
		let anns = [];
		for (let item of items) {
			let atts = item.isRegularItem() ? Zotero.Items.get(item.getAttachments()) : [item];
			for (let att of atts) if (att.isFileAttachment()) anns.push(...att.getAnnotations());
		}
		if (!anns.length) return Hafif.toast("Seçili kayıtlarda vurgu yok.");
		return this.sendAnnotations(anns, target);
	},

	/** Okuyucuda az önce yapılan vurguları son hedefe gönderir; senkronizasyondan gelenleri atlar. */
	async autoSend(ids) {
		let target = this._lastTarget();
		if (!this._resolve(target)) return;
		let now = Date.now();
		let open = new Set(Zotero.Reader._readers.map(r => r.itemID));
		let anns = Zotero.Items.get(ids).filter(i =>
			i.isAnnotation()
			&& ["highlight", "underline"].includes(i.annotationType)
			&& open.has(i.parentID)
			&& now - Zotero.Date.sqlToDate(i.dateAdded, true).getTime() < 60000);
		if (anns.length) await this.sendAnnotations(anns, target, { quiet: true });
	},

	/** İşler sıraya alınır; peş peşe gönderimde not bozulmaz. Hatalar ekranda gösterilir. */
	_enqueue(target, getJSONs, quiet = false) {
		this._queue = this._queue.then(async () => {
			let resolved = this._resolve(target);
			if (!resolved) {
				Hafif.toast("Hedef not bulunamadı (silinmiş olabilir).", 4000);
				return;
			}
			let jsons = await getJSONs(resolved.note);
			if (!jsons.length) return;
			let { html, citationItems } = this._serialize(jsons);
			let schema = jsons.some(j => j.type === "underline") ? 10 : 9;
			let fragment = `<div data-citation-items="${encodeURIComponent(JSON.stringify(citationItems))}" data-schema-version="${schema}">${html}</div>`;
			let found = await this._insert(resolved.note, resolved.heading, fragment);
			Hafif.pref("lastTarget", JSON.stringify(target));
			let where = this._targetLabel(resolved);
			Hafif.toast(found
				? `${jsons.length} parça → ${where}`
				: `Başlık bulunamadı, notun sonuna eklendi: ${resolved.note.getNoteTitle()}`, quiet ? 1500 : 2500);
		}).catch(e => {
			Zotero.logError(e);
			Hafif.toast("Nota gönderilemedi: " + e.message, 6000);
		});
		return this._queue;
	},

	/** Düz metni (ör. yapay zekâ yanıtı) son hedef başlığa paragraflar hâlinde ekler. */
	sendTextToLast(text, item) {
		let target = this._lastTarget();
		if (!this._resolve(target)) return Hafif.toast("Önce okuyucudan bir başlığa en az bir kez gönderin.", 4000);
		this._queue = this._queue.then(async () => {
			let { note, heading } = this._resolve(target);
			let src = item ? (item.parentItem || item).getDisplayTitle() : "";
			let paras = String(text).trim().split(/\n{2,}/)
				.map(p => `<p>${this._esc(p).replace(/\n/g, "<br/>")}</p>`).join("");
			let html = `<div data-schema-version="9"><p><em>Yapay zekâ notu${src ? " — " + this._esc(src) : ""}</em></p>${paras}</div>`;
			await this._insert(note, heading, html);
			Hafif.toast(`Yanıt eklendi → ${this._targetLabel({ note, heading })}`);
		}).catch(e => {
			Zotero.logError(e);
			Hafif.toast("Nota eklenemedi: " + e.message, 6000);
		});
		return this._queue;
	},

	// ---- Açıklama bağlantıları: vurgu → gönderildiği notlar ----

	/** Vurgunun geçtiği notlar ve her notta altında durduğu başlık: [{ note, heading }]. */
	async notesWithAnnotation(key) {
		let needle = `annotationKey%22%3A%22${key}%22`;
		let ids = await Zotero.DB.columnQueryAsync("SELECT itemID FROM itemNotes WHERE note LIKE ?", [`%${needle}%`]);
		return Zotero.Items.get(ids || [])
			.filter(n => n && !n.deleted && n.getNote().includes(needle))
			.map(note => ({ note, heading: this._headingOf(note, needle) }));
	},

	_headingOf(note, needle) {
		let wrap = this._wrapper(this._parse(note.getNote()));
		let heading = null;
		for (let el of wrap.children) {
			if (/^H[1-6]$/.test(el.tagName)) heading = el.textContent.trim();
			if (el.outerHTML.includes(needle)) return heading;
		}
		return null;
	},

	/** Okuyucuda seçili vurguların bağlı notlarını menü ağacı olarak verir. */
	async linkedNotesTree(keys) {
		let seen = new Set();
		let nodes = [];
		for (let key of keys) {
			for (let { note, heading } of await this.notesWithAnnotation(key)) {
				let id = `${note.id}|${heading}`;
				if (seen.has(id)) continue;
				seen.add(id);
				let title = note.getNoteTitle() || "(başlıksız not)";
				nodes.push({
					label: heading && heading !== title ? `${title} › ${heading}` : title,
					onCommand: () => Hafif.load("toc").open({ noteID: note.id, annotationKey: key }),
				});
			}
		}
		return nodes.length ? nodes : [{ label: "(Bu vurgu henüz hiçbir nota gönderilmedi)", onCommand: () => {} }];
	},

	// ---- Not şablonları ----

	DEFAULT_TEMPLATES: [
		{ name: "Konu notu", html: "<h1>{{başlık}}</h1><h2>Tanım</h2><p></p><h2>Deliller</h2><p></p><h2>İhtilaf</h2><p></p><h2>Değerlendirme</h2><p></p>" },
		{ name: "Kitap / makale notu", html: "<h1>{{başlık}}</h1><h2>Künye ve genel bilgi</h2><p></p><h2>Ana tez</h2><p></p><h2>Önemli pasajlar</h2><p></p><h2>Değerlendirme</h2><p></p>" },
		{ name: "Tez / makale bölümü", html: "<h1>{{başlık}}</h1><h2>Giriş</h2><p></p><h2>1.</h2><p></p><h2>2.</h2><p></p><h2>Sonuç</h2><p></p>" },
	],

	templates() {
		try {
			let list = JSON.parse(Hafif.pref("templates") || "null");
			if (Array.isArray(list) && list.length) return list.filter(t => t && t.name && t.html);
		}
		catch (e) {
			Zotero.logError(e);
		}
		return this.DEFAULT_TEMPLATES;
	},

	/** Şablon HTML'ini doldurur ({{başlık}}, {{tarih}}). */
	renderTemplate(tpl, title) {
		return tpl.html
			.replace(/\{\{\s*başlık\s*\}\}/g, this._esc(title))
			.replace(/\{\{\s*tarih\s*\}\}/g, new Date().toLocaleDateString("tr-TR"));
	},

	/** Şablondan yeni bağımsız not açar; seçili koleksiyon hedefse oraya, değilse ilk not koleksiyonuna koyar. */
	async createFromTemplate(tpl) {
		let win = Zotero.getMainWindow();
		let input = { value: "" };
		if (!Services.prompt.prompt(win, tpl.name, "Not başlığı:", input, null, {})) return null;
		let title = input.value.trim() || tpl.name;

		let pane = Zotero.getActiveZoteroPane();
		let selected = pane?.getSelectedCollection?.();
		let col = selected && this.isTarget(selected) ? selected : this.getCollections()[0];

		let note = new Zotero.Item("note");
		note.libraryID = col ? col.libraryID : Zotero.Libraries.userLibraryID;
		note.setNote(`<div data-schema-version="9">${this.renderTemplate(tpl, title)}</div>`);
		if (col) note.addToCollection(col.id);
		await note.saveTx();
		Hafif.toast(`“${title}” oluşturuldu${col ? ` (${col.name})` : ""}.`);
		await pane?.selectItem(note.id);
		return note;
	},

	_esc(s) {
		return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
	},

	// ---- HTML ----

	/**
	 * Zotero'nun serileştiricisini bizim alıntı şablonumuzla çalıştırır: vurgu blok alıntı olarak,
	 * yorumunuz altında ayrı paragraf olarak gider. Zotero şablonu yalnızca kendi tercihinden
	 * okuduğu için tercih bu eşzamanlı çağrı süresince değiştirilip hemen geri yüklenir.
	 */
	_serialize(jsons) {
		let key = "annotations.noteTemplates.highlight";
		let original = Zotero.Prefs.get(key);
		try {
			Zotero.Prefs.set(key, Hafif.pref("quoteTemplate") || original);
			return Zotero.EditorInstanceUtilities.serializeAnnotations(jsons, true);
		}
		finally {
			Zotero.Prefs.set(key, original);
		}
	},

	_sort(anns) {
		return [...anns].sort((a, b) =>
			a.parentID - b.parentID || (a.annotationSortIndex || "").localeCompare(b.annotationSortIndex || ""));
	},

	_parse(html) {
		let win = Zotero.getMainWindow();
		return new win.DOMParser().parseFromString(html || "", "text/html");
	},

	/** Notun asıl içerik kabı. Zotero içeriği çoğu zaman <div class="zotero-note znv1"> içine koyar. */
	_wrapper(doc) {
		let wrap = doc.body.querySelector("div[data-schema-version]");
		if (!wrap) {
			wrap = doc.createElement("div");
			wrap.setAttribute("data-schema-version", "9");
			wrap.append(...doc.body.childNodes);
			doc.body.append(wrap);
		}
		return wrap;
	},

	_citations(wrap) {
		try {
			return JSON.parse(decodeURIComponent(wrap.getAttribute("data-citation-items") || "%5B%5D"));
		}
		catch (e) {
			return [];
		}
	},

	/**
	 * Parçayı başlığın bölümünün sonuna (aynı ya da daha üst düzeydeki bir sonraki başlıktan önce)
	 * yerleştirir; başlık yoksa notun sonuna ekler. Atıf listesini ve şema sürümünü birleştirir.
	 * Başlık bulunduysa true döner.
	 */
	async _insert(note, heading, fragmentHTML) {
		let doc = this._parse(note.getNote());
		let wrap = this._wrapper(doc);
		let fwrap = this._wrapper(this._parse(fragmentHTML));

		let anchor = null;
		let found = !heading;
		if (heading) {
			let same = [...wrap.querySelectorAll(`:scope > :is(${this.HEADINGS})`)]
				.filter(h => h.textContent.trim() === heading.text);
			let h = same[heading.ordinal] || same[0];
			if (h) {
				found = true;
				let level = +h.tagName[1];
				for (let el = h.nextElementSibling; el; el = el.nextElementSibling) {
					if (/^H[1-6]$/.test(el.tagName) && +el.tagName[1] <= level) {
						anchor = el;
						break;
					}
				}
			}
		}

		let citations = this._citations(wrap);
		for (let c of this._citations(fwrap)) {
			if (!citations.some(x => x.uris.some(u => c.uris.includes(u)))) citations.push(c);
		}
		let schema = Math.max(+wrap.getAttribute("data-schema-version") || 9, +fwrap.getAttribute("data-schema-version") || 9);
		let nodes = [...fwrap.childNodes].map(n => doc.adoptNode(n));
		if (anchor) anchor.before(...nodes);
		else wrap.append(...nodes);

		wrap.setAttribute("data-schema-version", String(schema));
		if (citations.length) wrap.setAttribute("data-citation-items", encodeURIComponent(JSON.stringify(citations)));
		note.setNote(wrap.outerHTML);
		await note.saveTx();
		return found;
	},
};
