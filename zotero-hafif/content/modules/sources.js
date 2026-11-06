/* Literatür kaynakları: YÖK Ulusal Tez Merkezi, DergiPark, TDV İslâm Ansiklopedisi ve OpenAlex'te
 * ortak süzgeçlerle arama ve sonuçları tam künyesiyle Zotero'ya ekleme.
 * Süzgeçler: tür (tez/makale/madde/kitap), tez türü, alan (Temel İslâm Bilimleri, İslâm hukuku,
 * İslâm ekonomisi, İslâm tarihi…), yıl aralığı, dil, nerede aranacağı, yalnızca tam metni olanlar.
 * Site ayrıştırıcıları Mütalaa'daki (packages/server/src/sources) canlı incelenmiş kodlardan
 * uyarlandı. DergiPark araması Cloudflare doğrulaması isterse küçük bir pencere açılır; kutuyu
 * kullanıcı kendisi işaretler, sonraki aramalar aynı oturumla sürer. */

Hafif.modules.sources = {
	SOURCES: {
		yoktez: { label: "YÖK Tez", types: ["thesis"] },
		dergipark: { label: "DergiPark", types: ["article"] },
		dia: { label: "TDV İslâm Ansiklopedisi", types: ["encyclopedia"] },
		openalex: { label: "OpenAlex", types: ["article", "thesis", "book"] },
	},

	/** Alanlar: YÖK konu kodları ve tezin anabilim/bilim dalında aranacak ifadeler. */
	FIELDS: {
		tib: { label: "Temel İslâm Bilimleri", konu: ["Din = Religion"], match: /temel isl[aâ]m bilimleri|tefsir|hadis|kel[aâ]m|f[ıi]k[ıi]h|isl[aâ]m hukuku|tasavvuf|mezhepler|arap dili|kur.?[aâ]n/i, en: "Islamic studies" },
		hukuk: { label: "İslâm Hukuku", konu: ["Din = Religion", "Hukuk = Law"], match: /isl[aâ]m hukuku|f[ıi]k[ıi]h|f[ıi]kh/i, en: "Islamic law" },
		ekonomi: { label: "İslâm Ekonomisi ve Finans", konu: ["Din = Religion", "Ekonomi = Economics", "İşletme = Business Administration", "Bankacılık = Banking"], match: /isl[aâ]m(i)? (ekonomi|iktisat|finans)|kat[ıi]l[ıi]m (bankac|finans)|faizsiz/i, en: "Islamic economics finance" },
		islamtarihi: { label: "İslâm Tarihi ve Sanatları", konu: ["Din = Religion", "Tarih = History"], match: /isl[aâ]m tarihi|isl[aâ]m sanatlar|siyer/i, en: "Islamic history" },
		tarih: { label: "Tarih (genel)", konu: ["Tarih = History"], match: null, en: "history" },
		din: { label: "Bütün din bilimleri", konu: ["Din = Religion"], match: null, en: "religion" },
	},

	YOK: "https://tez.yok.gov.tr/UlusalTezMerkezi",
	DP: "https://dergipark.org.tr",
	DIA: "https://islamansiklopedisi.org.tr",

	_cache: new Map(),
	_yokQueue: Promise.resolve(),

	// ---- Yardımcılar ----

	_doc(html) {
		return Hafif.load("notes")._parse(html);
	},

	_text(s) {
		return String(s ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")
			.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => {
				if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
				return { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " }[e.toLowerCase()] ?? m;
			}).replace(/\s+/g, " ").trim();
	},

	/** “MEHMET ÖZTÜRK”, “İBNÜ'L-ARABÎ” → Türkçe başlık düzeni. */
	tc(s) {
		s = String(s || "").trim();
		if (!s) return s;
		let caps = s === s.toLocaleUpperCase("tr");
		if (!caps) return s;
		// Kelime başı ve “’l-” takısından sonraki harf büyür; kesme işaretinden sonraki ek küçük kalır
		return s.toLocaleLowerCase("tr").replace(/(^|[\s\-("“]|['’]l-)(\p{L})/gu, (m, a, c) => a + c.toLocaleUpperCase("tr"))
			.replace(/\b(Ve|İle|Ya Da|De|Da|Ki)\b/g, w => w.toLocaleLowerCase("tr"))
			.replace(/^(\p{L})/u, c => c.toLocaleUpperCase("tr"))
			// Arapça harf-i tarif takısı küçük yazılır: el-Mergînânî, er-Râzî
			.replace(/(^|\s)(E[lrsntzdşc])-(?=\p{Lu})/gu, (m, a, p) => a + p.toLocaleLowerCase("tr") + "-");
	},

	/** Şapkasız ve şapkalı yazım çeşitleri (İslâm/İslam, fıkıh/fikih değil: yalnızca şapka). */
	variants(q) {
		let plain = q.replace(/[âÂ]/g, m => m === "â" ? "a" : "A").replace(/[îÎ]/g, m => m === "î" ? "i" : "İ").replace(/[ûÛ]/g, m => m === "û" ? "u" : "U");
		return [...new Set([q, plain])];
	},

	async _req(method, url, { body, headers = {}, type = "text", timeout = 60000 } = {}) {
		let xhr;
		try {
			xhr = await Zotero.HTTP.request(method, url, { body, headers, responseType: type, timeout, successCodes: false });
		}
		catch (e) {
			let host = url.replace(/^https?:\/\/([^/]+).*/, "$1");
			throw new Error(/tez\.yok/.test(host)
				? "YÖK Tez Merkezi'ne bağlanılamadı (site yanıt vermiyor ya da sık istek nedeniyle bir süre engelliyor; birkaç dakika sonra deneyin)."
				: `${host} adresine bağlanılamadı: ${e.message || e}`);
		}
		return { status: xhr.status, url: xhr.responseURL || url, body: xhr.response };
	},

	/** Sonucun kütüphanede olup olmadığını anlamak için başlık ve DOI kümesi. */
	async _libIndex() {
		let S = Hafif.load("search");
		if (Hafif.indexDirty || !S._index.length) await S.buildIndex();
		let titles = new Set(S._index.map(e => e.nTitle).filter(t => t.length > 8));
		let dois = await Hafif.load("research")._libraryDOIs().catch(() => new Set());
		return { titles, dois, norm: S.normalize.bind(S) };
	},

	_mark(hits, lib) {
		for (let h of hits) {
			h.inLibrary = (h.doi && lib.dois.has(h.doi.toLowerCase())) || lib.titles.has(lib.norm(h.title || ""));
		}
		return hits;
	},

	// ---- Ortak arama ----

	/**
	 * params: { query, searchIn: all|title|abstract|keywords|author|advisor, sources: [..],
	 *   docType: any|thesis|article|encyclopedia|book, thesisType: any|yl|doktora,
	 *   field: any|tib|hukuk|…, yearFrom, yearTo, language: any|tr|ar|en, fullTextOnly, englishQuery, limit }
	 * Dönüş: { results: [hit], bySource: { kaynak: { total, error, note } } }
	 */
	async search(params, { onSource } = {}) {
		let p = { searchIn: "all", sources: Object.keys(this.SOURCES), docType: "any", thesisType: "any", field: "any", language: "any", limit: 20, ...params };
		if (!String(p.query || "").trim()) throw new Error("Aranacak bir şey yazın.");
		let want = p.sources.filter(s => this.SOURCES[s] && (p.docType === "any" || this.SOURCES[s].types.includes(p.docType)));
		let lib = await this._libIndex();
		let bySource = {};
		let all = [];
		await Promise.all(want.map(async (s) => {
			try {
				let r = await this["_" + s](p);
				let hits = this._mark(r.hits, lib);
				bySource[s] = { total: r.total, note: r.note, count: hits.length };
				all.push(...hits);
				onSource?.(s, { ...bySource[s], hits });
			}
			catch (e) {
				bySource[s] = { error: e.message || String(e) };
				onSource?.(s, bySource[s]);
			}
		}));
		return { results: all, bySource };
	},

	_yearOK(p, y) {
		y = parseInt(y);
		if (!y) return !p.yearFrom && !p.yearTo;
		return (!p.yearFrom || y >= p.yearFrom) && (!p.yearTo || y <= p.yearTo);
	},

	// ---- YÖK Tez ----

	/** YÖK art arda isteklerde kısıtladığı için istekler sıraya girer. */
	_yok(fn) {
		let run = this._yokQueue.then(fn, fn);
		// YÖK sık istekte IP'yi bir süre engelliyor: istekler arası yarım saniye
		this._yokQueue = run.catch(() => {}).then(() => new Promise(r => setTimeout(r, 500)));
		return run;
	},

	async _yokSession() {
		if (this._yokAt && Date.now() - this._yokAt < 10 * 60000) return;
		await this._req("GET", this.YOK + "/tarama.jsp");
		this._yokAt = Date.now();
	},

	_yokCards(html) {
		let meta = new Map();
		for (let m of html.matchAll(/"(\d+)":\s*\{\s*"meta":\s*(\{[^}]*\})/g)) {
			try {
				meta.set(m[1], JSON.parse(m[2]));
			}
			catch (e) {}
		}
		let cards = [];
		for (let part of html.split('class="result-card"').slice(1)) {
			let head = /data-index="(\d+)"\s+data-kayitno="([^"]+)"\s+data-tezno="([^"]+)"/.exec(part);
			let no = /Tez No:<\/strong>\s*(\d+)/.exec(part)?.[1];
			if (!head || !no) continue;
			let title = this._text(/class="card-title">([\s\S]*?)<\/div>/.exec(part)?.[1]);
			let title2 = this._text(/class="card-info"[^>]*italic[^>]*>([\s\S]*?)<\/div>/.exec(part)?.[1]);
			let m = meta.get(head[1]) || {};
			cards.push({
				kayitNo: head[2], tezKey: head[3], no,
				title: title || title2, title2: title ? title2 : "",
				author: m.author && this._text(m.author), year: /\d{4}/.exec(m.year || "")?.[0],
				type: m.type && this._text(m.type), lang: m.lang && this._text(m.lang),
				subject: m.subject && this._text(m.subject), yer: m.yer && this._text(m.yer),
			});
		}
		let total = /Arama sonucunda\s+([\d.]+)\s+kay/.exec(html)?.[1];
		return { cards, total: total ? +total.replace(/\./g, "") : cards.length };
	},

	async _yokSearchOnce(p, konu) {
		await this._yokSession();
		let tur = { yl: "1", doktora: "2" }[p.thesisType] || "0";
		let dil = { tr: "1", en: "2", ar: "3" }[p.language] || "0";
		let q = p.query.trim();
		let f = {
			uniad: "", Universite: "", uni_yoksis_id: "", source: "TR", ensad: "", Enstitu: "0", abdad: "", ABD: "0",
			izin: p.fullTextOnly ? "1" : "0", Durum: "3", Dil: dil, AdSoyad: "", DanismanAdSoyad: "", Dizin: "", TezNo: "", Metin: "", TezAd: "",
			Konu: konu || "", Tur: tur, yil1: String(p.yearFrom || 0), yil2: String(p.yearTo || 0), islem: "2", Bolum: "0", "-find": "  Bul",
		};
		let simple = p.searchIn === "all" && tur === "0" && dil === "0" && !konu && !p.yearFrom && !p.yearTo && !p.fullTextOnly;
		if (simple) {
			// Bütün alanlarda: basit arama (başlık, yazar, danışman, konu, anahtar kelime ve özet birlikte)
			let w = q.split(/\s+/);
			f = { keyword: w[0] || "", keyword1: w[1] || "", keyword2: w.slice(2).join(" "), ops_field: "and", ops_field1: "and", nevi: "7", tip: "2", islem: "4", "-find": "Bul" };
		}
		else {
			let key = { title: "TezAd", abstract: "Metin", keywords: "Dizin", author: "AdSoyad", advisor: "DanismanAdSoyad" }[p.searchIn] || "TezAd";
			f[key] = q;
		}
		let body = Object.entries(f).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
		let cacheKey = "yok:" + body;
		let hit = this._cache.get(cacheKey);
		if (hit && Date.now() - hit.at < 10 * 60000) return hit.data;
		let r = await this._yok(() => this._req("POST", this.YOK + "/SearchTez", {
			body, headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: this.YOK + "/tarama.jsp" }, timeout: 90000,
		}));
		let html = String(r.body || "");
		if (/tezSorguSonucHata/.test(r.url) || /Geçersiz sorgulama/.test(html)) throw new Error("YÖK Tez sorguyu kabul etmedi; terimleri sadeleştirip tekrar deneyin.");
		if (/captcha/i.test(html) && !/result-card/.test(html)) throw new Error("YÖK Tez doğrulama istedi; biraz sonra deneyin.");
		let data = this._yokCards(html);
		this._cache.set(cacheKey, { at: Date.now(), data });
		return data;
	},

	async _yokDetail(c) {
		let k = `yokd:${c.kayitNo}:${c.tezKey}`;
		if (this._cache.has(k)) return this._cache.get(k);
		let r = await this._yok(() => this._req("GET", `${this.YOK}/tezBilgiDetay.jsp?kayitNo=${encodeURIComponent(c.kayitNo)}&tezNo=${encodeURIComponent(c.tezKey)}`, {
			headers: { "X-Requested-With": "XMLHttpRequest", Referer: this.YOK + "/tezSorguSonucYeni.jsp" }, timeout: 20000,
		}));
		let d = {};
		try {
			d = JSON.parse(r.body);
		}
		catch (e) {}
		this._cache.set(k, d);
		return d;
	},

	async _yokPdf(c) {
		let r = await this._yok(() => this._req("GET", `${this.YOK}/getTezPdf.jsp?kayitNo=${encodeURIComponent(c.kayitNo)}&tezNo=${encodeURIComponent(c.tezKey)}`, {
			headers: { "X-Requested-With": "XMLHttpRequest", Referer: this.YOK + "/tezSorguSonucYeni.jsp" }, timeout: 20000,
		}));
		let key = /TezGoster\?key=([^'"\s&<>]+)/.exec(String(r.body || ""))?.[1];
		return key ? `${this.YOK}/TezGoster?key=${key}` : null;
	},

	_thesisType(t) {
		if (/y[üu]ksek\s+lisans/i.test(t || "")) return "Yüksek Lisans Tezi";
		if (/doktora/i.test(t || "")) return "Doktora Tezi";
		return t || "";
	},

	async _yoktez(p) {
		let field = this.FIELDS[p.field];
		let konular = field ? field.konu : [null];
		let merged = new Map();
		let total = 0;
		for (let konu of konular) {
			let r = await this._yokSearchOnce(p, konu);
			total += r.total;
			for (let c of r.cards) if (!merged.has(c.no)) merged.set(c.no, c);
		}
		let cards = [...merged.values()].filter(c => this._yearOK(p, c.year) || (!p.yearFrom && !p.yearTo));
		// Alan süzgeci: tezin anabilim/bilim dalı ayrıntıdan okunur (ilk 40 tez; YÖK sık isteği engelliyor)
		let limit = p.limit || 20;
		let pool = field?.match ? cards.slice(0, 40) : cards.slice(0, limit);
		let details = new Map();
		let i = 0;
		await Promise.all(Array.from({ length: 2 }, async () => {
			while (i < pool.length) {
				let c = pool[i++];
				try {
					details.set(c.no, await this._yokDetail(c));
				}
				catch (e) {}
			}
		}));
		let note = "";
		if (field?.match) {
			let before = pool.length;
			pool = pool.filter(c => {
				let d = details.get(c.no) || {};
				return field.match.test([this._text(d.yer), c.subject, c.title, c.title2].join(" "));
			});
			note = `${before} tezin ${pool.length} tanesi “${field.label}” alanında` + (cards.length > 40 ? ` (${cards.length} tezin ilk 40'ı süzüldü; daha dar terimlerle ya da yıl aralığıyla arayın)` : "");
		}
		let hits = pool.slice(0, limit).map(c => {
			let d = details.get(c.no) || {};
			let yer = this._text(d.yer || c.yer).split(/\s*\/\s*/).filter(Boolean);
			let abs = this._text(d.trOzet) || this._text(d.enOzet);
			return {
				source: "yoktez", id: `${c.no}:${c.kayitNo}:${c.tezKey}`, card: c,
				title: c.title, title2: c.title2, authors: c.author ? [this.tc(c.author)] : [], year: c.year,
				type: "thesis", thesisType: this._thesisType(c.type), lang: c.lang,
				venue: yer.map(x => this.tc(x)).join(" · "), subject: c.subject,
				advisor: this._text(d.danisman).replace(/^(?:Eş\s+)?Danışman\S*\s*:?\s*/i, ""),
				abstract: abs ? abs.slice(0, 1200) : "",
				url: `${this.YOK}/tezBilgiDetay.jsp?kayitNo=${encodeURIComponent(c.kayitNo)}&tezNo=${encodeURIComponent(c.tezKey)}`,
				no: c.no,
			};
		});
		return { hits, total, note };
	},

	// ---- TDV İslâm Ansiklopedisi ----

	_diaRows(html, mode) {
		let doc = this._doc(html);
		let out = [];
		for (let row of doc.querySelectorAll(".madde_liste_satir")) {
			let a = row.querySelector("a[href]");
			let href = a?.getAttribute("href") || "";
			if (!href || /^https?:\/\/(?!islamansiklopedisi)/.test(href) || /^\/(arama|muellif)\b/.test(href)) continue;
			let [name, arabic] = (a.textContent || "").split(/\s{2,}/).map(s => s.trim());
			if (!name) continue;
			let desc = row.querySelector(".desc")?.textContent?.replace(/\s+/g, " ").trim();
			let snippet = [...row.querySelectorAll("div")].map(d => d.textContent || "").filter(t => t.includes("…")).join(" ").replace(/\s+/g, " ").trim();
			let url = new URL(href, this.DIA).href;
			out.push({
				source: "dia", id: url.replace(this.DIA, ""), title: this.tc(name), arabic, authors: [], type: "encyclopedia",
				venue: "TDV İslâm Ansiklopedisi", url,
				abstract: [arabic, desc, mode === "t" && snippet ? "İçerikte: " + snippet.slice(0, 500) : ""].filter(Boolean).join(" — "),
			});
		}
		return out;
	},

	async _dia(p) {
		let q = p.query.trim();
		// m: madde başlıkları, t: madde metinleri (müellif araması madde değil müellif listesi döndürür)
		let modes = p.searchIn === "title" ? ["m"] : ["m", "t"];
		let seen = new Map();
		for (let v of this.variants(q).slice(0, 2)) {
			for (let mode of modes) {
				let r = await this._req("GET", `${this.DIA}/arama/?q=${encodeURIComponent(v)}&p=${mode}`);
				if (r.status === 503) {
					await new Promise(res => setTimeout(res, 1500));
					r = await this._req("GET", `${this.DIA}/arama/?q=${encodeURIComponent(v)}&p=${mode}`);
				}
				if (r.status !== 200) throw new Error(`TDV İslâm Ansiklopedisi ${r.status} döndürdü`);
				for (let h of this._diaRows(String(r.body), mode)) if (!seen.has(h.id)) seen.set(h.id, h);
			}
			if (seen.size >= (p.limit || 20)) break;
		}
		let hits = [...seen.values()].slice(0, p.limit || 20);
		return { hits, total: seen.size };
	},

	/** Madde sayfasından bölüm bölüm künye: müellif, basılı cilt, yıl, yer, sayfa ve bölüm PDF'i. */
	async diaArticle(url) {
		let r = await this._req("GET", url.replace(/#.*$/, ""));
		if (r.status !== 200) throw new Error(`Madde açılamadı (${r.status})`);
		let doc = this._doc(String(r.body));
		let text = (doc.body?.textContent || "").replace(/\s+/g, " ");
		let title = this.tc((doc.querySelector("h1")?.textContent || doc.title.replace(/\s*[-|–]\s*TDV İsl[âa]m Ansiklopedisi.*$/i, "")).trim());
		let PRINT = /(?:Bu madde|Maddenin bu bölümü)\s+(?:TDV\s+)?(?:Türkiye Diyanet Vakfı\s+)?İsl[âa]m Ansiklopedisi['’]?nin\s+(\d{4})\s+yılında\s+([\p{L}]+?)['’]?(?:da|de|ta|te)\s+basılan\s+([\p{L}\d-]+?)\.?\s*cildinde,?\s+([\d\s,–-]+?)\s+numaralı\s+sayfalarda/giu;
		let sections = [];
		for (let m of text.matchAll(PRINT)) sections.push({ index: sections.length + 1, year: m[1], place: m[2], volume: m[3], pages: m[4].replace(/\s+/g, "").replace(/–/g, "-") });
		let NAME = "[\\p{Lu}\\p{M}.'’-]+(?: [\\p{Lu}\\p{M}.'’-]+){0,5}";
		let CITE = new RegExp(`(${NAME}),\\s*["“”]([^"“”]+)["“”],\\s*TDV İsl[âa]m Ansiklopedisi,\\s*(https?:\\/\\/islamansiklopedisi\\.org\\.tr\\/[^\\s()]+)`, "gu");
		let authors = new Map();
		for (let m of text.matchAll(CITE)) {
			let idx = +(/#(\d+)/.exec(m[3])?.[1] || 1);
			if (!authors.has(idx)) authors.set(idx, m[1].trim());
		}
		if (!sections.length) sections.push({ index: 1 });
		let parts = [...doc.querySelectorAll(".article-part")];
		for (let s of sections) {
			s.author = authors.get(s.index) || (sections.length === 1 ? authors.values().next().value : null);
			let el = parts.find(x => x.id === "_" + s.index) || parts[s.index - 1];
			let pdf = el?.querySelector("a.dosyaindir")?.getAttribute("href");
			if (pdf && /^https?:\/\//.test(pdf)) s.pdf = pdf;
		}
		let wanted = /#(\d+)/.exec(url)?.[1];
		return { title, sections: wanted ? sections.filter(s => String(s.index) === wanted) : sections, multi: sections.length > 1, base: url.replace(/#.*$/, "") };
	},

	// ---- DergiPark ----

	_dpURL(p) {
		let q = p.query.trim();
		let parts = [];
		let field = { title: "title", author: "author", abstract: "abstract", keywords: "keywords" }[p.searchIn];
		if (field) parts.push(`${field}:(${q})`);
		else parts.push(q);
		if (p.yearFrom || p.yearTo) parts.push(`year:[${p.yearFrom || 1900} TO ${p.yearTo || new Date().getFullYear()}]`);
		let adv = parts.length > 1 || !!field;
		let query = adv ? parts.map(x => /:/.test(x) ? x : `(${x})`).join(" AND ") : q;
		return `${this.DP}/tr/search?q=${encodeURIComponent(query)}&section=article${adv ? "&advanced=1" : ""}`;
	},

	_dpCards(html) {
		let doc = this._doc(html);
		let cards = [];
		for (let card of doc.querySelectorAll("div.article-card")) {
			let a = card.querySelector("h5.card-title a, .card-title a");
			let href = a?.getAttribute("href") || "";
			if (!href) continue;
			if (href.startsWith("/")) href = this.DP + href;
			let title = (a.textContent || "").replace(/\s+/g, " ").trim();
			let lines = [...card.querySelectorAll("small, .article-meta, .card-text, .card-subtitle, a[href*='/pub/'], span")]
				.map(e => (e.textContent || "").replace(/\s+/g, " ").trim()).filter(t => t && t !== title && t.length < 300);
			cards.push({ url: href, title, lines: [...new Set(lines)].slice(0, 6) });
		}
		let text = (doc.body?.textContent || "").replace(/\s+/g, " ");
		let m = /([\d.]+)\s+(?:sonuç|kayıt|makale)\s+(?:bulundu|listeleniyor)/i.exec(text);
		return { cards, total: m ? +m[1].replace(/\./g, "") : cards.length };
	},

	/** Doğrulama isterse görünür pencere açar; kullanıcı kutuyu işaretleyince sonuç sayfasını okur. */
	async _dpFetch(url) {
		let r = await this._req("GET", url);
		let html = String(r.body || "");
		if (!/\/verification\b/.test(r.url) && !/cf-turnstile/.test(html)) return html;
		return new Promise((resolve, reject) => {
			let win = Zotero.openInViewer(url);
			let t0 = Date.now();
			let timer = setInterval(() => {
				try {
					if (win.closed) {
						clearInterval(timer);
						return reject(new Error("DergiPark doğrulama penceresi kapatıldı."));
					}
					let doc = win.document.querySelector("browser")?.contentDocument;
					if (doc?.querySelector("div.article-card") || (doc && /sonuç bulunamadı|bulunamadı/i.test(doc.body?.textContent || "") && !/verification/.test(doc.URL))) {
						clearInterval(timer);
						let out = doc.documentElement.outerHTML;
						win.close();
						resolve(out);
					}
					else if (Date.now() - t0 > 180000) {
						clearInterval(timer);
						win.close();
						reject(new Error("DergiPark doğrulaması zaman aşımına uğradı."));
					}
				}
				catch (e) {}
			}, 600);
		});
	},

	/** Makale sayfasının citation_* etiketlerinden künye (makale sayfaları doğrulama istemez). */
	async dpArticle(url) {
		let r = await this._req("GET", url, { timeout: 20000 });
		let doc = this._doc(String(r.body || ""));
		let meta = (n) => [...doc.querySelectorAll(`meta[name="${n}"]`)].map(m => m.getAttribute("content")).filter(Boolean);
		return {
			title: meta("citation_title")[0], authors: meta("citation_author").map(a => this.tc(a)),
			journal: meta("citation_journal_title")[0], year: (meta("citation_publication_date")[0] || meta("citation_date")[0] || "").slice(0, 4),
			volume: meta("citation_volume")[0], issue: meta("citation_issue")[0],
			pages: [meta("citation_firstpage")[0], meta("citation_lastpage")[0]].filter(Boolean).join("-"),
			doi: meta("citation_doi")[0], issn: meta("citation_issn")[0],
			pdf: meta("citation_pdf_url")[0] ? new URL(meta("citation_pdf_url")[0], url).href : null,
			language: meta("citation_language")[0], keywords: meta("citation_keywords"),
			// Özet: citation_abstract ya da sayfadaki özet bölümü (meta description dergi bilgisidir, özet değil)
			abstract: (doc.querySelector('meta[name="citation_abstract"]')?.getAttribute("content")
				|| doc.querySelector(".article-abstract, #article_tr .article-abstract, .abstract")?.textContent || "").replace(/^\s*(Öz|Özet|Abstract)\s*/i, "").replace(/\s+/g, " ").trim(),
		};
	},

	async _dergipark(p) {
		let html = await this._dpFetch(this._dpURL(p));
		let { cards, total } = this._dpCards(html);
		// Gelişmiş sözdizimi sonuç vermezse düz aramaya düş (yıl ve alan yerelde süzülür)
		if (!cards.length && /advanced=1/.test(this._dpURL(p))) {
			({ cards, total } = this._dpCards(await this._dpFetch(this._dpURL({ ...p, searchIn: "all", yearFrom: null, yearTo: null }))));
		}
		cards = cards.slice(0, p.limit || 20);
		let hits = cards.map(c => ({
			source: "dergipark", id: /\/(?:issue\/\d+\/|article\/)(\d+)/.exec(c.url)?.[1] || c.url,
			title: c.title, authors: [], year: c.lines.map(l => /\b(19|20)\d{2}\b/.exec(l)?.[0]).find(Boolean),
			type: "article", venue: c.lines.find(l => !/^\d/.test(l) && l.length > 6) || "", url: c.url,
		}));
		// Künye ayrıntısı makale sayfalarından (paralel)
		let i = 0;
		await Promise.all(Array.from({ length: Math.min(5, hits.length) }, async () => {
			while (i < hits.length) {
				let h = hits[i++];
				try {
					let a = await this.dpArticle(h.url);
					Object.assign(h, {
						title: a.title || h.title, authors: a.authors, year: a.year || h.year, venue: a.journal || h.venue,
						volume: a.volume, issue: a.issue, pages: a.pages, doi: a.doi, pdf: a.pdf, abstract: (a.abstract || "").slice(0, 1200), lang: a.language,
					});
				}
				catch (e) {}
			}
		}));
		hits = hits.filter(h => this._yearOK(p, h.year) || (!p.yearFrom && !p.yearTo));
		if (p.fullTextOnly) hits = hits.filter(h => h.pdf);
		return { hits, total };
	},

	// ---- OpenAlex ----

	async _openalex(p) {
		let R = Hafif.load("research");
		let filters = [];
		if (p.yearFrom || p.yearTo) filters.push(`publication_year:${p.yearFrom || ""}-${p.yearTo || ""}`);
		if (p.fullTextOnly) filters.push("open_access.is_oa:true");
		if (p.language && p.language !== "any") filters.push(`language:${p.language}`);
		let type = { thesis: "dissertation", article: "article", book: "book" }[p.docType];
		if (type) filters.push(`type:${type}`);
		else if (p.thesisType !== "any") filters.push("type:dissertation");
		let field = this.FIELDS[p.field];
		let q = (p.englishQuery || p.query).trim();
		let searchParam = p.searchIn === "title" ? "title.search" : p.searchIn === "abstract" ? "abstract.search" : "search";
		if (field?.en && !/islam/i.test(q) && p.searchIn === "all") q += " " + field.en;
		let n = Math.min(p.limit || 20, 50);
		let url = searchParam === "search"
			? `/works?search=${encodeURIComponent(q)}&per-page=${n}`
			: `/works?filter=${searchParam}:${encodeURIComponent(q)}&per-page=${n}`;
		if (filters.length) url += (searchParam === "search" ? "&filter=" : ",") + filters.join(",");
		let r = await R._get(url + "&select=" + R.SELECT);
		let hits = (r.results || []).map(w => {
			let o = R._work(w);
			let abs = R._abstract(w.abstract_inverted_index);
			return {
				source: "openalex", id: o.openalex, title: o.başlık, authors: o.yazar ? o.yazar.split("; ") : [], year: String(o.yıl || ""),
				type: w.type === "dissertation" ? "thesis" : w.type === "book" ? "book" : "article",
				venue: o.yayın, doi: o.doi, pdf: o.açık_erişim, lang: o.dil, cited: o.atıf, abstract: abs.slice(0, 1200),
				url: o.doi ? "https://doi.org/" + o.doi : `https://openalex.org/${o.openalex}`,
			};
		});
		return { hits, total: r.meta?.count };
	},

	// ---- Kütüphaneye ekleme ----

	/** Sonucu Zotero kaydı olarak ekler; dönüş: oluşturulan kayıtlar ve uyarılar. */
	async importHit(h, { collection, libraryID } = {}) {
		libraryID = collection?.libraryID ?? libraryID ?? Zotero.Libraries.userLibraryID;
		let warnings = [];
		let items = [];
		let save = async (it) => {
			it.libraryID = libraryID;
			if (collection) it.addToCollection(collection.id);
			await it.saveTx();
			items.push(it);
			return it;
		};
		if (h.source === "yoktez") {
			let c = h.card || (() => {
				let [no, kayitNo, tezKey] = h.id.split(":");
				return { no, kayitNo, tezKey };
			})();
			let d = await this._yokDetail(c);
			let yer = this._text(d.yer || c.yer).split(/\s*\/\s*/).filter(Boolean);
			let it = new Zotero.Item("thesis");
			it.setField("title", h.title);
			it.setField("thesisType", this._thesisType(c.type || h.thesisType));
			if (yer[0]) it.setField("university", this.tc(yer[0]));
			if (h.year) it.setField("date", h.year);
			if (c.lang) it.setField("language", c.lang);
			it.setField("url", h.url);
			it.setField("accessDate", Zotero.Date.dateToSQL(new Date(), true));
			let abs = this._text(d.trOzet) || this._text(d.enOzet);
			if (abs) it.setField("abstractNote", abs);
			let creators = [];
			if (c.author || h.authors[0]) creators.push(this._person(this.tc(c.author || h.authors[0]), "author"));
			for (let a of this._text(d.danisman).replace(/^(?:Eş\s+)?Danışman\S*\s*:?\s*/i, "").split(/\s*[;/]\s*/).filter(Boolean)) {
				let name = a.replace(/^(?:(?:prof|doç|dr|öğr|üyesi|öğretim|üye|yrd|arş|gör|uzm)(?=[\s.]|$)\.?\s*)+/iu, "").trim();
				if (name) creators.push(this._person(this.tc(name), "contributor"));
			}
			it.setCreators(creators);
			let extra = [`YÖK Tez No: ${c.no || h.no}`];
			if (yer[1]) extra.push(`Enstitü: ${this.tc(yer[1])}`);
			for (let x of yer.slice(2)) extra.push(this.tc(x));
			if (h.title2) extra.push(`İkinci başlık: ${h.title2}`);
			if (creators.some(x => x.creatorType === "contributor")) extra.push("Danışman: " + creators.filter(x => x.creatorType === "contributor").map(x => `${x.firstName} ${x.lastName}`).join("; "));
			it.setField("extra", extra.join("\n"));
			for (let s of (c.subject || "").split(/\s*;\s*/).filter(Boolean)) it.addTag(s);
			await save(it);
			try {
				let pdf = await this._yokPdf(c);
				if (pdf) await Zotero.Attachments.importFromURL({ libraryID, url: pdf, parentItemID: it.id, contentType: "application/pdf", referrer: this.YOK + "/tezSorguSonucYeni.jsp", title: "Tam metin (YÖK Tez)" });
				else warnings.push("Tezin tam metni YÖK'te erişime açık değil; yalnızca künye ve özet eklendi.");
			}
			catch (e) {
				warnings.push("PDF indirilemedi: " + e.message);
			}
		}
		else if (h.source === "dia") {
			let a = await this.diaArticle(h.url);
			for (let s of a.sections) {
				let it = new Zotero.Item("encyclopediaArticle");
				it.setField("title", a.title);
				it.setField("encyclopediaTitle", "Türkiye Diyanet Vakfı İslâm Ansiklopedisi");
				it.setField("publisher", "TDV Yayınları");
				if (s.place) it.setField("place", s.place);
				if (s.year) it.setField("date", s.year);
				if (s.volume) it.setField("volume", s.volume);
				if (s.pages) it.setField("pages", s.pages);
				it.setField("url", a.multi ? `${a.base}#${s.index}` : a.base);
				it.setField("accessDate", Zotero.Date.dateToSQL(new Date(), true));
				it.setField("language", "Türkçe");
				if (a.multi) it.setField("extra", `Maddenin ${s.index}. bölümü`);
				if (s.author) it.setCreators([this._person(this.tc(s.author), "author")]);
				await save(it);
				if (s.pdf) {
					try {
						await Zotero.Attachments.importFromURL({ libraryID, url: s.pdf, parentItemID: it.id, contentType: "application/pdf", referrer: a.base, title: "Basılı madde (PDF)" });
					}
					catch (e) {
						warnings.push("Madde PDF'i indirilemedi: " + e.message);
					}
				}
			}
			if (!a.sections.some(s => s.volume)) warnings.push("Maddenin basılı künyesi (cilt/sayfa) sayfada bulunamadı.");
		}
		else if (h.source === "dergipark") {
			let a = await this.dpArticle(h.url);
			let it = new Zotero.Item("journalArticle");
			it.setField("title", a.title || h.title);
			for (let [f, v] of [["publicationTitle", a.journal], ["volume", a.volume], ["issue", a.issue], ["pages", a.pages], ["date", a.year], ["DOI", a.doi], ["ISSN", a.issn], ["language", a.language], ["abstractNote", a.abstract]]) {
				if (v) it.setField(f, v);
			}
			it.setField("url", h.url);
			it.setField("accessDate", Zotero.Date.dateToSQL(new Date(), true));
			it.setField("libraryCatalog", "DergiPark");
			it.setCreators(a.authors.map(n => this._person(n, "author")));
			for (let k of a.keywords.flatMap(k => k.split(/\s*[;,]\s*/)).filter(Boolean).slice(0, 12)) it.addTag(k, 1);
			await save(it);
			if (a.pdf) {
				try {
					await Zotero.Attachments.importFromURL({ libraryID, url: a.pdf, parentItemID: it.id, contentType: "application/pdf", referrer: h.url, title: "Tam metin (PDF)" });
				}
				catch (e) {
					warnings.push("PDF indirilemedi: " + e.message);
				}
			}
		}
		else if (h.source === "openalex") {
			if (h.doi) {
				let tr = new Zotero.Translate.Search();
				tr.setIdentifier({ DOI: h.doi });
				tr.setTranslator(await tr.getTranslators());
				let made = await tr.translate({ libraryID, collections: collection ? [collection.id] : false, saveAttachments: true });
				items.push(...made);
				for (let it of made) {
					if (!it.getAttachments().length) {
						try {
							await Zotero.Attachments.addAvailableFile(it);
						}
						catch (e) {}
					}
				}
			}
			if (!items.length) {
				let it = new Zotero.Item(h.type === "thesis" ? "thesis" : h.type === "book" ? "book" : "journalArticle");
				it.setField("title", h.title);
				if (h.year) it.setField("date", h.year);
				if (h.venue && h.type === "article") it.setField("publicationTitle", h.venue);
				if (h.abstract) it.setField("abstractNote", h.abstract);
				it.setField("url", h.url);
				it.setCreators(h.authors.map(n => this._person(n, "author")));
				await save(it);
			}
		}
		return { items, warnings };
	},

	_person(full, creatorType) {
		full = String(full).replace(/\s+/g, " ").trim();
		let parts = full.split(" ");
		if (parts.length === 1) return { name: full, creatorType };
		let last = parts.pop();
		return { firstName: parts.join(" "), lastName: last, creatorType };
	},

	// ---- Pencere ----

	_win: null,

	/** Literatür Ara: kütüphanenin içinde (kayıt listesinin yerinde) açılır. */
	open(query) {
		let win = Zotero.getMainWindow();
		if (win?.document.getElementById("zotero-items-pane")) return Hafif.load("litview").open(win, query);
		return this.openWindow(query);
	},

	/** Ayrı pencere (ana pencere yoksa yedek yol). */
	openWindow(query) {
		let w = this._win;
		if (w && !w.closed) {
			w.focus();
			if (query) {
				w.document.getElementById("q").value = query;
				w.LitSearch?.run();
			}
			return w;
		}
		this._win = Zotero.getMainWindow().openDialog("chrome://hafif/content/windows/litsearch.xhtml", "hafif-litsearch",
			"chrome,resizable,centerscreen,dialog=no,width=1180,height=800", { query });
		return this._win;
	},

	shutdown() {
		if (this._win && !this._win.closed) this._win.close();
	},

	// ---- Asistan araçları ----

	_hits: new Map(),

	tools() {
		let S = this;
		let fieldEnum = ["any", ...Object.keys(this.FIELDS)];
		return [
			{
				name: "search_scholarly",
				label: (a) => `Türkçe kaynaklarda arandı: “${a.query}”`,
				description: `YÖK Ulusal Tez Merkezi, DergiPark, TDV İslâm Ansiklopedisi ve OpenAlex'te süzgeçli arama. Tez, Türkçe makale ya da DİA maddesi aranırken bunu kullan (search_literature yalnızca OpenAlex'tir). Alanlar: ${Object.entries(this.FIELDS).map(([k, f]) => `${k}=${f.label}`).join(", ")}. Sonuçlar id ile gelir; kullanıcı isterse import_scholarly ile kütüphaneye eklenir. Her sonuçta kütüphanede olup olmadığı yazar.`,
				parameters: {
					type: "object",
					properties: {
						query: { type: "string", description: "Kısa arama terimleri (Türkçe)" },
						english_query: { type: "string", description: "OpenAlex için İngilizce terimler (isteğe bağlı)" },
						sources: { type: "array", items: { type: "string", enum: Object.keys(this.SOURCES) } },
						doc_type: { type: "string", enum: ["any", "thesis", "article", "encyclopedia", "book"] },
						thesis_type: { type: "string", enum: ["any", "yl", "doktora"] },
						field: { type: "string", enum: fieldEnum },
						year_from: { type: "integer" },
						year_to: { type: "integer" },
						language: { type: "string", enum: ["any", "tr", "ar", "en"] },
						search_in: { type: "string", enum: ["all", "title", "abstract", "keywords", "author", "advisor"] },
						full_text_only: { type: "boolean" },
						limit: { type: "integer", description: "Kaynak başına (varsayılan 10)" },
					},
					required: ["query"],
				},
				run: (a) => S._toolSearch(a),
			},
			{
				name: "import_scholarly",
				approval: true,
				label: (a) => `Kütüphaneye ekleniyor: ${(a.ids || []).length} eser`,
				description: "search_scholarly sonuçlarını tam künyeleriyle (erişilebilirse PDF'iyle) kütüphaneye ekler. Kullanıcı onaylamadan eklenmez.",
				parameters: {
					type: "object",
					properties: { ids: { type: "array", items: { type: "string" } }, collection: { type: "string", description: "Hedef koleksiyon (isteğe bağlı)" } },
					required: ["ids"],
				},
				run: (a, ctx) => S._toolImport(a, ctx),
			},
		];
	},

	async _toolSearch(a) {
		let p = {
			query: a.query, englishQuery: a.english_query, sources: a.sources?.length ? a.sources : Object.keys(this.SOURCES),
			docType: a.doc_type || "any", thesisType: a.thesis_type || "any", field: a.field || "any",
			yearFrom: a.year_from || null, yearTo: a.year_to || null, language: a.language || "any",
			searchIn: a.search_in || "all", fullTextOnly: !!a.full_text_only, limit: Math.min(a.limit || 10, 25),
		};
		let r = await this.search(p);
		let rows = r.results.map(h => {
			let id = `${h.source}|${h.id}`;
			this._hits.set(id, h);
			let o = { id, kaynak: this.SOURCES[h.source].label, tür: h.thesisType || h.type, başlık: h.title, yazar: (h.authors || []).join("; "), yıl: h.year, yer: h.venue };
			if (h.advisor) o.danışman = h.advisor;
			if (h.doi) o.doi = h.doi;
			if (h.pdf) o.tam_metin = true;
			if (h.inLibrary) o.kütüphanede = true;
			if (h.abstract) o.özet = h.abstract.slice(0, 400);
			return o;
		});
		while (this._hits.size > 500) this._hits.delete(this._hits.keys().next().value);
		let status = Object.fromEntries(Object.entries(r.bySource).map(([s, x]) => [this.SOURCES[s].label, x.error ? "hata: " + x.error : `${x.count}${x.total != null ? "/" + x.total : ""}${x.note ? " — " + x.note : ""}`]));
		return Hafif.load("libtools")._cap(JSON.stringify({ kaynaklar: status, sonuçlar: rows }, null, 1));
	},

	async _toolImport(a, ctx = {}) {
		let hits = (a.ids || []).map(id => this._hits.get(id)).filter(Boolean);
		if (!hits.length) return "Bu kimliklerle sonuç bulunamadı; önce search_scholarly ile ara.";
		let collection = a.collection ? Hafif.load("libtools")._collectionByRef(a.collection) : null;
		let ok = await ctx.approve?.({
			title: `${hits.length} eser kütüphaneye eklenecek${collection ? ` (“${collection.name}”)` : ""}`,
			items: hits.map(h => ({ text: h.title, meta: [this.SOURCES[h.source].label, h.thesisType || h.type, h.year, h.inLibrary ? "zaten kütüphanede görünüyor" : ""].filter(Boolean).join(" · ") })),
			yes: "Ekle",
		});
		if (ctx.approve && !ok) return "Kullanıcı eklemeyi reddetti.";
		let made = [];
		let warns = [];
		for (let h of hits) {
			try {
				let r = await this.importHit(h, { collection });
				made.push(...r.items);
				warns.push(...r.warnings);
			}
			catch (e) {
				warns.push(`${h.title.slice(0, 50)}: ${e.message}`);
			}
		}
		if (made.length) ctx.registerUndo?.(`Eklenen ${made.length} kaydı geri al (çöpe)`, async () => Zotero.Items.trashTx(made.map(i => i.id)));
		return `Eklendi: ${made.map(i => `${i.key} “${i.getDisplayTitle().slice(0, 70)}”`).join("; ")}` + (warns.length ? `\nUyarılar: ${warns.join(" | ")}` : "");
	},

	// ---- Doğal dilde arama ----

	/** “2015 sonrası İslâm hukukunda vakıf üzerine doktora tezleri” → süzgeçler (modelle). */
	async interpret(text) {
		let llm = Hafif.load("llm");
		let { provider, model } = llm.current();
		let fields = Object.entries(this.FIELDS).map(([k, f]) => `${k}=${f.label}`).join(", ");
		let system = `Kullanıcının literatür arama isteğini yapılandırılmış süzgeçlere çevir. Yalnızca JSON döndür:
{"query": "aranacak temel terimler (Türkçe, kısa; gereksiz kelimeleri at: 'üzerine', 'hakkında', 'tezler' gibi)",
 "englishQuery": "aynı konunun İngilizce arama terimleri (OpenAlex için)",
 "searchIn": "all|title|abstract|keywords|author|advisor",
 "docType": "any|thesis|article|encyclopedia|book",
 "thesisType": "any|yl|doktora",
 "field": "any|${Object.keys(this.FIELDS).join("|")}",
 "yearFrom": null ya da yıl, "yearTo": null ya da yıl,
 "language": "any|tr|ar|en",
 "fullTextOnly": false,
 "sources": ["yoktez","dergipark","dia","openalex"] içinden uygun olanlar}
Alanlar: ${fields}. “tez” geçiyorsa docType thesis ve sources yoktez (+openalex); “madde/ansiklopedi” geçiyorsa dia; “makale” geçiyorsa dergipark ve openalex. “yüksek lisans” yl, “doktora” doktora. “son on yıl” gibi ifadeleri bugünkü yıla (${new Date().getFullYear()}) göre çevir. Belirtilmeyeni any/null bırak.`;
		let res = await llm.chat({ provider, model, system, effort: "low", messages: [{ role: "user", content: [{ type: "text", text }] }] });
		let out = res.content.filter(b => b.type === "text").map(b => b.text).join("");
		let j = Hafif.load("tables")._json(out);
		if (!Array.isArray(j.sources) || !j.sources.length) delete j.sources;
		return j;
	},
};
