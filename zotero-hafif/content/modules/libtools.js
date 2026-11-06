/* Yapay zekâ asistanının kütüphane araçları (yalnızca okur).
 * Her araç: { name, label, description, parameters (JSON Schema), run(args, ctx) → metin }.
 * Kayıtlara 8 harfli Zotero anahtarıyla başvurulur; model atıfı [[ANAHTAR]] ya da
 * [[ANAHTAR, s. 12]] biçiminde yazar, sohbet paneli bunu tıklanabilir atfa çevirir.
 * PDF metni sayfa sayfa çıkarılır (Zotero'nun PDF işçisi sayfaları \f ile ayırır) ve
 * Zotero veri klasöründe önbelleğe alınır. */

Hafif.modules.libtools = {
	MAX_RESULT: 60000,
	_pageCache: new Map(),

	COLORS: {
		"#ffd400": "sarı", "#ff6666": "kırmızı", "#5fb236": "yeşil", "#2ea8e5": "mavi",
		"#a28ae5": "mor", "#e56eee": "pembe", "#f19837": "turuncu", "#aaaaaa": "gri",
	},
	ANN_TYPES: { 1: "vurgu", 2: "not", 3: "görsel", 4: "çizim", 5: "altı çizili", 6: "metin" },

	// ---- Ortak yardımcılar ----

	libraries() {
		return Zotero.Libraries.getAll().filter(l => l.libraryType === "user" || l.libraryType === "group");
	},

	/** Anahtardan kayıt; kütüphane belirtilmemişse hepsinde aranır. */
	byKey(key) {
		key = String(key || "").trim().replace(/^\[\[|\]\]$/g, "").split(/[,\s|:]/)[0].toUpperCase();
		if (!/^[A-Z0-9]{8}$/.test(key)) throw new Error(`Geçersiz kayıt anahtarı: ${key}`);
		for (let lib of this.libraries()) {
			let it = Zotero.Items.getByLibraryAndKey(lib.libraryID, key);
			if (it && !it.deleted) return it;
		}
		throw new Error(`${key} anahtarlı kayıt bulunamadı.`);
	},

	top(item) {
		return item.isRegularItem() ? item : (item.parentItem || item);
	},

	year(item) {
		let d = item.getField?.("date", true, true) || "";
		return d.slice(0, 4).replace(/^0000$/, "");
	},

	creatorsShort(item, max = 3) {
		let cs = item.getCreators?.() || [];
		let names = cs.slice(0, max).map(c => c.lastName || c.name || c.firstName).filter(Boolean);
		return names.join("; ") + (cs.length > max ? " vd." : "");
	},

	/** Kısa kayıt özeti: arama sonuçlarında kullanılır. */
	summary(item) {
		let top = this.top(item);
		if (top.isNote()) return { key: top.key, tür: "not", başlık: top.getNoteTitle() };
		let atts = top.isRegularItem() ? top.getAttachments().map(id => Zotero.Items.get(id)).filter(a => a && !a.deleted) : [];
		let out = {
			key: top.key,
			tür: Zotero.ItemTypes.getLocalizedString(top.itemType),
			başlık: top.getField("title"),
			yazar: this.creatorsShort(top),
			yıl: this.year(top),
		};
		let pub = top.getField("publicationTitle") || top.getField("bookTitle") || top.getField("publisher");
		if (pub) out.yayın = pub;
		let docs = atts.filter(a => a.isPDFAttachment() || a.isEPUBAttachment?.() || a.isSnapshotAttachment?.());
		if (docs.length) out.belge = docs.map(a => a.key).join(",");
		return out;
	},

	/** Kaydın okunabilir belgesi (PDF > EPUB > anlık görüntü). */
	async documentOf(item) {
		if (item.isAttachment()) return item;
		let top = this.top(item);
		let best = await top.getBestAttachment?.();
		if (best && (best.isPDFAttachment() || best.isEPUBAttachment?.() || best.isSnapshotAttachment?.())) return best;
		for (let id of top.getAttachments?.() || []) {
			let a = Zotero.Items.get(id);
			if (a && (a.isPDFAttachment() || a.isEPUBAttachment?.() || a.isSnapshotAttachment?.())) return a;
		}
		return null;
	},

	_cacheDir() {
		return PathUtils.join(Zotero.DataDirectory.dir, "hafif", "text");
	},

	/** Belgenin sayfa metinleri (dizi; 0. öğe 1. sayfa). PDF dışı belgeler ~3000 karakterlik parçalara bölünür. */
	async pages(att) {
		let hash = (await att.attachmentHash) || String(att.attachmentSyncedModificationTime || att.dateModified);
		let mem = this._pageCache.get(att.id);
		if (mem?.hash === hash) return mem.pages;
		let file = PathUtils.join(this._cacheDir(), att.libraryID + "-" + att.key + ".json");
		try {
			let disk = await IOUtils.readJSON(file);
			if (disk.hash === hash && Array.isArray(disk.pages)) {
				this._pageCache.set(att.id, disk);
				return disk.pages;
			}
		}
		catch (e) {}
		let pages = null;
		if (att.isPDFAttachment()) {
			try {
				let r = await Zotero.PDFWorker.getFullText(att.id, null, true);
				pages = (r?.text || "").split("\f").map(p => p.trim());
			}
			catch (e) {
				Zotero.logError(e);
			}
		}
		if (!pages || !pages.join("").trim()) {
			let text = (await att.attachmentText) || "";
			pages = text.includes("\f") ? text.split("\f") : this._chunk(text, 3000);
		}
		let entry = { hash, pages, pdf: att.isPDFAttachment() };
		this._pageCache.set(att.id, entry);
		if (this._pageCache.size > 30) this._pageCache.delete(this._pageCache.keys().next().value);
		try {
			await IOUtils.makeDirectory(this._cacheDir(), { createAncestors: true, ignoreExisting: true });
			await IOUtils.writeJSON(file, entry);
		}
		catch (e) {
			Zotero.logError(e);
		}
		return pages;
	},

	/** OCR ile elde edilen sayfa metnini önbelleğe yazar (dosya değişmedikçe kalıcıdır). */
	async setPageText(att, pageIndex, text) {
		await this.pages(att);
		let entry = this._pageCache.get(att.id);
		if (!entry) return;
		while (entry.pages.length <= pageIndex) entry.pages.push("");
		entry.pages[pageIndex] = text;
		entry.ocr = [...new Set([...(entry.ocr || []), pageIndex])];
		let file = PathUtils.join(this._cacheDir(), att.libraryID + "-" + att.key + ".json");
		await IOUtils.makeDirectory(this._cacheDir(), { createAncestors: true, ignoreExisting: true });
		await IOUtils.writeJSON(file, entry);
	},

	_chunk(text, size) {
		let out = [];
		let i = 0;
		while (i < text.length) {
			let end = Math.min(text.length, i + size);
			let nl = text.lastIndexOf("\n", end);
			if (nl > i + size / 2 && end < text.length) end = nl;
			out.push(text.slice(i, end).trim());
			i = end;
		}
		return out;
	},

	/** Harf katlama: aksan, hareke, büyük/küçük farkı atılır; katlanmış dizinden asıl dizine eşlem tutulur. */
	_foldMemo: new Map(),

	fold(s) {
		let out = "";
		let map = [];
		let memo = this._foldMemo;
		let norm = Hafif.load("search").normalize.bind(Hafif.modules.search);
		for (let i = 0; i < s.length; i++) {
			let ch = s[i];
			let f = memo.get(ch);
			if (f === undefined) {
				f = /\s/.test(ch) ? " " : norm(ch);
				memo.set(ch, f);
			}
			for (let c of f) {
				out += c;
				map.push(i);
			}
		}
		return { text: out, map };
	},

	/** Metinde geçen yerler ve çevreleri. */
	snippets(text, query, { max = 3, radius = 220 } = {}) {
		let q = this.fold(query).text.trim();
		if (!q) return [];
		let { text: ft, map } = this.fold(text);
		let out = [];
		let from = 0;
		while (out.length < max) {
			let i = ft.indexOf(q, from);
			if (i < 0) break;
			let s = map[i], e = map[Math.min(i + q.length - 1, map.length - 1)] + 1;
			out.push((s > radius ? "…" : "") + text.slice(Math.max(0, s - radius), Math.min(text.length, e + radius)).replace(/\s+/g, " ").trim() + (e + radius < text.length ? "…" : ""));
			from = i + q.length;
		}
		return out;
	},

	_cap(s) {
		return s.length > this.MAX_RESULT ? s.slice(0, this.MAX_RESULT) + "\n\n[Sonuç kısaltıldı; daha dar bir istekle tekrar deneyin.]" : s;
	},

	_noteText(html) {
		let doc = Hafif.load("notes")._parse(html);
		for (let h of doc.querySelectorAll("h1,h2,h3,h4,h5,h6")) h.prepend("#".repeat(+h.tagName[1]) + " ");
		for (let li of doc.querySelectorAll("li")) li.prepend("• ");
		for (let bq of doc.querySelectorAll("blockquote")) bq.prepend("> ");
		for (let el of doc.querySelectorAll("p,div,h1,h2,h3,h4,h5,h6,li,blockquote,tr,br")) el.append("\n");
		return (doc.body?.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
	},

	_collectionByRef(ref, libraryID) {
		if (!ref) return null;
		ref = String(ref).trim();
		let libs = libraryID ? [Zotero.Libraries.get(libraryID)] : this.libraries();
		for (let lib of libs) {
			if (/^[A-Z0-9]{8}$/.test(ref)) {
				let c = Zotero.Collections.getByLibraryAndKey(lib.libraryID, ref);
				if (c) return c;
			}
		}
		let norm = Hafif.load("search").normalize(ref);
		for (let lib of libs) {
			let c = Zotero.Collections.getByLibrary(lib.libraryID, true).find(x => Hafif.modules.search.normalize(x.name) === norm);
			if (c) return c;
		}
		throw new Error(`"${ref}" koleksiyonu bulunamadı.`);
	},

	// ---- Araçlar ----

	tools() {
		let T = this;
		return [
			{
				name: "search_library",
				label: (a) => `Kütüphanede arandı${a.query ? `: “${a.query}”` : ""}`,
				description: "Zotero kütüphanesinde kayıt arar (başlık, yazar, yıl, yayın; mode=everything ile tam metin ve notlar da). Süzgeçler birlikte kullanılabilir. Önce bunu kullan; sonuçlar kısa özet ve kayıt anahtarı verir.",
				parameters: {
					type: "object",
					properties: {
						query: { type: "string", description: "Aranacak sözcükler (boş bırakılırsa yalnızca süzgeçler uygulanır)" },
						mode: { type: "string", enum: ["metadata", "everything"], description: "metadata: başlık/yazar/yıl; everything: tam metin, notlar ve etiketler dahil" },
						creator: { type: "string", description: "Yazar adı" },
						collection: { type: "string", description: "Koleksiyon adı ya da anahtarı (alt koleksiyonlar dahil)" },
						tag: { type: "string" },
						item_type: { type: "string", description: "Zotero tür adı: book, journalArticle, bookSection, thesis, encyclopediaArticle…" },
						year_from: { type: "integer" },
						year_to: { type: "integer" },
						limit: { type: "integer", description: "En çok kaç sonuç (varsayılan 25, en çok 100)" },
					},
				},
				run: (a) => T.searchLibrary(a),
			},
			{
				name: "fulltext_search",
				label: (a) => `PDF'lerin içinde arandı: “${a.query}”`,
				description: "Kütüphanedeki PDF/EPUB metinlerinin içinde sözcük ya da kalıp arar; eşleşen yerleri sayfa numarasıyla döndürür. Bir kavramın geçtiği yerleri bulmak için kullan.",
				parameters: {
					type: "object",
					properties: {
						query: { type: "string", description: "Aranan sözcük ya da kısa kalıp" },
						collection: { type: "string", description: "Yalnızca bu koleksiyonda ara (isteğe bağlı)" },
						limit: { type: "integer", description: "En çok kaç belge (varsayılan 10)" },
					},
					required: ["query"],
				},
				run: (a) => T.fulltextSearch(a),
			},
			{
				name: "get_item",
				label: (a) => `Künye okundu: ${T._labelFor(a.key)}`,
				description: "Bir kaydın bütün künyesini, özetini, etiketlerini, koleksiyonlarını, eklerini (sayfa sayısıyla) ve notlarını verir.",
				parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
				run: (a) => T.getItem(a),
			},
			{
				name: "read_document",
				label: (a) => `Okundu: ${T._labelFor(a.key)}${a.page_start ? `, s. ${a.page_start}${a.page_end && a.page_end !== a.page_start ? "–" + a.page_end : ""}` : ""}`,
				description: "Bir kaydın PDF/EPUB metnini sayfa sayfa okur. Sayfa aralığı ver; verilmezse baştan yaklaşık 20 sayfa. Uzun kitaplarda önce search_in_document ile ilgili sayfaları bul. Sayfa numaraları PDF sayfasıdır (1'den başlar).",
				parameters: {
					type: "object",
					properties: {
						key: { type: "string", description: "Kayıt ya da ek anahtarı" },
						page_start: { type: "integer" },
						page_end: { type: "integer" },
					},
					required: ["key"],
				},
				run: (a) => T.readDocument(a),
			},
			{
				name: "search_in_document",
				label: (a) => `Belgede arandı: “${a.query}” — ${T._labelFor(a.key)}`,
				description: "Tek bir belgenin içinde sözcük arar; geçtiği sayfaları ve çevresini verir.",
				parameters: {
					type: "object",
					properties: { key: { type: "string" }, query: { type: "string" }, limit: { type: "integer" } },
					required: ["key", "query"],
				},
				run: (a) => T.searchInDocument(a),
			},
			{
				name: "list_collections",
				label: () => "Koleksiyonlar listelendi",
				description: "Koleksiyon ağacını kayıt sayılarıyla verir. parent verilirse yalnızca onun alt koleksiyonları.",
				parameters: { type: "object", properties: { parent: { type: "string", description: "Üst koleksiyon adı ya da anahtarı" } } },
				run: (a) => T.listCollections(a),
			},
			{
				name: "list_collection_items",
				label: (a) => `Koleksiyon açıldı: ${a.collection}`,
				description: "Bir koleksiyondaki kayıtları listeler.",
				parameters: {
					type: "object",
					properties: { collection: { type: "string" }, include_subcollections: { type: "boolean" }, limit: { type: "integer" }, offset: { type: "integer" } },
					required: ["collection"],
				},
				run: (a) => T.listCollectionItems(a),
			},
			{
				name: "list_tags",
				label: (a) => "Etiketler listelendi" + (a.query ? `: “${a.query}”` : ""),
				description: "Etiketleri kullanım sayılarıyla listeler.",
				parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } } },
				run: (a) => T.listTags(a),
			},
			{
				name: "search_notes",
				label: (a) => `Notlarda arandı: “${a.query}”`,
				description: "Zotero notlarının içinde arar (bağımsız notlar ve kayıt notları).",
				parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"] },
				run: (a) => T.searchNotes(a),
			},
			{
				name: "read_note",
				label: (a) => `Not okundu: ${T._labelFor(a.key)}`,
				description: "Bir notun tam metnini verir (başlıklar # ile).",
				parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
				run: (a) => T.readNote(a),
			},
			{
				name: "find_annotations",
				label: () => "Vurgular arandı",
				description: "PDF vurgularını ve notlarını arar: metin, yorum, renk (sarı, kırmızı, yeşil, mavi, mor, pembe, turuncu, gri), etiket, tür, kayıt, koleksiyon ve tarih aralığına göre. Bütün kütüphanede çalışır.",
				parameters: {
					type: "object",
					properties: {
						text: { type: "string", description: "Vurgulanan metinde geçen" },
						comment: { type: "string", description: "Yorumda geçen" },
						color: { type: "string" },
						tag: { type: "string" },
						type: { type: "string", enum: ["highlight", "underline", "note", "image", "ink", "text"] },
						item_key: { type: "string", description: "Yalnızca bu kaydın vurguları" },
						collection: { type: "string" },
						since: { type: "string", description: "YYYY-AA-GG; bu tarihten sonra eklenenler" },
						until: { type: "string" },
						limit: { type: "integer", description: "varsayılan 50" },
					},
				},
				run: (a) => T.findAnnotations(a),
			},
			{
				name: "view_page",
				label: (a) => `Sayfaya bakıldı: ${T._labelFor(a.key)}, s. ${a.page}`,
				description: "Bir PDF sayfasının görüntüsünü verir. Taranmış (metin katmanı olmayan) sayfaları okumak, tablo, şekil, el yazması ve dipnot düzenini görmek için kullan. Sayfa numarası PDF sayfasıdır.",
				parameters: { type: "object", properties: { key: { type: "string" }, page: { type: "integer" } }, required: ["key", "page"] },
				run: (a) => T.viewPage(a),
			},
			{
				name: "create_highlights",
				approval: true,
				label: (a) => `PDF'e vurgu: ${T._labelFor(a.key)} (${(a.highlights || []).length})`,
				description: "Kullanıcının PDF'ine gerçek Zotero vurguları (isteğe bağlı yorumla) ya da yapışkan notlar ekler. Kullanıcı açıkça vurgu, işaretleme ya da not ekleme istediğinde kullan. Her vurgunun metni, belgedeki metnin birebir kopyası olmalı (read_document çıktısından), en fazla birkaç cümle. Renkler: sarı, kırmızı, yeşil, mavi, mor, pembe, turuncu, gri. Kullanıcı onaylamadan hiçbir şey eklenmez.",
				parameters: {
					type: "object",
					properties: {
						key: { type: "string", description: "Kayıt ya da PDF eki anahtarı" },
						highlights: {
							type: "array",
							items: {
								type: "object",
								properties: {
									page: { type: "integer", description: "PDF sayfası" },
									text: { type: "string", description: "Vurgulanacak metin, belgedeki gibi" },
									color: { type: "string" },
									comment: { type: "string", description: "Vurguya eklenecek yorum (isteğe bağlı)" },
									type: { type: "string", enum: ["highlight", "underline", "note"], description: "varsayılan highlight; note: metnin yanına yapışkan not" },
								},
								required: ["page", "text"],
							},
						},
						tag: { type: "string", description: "Eklenen vurgulara verilecek etiket (isteğe bağlı)" },
					},
					required: ["key", "highlights"],
				},
				run: (a, ctx) => T.createHighlights(a, ctx),
			},
		];
	},

	_labelFor(key) {
		try {
			let it = this.byKey(key);
			let top = this.top(it);
			if (top.isNote()) return top.getNoteTitle() || key;
			let a = this.creatorsShort(top, 1);
			let y = this.year(top);
			return [a, y].filter(Boolean).join(" ") || top.getField("title")?.slice(0, 40) || key;
		}
		catch (e) {
			return key;
		}
	},

	async searchLibrary(a) {
		let limit = Math.min(a.limit || 25, 100);
		let found = new Map();
		for (let lib of this.libraries()) {
			let s = new Zotero.Search();
			s.libraryID = lib.libraryID;
			if (a.query) s.addCondition(a.mode === "everything" ? "quicksearch-everything" : "quicksearch-titleCreatorYear", "contains", a.query);
			if (a.creator) s.addCondition("creator", "contains", a.creator);
			if (a.tag) s.addCondition("tag", "is", a.tag);
			if (a.item_type) s.addCondition("itemType", "is", a.item_type);
			if (a.collection) {
				let c;
				try {
					c = this._collectionByRef(a.collection, lib.libraryID);
				}
				catch (e) {
					continue;
				}
				s.addCondition("collection", "is", c.key);
				s.addCondition("recursive", "true");
			}
			if (!a.query && !a.creator && !a.tag && !a.item_type && !a.collection) s.addCondition("itemType", "isNot", "attachment");
			let ids = await s.search();
			for (let it of await Zotero.Items.getAsync(ids)) {
				if (!it || it.deleted || it.isAnnotation?.()) continue;
				let top = this.top(it);
				if (top.isAttachment()) continue;
				if (a.year_from || a.year_to) {
					let y = parseInt(this.year(top));
					if (!y || (a.year_from && y < a.year_from) || (a.year_to && y > a.year_to)) continue;
				}
				found.set(top.id, top);
			}
		}
		let items = [...found.values()];
		// Başlıkta geçenler öne
		if (a.query) {
			let q = Hafif.load("search").normalize(a.query);
			let score = (it) => (Hafif.modules.search.normalize(it.isNote() ? it.getNoteTitle() : it.getField("title")).includes(q) ? 0 : 1);
			items.sort((x, y) => score(x) - score(y));
		}
		let total = items.length;
		let rows = items.slice(0, limit).map(it => this.summary(it));
		return this._cap(JSON.stringify({ toplam: total, gösterilen: rows.length, sonuçlar: rows }, null, 1));
	},

	async fulltextSearch(a) {
		let limit = Math.min(a.limit || 10, 30);
		let out = [];
		for (let lib of this.libraries()) {
			let s = new Zotero.Search();
			s.libraryID = lib.libraryID;
			s.addCondition("fulltextContent", "contains", a.query);
			if (a.collection) {
				try {
					let c = this._collectionByRef(a.collection, lib.libraryID);
					s.addCondition("collection", "is", c.key);
					s.addCondition("recursive", "true");
				}
				catch (e) {
					continue;
				}
			}
			let ids = await s.search();
			for (let it of await Zotero.Items.getAsync(ids)) {
				if (out.length >= limit) break;
				if (!it?.isAttachment() || it.deleted) continue;
				let hits = [];
				try {
					let pages = await this.pages(it);
					for (let i = 0; i < pages.length && hits.length < 4; i++) {
						for (let sn of this.snippets(pages[i], a.query, { max: 2, radius: 180 })) hits.push({ sayfa: i + 1, metin: sn });
					}
				}
				catch (e) {
					Zotero.logError(e);
				}
				out.push({ ...this.summary(it), ek: it.key, eşleşmeler: hits });
			}
		}
		if (!out.length) return `“${a.query}” hiçbir belgenin tam metninde bulunamadı. (Zotero yalnızca dizinlenmiş PDF'lerde arar; başka yazımları ya da search_library'yi deneyin.)`;
		return this._cap(JSON.stringify(out, null, 1));
	},

	async getItem(a) {
		let it = this.byKey(a.key);
		let top = this.top(it);
		if (top.isNote()) return this.readNote({ key: top.key });
		let out = { key: top.key, tür: Zotero.ItemTypes.getLocalizedString(top.itemType) };
		for (let fid of Zotero.ItemFields.getItemTypeFields(top.itemTypeID)) {
			let name = Zotero.ItemFields.getName(fid);
			let v = top.getField(name);
			if (v) out[Zotero.ItemFields.getLocalizedString(name)] = v;
		}
		out.yazarlar = top.getCreators().map(c => ({
			ad: c.name || [c.lastName, c.firstName].filter(Boolean).join(", "),
			rol: Zotero.CreatorTypes.getLocalizedString(Zotero.CreatorTypes.getName(c.creatorTypeID)),
		}));
		out.etiketler = top.getTags().map(t => t.tag);
		out.koleksiyonlar = top.getCollections().map(id => Zotero.Collections.get(id)?.name).filter(Boolean);
		out.ekler = [];
		for (let id of top.getAttachments()) {
			let att = Zotero.Items.get(id);
			if (!att || att.deleted) continue;
			let e = { key: att.key, başlık: att.getField("title"), tür: att.attachmentContentType || "" };
			if (att.isPDFAttachment() || att.isEPUBAttachment?.()) {
				try {
					e.sayfa = (await this.pages(att)).length;
				}
				catch (err) {}
				e.vurgu = att.getAnnotations?.().length || 0;
			}
			out.ekler.push(e);
		}
		out.notlar = top.getNotes().map(id => Zotero.Items.get(id)).filter(Boolean).map(n => ({ key: n.key, başlık: n.getNoteTitle() }));
		let rel = top.relatedItems || [];
		if (rel.length) out.ilgili = rel;
		return this._cap(JSON.stringify(out, null, 1));
	},

	async readDocument(a) {
		let it = this.byKey(a.key);
		let att = await this.documentOf(it);
		if (!att) return "Bu kaydın okunabilir bir PDF/EPUB eki yok. Yalnızca künyesi var (get_item).";
		let pages = await this.pages(att);
		let n = pages.length;
		if (!pages.join("").trim()) return `Belgenin metin katmanı yok (taranmış PDF). ${n} sayfa var; view_page ile sayfaların görüntüsüne bakarak okuyabilirsin.`;
		let start = Math.max(1, a.page_start || 1);
		let end = Math.min(n, a.page_end || start + 19);
		let labels = att.isPDFAttachment() ? await Hafif.load("pdfsvc").labels(att) : null;
		let out = [`Belge: ${this.top(att).getField?.("title") || att.getField("title")} — kayıt ${this.top(att).key}, ek ${att.key}, toplam ${n} ${att.isPDFAttachment() ? "sayfa" : "bölüm"}.`
			+ (labels ? " Sayfa işaretlerinde PDF sayfası ve kitabın basılı sayfa numarası birlikte verilir; atıfta PDF sayfasını yaz." : "")];
		let size = 0;
		let last = start - 1;
		for (let p = start; p <= end; p++) {
			let t = pages[p - 1] || "";
			if (size + t.length > this.MAX_RESULT - 2000 && p > start) break;
			let printed = labels?.[p - 1];
			out.push(`\n[[s. ${p}]]${printed && String(printed) !== String(p) ? ` (basılı s. ${printed})` : ""}\n${t.trim() ? t : "(bu sayfada metin yok — view_page ile görüntüsüne bakılabilir)"}`);
			size += t.length;
			last = p;
		}
		if (last < n) out.push(`\n[${last}. sayfada kesildi. Devamı için page_start=${last + 1}.]`);
		return out.join("\n");
	},

	async searchInDocument(a) {
		let att = await this.documentOf(this.byKey(a.key));
		if (!att) return "Okunabilir belge yok.";
		let pages = await this.pages(att);
		let hits = [];
		let limit = Math.min(a.limit || 20, 60);
		for (let i = 0; i < pages.length && hits.length < limit; i++) {
			for (let sn of this.snippets(pages[i], a.query, { max: 3, radius: 200 })) hits.push({ sayfa: i + 1, metin: sn });
		}
		if (!hits.length) return `“${a.query}” bu belgede geçmiyor (${pages.length} sayfa tarandı). Başka yazım ya da eşanlamlı deneyin.`;
		return this._cap(JSON.stringify({ ek: att.key, toplam_sayfa: pages.length, eşleşmeler: hits }, null, 1));
	},

	async listCollections(a) {
		let out = [];
		let walk = (c, depth) => {
			let node = { key: c.key, ad: c.name, kayıt: c.getChildItems(false, false).filter(i => i.isRegularItem()).length };
			let kids = c.getChildCollections(false);
			if (kids.length) {
				if (depth < 3) node.alt = kids.sort((x, y) => x.name.localeCompare(y.name, "tr")).map(k => walk(k, depth + 1));
				else node.alt_sayısı = kids.length;
			}
			return node;
		};
		if (a.parent) {
			let p = this._collectionByRef(a.parent);
			return this._cap(JSON.stringify(walk(p, 0), null, 1));
		}
		for (let lib of this.libraries()) {
			let roots = Zotero.Collections.getByLibrary(lib.libraryID, false).sort((x, y) => x.name.localeCompare(y.name, "tr"));
			out.push({ kütüphane: lib.name, koleksiyonlar: roots.map(c => walk(c, 0)) });
		}
		return this._cap(JSON.stringify(out, null, 1));
	},

	async listCollectionItems(a) {
		let c = this._collectionByRef(a.collection);
		let items = c.getChildItems(false, false);
		if (a.include_subcollections) {
			let walk = (x) => {
				for (let k of x.getChildCollections(false)) {
					items.push(...k.getChildItems(false, false));
					walk(k);
				}
			};
			walk(c);
		}
		items = [...new Map(items.filter(i => i.isRegularItem() || i.isNote()).map(i => [i.id, i])).values()];
		let off = a.offset || 0;
		let lim = Math.min(a.limit || 50, 200);
		return this._cap(JSON.stringify({ koleksiyon: c.name, toplam: items.length, kayıtlar: items.slice(off, off + lim).map(i => this.summary(i)) }, null, 1));
	},

	async listTags(a) {
		let lim = Math.min(a.limit || 100, 500);
		let rows = await Zotero.DB.queryAsync(
			"SELECT T.name AS name, COUNT(DISTINCT IT.itemID) AS n FROM tags T JOIN itemTags IT USING (tagID) "
			+ "JOIN items I USING (itemID) WHERE I.itemID NOT IN (SELECT itemID FROM deletedItems) "
			+ "GROUP BY T.name ORDER BY n DESC");
		let q = a.query && Hafif.load("search").normalize(a.query);
		let list = rows.filter(r => !q || Hafif.modules.search.normalize(r.name).includes(q)).slice(0, lim).map(r => `${r.name} (${r.n})`);
		return list.length ? list.join("\n") : "Etiket bulunamadı.";
	},

	async searchNotes(a) {
		let out = [];
		let lim = Math.min(a.limit || 20, 60);
		for (let lib of this.libraries()) {
			let s = new Zotero.Search();
			s.libraryID = lib.libraryID;
			s.addCondition("note", "contains", a.query);
			let ids = await s.search();
			for (let n of await Zotero.Items.getAsync(ids)) {
				if (!n?.isNote() || n.deleted || out.length >= lim) continue;
				let text = this._noteText(n.getNote());
				out.push({
					key: n.key, başlık: n.getNoteTitle(),
					üst_kayıt: n.parentItem ? this.summary(n.parentItem) : null,
					geçtiği_yer: this.snippets(text, a.query, { max: 2, radius: 200 }),
				});
			}
		}
		return out.length ? this._cap(JSON.stringify(out, null, 1)) : `“${a.query}” hiçbir notta geçmiyor.`;
	},

	async readNote(a) {
		let n = this.byKey(a.key);
		if (!n.isNote()) return "Bu bir not değil; get_item kullanın.";
		let head = `Not ${n.key}: ${n.getNoteTitle()}` + (n.parentItem ? ` (üst kayıt ${n.parentItem.key})` : "");
		return this._cap(head + "\n\n" + this._noteText(n.getNote()));
	},

	async findAnnotations(a) {
		let where = ["I.itemID NOT IN (SELECT itemID FROM deletedItems)"];
		let params = [];
		let like = (s) => "%" + String(s).replace(/[%_]/g, "") + "%";
		if (a.text) { where.push("IA.text LIKE ?"); params.push(like(a.text)); }
		if (a.comment) { where.push("IA.comment LIKE ?"); params.push(like(a.comment)); }
		if (a.color) {
			let c = String(a.color).toLowerCase();
			let hex = c.startsWith("#") ? c : Object.entries(this.COLORS).find(([, n]) => n === c || Hafif.load("search").normalize(n) === Hafif.modules.search.normalize(c))?.[0]
				|| { yellow: "#ffd400", red: "#ff6666", green: "#5fb236", blue: "#2ea8e5", purple: "#a28ae5", magenta: "#e56eee", pink: "#e56eee", orange: "#f19837", gray: "#aaaaaa", grey: "#aaaaaa" }[c];
			if (hex) { where.push("LOWER(IA.color)=?"); params.push(hex); }
		}
		if (a.type) {
			let t = { highlight: 1, note: 2, image: 3, ink: 4, underline: 5, text: 6 }[a.type];
			if (t) { where.push("IA.type=?"); params.push(t); }
		}
		if (a.since) { where.push("I.dateAdded >= ?"); params.push(a.since); }
		if (a.until) { where.push("I.dateAdded <= ?"); params.push(a.until + " 23:59:59"); }
		if (a.tag) { where.push("IA.itemID IN (SELECT itemID FROM itemTags JOIN tags USING (tagID) WHERE tags.name=?)"); params.push(a.tag); }
		if (a.item_key) {
			let it = this.byKey(a.item_key);
			let atts = it.isAttachment() ? [it.id] : this.top(it).getAttachments();
			if (!atts.length) return "Bu kaydın eki yok.";
			where.push(`IA.parentItemID IN (${atts.map(() => "?").join(",")})`);
			params.push(...atts);
		}
		if (a.collection) {
			let c = this._collectionByRef(a.collection);
			let ids = [c.id, ...c.getDescendents(false, "collection").map(d => d.id)];
			where.push(`IA.parentItemID IN (SELECT itemID FROM itemAttachments WHERE parentItemID IN (SELECT itemID FROM collectionItems WHERE collectionID IN (${ids.map(() => "?").join(",")})))`);
			params.push(...ids);
		}
		let lim = Math.min(a.limit || 50, 300);
		let sql = `SELECT IA.itemID FROM itemAnnotations IA JOIN items I USING (itemID) WHERE ${where.join(" AND ")} ORDER BY I.dateAdded DESC LIMIT ${lim + 1}`;
		let ids = await Zotero.DB.columnQueryAsync(sql, params);
		if (!ids?.length) return "Ölçütlere uyan vurgu bulunamadı.";
		let anns = await Zotero.Items.getAsync(ids.slice(0, lim));
		let rows = anns.filter(Boolean).map(an => {
			let att = an.parentItem;
			let top = att?.parentItem || att;
			let r = {
				vurgu: an.key, tür: this.ANN_TYPES[{ highlight: 1, note: 2, image: 3, ink: 4, underline: 5, text: 6 }[an.annotationType]] || an.annotationType,
				kayıt: top?.key, ek: att?.key, kaynak: top ? `${this.creatorsShort(top, 1)} ${this.year(top)}`.trim() : "",
				sayfa: an.annotationPageLabel, renk: this.COLORS[(an.annotationColor || "").toLowerCase()] || an.annotationColor,
				eklendi: an.dateAdded?.slice(0, 10),
			};
			if (an.annotationText) r.metin = an.annotationText;
			if (an.annotationComment) r.yorum = an.annotationComment;
			let tags = an.getTags().map(t => t.tag);
			if (tags.length) r.etiketler = tags;
			return r;
		});
		return this._cap(JSON.stringify({ gösterilen: rows.length, daha_fazla: ids.length > lim, vurgular: rows }, null, 1));
	},

	// ---- Görüntü ve vurgu ----

	async viewPage(a) {
		let att = await this.documentOf(this.byKey(a.key));
		if (!att?.isPDFAttachment()) return "Bu kaydın PDF eki yok.";
		let page = Math.max(1, a.page | 0);
		let img = await Hafif.load("notepreview").renderPage(att, page - 1);
		let data = img.url.replace(/^data:image\/png;base64,/, "");
		let printed = Hafif.load("pdfsvc").labelSync(att, page - 1);
		return { text: `PDF s. ${page}${printed !== String(page) ? ` (basılı s. ${printed})` : ""} görüntüsü — kayıt ${this.top(att).key}.`, images: [{ mediaType: "image/png", data }] };
	},

	HEX: {
		sarı: "#ffd400", yellow: "#ffd400", kırmızı: "#ff6666", red: "#ff6666", yeşil: "#5fb236", green: "#5fb236",
		mavi: "#2ea8e5", blue: "#2ea8e5", mor: "#a28ae5", purple: "#a28ae5", pembe: "#e56eee", pink: "#e56eee", magenta: "#e56eee",
		turuncu: "#f19837", orange: "#f19837", gri: "#aaaaaa", gray: "#aaaaaa", grey: "#aaaaaa",
	},

	_hex(c) {
		if (!c) return "#ffd400";
		c = String(c).trim().toLowerCase();
		if (/^#[0-9a-f]{6}$/.test(c)) return c;
		return this.HEX[c] || this.HEX[Hafif.load("search").normalize(c)] || "#ffd400";
	},

	/** Alıntıları PDF'te bulur, kullanıcıya gösterir, onaylanırsa Zotero vurgusu olarak kaydeder. */
	async createHighlights(a, ctx = {}) {
		let att = await this.documentOf(this.byKey(a.key));
		if (!att?.isPDFAttachment()) return "Bu kaydın PDF eki yok; vurgu yalnızca PDF'e eklenebilir.";
		if (typeof att.isEditable === "function" && !att.isEditable()) return "Bu kütüphane düzenlenemiyor; vurgu eklenemez.";
		let svc = Hafif.load("pdfsvc");
		let found = [];
		let missing = [];
		for (let h of a.highlights || []) {
			let loc = await svc.findQuote(att, Math.max(0, (h.page | 0) - 1), h.text, { spread: 2 });
			if (loc) found.push({ h, loc });
			else missing.push(h);
		}
		if (!found.length) {
			return `Hiçbir alıntı PDF'te bulunamadı (${missing.length}). Metni belgedeki gibi, sayfasıyla birlikte tekrar dene (read_document çıktısından birebir kopyala).`;
		}
		let names = Object.fromEntries(Object.entries(this.COLORS));
		let preview = {
			title: `${this._labelFor(att.key)} — ${found.length} ${found.length === 1 ? "vurgu" : "vurgu"} eklenecek`,
			items: found.map(({ h, loc }) => ({
				color: this._hex(h.color),
				text: loc.text,
				meta: `s. ${loc.pageLabel}${h.type === "note" ? " · yapışkan not" : h.type === "underline" ? " · altı çizili" : ""}${names[this._hex(h.color)] ? " · " + names[this._hex(h.color)] : ""}`,
				comment: h.comment || "",
			})),
			note: missing.length ? `${missing.length} alıntı PDF'te bulunamadı, eklenmeyecek.` : "",
		};
		if (ctx.approve && !(await ctx.approve(preview))) return "Kullanıcı vurguları eklemeyi reddetti. Başka bir şey yapma; gerekirse ne değiştirmek istediğini sor.";
		let created = [];
		for (let { h, loc } of found) {
			let type = ["highlight", "underline", "note"].includes(h.type) ? h.type : "highlight";
			let rects = loc.rects;
			if (type === "note") {
				let r = rects[0];
				let x = Math.max(0, r[0] - 24);
				rects = [[x, r[3] - 22, x + 22, r[3]]];
			}
			let json = {
				key: Zotero.DataObjectUtilities.generateKey(),
				type,
				text: type === "note" ? undefined : loc.text,
				comment: h.comment || "",
				color: this._hex(h.color),
				pageLabel: loc.pageLabel,
				sortIndex: loc.sortIndex,
				position: { pageIndex: loc.pageIndex, rects },
				tags: a.tag ? [{ name: a.tag }] : [],
			};
			created.push(await Zotero.Annotations.saveFromJSON(att, json));
		}
		ctx.registerUndo?.(`${created.length} vurguyu geri al`, async () => {
			for (let it of created) await it.eraseTx();
		});
		let lines = created.map((it, i) => `- s. ${found[i].loc.pageLabel}: “${(found[i].loc.text || "").slice(0, 80)}”${found[i].loc.partial ? " (kısmen eşleşti)" : ""}`);
		return `${created.length} vurgu eklendi (ek ${att.key}).\n${lines.join("\n")}` + (missing.length ? `\nBulunamayanlar: ${missing.map(m => `s. ${m.page} “${String(m.text).slice(0, 50)}”`).join("; ")}` : "");
	},

	// ---- Bağlam ----

	/** O an ekranda olan: okuyucudaki belge ve sayfa ya da kütüphanede seçili kayıtlar. */
	viewContext(win = Zotero.getMainWindow()) {
		let tabs = win?.Zotero_Tabs;
		if (!tabs) return null;
		if (tabs.selectedType !== "library") {
			let reader = Zotero.Reader.getByTabID(tabs.selectedID);
			let att = reader && Zotero.Items.get(reader.itemID);
			if (att) {
				let st = reader._internalReader?._state;
				let page = st?.primaryViewStats?.pageIndex;
				let label = st?.primaryViewStats?.pageLabel;
				return { kind: "reader", attachment: att, item: this.top(att), page: page != null ? page + 1 : null, pageLabel: label };
			}
		}
		let pane = win.ZoteroPane;
		let items = pane?.getSelectedItems?.() || [];
		let collection = pane?.getSelectedCollection?.() || null;
		return { kind: "library", items, collection };
	},
};
