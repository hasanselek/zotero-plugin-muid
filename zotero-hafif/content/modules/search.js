/* Hızlı arama.
 * Dizin bellekte tutulur ve yalnızca kütüphane değiştiğinde, pencere açılırken yenilenir.
 * Eşleştirme harekeden, şeddeden, elif/yâ/tâ-merbûta biçimlerinden, Latin aksanlarından
 * ve transkripsiyon işaretlerinden (ʿ ʾ ā ī ū ḥ …) bağımsızdır. */

Hafif.modules.search = {
	_index: [],
	MAX: 50,

	normalize(s) {
		if (!s) return "";
		return String(s)
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")                 // Latin aksanları
			.replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, "") // harekeler, tatvîl
			.replace(/[آأإٱ]/g, "ا") // آ أ إ ٱ → ا
			.replace(/ى/g, "ي")                    // ى → ي
			.replace(/ة/g, "ه")                    // ة → ه
			.replace(/ؤ/g, "و")                    // ؤ → و
			.replace(/ئ/g, "ي")                    // ئ → ي
			.replace(/[ʻʼʾʿ‘’'`]/g, "")
			.replace(/ı/g, "i")
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, " ")
			.trim();
	},

	async buildIndex() {
		let t = Date.now();
		let index = [];
		for (let lib of Zotero.Libraries.getAll()) {
			if (lib.libraryType === "feed") continue;
			let items = await Zotero.Items.getAll(lib.libraryID, true, false);
			for (let item of items) {
				if (item.isAnnotation?.()) continue;
				let title = item.getDisplayTitle();
				let creators = item.isRegularItem()
					? item.getCreators().map(c => [c.lastName, c.firstName].filter(Boolean).join(", "))
					: [];
				let year = item.isRegularItem() ? (item.getField("date", true, true) || "").slice(0, 4).replace(/^0000$/, "") : "";
				let extra = item.isRegularItem()
					? [item.getField("publicationTitle"), item.getField("shortTitle"), item.getField("place"), item.getField("publisher")]
					: [];
				let tags = item.getTags().map(t => t.tag);
				index.push({
					id: item.id,
					title,
					meta: [creators.join("; "), year, Zotero.ItemTypes.getLocalizedString(item.itemType)].filter(Boolean).join(" · "),
					nTitle: this.normalize(title),
					hay: this.normalize([title, creators.join(" "), year, ...extra, ...tags].join(" ")),
				});
			}
		}
		this._index = index;
		Hafif.indexDirty = false;
		Hafif.log(`arama dizini: ${index.length} kayıt, ${Date.now() - t} ms`);
	},

	query(q) {
		let nq = this.normalize(q);
		if (!nq) return [];
		let tokens = nq.split(" ");
		let out = [];
		for (let e of this._index) {
			if (!tokens.every(tok => e.hay.includes(tok))) continue;
			let score = 0;
			if (e.nTitle.startsWith(nq)) score += 100;
			else if (e.nTitle.includes(nq)) score += 50;
			for (let tok of tokens) if (e.nTitle.includes(tok)) score += 10;
			score -= e.nTitle.length / 200;
			out.push([score, e]);
		}
		out.sort((a, b) => b[0] - a[0]);
		return out.slice(0, this.MAX).map(x => x[1]);
	},

	toggle(win) {
		return Hafif.load("palette").toggle(win, {
			id: "search",
			placeholder: "Başlık, yazar, yıl, etiket… (Arapça harekesiz de olur)",
			hint: "↵ kütüphanede göster · ⌘↵ PDF'i aç · esc kapat",
			empty: "Aramak için yazın",
			prepare: async () => { if (Hafif.indexDirty) await this.buildIndex(); },
			items: (q) => this.query(q),
			onEnter: (entry, mods) => this._activate(win, entry, mods.accel),
		});
	},

	async _activate(win, entry, open) {
		if (!entry) return;
		let item = Zotero.Items.get(entry.id);
		if (!item) return;
		if (!open) {
			await win.ZoteroPane.selectItem(item.id);
			return;
		}
		if (item.isNote()) {
			win.ZoteroPane.openNoteWindow(item.id);
			return;
		}
		let att = item.isAttachment() ? item : await item.getBestAttachment();
		if (att) await win.ZoteroPane.viewAttachment(att.id);
		else await win.ZoteroPane.selectItem(item.id);
	},
};
