/* Karşılaştırma tablosu: seçili kayıtları (ya da bir koleksiyonu) kullanıcının belirlediği
 * sütunlara göre karşılaştırır. Her kayıt için model ayrı ayrı okunur (künye, özet ve PDF metni)
 * ve her hücre kaynağın sayfasına bağlı bir atıfla doldurulur. Sonuç Markdown tablosu olarak
 * sohbette gösterilir; oradan CSV'ye kaydedilip nota aktarılabilir.
 * OCR: metin katmanı olmayan PDF sayfaları görsel destekli modelle metne çevrilir ve sayfa
 * önbelleğine yazılır; sonra okuma, arama ve anlamsal dizin bu metni kullanır. */

Hafif.modules.tables = {
	CONCURRENCY: 3,
	MAX_TEXT: 60000,

	tools() {
		let M = this;
		return [
			{
				name: "build_table",
				label: (a) => `Karşılaştırma tablosu: ${(a.columns || []).map(c => c.name).join(", ")}`,
				description: "Birden çok kaydı aynı sorulara göre karşılaştıran tablo kurar (literatür taraması, yöntem/bulgu karşılaştırması, görüş tablosu). Her kayıt ayrı ayrı okunur; hücreler sayfa atıflı gelir. keys ya da collection ver. Sonucu kullanıcıya tablo olarak aynen göster.",
				parameters: {
					type: "object",
					properties: {
						keys: { type: "array", items: { type: "string" } },
						collection: { type: "string" },
						columns: {
							type: "array",
							items: {
								type: "object",
								properties: {
									name: { type: "string", description: "Kısa sütun başlığı" },
									question: { type: "string", description: "Bu sütunda her kaynağa sorulacak soru" },
								},
								required: ["name"],
							},
						},
						use_fulltext: { type: "boolean", description: "PDF metnini de oku (varsayılan evet; yalnızca künye/özet için hayır)" },
						limit: { type: "integer", description: "En çok kaç kayıt (varsayılan 30)" },
					},
					required: ["columns"],
				},
				run: (a, ctx) => M.buildTable(a, ctx),
			},
			{
				name: "ocr_document",
				approval: true,
				label: (a) => `OCR: ${Hafif.load("libtools")._labelFor(a.key)}`,
				description: "Metin katmanı olmayan (taranmış) bir PDF'in sayfalarını görsel destekli modelle metne çevirir ve kalıcı olarak saklar; sonra read_document, search_in_document ve anlamsal arama bu metni kullanır. Sayfa aralığı ver (varsayılan: metni olmayan bütün sayfalar, en çok 40). Kullanıcıya maliyeti gösterilir, onaylamadan çalışmaz.",
				parameters: {
					type: "object",
					properties: { key: { type: "string" }, page_start: { type: "integer" }, page_end: { type: "integer" }, force: { type: "boolean", description: "Metni olan sayfaları da yeniden oku" } },
					required: ["key"],
				},
				run: (a, ctx) => M.ocrTool(a, ctx),
			},
		];
	},

	// ---- Tablo ----

	async _items(a) {
		let T = Hafif.load("libtools");
		let items = [];
		if (a.keys?.length) items = a.keys.map(k => T.top(T.byKey(k)));
		else if (a.collection) {
			let c = T._collectionByRef(a.collection);
			items = c.getChildItems(false, false);
		}
		items = [...new Map(items.filter(i => i.isRegularItem()).map(i => [i.id, i])).values()];
		return items.slice(0, Math.min(a.limit || 30, 60));
	},

	async _context(item, fulltext) {
		let T = Hafif.load("libtools");
		let lines = [`Kayıt anahtarı: ${item.key}`, `Başlık: ${item.getField("title")}`, `Yazar: ${T.creatorsShort(item, 6)}`, `Yıl: ${T.year(item)}`];
		let pub = item.getField("publicationTitle") || item.getField("publisher");
		if (pub) lines.push(`Yayın: ${pub}`);
		let abs = item.getField("abstractNote");
		if (abs) lines.push(`Özet: ${abs}`);
		if (fulltext) {
			let att = await T.documentOf(item);
			if (att) {
				try {
					let pages = await T.pages(att);
					let out = [];
					let size = 0;
					for (let i = 0; i < pages.length; i++) {
						let t = (pages[i] || "").trim();
						if (!t) continue;
						if (size + t.length > this.MAX_TEXT) {
							out.push(`[Metin ${i}. sayfada kesildi; toplam ${pages.length} sayfa.]`);
							break;
						}
						out.push(`[[s. ${i + 1}]]\n${t}`);
						size += t.length;
					}
					if (out.length) lines.push("\nTam metin:\n" + out.join("\n\n"));
				}
				catch (e) {}
			}
		}
		return lines.join("\n");
	},

	_json(text) {
		let t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
		let s = t.indexOf("{");
		let e = t.lastIndexOf("}");
		if (s < 0 || e < s) throw new Error("JSON yok");
		return JSON.parse(t.slice(s, e + 1));
	},

	/** Tek kayıt için hücreleri doldurur: { sütun: { value, page, quote } } */
	async _row(item, columns, fulltext, signal) {
		let llm = Hafif.load("llm");
		let { provider, model } = llm.current();
		let ctxText = await this._context(item, fulltext);
		let cols = columns.map((c, i) => `${i + 1}. "${c.name}": ${c.question || c.name}`).join("\n");
		let system = "Bir akademik kaynaktan bilgi çıkarıyorsun. Yalnızca verilen metne dayan; metinde yoksa value olarak \"—\" yaz. Kısa ve öz yaz (her hücre en çok 2-3 cümle), kullanıcının dilinde (Türkçe). Yanıtın yalnızca JSON olsun.";
		let user = `${ctxText}\n\n---\nŞu sütunları doldur:\n${cols}\n\nYanıt biçimi (yalnızca JSON):\n{"cells": {"<sütun adı>": {"value": "...", "page": <PDF sayfa numarası ya da null>, "quote": "<dayanak cümleden 5-20 kelime, metindeki gibi ya da null>"}}}`;
		let res = await llm.chat({ provider, model, system, messages: [{ role: "user", content: [{ type: "text", text: user }] }], effort: "low", signal });
		let text = res.content.filter(b => b.type === "text").map(b => b.text).join("");
		try {
			return this._json(text).cells || {};
		}
		catch (e) {
			return Object.fromEntries(columns.map(c => [c.name, { value: "(yanıt okunamadı)" }]));
		}
	},

	_cell(item, cell) {
		if (!cell) return "—";
		let v = String(cell.value ?? "—").replace(/\|/g, "/").replace(/\s*\n+\s*/g, " ").trim() || "—";
		if (v !== "—" && cell.page) {
			let q = cell.quote ? `, "${String(cell.quote).replace(/["“”\]|]/g, "").slice(0, 160)}"` : "";
			v += ` [[${item.key}, s. ${cell.page}${q}]]`;
		}
		else if (v !== "—") v += ` [[${item.key}]]`;
		return v;
	},

	async buildTable(a, ctx = {}) {
		let columns = (a.columns || []).map(c => typeof c === "string" ? { name: c } : c).filter(c => c?.name);
		if (!columns.length) return "Sütun verilmedi.";
		let items = await this._items(a);
		if (!items.length) return "Tabloya konacak kayıt bulunamadı (keys ya da collection ver).";
		let T = Hafif.load("libtools");
		let fulltext = a.use_fulltext !== false;
		let rows = new Array(items.length);
		let next = 0;
		let worker = async () => {
			while (next < items.length) {
				let i = next++;
				if (ctx.signal?.aborted) return;
				try {
					rows[i] = await this._row(items[i], columns, fulltext, ctx.signal);
				}
				catch (e) {
					if (e.name === "AbortError") return;
					rows[i] = Object.fromEntries(columns.map(c => [c.name, { value: "(hata: " + e.message.slice(0, 60) + ")" }]));
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(this.CONCURRENCY, items.length) }, worker));
		let head = `| Kaynak | ${columns.map(c => c.name.replace(/\|/g, "/")).join(" | ")} |`;
		let sep = `|---|${columns.map(() => "---").join("|")}|`;
		let body = items.map((it, i) => {
			let src = `${T.creatorsShort(it, 1)} ${T.year(it)} [[${it.key}]]`.trim();
			return `| ${src} | ${columns.map(c => this._cell(it, rows[i]?.[c.name])).join(" | ")} |`;
		});
		return `${items.length} kayıt, ${columns.length} sütun${fulltext ? " (tam metinden)" : " (künye ve özetten)"}:\n\n${head}\n${sep}\n${body.join("\n")}`;
	},

	// ---- OCR ----

	async ocrTool(a, ctx = {}) {
		let T = Hafif.load("libtools");
		let att = await T.documentOf(T.byKey(a.key));
		if (!att?.isPDFAttachment()) return "Bu kaydın PDF eki yok.";
		let pages = await T.pages(att);
		let n = pages.length;
		let start = Math.max(1, a.page_start || 1);
		let end = Math.min(n, a.page_end || n);
		let todo = [];
		for (let p = start; p <= end; p++) if (a.force || !(pages[p - 1] || "").trim()) todo.push(p);
		todo = todo.slice(0, 40);
		if (!todo.length) return "Bu aralıktaki sayfaların zaten metni var (force ile yeniden okutulabilir).";
		let { model } = Hafif.load("llm").current();
		let ok = await ctx.approve?.({
			title: `${T._labelFor(att.key)} — ${todo.length} sayfa OCR ile metne çevrilecek`,
			items: [{ text: `Sayfalar: ${this._ranges(todo)}`, meta: `Model: ${model} — her sayfa bir görsel istek; ücretli modelde maliyeti olur` }],
			yes: "Metne çevir",
		});
		if (ctx.approve && !ok) return "Kullanıcı OCR'ı reddetti.";
		let r = await this.ocr(att, todo, { signal: ctx.signal });
		return `${r.done} sayfa metne çevrildi ve saklandı${r.failed.length ? `; okunamayanlar: ${this._ranges(r.failed)}` : ""}. Artık read_document ile okunabilir.`;
	},

	_ranges(list) {
		let out = [];
		for (let i = 0; i < list.length; i++) {
			let s = list[i];
			while (list[i + 1] === list[i] + 1) i++;
			out.push(s === list[i] ? String(s) : `${s}–${list[i]}`);
		}
		return out.join(", ");
	},

	/** Sayfaları görsel modelle okur ve önbelleğe yazar. */
	async ocr(att, pageNumbers, { signal, onProgress } = {}) {
		let llm = Hafif.load("llm");
		let T = Hafif.load("libtools");
		let np = Hafif.load("notepreview");
		let { provider, model } = llm.current();
		let system = "Bir sayfa görüntüsünü metne çeviriyorsun (OCR). Sayfadaki metni olduğu gibi, kendi dilinde ve yazısında (Arapça, Osmanlıca, Türkçe, Latin harfli transkripsiyon) yaz. Harekeleri ve özel işaretleri koru. Paragrafları boş satırla ayır; dipnotları sayfa sonunda “---” çizgisinden sonra ver. Açıklama ekleme, yalnızca metni yaz.";
		let done = 0;
		let failed = [];
		let next = 0;
		let worker = async () => {
			while (next < pageNumbers.length) {
				if (signal?.aborted) return;
				let p = pageNumbers[next++];
				try {
					let img = await np.renderPage(att, p - 1);
					let data = img.url.replace(/^data:image\/png;base64,/, "");
					let res = await llm.chat({
						provider, model, system, signal, effort: "low",
						messages: [{ role: "user", content: [{ type: "image", mediaType: "image/png", data }, { type: "text", text: `PDF sayfa ${p}. Metni yaz.` }] }],
					});
					let text = res.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
					if (!text) throw new Error("boş");
					await T.setPageText(att, p - 1, text);
					done++;
				}
				catch (e) {
					if (e.name === "AbortError") return;
					failed.push(p);
				}
				onProgress?.(done + failed.length, pageNumbers.length);
			}
		};
		await Promise.all(Array.from({ length: Math.min(2, pageNumbers.length) }, worker));
		failed.sort((x, y) => x - y);
		return { done, failed };
	},

	/** Eylem: seçili kaydın taranmış PDF'ini arka planda metne çevirir. */
	async ocrAction(win, items) {
		let T = Hafif.load("libtools");
		let item = items?.[0];
		if (!item) return Hafif.toast("Önce bir kayıt seçin.");
		let att = await T.documentOf(item);
		if (!att?.isPDFAttachment()) return Hafif.toast("Bu kaydın PDF eki yok.");
		let pages = await T.pages(att);
		let todo = pages.map((t, i) => (t || "").trim() ? null : i + 1).filter(Boolean);
		if (!todo.length) {
			if (!Services.prompt.confirm(win, "OCR", `Bu PDF'in bütün sayfalarında metin var (${pages.length} sayfa). Yine de baştan okutulsun mu?`)) return;
			todo = pages.map((t, i) => i + 1);
		}
		let { model } = Hafif.load("llm").current();
		if (!Services.prompt.confirm(win, "OCR ile metne çevir", `${todo.length} sayfa ${model} modeliyle okunacak (her sayfa bir görsel istek). Devam edilsin mi?`)) return;
		let pw = new Zotero.ProgressWindow({ closeOnClick: false });
		pw.changeHeadline("Hafif · OCR");
		let line = new pw.ItemProgress(null, `${T._labelFor(att.key)}: 0/${todo.length}`);
		pw.show();
		let r = await this.ocr(att, todo, {
			onProgress: (d, t) => {
				line.setText(`${T._labelFor(att.key)}: ${d}/${t}`);
				line.setProgress(Math.round(d / t * 100));
			},
		});
		line.setProgress(100);
		line.setText(`${r.done} sayfa metne çevrildi${r.failed.length ? `, ${r.failed.length} sayfa okunamadı` : ""}`);
		pw.startCloseTimer(5000);
	},
};
