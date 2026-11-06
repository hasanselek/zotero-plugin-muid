/* PDF'leri klasöre taşıma (ZotMoov yerine).
 * Zotero deposundaki dosyayı seçilen klasöre kopyalar, onu gösteren bağlantılı ek oluşturur,
 * vurguları/alt öğeleri, ilişkileri ve tam metin dizinini yeni eke aktarır; eski eki çöp
 * kutusuna atar (kalıcı silme yok). Zotero'nun "bağlantılıyı depoya çevir" işleminin tersidir. */

Hafif.modules.move = {
	async pickFolder(win) {
		let { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
		let fp = new FilePicker();
		fp.init(win, "PDF'lerin taşınacağı klasörü seçin", fp.modeGetFolder);
		if (await fp.show() !== fp.returnOK) return null;
		Hafif.pref("moveDir", fp.file);
		return fp.file;
	},

	/** Seçimden depolanmış (Zotero deposundaki) dosya eklerini toplar. */
	storedAttachments(items) {
		let out = new Map();
		for (let item of items) {
			let atts = item.isRegularItem() ? Zotero.Items.get(item.getAttachments()) : [item];
			for (let a of atts) {
				if (a?.isStoredFileAttachment?.() && !a.deleted) out.set(a.id, a);
			}
		}
		return [...out.values()];
	},

	_safe(name) {
		return String(name).replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "adsız";
	},

	async _unique(path) {
		if (!(await IOUtils.exists(path))) return path;
		let dir = PathUtils.parent(path);
		let name = PathUtils.filename(path);
		let dot = name.lastIndexOf(".");
		let base = dot > 0 ? name.slice(0, dot) : name;
		let ext = dot > 0 ? name.slice(dot) : "";
		for (let i = 2; i < 1000; i++) {
			let p = PathUtils.join(dir, `${base} (${i})${ext}`);
			if (!(await IOUtils.exists(p))) return p;
		}
		throw new Error("Benzersiz dosya adı bulunamadı: " + path);
	},

	async run(items) {
		let win = Zotero.getMainWindow();
		let atts = this.storedAttachments(items);
		if (!atts.length) return Hafif.toast("Seçimde Zotero deposunda duran dosya eki yok.");
		let dir = Hafif.pref("moveDir") || await this.pickFolder(win);
		if (!dir) return;
		let byCollection = Hafif.pref("moveByCollection");
		let ok = Services.prompt.confirm(win, "PDF'leri klasöre taşı",
			`${atts.length} dosya “${dir}” klasörüne${byCollection ? " (koleksiyon alt klasörleriyle)" : ""} taşınacak `
			+ "ve bağlantılı ek olarak yeniden kurulacak. Vurgular ve notlar yeni eke aktarılır, eski ekler çöp kutusuna gider.\n\n"
			+ "Not: Bağlantılı dosyalar Zotero dosya senkronizasyonuyla eşitlenmez.\n\nDevam edilsin mi?");
		if (!ok) return;

		let done = 0;
		let failed = [];
		for (let att of atts) {
			try {
				await this.moveOne(att, dir, byCollection);
				done++;
			}
			catch (e) {
				Zotero.logError(e);
				failed.push(`${att.getDisplayTitle()}: ${e.message}`);
			}
		}
		Hafif.toast(`${done} dosya taşındı.` + (failed.length ? ` ${failed.length} hata: ${failed[0]}` : ""), failed.length ? 8000 : 3000);
	},

	async moveOne(att, dir, byCollection) {
		let src = await att.getFilePathAsync();
		if (!src) throw new Error("dosya diskte yok");
		let parent = att.parentItem;
		let ext = PathUtils.filename(src).match(/\.[^.]+$/)?.[0] || "";
		let base = parent
			? Zotero.Attachments.getFileBaseNameFromItem(parent, { attachmentTitle: att.getField("title") })
			: PathUtils.filename(src).replace(/\.[^.]+$/, "");
		let targetDir = dir;
		if (byCollection) {
			let colID = (parent || att).getCollections()[0];
			let col = colID && Zotero.Collections.get(colID);
			if (col) targetDir = PathUtils.join(dir, this._safe(col.name));
		}
		await IOUtils.makeDirectory(targetDir, { ignoreExisting: true });
		let dst = await this._unique(PathUtils.join(targetDir, this._safe(base) + ext));
		await IOUtils.copy(src, dst);

		let json = att.toJSON();
		delete json.key;
		delete json.version;
		delete json.filename;
		delete json.md5;
		delete json.mtime;
		json.linkMode = "linked_file";
		json.path = dst;
		let newItem = new Zotero.Item("attachment");
		newItem.libraryID = att.libraryID;
		newItem.fromJSON(json);
		try {
			await newItem.saveTx();
			await Zotero.DB.executeTransaction(async () => {
				await Zotero.Items.moveChildItems(att, newItem);
			});
			await Zotero.Relations.copyObjectSubjectRelations(att, newItem);
		}
		catch (e) {
			// Yarım kalan işi geri al: yeni kayıt ve kopya dosya silinir, eski ek yerinde kalır
			if (newItem.id) await newItem.eraseTx().catch(Zotero.logError);
			await IOUtils.remove(dst, { ignoreAbsent: true }).catch(Zotero.logError);
			throw e;
		}
		try {
			await Zotero.DB.executeTransaction(async () => {
				await Zotero.Fulltext.transferItemIndex(att, newItem);
			});
		}
		catch (e) {
			Zotero.logError(e);
		}
		if (!(await newItem.fileExists())) throw new Error("yeni dosya doğrulanamadı; eski ek yerinde bırakıldı");
		att.deleted = true;
		await att.saveTx();
		return newItem;
	},
};
