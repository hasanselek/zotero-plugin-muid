/* Atıf anahtarları (Better BibTeX'e gerek kalmadan): yazarYılKelime biçiminde, kütüphanede tekil.
 * Sıra: Better BibTeX kuruluysa onun anahtarı → Zotero'nun kendi "citationKey" alanı (varsa)
 * → Extra'daki "Citation Key: …" satırı → üretilen anahtar. Atanan anahtar alan varsa alana,
 * yoksa Extra'ya Pandoc/citeproc'un okuduğu biçimde yazılır. */

Hafif.modules.citekey = {
	STOP: new Set(["a", "an", "the", "on", "of", "in", "and", "to", "for", "ve", "ile", "bir", "bu", "şu", "ki", "de", "da", "el", "al", "fi", "fî", "min", "ala", "alâ", "an", "kitab", "kitâb", "kitabu"]),

	/** Türkçe ve transkripsiyon harflerini ASCII'ye indirir. */
	ascii(s) {
		return String(s || "")
			.replace(/[ıİ]/g, c => (c === "ı" ? "i" : "I"))
			.replace(/[ğĞ]/g, c => (c === "ğ" ? "g" : "G"))
			.replace(/[şŞ]/g, c => (c === "ş" ? "s" : "S"))
			.replace(/[çÇ]/g, c => (c === "ç" ? "c" : "C"))
			.replace(/[öÖ]/g, c => (c === "ö" ? "o" : "O"))
			.replace(/[üÜ]/g, c => (c === "ü" ? "u" : "U"))
			.replace(/[ʿʾ‘’'`ʼ]/g, "")
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			.replace(/[^A-Za-z0-9]/g, "");
	},

	/** Saf anahtar üretimi: ("Yılmaz", "2019", "Osmanlı'da Vakıf Hukuku") → "yilmaz2019osmanlida". */
	make(lastName, year, title) {
		let a = this.ascii(String(lastName || "").split(/[\s-]+/).filter(w => !/^(el|al|ibn|b\.?|bin)$/i.test(w)).pop() || "anon").toLowerCase() || "anon";
		let y = String(year || "").match(/\d{4}/)?.[0] || "tarihsiz";
		let words = String(title || "").split(/[\s:;,.!?()[\]"«»/-]+/).map(w => w.replace(/^(el|al|ul|ül)-/i, ""));
		let w = words.map(x => this.ascii(x).toLowerCase()).find(x => x.length > 2 && !this.STOP.has(x)) || "";
		return a + y + w;
	},

	_lastName(item) {
		let c = item.getCreators();
		let primary = Zotero.CreatorTypes.getPrimaryIDForType(item.itemTypeID);
		let first = c.find(x => x.creatorTypeID === primary) || c[0];
		return first ? (first.lastName || first.name || "") : "";
	},

	_year(item) {
		return Zotero.Date.strToDate(item.getField("date") || "").year || "";
	},

	_fieldID() {
		try {
			return Zotero.ItemFields.getID("citationKey") || null;
		}
		catch (e) {
			return null;
		}
	},

	/** Kayıtlı anahtar (yoksa boş). */
	existing(item) {
		try {
			let bbt = Zotero.BetterBibTeX?.KeyManager?.get?.(item.id);
			if (bbt?.citationKey || bbt?.citekey) return bbt.citationKey || bbt.citekey;
		}
		catch (e) {}
		let fid = this._fieldID();
		if (fid && Zotero.ItemFields.isValidForType(fid, item.itemTypeID)) {
			let v = item.getField("citationKey");
			if (v) return v;
		}
		let m = (item.getField("extra") || "").match(/^\s*Citation Key:\s*(\S+)\s*$/mi);
		return m ? m[1] : "";
	},

	/** Anahtar: kayıtlıysa o, değilse (kaydetmeden) üretilen. */
	get(item) {
		return this.existing(item) || this.make(this._lastName(item), this._year(item), item.getField("title"));
	},

	/** Kütüphanedeki kayıtlı anahtarlar (tekillik için). */
	async _taken(libraryID) {
		let set = new Set();
		let rows = await Zotero.DB.columnQueryAsync(
			"SELECT value FROM itemData JOIN itemDataValues USING (valueID) JOIN items USING (itemID) "
			+ "WHERE libraryID=? AND fieldID=? AND value LIKE '%Citation Key:%'",
			[libraryID, Zotero.ItemFields.getID("extra")]);
		for (let v of rows || []) {
			let m = String(v).match(/^\s*Citation Key:\s*(\S+)\s*$/mi);
			if (m) set.add(m[1]);
		}
		let fid = this._fieldID();
		if (fid) {
			for (let v of await Zotero.DB.columnQueryAsync(
				"SELECT value FROM itemData JOIN itemDataValues USING (valueID) JOIN items USING (itemID) WHERE libraryID=? AND fieldID=?",
				[libraryID, fid]) || []) set.add(String(v));
		}
		return set;
	},

	/** Seçili kayıtlara anahtar yazar (olanlara dokunmaz). Atanan sayı döner. */
	async assign(items, { quiet = false } = {}) {
		items = items.filter(i => i.isRegularItem());
		if (!items.length) return 0;
		let taken = await this._taken(items[0].libraryID);
		let fid = this._fieldID();
		let n = 0;
		await Zotero.DB.executeTransaction(async () => {
			for (let it of items) {
				if (this.existing(it)) continue;
				let base = this.make(this._lastName(it), this._year(it), it.getField("title"));
				let key = base;
				for (let i = 0; taken.has(key); i++) key = base + String.fromCharCode(97 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : "");
				taken.add(key);
				if (fid && Zotero.ItemFields.isValidForType(fid, it.itemTypeID)) it.setField("citationKey", key);
				else {
					let extra = (it.getField("extra") || "").trim();
					it.setField("extra", (extra ? extra + "\n" : "") + "Citation Key: " + key);
				}
				await it.save();
				n++;
			}
		});
		if (!quiet) Hafif.toast(n ? `${n} kayda atıf anahtarı verildi.` : "Seçili kayıtların hepsinin anahtarı var.");
		return n;
	},

	async copy(items) {
		let keys = items.filter(i => i.isRegularItem()).map(i => "@" + this.get(i));
		if (!keys.length) return Hafif.toast("Kayıt seçin.");
		Hafif.copy(null, keys.join("; "), `${keys.length} atıf anahtarı kopyalandı.`);
	},
};
