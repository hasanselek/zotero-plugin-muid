/* Künye denetimi (İSNAD 2. edisyonu gözeterek): eksik zorunlu alanlar, büyük harfli başlık ve
 * yazar adları, fazla boşluk, sonda nokta, bozuk ISBN/DOI, tarih ve sayfa biçimi, dil kodu,
 * transkripsiyon tutarlılığı (ayın/hemze yerine düz kesme işareti), hicrî tarih ipuçları.
 * Denetim saf işlevdir: kaydın anlık görüntüsü (snapshot) üzerinde çalışır, Zotero'suz sınanır.
 * Güvenle düzeltilebilenler (boşluk, nokta, DOI öneki, dil adı, büyük harf) tek tuşla düzeltilir. */

Hafif.modules.lint = {
	/** Türlere göre İSNAD'ın beklediği alanlar. "creator" en az bir yazar/editör demektir. */
	REQUIRED: {
		book: ["creator", "title", "place", "publisher", "date"],
		bookSection: ["creator", "title", "bookTitle", "place", "publisher", "date", "pages"],
		journalArticle: ["creator", "title", "publicationTitle", "date", "pages", "volume|issue"],
		thesis: ["creator", "title", "university", "place", "thesisType", "date"],
		encyclopediaArticle: ["creator", "title", "encyclopediaTitle", "volume", "pages", "place", "date"],
		conferencePaper: ["creator", "title", "proceedingsTitle|conferenceName", "date"],
		magazineArticle: ["creator", "title", "publicationTitle", "date"],
		newspaperArticle: ["title", "publicationTitle", "date"],
		report: ["creator", "title", "institution", "date"],
		webpage: ["title", "url", "accessDate"],
		manuscript: ["creator", "title"],
	},

	LABELS: {
		creator: "yazar/editör", title: "başlık", place: "yayın yeri", publisher: "yayınevi", date: "tarih",
		bookTitle: "kitap adı", pages: "sayfa aralığı", publicationTitle: "dergi adı", volume: "cilt", issue: "sayı",
		university: "üniversite", thesisType: "tez türü", encyclopediaTitle: "ansiklopedi adı",
		proceedingsTitle: "bildiri kitabı", conferenceName: "kongre adı", institution: "kurum", url: "URL",
		accessDate: "erişim tarihi", language: "dil", ISBN: "ISBN", DOI: "DOI", ISSN: "ISSN",
	},

	LANGS: {
		"türkçe": "tr", turkish: "tr", "tr-tr": "tr", "ingilizce": "en", english: "en", "en-us": "en", "en-gb": "en",
		"arapça": "ar", arabic: "ar", "almanca": "de", german: "de", deutsch: "de", "fransızca": "fr", french: "fr",
		"farsça": "fa", persian: "fa", farsi: "fa", "osmanlıca": "ota", ottoman: "ota", "urduca": "ur", urdu: "ur",
		"italyanca": "it", italian: "it", "ispanyolca": "es", spanish: "es", "rusça": "ru", russian: "ru",
	},

	// ---- Anlık görüntü ----

	snapshot(item) {
		let fields = {};
		let own = new Set();
		let aliases = {};
		for (let fid of Zotero.ItemFields.getItemTypeFields(item.itemTypeID)) {
			let name = Zotero.ItemFields.getName(fid);
			let base = Zotero.ItemFields.getBaseIDFromTypeAndField(item.itemTypeID, fid);
			fields[name] = item.getField(name);
			own.add(name);
			if (base) aliases[Zotero.ItemFields.getName(base)] = fields[name];
		}
		for (let [k, v] of Object.entries(aliases)) if (!(k in fields)) fields[k] = v;
		return {
			type: Zotero.ItemTypes.getName(item.itemTypeID),
			fields,
			own,
			valid: new Set(Object.keys(fields)),
			creators: item.getCreators().map(c => ({ ...c, creatorType: Zotero.CreatorTypes.getName(c.creatorTypeID) })),
		};
	},

	// ---- Denetim (saf) ----

	isCaps(s) {
		let letters = String(s || "").replace(/[^\p{L}]/gu, "");
		return letters.length >= 4 && letters === letters.toLocaleUpperCase("tr") && letters !== letters.toLocaleLowerCase("tr");
	},

	isbnValid(raw) {
		let s = String(raw || "").replace(/[\s-]/g, "").toUpperCase();
		if (/^\d{9}[\dX]$/.test(s)) {
			let sum = 0;
			for (let i = 0; i < 10; i++) sum += (s[i] === "X" ? 10 : +s[i]) * (10 - i);
			return sum % 11 === 0;
		}
		if (/^\d{13}$/.test(s)) {
			let sum = 0;
			for (let i = 0; i < 13; i++) sum += +s[i] * (i % 2 ? 3 : 1);
			return sum % 10 === 0;
		}
		return false;
	},

	/** → [{ field, level: "error"|"warn"|"info", msg, fix?: { field, value } | { action } }] */
	check(snap) {
		let out = [];
		let f = snap.fields;
		let add = (field, level, msg, fix) => out.push({ field, level, msg, fix });
		let has = (name) => {
			if (name === "creator") return snap.creators.some(c => (c.lastName || c.name || "").trim());
			return name.split("|").some(n => String(f[n] || "").trim());
		};
		let label = (name) => name.split("|").map(n => this.LABELS[n] || n).join(" ya da ");

		for (let req of this.REQUIRED[snap.type] || []) {
			if (req !== "creator" && !req.split("|").some(n => snap.valid.has(n))) continue;
			if (!has(req)) add(req.split("|")[0], req === "title" || req === "creator" ? "error" : "warn", `${label(req)} eksik`);
		}

		// Başlık
		let title = f.title || "";
		if (title) {
			if (/\s{2,}|^\s|\s$/.test(title)) add("title", "warn", "başlıkta fazla boşluk", { field: "title", value: title.replace(/\s+/g, " ").trim() });
			if (/[^.]\.$/.test(title) && !/\b(vb|vs|bk|age|a\.g\.e|et al)\.$/i.test(title)) add("title", "info", "başlık noktayla bitiyor", { field: "title", value: title.replace(/\.$/, "") });
			if (this.isCaps(title)) add("title", "warn", "başlık BÜYÜK HARFLE yazılmış", { action: "titleCase" });
		}
		for (let name of ["publicationTitle", "bookTitle", "publisher", "place"]) {
			if (snap.own && !snap.own.has(name)) continue;
			let v = f[name];
			if (v && /\s{2,}|^\s|\s$/.test(v)) add(name, "warn", `${this.LABELS[name]}: fazla boşluk`, { field: name, value: v.replace(/\s+/g, " ").trim() });
			if (v && this.isCaps(v) && name !== "place") add(name, "info", `${this.LABELS[name]} BÜYÜK HARFLE yazılmış`);
		}

		// Yazarlar
		for (let c of snap.creators) {
			let full = [c.lastName, c.firstName, c.name].filter(Boolean).join(" ");
			if (this.isCaps(full)) add("creators", "warn", `yazar adı BÜYÜK HARFLE: “${full}”`, { action: "fixNames" });
			if (c.fieldMode === 1 && /\s/.test(c.name || "") && !/[؀-ۿ]/.test(c.name) && !/(enstitü|vakf|üniversite|institute|university|bakanlığ|derneğ|merkez)/i.test(c.name)) {
				add("creators", "info", `“${c.name}” tek alanda yazılmış; soyadı/ad olarak ayırmak gerekebilir`);
			}
		}

		// Tarih
		let date = (f.date || "").trim();
		if (date) {
			let y = date.match(/\b(\d{3,4})\b/)?.[1];
			if (!y) add("date", "warn", `tarih çözümlenemiyor: “${date}”`);
			else if (+y < 1500 && !/h\.|hicr|ah\b/i.test(date) && !/original-date|original date/i.test(f.extra || "")) {
				add("date", "info", `${y} hicrî bir yıl gibi görünüyor; miladî karşılığını yazın ya da “h.” ekleyin (ör. “1430/2009”)`);
			}
		}

		// Sayfa
		let pages = (f.pages || "").trim();
		if (pages) {
			if (/^(s|ss|pp?)\.?\s*/i.test(pages)) add("pages", "warn", "sayfa alanında “s./pp.” öneki var", { field: "pages", value: pages.replace(/^(s|ss|pp?)\.?\s*/i, "") });
			else if (/\d\s*[–—]\s*\d/.test(pages)) add("pages", "info", "sayfa aralığında uzun tire var (İSNAD: kısa tire “-”)", { field: "pages", value: pages.replace(/\s*[–—]\s*/g, "-") });
			let m = pages.match(/^(\d+)\s*-\s*(\d+)$/);
			if (m && +m[2] < +m[1]) add("pages", "warn", `sayfa aralığı ters: ${pages}`);
		}

		// Tanımlayıcılar
		let isbn = (f.ISBN || "").trim();
		if (isbn) {
			let bad = isbn.split(/[\s,;]+/).filter(Boolean).filter(x => !this.isbnValid(x));
			if (bad.length) add("ISBN", "warn", `geçersiz ISBN: ${bad.join(", ")}`);
		}
		let doi = (f.DOI || "").trim();
		if (doi) {
			let clean = doi.replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/i, "");
			if (clean !== doi) add("DOI", "info", "DOI alanında adres öneki var", { field: "DOI", value: clean });
			else if (!/^10\.\d{4,9}\/\S+$/.test(doi)) add("DOI", "warn", `DOI biçimi hatalı: ${doi}`);
		}
		else if (snap.type === "journalArticle" && /doi\.org\/10\./i.test(f.url || "")) {
			add("DOI", "info", "URL'de DOI var ama DOI alanı boş", { field: "DOI", value: (f.url.match(/10\.\d{4,9}\/\S+/) || [""])[0] });
		}

		// Dil
		if (snap.valid.has("language")) {
			let lang = (f.language || "").trim();
			if (!lang) add("language", "info", "dil alanı boş (atıf stilleri büyük-küçük harfi buna göre uygular)");
			else if (this.LANGS[lang.toLocaleLowerCase("tr")]) add("language", "info", `dil adı yerine kod: “${lang}” → “${this.LANGS[lang.toLocaleLowerCase("tr")]}”`, { field: "language", value: this.LANGS[lang.toLocaleLowerCase("tr")] });
		}

		// Transkripsiyon: harf arasında düz kesme işareti/ters tırnak (ʿ ʾ yerine)
		let translit = [title, f.bookTitle, f.publicationTitle].filter(Boolean).join(" ");
		if (/[āīūḥṣḍṭẓ]/i.test(translit) && /\p{L}['`]\p{L}/u.test(translit)) {
			add("title", "info", "transkripsiyonlu metinde düz kesme işareti var; ayın için ʿ, hemze için ʾ kullanın");
		}
		return out;
	},

	// ---- Kütüphane üzerinde ----

	checkItems(items) {
		let report = [];
		for (let it of items) {
			if (!it.isRegularItem()) continue;
			let issues = this.check(this.snapshot(it));
			if (issues.length) report.push({ item: it, issues });
		}
		let rank = { error: 0, warn: 1, info: 2 };
		report.sort((a, b) => Math.min(...a.issues.map(i => rank[i.level])) - Math.min(...b.issues.map(i => rank[i.level])));
		return report;
	},

	/** Denetlenecek kayıtlar: seçim varsa o, yoksa açık koleksiyon, o da yoksa bütün kütüphane. */
	async scope(win) {
		let A = Hafif.load("actions");
		let ctx = A.context(win);
		let items = A._regular(ctx.items);
		if (items.length > 1) return { items, label: `${items.length} seçili kayıt` };
		if (ctx.collection) return { items: ctx.collection.getChildItems(false, false).filter(i => i.isRegularItem()), label: `“${ctx.collection.name}” koleksiyonu` };
		let all = await Zotero.Items.getAll(ctx.libraryID, true, false);
		return { items: all.filter(i => i.isRegularItem()), label: "bütün kütüphane" };
	},

	/** Güvenle düzeltilebilen sorunları düzeltir. Düzeltilen kayıt sayısı döner. */
	async fix(items) {
		let A = Hafif.load("actions");
		let report = this.checkItems(items);
		let titleCase = [], fixNames = [];
		let n = 0;
		await Zotero.DB.executeTransaction(async () => {
			for (let { item, issues } of report) {
				let changed = false;
				for (let is of issues) {
					if (is.fix?.field) {
						item.setField(is.fix.field, is.fix.value);
						changed = true;
					}
					else if (is.fix?.action === "titleCase") titleCase.push(item);
					else if (is.fix?.action === "fixNames") fixNames.push(item);
				}
				if (changed && item.hasChanged()) {
					await item.save();
					n++;
				}
			}
		});
		if (titleCase.length) await A.mapTitles([...new Set(titleCase)], (t, lang) => A.titleCase(t, lang));
		if (fixNames.length) await A.fixNames([...new Set(fixNames)]);
		return n + new Set([...titleCase, ...fixNames]).size;
	},

	ICON: { error: "✕", warn: "!", info: "i" },

	/** Hızlı görünüm: sorunlu kayıtlar paletinde; ↵ kaydı seçer. Ayrıntılı görünüm Hafif Merkezi'nde. */
	async run(win) {
		let { items, label } = await this.scope(win);
		if (!items.length) return Hafif.toast("Denetlenecek kayıt yok.");
		let report = this.checkItems(items);
		if (!report.length) return Hafif.toast(`${label}: sorun bulunmadı (${items.length} kayıt).`, 3000);
		let fixable = report.filter(r => r.issues.some(i => i.fix)).length;
		let entries = [];
		entries.push({ title: "▤ Ayrıntılı rapor (Hafif Merkezi)", meta: "kayıt kayıt sorunlar, tek tek düzeltme", data: { hub: true } });
		if (fixable) entries.push({ title: `✓ Düzeltilebilenleri düzelt (${fixable} kayıt)`, meta: "boşluk, nokta, DOI öneki, dil kodu, büyük harf", data: { fixAll: true } });
		for (let r of report) {
			let worst = r.issues.find(i => i.level === "error") || r.issues.find(i => i.level === "warn") || r.issues[0];
			entries.push({ title: `${this.ICON[worst.level]} ${r.item.getDisplayTitle()}`, meta: r.issues.map(i => i.msg).join(" · "), data: { item: r.item } });
		}
		let pick = await Hafif.load("actions")._pick(win, `Künye denetimi — ${label}: ${report.length} kayıtta sorun`, entries);
		if (!pick) return;
		if (pick.hub) return Hafif.load("hub").open("lint");
		if (pick.fixAll) {
			let n = await this.fix(report.map(r => r.item));
			return Hafif.toast(`${n} kayıt düzeltildi. Kalanlar elle bakılmalı.`, 3500);
		}
		win.Zotero_Tabs.select("zotero-pane");
		await win.ZoteroPane.selectItem(pick.item.id);
	},
};
