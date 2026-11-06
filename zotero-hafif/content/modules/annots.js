/* Vurgular: bütün kütüphanedeki vurgu ve notlara toplu bakış, renk anlamları ve vurgu tekrarı.
 *   query(filter)  — tek SQL sorgusuyla süzme (renk, tür, metin, tarih, koleksiyon, etiket)
 *   meanings()     — renklerin anlamı (ör. sarı = önemli, kırmızı = itiraz); asistan da bilir
 *   review         — aralıklı tekrar (Leitner kutuları): her gün birkaç vurgu yeniden önünüze gelir.
 * Tekrar durumu Zotero veri klasöründe hafif/review.json'da durur. */

Hafif.modules.annots = {
	TYPES: { 1: "highlight", 2: "note", 3: "image", 4: "ink", 5: "underline", 6: "text" },
	TYPE_LABELS: { highlight: "Vurgu", note: "Not", image: "Alan", ink: "Çizim", underline: "Altı çizili", text: "Metin" },
	COLORS: [
		["#ffd400", "sarı", "Önemli"],
		["#ff6666", "kırmızı", "İtiraz / sorun"],
		["#5fb236", "yeşil", "Delil / katılıyorum"],
		["#2ea8e5", "mavi", "Tanım / yöntem"],
		["#a28ae5", "mor", "Kavram / terim"],
		["#e56eee", "pembe", "Soru"],
		["#f19837", "turuncu", "Atıf yapılacak"],
		["#aaaaaa", "gri", "Arka plan"],
	],
	BOXES: [1, 3, 7, 16, 35],

	// ---- Renk anlamları ----

	meanings() {
		let def = Object.fromEntries(this.COLORS.map(([hex, , m]) => [hex, m]));
		try {
			return Object.assign(def, JSON.parse(Hafif.pref("colorMeanings") || "{}"));
		}
		catch (e) {
			return def;
		}
	},

	meaning(hex) {
		return this.meanings()[String(hex || "").toLowerCase()] || "";
	},

	colorName(hex) {
		return this.COLORS.find(c => c[0] === String(hex || "").toLowerCase())?.[1] || hex || "";
	},

	setMeaning(hex, text) {
		let cur = {};
		try {
			cur = JSON.parse(Hafif.pref("colorMeanings") || "{}");
		}
		catch (e) {}
		// Boş değer de saklanır: "bu rengin anlamı yok" (varsayılana dönmez)
		cur[hex] = text || "";
		Hafif.pref("colorMeanings", JSON.stringify(cur));
	},

	// ---- Sorgu ----

	/**
	 * filter: { libraryID, colors: [hex], types: [name], text, since (YYYY-MM-DD), collectionID, tag, itemIDs, limit }
	 * → [{ id, key, libraryID, type, text, comment, color, page, added, attID, topID }]
	 */
	async query(f = {}) {
		let where = ["I.libraryID=?", "I.itemID NOT IN (SELECT itemID FROM deletedItems)"];
		let params = [f.libraryID ?? Zotero.Libraries.userLibraryID];
		if (f.colors?.length) {
			where.push(`LOWER(IA.color) IN (${f.colors.map(() => "?").join(",")})`);
			params.push(...f.colors.map(c => c.toLowerCase()));
		}
		if (f.types?.length) {
			let rev = Object.fromEntries(Object.entries(this.TYPES).map(([k, v]) => [v, +k]));
			where.push(`IA.type IN (${f.types.map(() => "?").join(",")})`);
			params.push(...f.types.map(t => rev[t]));
		}
		if (f.since) {
			where.push("I.dateAdded >= ?");
			params.push(f.since);
		}
		if (f.tag) {
			where.push("IA.itemID IN (SELECT itemID FROM itemTags JOIN tags USING (tagID) WHERE tags.name=?)");
			params.push(f.tag);
		}
		if (f.collectionID) {
			let c = Zotero.Collections.get(f.collectionID);
			let ids = c ? [c.id, ...c.getDescendents(false, "collection").map(d => d.id)] : [];
			if (ids.length) {
				where.push(`IAt.parentItemID IN (SELECT itemID FROM collectionItems WHERE collectionID IN (${ids.map(() => "?").join(",")}))`);
				params.push(...ids);
			}
		}
		if (f.itemIDs?.length) {
			where.push(`(IAt.parentItemID IN (${f.itemIDs.map(() => "?").join(",")}) OR IA.parentItemID IN (${f.itemIDs.map(() => "?").join(",")}))`);
			params.push(...f.itemIDs, ...f.itemIDs);
		}
		let sql = `SELECT IA.itemID AS id, I.key AS key, I.libraryID AS libraryID, IA.type AS type, IA.text AS text, IA.comment AS comment,
			IA.color AS color, IA.pageLabel AS page, IA.sortIndex AS sortIndex, I.dateAdded AS added, IA.parentItemID AS attID, IAt.parentItemID AS topID
			FROM itemAnnotations IA JOIN items I USING (itemID) LEFT JOIN itemAttachments IAt ON IAt.itemID = IA.parentItemID
			WHERE ${where.join(" AND ")} ORDER BY I.dateAdded DESC LIMIT ${Math.min(f.limit || 2000, 10000)}`;
		let rows = await Zotero.DB.queryAsync(sql, params);
		let norm = f.text ? Hafif.load("search").normalize(f.text) : null;
		let S = Hafif.modules.search;
		let out = [];
		for (let r of rows || []) {
			let o = { id: r.id, key: r.key, libraryID: r.libraryID, type: this.TYPES[r.type] || "highlight", text: r.text || "", comment: r.comment || "", color: (r.color || "").toLowerCase(), page: r.page || "", sortIndex: r.sortIndex || "", added: r.added, attID: r.attID, topID: r.topID || r.attID };
			if (norm && !S.normalize(o.text + " " + o.comment).includes(norm)) continue;
			out.push(o);
		}
		return out;
	},

	/** Kaynak kaydın kısa etiketi: "Yazar yıl — Başlık". */
	sourceLabel(topID) {
		let top = Zotero.Items.get(topID);
		if (!top) return "";
		let T = Hafif.load("libtools");
		let who = top.isRegularItem() ? `${T.creatorsShort(top, 1)} ${T.year(top)}`.trim() : "";
		return (who ? who + " — " : "") + top.getDisplayTitle();
	},

	/** Vurguyu okuyucuda, yerinde açar. */
	async open(a) {
		let att = Zotero.Items.get(a.attID);
		if (!att) return;
		await Zotero.Reader.open(att.id, { annotationID: a.key });
	},

	/** Vurguları Markdown'a çevirir (renk anlamıyla gruplanmış, sayfalı). */
	toMarkdown(list) {
		let bySource = new Map();
		for (let a of list) {
			if (!bySource.has(a.topID)) bySource.set(a.topID, []);
			bySource.get(a.topID).push(a);
		}
		let lines = [];
		for (let [topID, anns] of bySource) {
			lines.push(`## ${this.sourceLabel(topID)}`, "");
			anns.sort((x, y) => String(x.sortIndex).localeCompare(String(y.sortIndex)));
			for (let a of anns) {
				let m = this.meaning(a.color);
				if (a.text) lines.push(`> ${a.text.replace(/\n+/g, " ")} (s. ${a.page || "?"})${m ? ` — *${m}*` : ""}`);
				if (a.comment) lines.push(a.text ? "" : `- (s. ${a.page || "?"})`, a.comment);
				lines.push("");
			}
		}
		return lines.join("\n").trim() + "\n";
	},

	/** Seçilen vurguları bir not başlığına gönderir (hedefi ana pencerede paletten seçtirir). */
	async sendToNote(list) {
		let N = Hafif.load("notes");
		let win = Zotero.getMainWindow();
		let flat = [];
		let walk = (nodes, path) => {
			for (let n of nodes) {
				if (n.separator) continue;
				if (n.children) walk(n.children, [...path, n.label.replace(/^▸ /, "")]);
				else flat.push({ title: [...path, n.label.trim()].join(" › "), meta: "", data: n });
			}
		};
		let target = null;
		walk(N.menuTree((t) => { target = t; }), []);
		win.focus();
		let node = await Hafif.load("actions")._pick(win, `${list.length} vurgu hangi nota/başlığa gitsin?`, flat);
		if (!node) return;
		node.onCommand();
		if (!target) return;
		let items = (await Zotero.Items.getAsync(list.map(a => a.id))).filter(Boolean);
		return N.sendAnnotations(items, target);
	},

	// ---- Vurgu tekrarı ----

	_reviewPath() {
		return PathUtils.join(Zotero.DataDirectory.dir, "hafif", "review.json");
	},

	async _reviewState() {
		if (this._review) return this._review;
		try {
			this._review = JSON.parse(await IOUtils.readUTF8(this._reviewPath())) || {};
		}
		catch (e) {
			this._review = {};
		}
		return this._review;
	},

	async _saveReview() {
		await IOUtils.makeDirectory(PathUtils.parent(this._reviewPath()), { createAncestors: true, ignoreExisting: true });
		await IOUtils.writeUTF8(this._reviewPath(), JSON.stringify(this._review || {}), { tmpPath: this._reviewPath() + ".tmp" });
	},

	_today() {
		return new Date().toISOString().slice(0, 10);
	},

	_addDays(days) {
		return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
	},

	/** Bugünkü tekrar destesi: vadesi gelenler + birkaç yeni vurgu (yorumlu ve uzun olanlar önce). */
	async dueToday(libraryID = Zotero.Libraries.userLibraryID) {
		let st = await this._reviewState();
		let today = this._today();
		let colors = (() => {
			try {
				return JSON.parse(Hafif.pref("reviewColors") || "null");
			}
			catch (e) {
				return null;
			}
		})();
		let all = await this.query({ libraryID, types: ["highlight", "underline", "note"], colors: colors?.length ? colors : undefined, limit: 10000 });
		all = all.filter(a => (a.text || a.comment).length >= 25);
		let due = all.filter(a => st[a.key] && st[a.key].due <= today);
		let fresh = all.filter(a => !st[a.key]);
		let newPerDay = +(Hafif.pref("reviewNew") ?? 10) || 10;
		let newToday = Object.values(st).filter(s => s.introduced === today).length;
		fresh.sort((x, y) => (!!y.comment - !!x.comment) || (y.text.length - x.text.length));
		// Yeni vurgular kaynaklar arasında dağıtılır
		let picked = [];
		let perSource = new Map();
		for (let a of fresh) {
			if (picked.length >= Math.max(0, newPerDay - newToday)) break;
			let n = perSource.get(a.topID) || 0;
			if (n >= 2) continue;
			perSource.set(a.topID, n + 1);
			picked.push(a);
		}
		return { due, fresh: picked, total: all.length, known: Object.keys(st).length };
	},

	/** ok: hatırladım → bir üst kutu; değilse ilk kutuya döner. */
	async grade(a, ok) {
		let st = await this._reviewState();
		let cur = st[a.key] || { box: 0, introduced: this._today() };
		cur.box = ok ? Math.min(cur.box + 1, this.BOXES.length) : 1;
		cur.due = this._addDays(this.BOXES[cur.box - 1]);
		cur.seen = (cur.seen || 0) + 1;
		cur.last = this._today();
		st[a.key] = cur;
		await this._saveReview();
		return cur;
	},

	async skip(a) {
		let st = await this._reviewState();
		st[a.key] = { ...(st[a.key] || { box: 1, introduced: this._today() }), due: "9999-12-31", skipped: true };
		await this._saveReview();
	},

	shutdown() {
		this._review = null;
	},
};
