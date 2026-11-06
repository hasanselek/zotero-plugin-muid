/* Araştırma araçları: anlamsal arama (yerel gömme dizini), dış literatür (OpenAlex: 250 milyonu
 * aşkın akademik eser, anahtar gerektirmez) ve bir web sayfasını okuma.
 * Dış aramalarda yalnızca arama sözcükleri OpenAlex'e gider; kütüphaneden bir şey gönderilmez. */

Hafif.modules.research = {
	OPENALEX: "https://api.openalex.org",
	SELECT: "id,doi,display_name,publication_year,authorships,primary_location,cited_by_count,abstract_inverted_index,open_access,type,language,referenced_works_count",

	tools() {
		let R = this;
		let T = Hafif.load("libtools");
		let list = [
			{
				name: "semantic_search",
				label: (a) => `Anlamca arandı: “${a.query}”`,
				description: "Kütüphanede anlamca arar: kelimesi kelimesine geçmese de konuyla ilgili kayıtları, not ve PDF bölümlerini bulur (başka dillerdeki karşılıklar dahil). Kavram, tez ya da soru üzerinden kaynak bulmak için search_library ve fulltext_search ile birlikte kullan. Sonuçlar sayfa numarasıyla gelir.",
				parameters: {
					type: "object",
					properties: {
						query: { type: "string", description: "Doğal dilde soru ya da kavram" },
						scope: { type: "string", enum: ["all", "metadata", "fulltext", "notes"], description: "all (varsayılan): hepsi; metadata: künye+özet; fulltext: PDF metinleri; notes: notlar" },
						collection: { type: "string" },
						limit: { type: "integer", description: "Kayıt sayısı (varsayılan 10)" },
					},
					required: ["query"],
				},
				run: (a) => R.semanticSearch(a),
			},
		];
		if (Hafif.pref("aiExternal") !== false) {
			list.push(
				{
					name: "search_literature",
					label: (a) => `Literatürde arandı: “${a.query}”`,
					description: "Kütüphane dışındaki akademik literatürde (OpenAlex, 250 milyonu aşkın eser) arar. Önce kullanıcının kütüphanesine bak; bu aracı kütüphanede yeterli kaynak yoksa ya da kullanıcı yeni kaynak, güncel çalışma, eksik literatür isterse kullan. Her sonucun kütüphanede olup olmadığı belirtilir; eklemek için import_by_identifier (DOI).",
					parameters: {
						type: "object",
						properties: {
							query: { type: "string" },
							year_from: { type: "integer" },
							year_to: { type: "integer" },
							open_access: { type: "boolean", description: "Yalnızca açık erişimli" },
							sort: { type: "string", enum: ["relevance", "cited", "newest"] },
							language: { type: "string", description: "ISO kodu: tr, en, ar, de…" },
							limit: { type: "integer", description: "varsayılan 10, en çok 25" },
						},
						required: ["query"],
					},
					run: (a) => R.searchLiterature(a),
				},
				{
					name: "get_work",
					label: (a) => `Eser bilgisi: ${a.id}`,
					description: "OpenAlex'te bir eserin ayrıntısı: özet, yazarlar, dergi, atıf sayısı, açık erişim bağlantısı. DOI ya da OpenAlex kimliği (W…) ver.",
					parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
					run: (a) => R.getWork(a),
				},
				{
					name: "citation_network",
					label: (a) => `${a.direction === "references" ? "Kaynakçası" : a.direction === "related" ? "İlgili eserler" : "Atıf yapanlar"}: ${a.id}`,
					description: "Bir eserin atıf ağı: cited_by (ona atıf yapan sonraki çalışmalar), references (kendi kaynakçası) ya da related (benzer çalışmalar). Bir konunun literatürünü genişletmek ve bir tezin nasıl karşılandığını görmek için.",
					parameters: {
						type: "object",
						properties: {
							id: { type: "string", description: "DOI ya da OpenAlex kimliği" },
							direction: { type: "string", enum: ["cited_by", "references", "related"] },
							limit: { type: "integer" },
						},
						required: ["id", "direction"],
					},
					run: (a) => R.citationNetwork(a),
				},
			);
		}
		if (Hafif.pref("aiWebSearch") === true) {
			list.push({
				name: "read_url",
				label: (a) => `Sayfa okundu: ${String(a.url).replace(/^https?:\/\//, "").slice(0, 50)}`,
				description: "Bir web sayfasının metnini okur (http/https). Sonuçlarda geçen bir makale sayfasını, açık erişim bağlantısını ya da kullanıcının verdiği adresi okumak için.",
				parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
				run: (a) => R.readURL(a),
			});
		}
		return list;
	},

	// ---- Anlamsal arama ----

	async semanticSearch(a) {
		let E = Hafif.load("embed");
		let T = Hafif.load("libtools");
		let kinds = { metadata: ["meta"], fulltext: ["text"], notes: ["note"] }[a.scope] || null;
		let r = await E.search(a.query, { limit: Math.min(a.limit || 10, 30), kinds, collection: a.collection });
		if (r.error) return r.error + " Şimdilik search_library ve fulltext_search ile ara.";
		let out = [];
		for (let g of r.results) {
			let it = Zotero.Items.getByLibraryAndKey(g.lib, g.item);
			if (!it || it.deleted) continue;
			out.push({
				...T.summary(it),
				benzerlik: g.score,
				eşleşmeler: g.hits.map(h => ({
					tür: { meta: "künye/özet", text: "metin", note: "not" }[h.kind],
					...(h.page ? { sayfa: h.page } : {}),
					...(h.note ? { not: h.note } : {}),
					metin: h.text,
				})),
			});
		}
		if (!out.length) return "Anlamca yakın bir sonuç bulunamadı.";
		return T._cap(JSON.stringify(out, null, 1));
	},

	// ---- OpenAlex ----

	async _get(path) {
		let res = await fetch(this.OPENALEX + path, { headers: { accept: "application/json" } });
		if (res.status === 404) throw new Error("OpenAlex'te bulunamadı.");
		if (!res.ok) throw new Error(`OpenAlex hatası ${res.status}`);
		return res.json();
	},

	_abstract(inv) {
		if (!inv) return "";
		let words = [];
		for (let [w, pos] of Object.entries(inv)) for (let p of pos) words[p] = w;
		return words.filter(Boolean).join(" ");
	},

	_id(s) {
		s = String(s || "").trim();
		let doi = s.match(/10\.\d{4,9}\/\S+/);
		if (doi) return "doi:" + doi[0].replace(/[.,;)]+$/, "");
		let w = s.match(/W\d+/i);
		if (w) return w[0].toUpperCase();
		throw new Error("Geçerli bir DOI ya da OpenAlex kimliği (W…) verin.");
	},

	/** Kütüphanedeki DOI'ler (küçük harf): dış sonuçların “kütüphanede var” işareti için. */
	async _libraryDOIs() {
		let fid = Zotero.ItemFields.getID("DOI");
		let rows = await Zotero.DB.columnQueryAsync(
			"SELECT LOWER(value) FROM itemData JOIN itemDataValues USING (valueID) WHERE fieldID=? AND itemID NOT IN (SELECT itemID FROM deletedItems)", [fid]);
		return new Set(rows || []);
	},

	_work(w, dois) {
		let doi = (w.doi || "").replace(/^https?:\/\/doi\.org\//, "");
		let authors = (w.authorships || []).map(x => x.author?.display_name).filter(n => n && /\p{L}/u.test(n));
		let out = {
			openalex: (w.id || "").replace("https://openalex.org/", ""),
			başlık: w.display_name,
			yazar: authors.slice(0, 4).join("; ") + (authors.length > 4 ? " vd." : ""),
			yıl: w.publication_year,
			yayın: w.primary_location?.source?.display_name || "",
			tür: w.type,
			atıf: w.cited_by_count,
		};
		if (doi) out.doi = doi;
		if (w.language) out.dil = w.language;
		if (w.open_access?.oa_url) out.açık_erişim = w.open_access.oa_url;
		if (dois && doi) out.kütüphanede = dois.has(doi.toLowerCase());
		return out;
	},

	async searchLiterature(a) {
		let filters = [];
		if (a.year_from || a.year_to) filters.push(`publication_year:${a.year_from || ""}-${a.year_to || ""}`);
		if (a.open_access) filters.push("open_access.is_oa:true");
		if (a.language) filters.push(`language:${String(a.language).toLowerCase()}`);
		let sort = { cited: "&sort=cited_by_count:desc", newest: "&sort=publication_date:desc" }[a.sort] || "";
		let n = Math.min(a.limit || 10, 25);
		let r = await this._get(`/works?search=${encodeURIComponent(a.query)}&per-page=${n}${filters.length ? "&filter=" + filters.join(",") : ""}${sort}&select=${this.SELECT}`);
		let dois = await this._libraryDOIs();
		let rows = (r.results || []).map(w => {
			let o = this._work(w, dois);
			let abs = this._abstract(w.abstract_inverted_index);
			if (abs) o.özet = abs.length > 600 ? abs.slice(0, 600) + "…" : abs;
			return o;
		});
		if (!rows.length) return `OpenAlex'te “${a.query}” için sonuç yok. Başka dilde ya da daha genel terimlerle dene.`;
		return Hafif.load("libtools")._cap(JSON.stringify({ toplam: r.meta?.count, gösterilen: rows.length, sonuçlar: rows }, null, 1));
	},

	async getWork(a) {
		let w = await this._get(`/works/${encodeURIComponent(this._id(a.id))}`);
		let dois = await this._libraryDOIs();
		let o = this._work(w, dois);
		o.özet = this._abstract(w.abstract_inverted_index) || "(özet yok)";
		o.kaynakça_sayısı = w.referenced_works_count;
		o.konular = (w.topics || w.concepts || []).slice(0, 6).map(t => t.display_name);
		return JSON.stringify(o, null, 1);
	},

	async citationNetwork(a) {
		let id = this._id(a.id);
		let n = Math.min(a.limit || 15, 40);
		let dois = await this._libraryDOIs();
		let works;
		if (a.direction === "cited_by") {
			let wid = id.startsWith("W") ? id : (await this._get(`/works/${encodeURIComponent(id)}?select=id`)).id.replace("https://openalex.org/", "");
			works = (await this._get(`/works?filter=cites:${wid}&per-page=${n}&sort=cited_by_count:desc&select=${this.SELECT}`)).results;
		}
		else {
			let w = await this._get(`/works/${encodeURIComponent(id)}?select=id,referenced_works,related_works`);
			let ids = (a.direction === "references" ? w.referenced_works : w.related_works || []).slice(0, n).map(x => x.replace("https://openalex.org/", ""));
			if (!ids.length) return "Bu eser için OpenAlex'te kayıtlı " + (a.direction === "references" ? "kaynakça" : "ilgili eser") + " yok.";
			works = (await this._get(`/works?filter=openalex_id:${ids.join("|")}&per-page=${ids.length}&select=${this.SELECT}`)).results;
		}
		let rows = (works || []).map(w => this._work(w, dois));
		return Hafif.load("libtools")._cap(JSON.stringify({ yön: a.direction, sonuçlar: rows }, null, 1));
	},

	// ---- Web ----

	async readURL(a) {
		let url = String(a.url || "").trim();
		if (!/^https?:\/\//i.test(url)) return "Yalnızca http/https adresleri okunabilir.";
		let res = await fetch(url, { headers: { accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" }, redirect: "follow" });
		if (!res.ok) return `Sayfa açılamadı (${res.status}).`;
		let type = res.headers.get("content-type") || "";
		if (/pdf/i.test(type)) return "Bu adres bir PDF. Kütüphaneye eklemek için DOI'si varsa import_by_identifier kullan.";
		let text = await res.text();
		if (/html/i.test(type) || /^\s*</.test(text)) {
			let doc = Hafif.load("notes")._parse(text);
			for (let bad of doc.querySelectorAll("script, style, noscript, nav, header, footer, aside, form, iframe, svg")) bad.remove();
			let main = doc.querySelector("article, main, [role=main]") || doc.body;
			let title = doc.querySelector("title")?.textContent?.trim() || "";
			let meta = doc.querySelector('meta[name="description"], meta[property="og:description"]')?.getAttribute("content") || "";
			text = [title, meta, (main?.textContent || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n")].filter(Boolean).join("\n\n");
		}
		text = text.trim();
		return Hafif.load("libtools")._cap(`Adres: ${res.url || url}\n\n` + (text.length > 40000 ? text.slice(0, 40000) + "\n…[kısaltıldı]" : text));
	},
};
