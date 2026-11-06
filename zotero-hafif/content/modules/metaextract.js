/* Yapay zekâ ile künye çıkarma: PDF'in ilk sayfaları ve son sayfası (künye/kolofon) okunur,
 * metin katmanı yoksa sayfa görüntüsüne bakılır. DOI ya da ISBN bulunursa künye önce Zotero'nun
 * kendi çekicisiyle (kaydetmeden) alınır ve modelin çıkardığıyla birleştirilir. Üst kaydı olmayan
 * PDF için kayıt oluşturulur; olan kayıtta yalnızca değişecek alanlar onaya sunulur. */

Hafif.modules.metaextract = {
	TYPES: ["book", "bookSection", "journalArticle", "thesis", "encyclopediaArticle", "manuscript", "conferencePaper", "report", "magazineArticle", "newspaperArticle", "webpage", "document"],

	tools() {
		let M = this;
		return [{
			name: "extract_metadata",
			approval: true,
			label: (a) => `Künye çıkarılıyor: ${Hafif.load("libtools")._labelFor(a.key)}`,
			description: "Bir PDF'in (ya da kaydın PDF ekinin) ilk sayfalarından ve künye sayfasından künyeyi çıkarır: tür, başlık, yazar/editör/çevirmen/muhakkik, yayınevi, yer, yıl (hicrî dahil), cilt, sayfa, ISBN/DOI… Üst kaydı olmayan PDF için kayıt oluşturur, olan kayıtta eksik ya da hatalı alanları düzeltir. Kullanıcı onaylamadan değiştirmez.",
			parameters: {
				type: "object",
				properties: {
					key: { type: "string", description: "Kayıt ya da PDF eki anahtarı" },
					overwrite: { type: "boolean", description: "Dolu alanları da (farklıysa) değiştir; varsayılan yalnızca boş alanları doldur" },
				},
				required: ["key"],
			},
			run: (a, ctx) => M.run(a, ctx),
		}];
	},

	/** PDF'ten çıkarılacak metin: ilk 4 sayfa ve son 2 sayfa. */
	async _text(att) {
		let T = Hafif.load("libtools");
		let pages = await T.pages(att);
		let n = pages.length;
		let pick = [...new Set([0, 1, 2, 3, n - 2, n - 1].filter(i => i >= 0 && i < n))];
		let parts = pick.map(i => `[[PDF s. ${i + 1}]]\n${(pages[i] || "").slice(0, 4000)}`);
		let chars = pick.reduce((s, i) => s + (pages[i] || "").trim().length, 0);
		return { text: parts.join("\n\n"), chars, n };
	},

	async _ask(att) {
		let llm = Hafif.load("llm");
		let { provider, model } = llm.current();
		let { text, chars, n } = await this._text(att);
		let content = [];
		if (chars < 300) {
			// Taranmış: ilk iki sayfanın görüntüsü
			let np = Hafif.load("notepreview");
			for (let i = 0; i < Math.min(2, n || 1); i++) {
				let img = await np.renderPage(att, i);
				content.push({ type: "image", mediaType: "image/png", data: img.url.replace(/^data:image\/png;base64,/, "") });
			}
		}
		content.push({ type: "text", text: (chars >= 300 ? `PDF'in ilk ve son sayfaları (toplam ${n} sayfa):\n\n${text}\n\n` : `Taranmış PDF; ilk sayfaların görüntüleri yukarıda (toplam ${n} sayfa).\n\n`) + "Bu eserin künyesini çıkar." });
		let system = `Bir akademik eserin künyesini PDF'inden çıkarıyorsun. Eserler çoğunlukla Türkçe, Arapça ve Osmanlıca İslâm ilimleri kaynaklarıdır (kitap, tahkikli neşir, tez, dergi makalesi, ansiklopedi maddesi, kitap bölümü, yazma). Yalnızca sayfalarda gördüğüne dayan; tahmin etme.
Yalnızca JSON döndür:
{"itemType": "${this.TYPES.join("|")}",
 "title": "kapakta/iç kapakta yazdığı gibi (Arapça ise Arapça harflerle)",
 "creators": [{"firstName": "...", "lastName": "...", "creatorType": "author|editor|translator|contributor|bookAuthor"}] (tek parça adlar için {"name": "...", "creatorType": ...}; muhakkik/tahkik eden editor olarak),
 "date": "miladî yıl (ya da tam tarih)", "hijri": "hicrî yıl varsa", "publisher": "", "place": "", "edition": "", "volume": "", "numberOfVolumes": "", "series": "", "seriesNumber": "",
 "publicationTitle": "dergi adı (makalede)", "bookTitle": "kitap adı (bölümde)", "issue": "", "pages": "makale/bölüm sayfa aralığı",
 "numPages": "", "ISBN": "", "ISSN": "", "DOI": "", "language": "tr|ar|en|ota|fa…", "university": "tezde", "thesisType": "Doktora Tezi|Yüksek Lisans Tezi",
 "abstractNote": "özet sayfada açıkça varsa, kısaltmadan", "tahkik": "muhakkik adı varsa", "translatedTitle": "Arapça başlığın Türkçe/Latin harfli okunuşu varsa"}
Boş alanları atla. Yazar adlarını büyük harfli yazılmışsa normal yaz (MEHMET ÖZTÜRK → Mehmet Öztürk).`;
		let res = await llm.chat({ provider, model, system, effort: "low", messages: [{ role: "user", content }] });
		let out = res.content.filter(b => b.type === "text").map(b => b.text).join("");
		return Hafif.load("tables")._json(out);
	},

	/** DOI/ISBN ile Zotero'nun künye çekicisinden kaydetmeden künye. */
	async _lookup(j) {
		let ids = Zotero.Utilities.extractIdentifiers([j.DOI, j.ISBN].filter(Boolean).join(" "));
		if (!ids.length) return null;
		try {
			let tr = new Zotero.Translate.Search();
			tr.setIdentifier(ids[0]);
			tr.setTranslator(await tr.getTranslators());
			let items = await tr.translate({ libraryID: false, saveAttachments: false });
			return items?.[0] || null;
		}
		catch (e) {
			return null;
		}
	},

	/** Model çıktısı (+ çekici sonucu) → { itemType, fields: {ad: değer}, creators } */
	_normalize(j, looked) {
		let type = this.TYPES.includes(looked?.itemType) ? looked.itemType : this.TYPES.includes(j.itemType) ? j.itemType : "book";
		let typeID = Zotero.ItemTypes.getID(type);
		let fields = {};
		let put = (name, v) => {
			if (v == null || v === "") return;
			let fid = Zotero.ItemFields.getFieldIDFromTypeAndBase(typeID, name) || Zotero.ItemFields.getID(name);
			if (fid && Zotero.ItemFields.isValidForType(fid, typeID)) fields[Zotero.ItemFields.getName(fid)] = String(v).trim();
		};
		// Çekiciden gelen künye esastır; model yalnızca eksikleri tamamlar
		let src = { ...j, ...(looked || {}) };
		for (let f of ["title", "date", "publisher", "place", "edition", "volume", "numberOfVolumes", "series", "seriesNumber", "publicationTitle", "bookTitle", "issue", "pages", "numPages", "ISBN", "ISSN", "DOI", "language", "university", "thesisType", "abstractNote", "encyclopediaTitle", "url"]) {
			put(f, src[f]);
		}
		let extra = [];
		if (j.hijri) extra.push(`Hicrî: ${j.hijri}`);
		if (j.tahkik) extra.push(`Tahkik: ${j.tahkik}`);
		if (j.translatedTitle) extra.push(`Okunuş: ${j.translatedTitle}`);
		if (extra.length) fields.extra = extra.join("\n");
		let fix = (s) => Hafif.load("sources").tc(s || "");
		let creators = (looked?.creators?.length ? looked.creators : j.creators || []).map(c => {
			let t = c.creatorType && Zotero.CreatorTypes.isValidForItemType(Zotero.CreatorTypes.getID(c.creatorType), typeID) ? c.creatorType : Zotero.CreatorTypes.getPrimaryIDForType(typeID) ? Zotero.CreatorTypes.getName(Zotero.CreatorTypes.getPrimaryIDForType(typeID)) : "author";
			return c.name ? { name: fix(c.name), creatorType: t } : { firstName: fix(c.firstName), lastName: fix(c.lastName), creatorType: t };
		}).filter(c => c.name || c.lastName || c.firstName);
		return { itemType: type, fields, creators };
	},

	async run(a, ctx = {}) {
		let T = Hafif.load("libtools");
		let item = T.byKey(a.key);
		let att = item.isAttachment() ? item : await T.documentOf(item);
		if (!att?.isPDFAttachment()) return "Bu kaydın PDF eki yok; künye PDF'ten çıkarılır.";
		let parent = att.parentItem || (item.isRegularItem() ? item : null);
		let j = await this._ask(att);
		let looked = await this._lookup(j);
		let meta = this._normalize(j, looked);
		let fmt = (cs) => cs.map(c => c.name || [c.lastName, c.firstName].filter(Boolean).join(", ") + (c.creatorType !== "author" ? ` (${Zotero.CreatorTypes.getLocalizedString(c.creatorType)})` : "")).join("; ");
		let label = (f) => Zotero.ItemFields.getLocalizedString(f);
		let items = [];
		let changes = [];
		if (!parent) {
			items.push({ text: Zotero.ItemTypes.getLocalizedString(meta.itemType), meta: "Tür" });
			for (let [f, v] of Object.entries(meta.fields)) items.push({ text: v.length > 300 ? v.slice(0, 300) + "…" : v, meta: label(f) });
			if (meta.creators.length) items.push({ text: fmt(meta.creators), meta: "Katkıda bulunanlar" });
		}
		else {
			for (let [f, v] of Object.entries(meta.fields)) {
				let fid = Zotero.ItemFields.getFieldIDFromTypeAndBase(parent.itemTypeID, f) || Zotero.ItemFields.getID(f);
				if (!fid || !Zotero.ItemFields.isValidForType(fid, parent.itemTypeID)) continue;
				let name = Zotero.ItemFields.getName(fid);
				let old = parent.getField(name) || "";
				if (f === "extra" && old) v = [old, ...v.split("\n").filter(l => !old.includes(l))].join("\n");
				if (old === v || (old && !a.overwrite && f !== "extra")) continue;
				changes.push({ name, old, v });
				items.push({ text: `${old || "(boş)"}  →  ${v.length > 300 ? v.slice(0, 300) + "…" : v}`, meta: label(name) });
			}
			let oldC = parent.getCreators();
			if (meta.creators.length && (!oldC.length || a.overwrite) && fmt(oldC) !== fmt(meta.creators)) {
				items.push({ text: `${fmt(oldC) || "(yok)"}  →  ${fmt(meta.creators)}`, meta: "Katkıda bulunanlar" });
				changes.push({ creators: meta.creators, oldCreators: oldC });
			}
			if (!changes.length) return "Künye zaten tam görünüyor; değiştirilecek alan yok." + (a.overwrite ? "" : " (Dolu alanları da karşılaştırmak için overwrite kullan.)");
		}
		let src = looked ? " (DOI/ISBN ile doğrulandı)" : "";
		let ok = await ctx.approve?.({
			title: parent ? `“${parent.getDisplayTitle().slice(0, 60)}” künyesi düzeltilecek${src}` : `PDF için yeni kayıt oluşturulacak${src}`,
			items,
			yes: parent ? "Künyeyi güncelle" : "Kaydı oluştur",
		});
		if (ctx.approve && !ok) return "Kullanıcı künyeyi reddetti.";
		if (!parent) {
			let it = new Zotero.Item(meta.itemType);
			it.libraryID = att.libraryID;
			for (let [f, v] of Object.entries(meta.fields)) it.setField(f, v);
			it.setCreators(meta.creators);
			for (let c of att.getCollections()) it.addToCollection(c);
			await it.saveTx();
			att.parentID = it.id;
			await att.saveTx();
			ctx.registerUndo?.("Oluşturulan kaydı geri al", async () => {
				att.parentID = false;
				for (let c of it.getCollections()) att.addToCollection(c);
				await att.saveTx();
				await Zotero.Items.trashTx([it.id]);
			});
			return `Kayıt oluşturuldu: ${it.key} “${it.getDisplayTitle()}” — PDF bu kaydın eki yapıldı${src}.`;
		}
		let undo = [];
		for (let c of changes) {
			if (c.creators) {
				parent.setCreators(c.creators);
				undo.push(() => parent.setCreators(c.oldCreators));
			}
			else {
				parent.setField(c.name, c.v);
				undo.push(() => parent.setField(c.name, c.old));
			}
		}
		await parent.saveTx();
		ctx.registerUndo?.("Künye değişikliğini geri al", async () => {
			for (let u of undo) u();
			await parent.saveTx();
		});
		return `Künye güncellendi (${parent.key}): ${items.map(i => i.meta).join(", ")}${src}.`;
	},
};
