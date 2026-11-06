/* Alıntı doğrulama: nottaki (ya da asistanın verdiği) tırnaklı alıntıların, atıf yapılan
 * kaynağın PDF'inde gerçekten ve gösterilen sayfada geçip geçmediğini denetler.
 * Eşleştirme harekeden, aksandan, satır sonu tirelerinden ve küçük yazım farklarından bağımsızdır
 * (sözcük torbası üzerinde kayan pencere). Basılı sayfa numaraları PDF'in sayfa etiketlerinden alınır.
 * Saf işlevler (tokens, findQuote, extractQuotes) Zotero'suz sınanır. */

Hafif.modules.verify = {
	MIN_SCORE: 0.82,

	// ---- Saf işlevler ----

	tokens(s) {
		let S = Hafif.load("search");
		return S.normalize(String(s || "").replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2"))
			.split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1);
	},

	/** t dizisinde q uzunluğundaki en iyi pencerenin eşleşme oranı (sözcük torbası). */
	_windowScore(t, need, qlen) {
		if (!t.length) return 0;
		let win = new Map();
		let matched = 0;
		let add = (w, d) => {
			if (!need.has(w)) return;
			let before = Math.min(win.get(w) || 0, need.get(w));
			win.set(w, (win.get(w) || 0) + d);
			matched += Math.min(win.get(w), need.get(w)) - before;
		};
		let L = Math.min(qlen, t.length);
		for (let i = 0; i < L; i++) add(t[i], 1);
		let top = matched;
		for (let i = L; i < t.length && top < qlen; i++) {
			add(t[i], 1);
			add(t[i - L], -1);
			if (matched > top) top = matched;
		}
		return top / qlen;
	},

	/** Alıntıyı sayfalarda arar → { index, score, weak? } (index: 0'dan, alıntının başladığı PDF sayfası) ya da null. */
	findQuote(pages, quote) {
		let q = this.tokens(quote);
		if (q.length < 3) return null;
		let need = new Map();
		for (let w of q) need.set(w, (need.get(w) || 0) + 1);
		let toks = pages.map(p => this.tokens(p));
		let best = null;
		for (let p = 0; p < toks.length; p++) {
			let score = this._windowScore(toks[p], need, q.length);
			// Sayfa sınırından taşan alıntı: yalnızca sınırı kesen pencereler (sayfa sonu + sonraki sayfanın başı)
			if (score < 1 && p + 1 < toks.length) {
				let cross = toks[p].slice(-(q.length - 1)).concat(toks[p + 1].slice(0, q.length - 1));
				score = Math.max(score, this._windowScore(cross, need, q.length));
			}
			if (!best || score > best.score) best = { index: p, score };
			if (score === 1) break;
		}
		if (!best) return null;
		return best.score >= this.MIN_SCORE ? best : { ...best, weak: true };
	},

	/** "12", "12-14", "xii" → basılı sayfa listesi */
	locatorPages(loc) {
		let m = String(loc || "").match(/^\s*(\d+)\s*[-–]\s*(\d+)\s*$/);
		if (m) {
			let out = [];
			for (let i = +m[1]; i <= Math.min(+m[2], +m[1] + 30); i++) out.push(String(i));
			return out;
		}
		let one = String(loc || "").match(/^\s*([\divxlc]+)/i);
		return one ? [one[1].toLowerCase()] : [];
	},

	QUOTE_RE: /[“"«‹]([^“”"«»‹›]{15,}?)[”"»›][\s.,;:)]*$/u,

	/**
	 * Not bloklarından (notedoc) alıntı + atıf çiftleri.
	 * → [{ quote, item, locator, block }] (vurgudan gelen alıntılar atlanır: zaten PDF'ten alınmıştır)
	 */
	extractQuotes(blocks) {
		let out = [];
		blocks.forEach((b, bi) => {
			let groups = b.items ? b.items.map(i => i.runs) : [b.runs];
			for (let runs of groups) {
				let buf = "";
				let fromAnnotation = false;
				for (let r of runs || []) {
					if (r.cite) {
						let c = r.cite[0];
						let m = buf.match(this.QUOTE_RE);
						let quote = m ? m[1] : (b.type === "quote" ? buf.trim() : null);
						if (quote && !fromAnnotation && quote.split(/\s+/).length >= 3) out.push({ quote: quote.trim(), item: c.item, locator: c.locator, block: bi });
						buf = "";
						fromAnnotation = false;
						continue;
					}
					if (r.source) fromAnnotation = true;
					buf += r.text || "";
				}
			}
		});
		return out;
	},

	// ---- Kütüphane ----

	async _attachment(item) {
		if (item.isFileAttachment?.()) return item;
		let att = await item.getBestAttachment?.();
		return att && att.isFileAttachment() ? att : null;
	},

	/** Tek alıntıyı denetler → { status: ok|page|weak|missing|nopdf, found?, printed?, score } */
	async check(item, quote, locator) {
		let att = await this._attachment(item);
		if (!att) return { status: "nopdf" };
		let pages = await Hafif.load("libtools").pages(att);
		let hit = this.findQuote(pages, quote);
		if (!hit) return { status: "missing", att };
		let labels = att.isPDFAttachment() ? await Hafif.load("pdfsvc").labels(att) : null;
		let printed = labels?.[hit.index] ?? String(hit.index + 1);
		let want = this.locatorPages(locator);
		let res = { att, found: hit.index, printed: String(printed), score: +hit.score.toFixed(2) };
		if (hit.weak) return { ...res, status: "weak" };
		if (!want.length || want.includes(String(printed).toLowerCase()) || want.includes(String(hit.index + 1))) return { ...res, status: "ok" };
		// Alıntı sayfa sonundan taşıyorsa bir sonraki sayfa da kabul
		let next = labels?.[hit.index + 1] ?? String(hit.index + 2);
		if (want.includes(String(next).toLowerCase())) return { ...res, status: "ok" };
		return { ...res, status: "page" };
	},

	ICON: { ok: "✓", page: "≠", weak: "≈", missing: "✕", nopdf: "–" },
	TEXT: {
		ok: "alıntı kaynakta, gösterilen sayfada",
		page: "alıntı kaynakta ama başka sayfada",
		weak: "kaynakta yalnızca benzeri var (yazım farkı olabilir)",
		missing: "alıntı kaynakta bulunamadı",
		nopdf: "kaynağın PDF'i yok, denetlenemedi",
	},

	/** Nottaki bütün alıntıları denetler ve sonucu paletten gösterir. */
	async verifyNote(win, note) {
		if (!note?.isNote()) return Hafif.toast("Alıntıları doğrulanacak bir not seçin.");
		let doc = await Hafif.load("notedoc").parse(note.getNote());
		let quotes = this.extractQuotes(doc.blocks);
		if (!quotes.length) return Hafif.toast("Notta atıfla biten tırnaklı alıntı bulunamadı. (Vurgudan gelen alıntılar zaten kaynaktan alınmıştır.)", 5000);
		Hafif.toast(`${quotes.length} alıntı denetleniyor…`, 1500);
		let rows = [];
		for (let q of quotes) rows.push({ ...q, res: await this.check(q.item, q.quote, q.locator) });
		let bad = rows.filter(r => r.res.status !== "ok").length;
		let entries = rows.map(r => ({
			title: `${this.ICON[r.res.status]} “${r.quote.length > 90 ? r.quote.slice(0, 90) + "…" : r.quote}”`,
			meta: `${this.TEXT[r.res.status]} · atıf s. ${r.locator || "?"}${r.res.printed ? ` · bulunan s. ${r.res.printed}` : ""} · ${r.item.getDisplayTitle()}`,
			data: r,
		}));
		let pick = await Hafif.load("actions")._pick(win, `Alıntı doğrulama: ${rows.length} alıntı, ${bad ? bad + " tanesinde sorun" : "hepsi doğru"}`, entries);
		if (pick?.res?.att && pick.res.found != null) await Zotero.Reader.open(pick.res.att.id, { pageIndex: pick.res.found });
	},

	// ---- Asistan aracı ----

	tools() {
		let V = this;
		let T = Hafif.load("libtools");
		return [{
			name: "verify_quote",
			label: (a) => `Alıntı doğrulandı: ${T._labelFor(a.key)}`,
			description: "Bir alıntının, kütüphanedeki kaynağın PDF'inde gerçekten geçip geçmediğini ve hangi sayfada olduğunu denetler. Kullanıcıya doğrudan alıntı verirken ya da kullanıcının metnindeki alıntıları kontrol ederken kullan.",
			parameters: {
				type: "object",
				properties: {
					key: { type: "string", description: "Kaydın 8 karakterlik anahtarı" },
					quote: { type: "string", description: "Alıntı metni (birebir)" },
					page: { type: "string", description: "Atıftaki (basılı) sayfa; bilinmiyorsa boş" },
				},
				required: ["key", "quote"],
			},
			async run(a) {
				let item = T.byKey(a.key);
				let r = await V.check(item, a.quote, a.page || "");
				return JSON.stringify({ durum: V.TEXT[r.status], benzerlik: r.score, bulunan_pdf_sayfası: r.found != null ? r.found + 1 : null, bulunan_basılı_sayfa: r.printed || null });
			},
		}];
	},
};
