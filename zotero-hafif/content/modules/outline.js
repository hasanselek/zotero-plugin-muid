/* PDF içindekiler (yer imleri).
 * Okurken seçilen başlıklar önce bir taslağa eklenir; düzenleyicide PDF'in mevcut içindekileriyle
 * birleştirilip tek seferde PDF'e yazılır. PDF'in aslı ilk yazımdan önce Zotero veri klasöründeki
 * hafif/yedek altına kopyalanır. Yazma işi pdf-lib (MIT) ile yapılır ve yalnızca gerektiğinde yüklenir. */

Hafif.modules.outline = {
	_lib: null,

	pdfLib() {
		if (!this._lib) {
			let scope = {};
			Services.scriptloader.loadSubScript(Hafif.rootURI + "content/lib/pdf-lib.min.js", scope);
			this._lib = scope.PDFLib;
		}
		return this._lib;
	},

	// ---- Saf işlevler (Zotero'suz da çalışır, testlerde kullanılır) ----

	/** Düz listeyi (level 1–3) ağaca çevirir. Atlanan düzeyler bir üstteki düğüme bağlanır. */
	tree(entries) {
		let root = { children: [] };
		let stack = [{ level: 0, node: root }];
		for (let e of entries) {
			let level = Math.max(1, Math.min(6, e.level | 0 || 1));
			let node = { e, children: [] };
			while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
			stack[stack.length - 1].node.children.push(node);
			stack.push({ level, node });
		}
		return root.children;
	},

	/** Girdileri sayfa ve sayfa içi konuma göre sıralar (PDF koordinatında y yukarı doğru artar). */
	sort(entries) {
		return [...entries].sort((a, b) =>
			a.pageIndex - b.pageIndex || (b.top ?? 1e9) - (a.top ?? 1e9));
	},

	/** PDF'teki mevcut içindekileri düz listeye çevirir: [{ title, level, pageIndex, top }]. */
	read(PDFLib, doc) {
		let { PDFName, PDFArray, PDFDict, PDFRef, PDFNumber, PDFString, PDFHexString } = PDFLib;
		let ctx = doc.context;
		let pageIndexByRef = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]));
		let outlines = doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
		if (!outlines) return [];

		let named = this._namedDests(PDFLib, doc);
		let destOf = (item) => {
			let d = item.get(PDFName.of("Dest"));
			if (!d) {
				let a = item.lookupMaybe(PDFName.of("A"), PDFDict);
				if (a) d = a.get(PDFName.of("D"));
			}
			if (d instanceof PDFRef) d = ctx.lookup(d);
			if (d instanceof PDFString || d instanceof PDFHexString || d instanceof PDFName) {
				let key = d instanceof PDFName ? d.asString().slice(1) : d.decodeText();
				d = named.get(key);
				if (d instanceof PDFRef) d = ctx.lookup(d);
				if (d instanceof PDFDict) d = d.lookup(PDFName.of("D"));
			}
			if (!(d instanceof PDFArray)) return { pageIndex: 0, top: null };
			let page = d.get(0);
			let pageIndex = page instanceof PDFRef ? pageIndexByRef.get(page.toString()) ?? 0
				: page instanceof PDFNumber ? page.asNumber() : 0;
			let type = d.get(1) instanceof PDFName ? d.get(1).asString() : "";
			let topObj = type === "/XYZ" ? d.get(3) : (type === "/FitH" || type === "/FitBH") ? d.get(2) : null;
			return { pageIndex, top: topObj instanceof PDFNumber ? topObj.asNumber() : null };
		};

		let out = [];
		let seen = new Set();
		let walk = (ref, level) => {
			while (ref && !seen.has(ref.toString()) && out.length < 5000) {
				seen.add(ref.toString());
				let item = ctx.lookup(ref, PDFDict);
				let t = item.lookup(PDFName.of("Title"));
				let title = t && t.decodeText ? t.decodeText() : "";
				out.push({ title: title.trim(), level, ...destOf(item) });
				let first = item.get(PDFName.of("First"));
				if (first) walk(first, level + 1);
				ref = item.get(PDFName.of("Next"));
			}
		};
		walk(outlines.get(PDFName.of("First")), 1);
		return out;
	},

	_namedDests(PDFLib, doc) {
		let { PDFName, PDFDict, PDFArray } = PDFLib;
		let map = new Map();
		let old = doc.catalog.lookupMaybe(PDFName.of("Dests"), PDFDict);
		if (old) for (let [k, v] of old.entries()) map.set(k.asString().slice(1), v);
		let names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
		let tree = names && names.lookupMaybe(PDFName.of("Dests"), PDFDict);
		let walk = (node, depth) => {
			if (!node || depth > 20) return;
			let arr = node.lookupMaybe(PDFName.of("Names"), PDFArray);
			if (arr) for (let i = 0; i + 1 < arr.size(); i += 2) map.set(arr.lookup(i).decodeText(), arr.get(i + 1));
			let kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
			if (kids) for (let i = 0; i < kids.size(); i++) walk(kids.lookup(i, PDFDict), depth + 1);
		};
		walk(tree, 0);
		return map;
	},

	/** PDF'in içindekilerini verilen düz listeyle değiştirir. */
	write(PDFLib, doc, entries) {
		let { PDFName, PDFHexString, PDFNumber, PDFNull, PDFArray } = PDFLib;
		let ctx = doc.context;
		let pages = doc.getPages();
		let outlinesRef = ctx.nextRef();

		let build = (nodes, parentRef) => {
			let refs = nodes.map(() => ctx.nextRef());
			let total = 0;
			nodes.forEach((n, i) => {
				let page = pages[Math.max(0, Math.min(n.e.pageIndex | 0, pages.length - 1))];
				let dest = PDFArray.withContext(ctx);
				dest.push(page.ref);
				dest.push(PDFName.of("XYZ"));
				dest.push(PDFNull);
				dest.push(n.e.top == null ? PDFNull : PDFNumber.of(n.e.top));
				dest.push(PDFNull);
				let dict = ctx.obj({});
				dict.set(PDFName.of("Title"), PDFHexString.fromText(n.e.title || "(başlıksız)"));
				dict.set(PDFName.of("Parent"), parentRef);
				dict.set(PDFName.of("Dest"), dest);
				if (i > 0) dict.set(PDFName.of("Prev"), refs[i - 1]);
				if (i < nodes.length - 1) dict.set(PDFName.of("Next"), refs[i + 1]);
				if (n.children.length) {
					let c = build(n.children, refs[i]);
					dict.set(PDFName.of("First"), c.refs[0]);
					dict.set(PDFName.of("Last"), c.refs[c.refs.length - 1]);
					// Pozitif sayı: alt başlıklar açık görünür
					dict.set(PDFName.of("Count"), PDFNumber.of(c.total));
					total += c.total;
				}
				ctx.assign(refs[i], dict);
				total += 1;
			});
			return { refs, total };
		};

		let top = build(this.tree(entries), outlinesRef);
		let outlines = ctx.obj({ Type: "Outlines" });
		if (top.refs.length) {
			outlines.set(PDFName.of("First"), top.refs[0]);
			outlines.set(PDFName.of("Last"), top.refs[top.refs.length - 1]);
			outlines.set(PDFName.of("Count"), PDFNumber.of(top.total));
		}
		ctx.assign(outlinesRef, outlines);
		doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
	},

	// ---- Taslak (henüz PDF'e yazılmamış başlıklar) ----

	_draftPath(att) {
		return PathUtils.join(Zotero.DataDirectory.dir, "hafif", "outlines", `${att.libraryID}_${att.key}.json`);
	},

	async getDraft(att) {
		try {
			return JSON.parse(await IOUtils.readUTF8(this._draftPath(att)));
		}
		catch (e) {
			return [];
		}
	},

	async setDraft(att, entries) {
		let path = this._draftPath(att);
		if (!entries.length) {
			await IOUtils.remove(path, { ignoreAbsent: true });
			return;
		}
		await IOUtils.makeDirectory(PathUtils.parent(path), { ignoreExisting: true });
		await IOUtils.writeUTF8(path, JSON.stringify(entries));
	},

	/** Okuyucudaki seçimi taslağa başlık olarak ekler. */
	async addFromSelection(reader, annotation, level) {
		let att = reader._item;
		let pos = annotation.position || {};
		let rects = pos.rects || [];
		let top = rects.length ? Math.max(...rects.map(r => r[3])) + 4 : null;
		let title = String(annotation.text || "").replace(/\s+/g, " ").trim().slice(0, 200);
		if (!title) return Hafif.toast("Seçili metin yok.");
		let draft = await this.getDraft(att);
		draft.push({ title, level, pageIndex: pos.pageIndex | 0, top });
		await this.setDraft(att, draft);
		Hafif.toast(`İçindekiler taslağına eklendi (${draft.length} bekleyen). Kaydetmek için: Görünüm › PDF içindekilerini düzenle…`, 4000);
	},

	// ---- PDF okuma/yazma ----

	/** Dosyayı pdf-lib'in kendi ortamında (aynı JS realm) bir Uint8Array olarak okur.
	 * IOUtils.read'in döndürdüğü dizi başka bir realm'den gelir ve pdf-lib'in tür denetiminden geçmez. */
	async _read(path) {
		try {
			let res = await fetch(PathUtils.toFileURI(path));
			return new Uint8Array(await res.arrayBuffer());
		}
		catch (e) {
			Zotero.logError(e);
			let raw = await IOUtils.read(path);
			let out = new Uint8Array(raw.length);
			out.set(raw);
			return out;
		}
	},

	_attachmentFrom(x) {
		let item = typeof x === "number" ? Zotero.Items.get(x) : x;
		if (item?.isRegularItem()) {
			let atts = Zotero.Items.get(item.getAttachments()).filter(a => a.isPDFAttachment());
			item = atts[0];
		}
		return item?.isPDFAttachment() ? item : null;
	},

	/** Düzenleyici için: PDF'teki mevcut içindekiler + taslak, sıralı tek liste. */
	async load(att) {
		let path = await att.getFilePathAsync();
		if (!path) throw new Error("PDF dosyası bulunamadı.");
		let PDFLib = this.pdfLib();
		let doc = await PDFLib.PDFDocument.load(await this._read(path), { ignoreEncryption: true, updateMetadata: false });
		let existing = this.read(PDFLib, doc).map(e => ({ ...e, source: "pdf" }));
		let draft = (await this.getDraft(att)).map(e => ({ ...e, source: "draft" }));
		return { entries: this._merge(existing, draft), pageCount: doc.getPageCount(), hadOutline: existing.length > 0 };
	},

	/** Taslak girdileri mevcut listeye konumlarına göre yerleştirir; mevcut sıra bozulmaz. */
	_merge(existing, draft) {
		let out = [...existing];
		for (let d of this.sort(draft)) {
			let i = out.findIndex(e => e.pageIndex > d.pageIndex
				|| (e.pageIndex === d.pageIndex && (e.top ?? -1) < (d.top ?? -1)));
			if (i < 0) out.push(d);
			else out.splice(i, 0, d);
		}
		return out;
	},

	async save(att, entries) {
		let path = await att.getFilePathAsync();
		if (!path) throw new Error("PDF dosyası bulunamadı.");
		let bytes = await this._read(path);
		await this._backup(att, path, bytes);
		let PDFLib = this.pdfLib();
		let doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
		this.write(PDFLib, doc, entries.map(({ title, level, pageIndex, top }) => ({ title, level, pageIndex, top })));
		let out = await doc.save({ useObjectStreams: false });
		let tmp = path + ".hafif-tmp";
		await IOUtils.write(tmp, out);
		await IOUtils.move(tmp, path);
		await this.setDraft(att, []);
		// Açık okuyucuları yenile ki yeni içindekiler görünsün
		for (let r of Zotero.Reader._readers) if (r.itemID === att.id) await r.reload();
		return out.length;
	},

	/** İlk yazımdan önce aslını yedekler (sonraki yazımlarda yedek tekrar alınmaz). */
	async _backup(att, path, bytes) {
		let dir = PathUtils.join(Zotero.DataDirectory.dir, "hafif", "yedek");
		let file = PathUtils.join(dir, `${att.libraryID}_${att.key}_${PathUtils.filename(path)}`);
		if (await IOUtils.exists(file)) return;
		await IOUtils.makeDirectory(dir, { ignoreExisting: true });
		await IOUtils.write(file, bytes);
	},

	openEditor(x) {
		let att = this._attachmentFrom(x);
		if (!att) return Hafif.toast("PDF eki bulunamadı.");
		Zotero.getMainWindow().openDialog("chrome://hafif/content/windows/outline.xhtml", "hafif-outline-" + att.id,
			"chrome,resizable,centerscreen,width=620,height=720", { Hafif, attachmentID: att.id });
	},
};
