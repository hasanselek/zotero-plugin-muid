/* PDF servisinin ana pencere tarafı: görünmez bir sayfada (windows/pdfservice.html) Zotero'nun
 * pdf.js'ini çalıştırır. Basılı sayfa numaraları (sayfa etiketleri) ve bir alıntının sayfadaki
 * konumu buradan alınır. Servis yüklenemezse çağıranlar sayfa düzeyinde kalır (hata atmaz). */

Hafif.modules.pdfsvc = {
	_frame: null,
	_labels: new Map(),

	async _svc() {
		let win = Zotero.getMainWindow();
		if (!this._frame || this._frame.ownerGlobal !== win || !this._frame.isConnected) {
			let f = win.document.createElementNS("http://www.w3.org/1999/xhtml", "iframe");
			f.setAttribute("src", "chrome://hafif/content/windows/pdfservice.html");
			f.style.cssText = "position: fixed; width: 0; height: 0; border: 0; visibility: hidden; pointer-events: none;";
			win.document.documentElement.append(f);
			this._frame = f;
		}
		for (let i = 0; i < 100; i++) {
			let w = this._frame.contentWindow;
			if (w?.PDFS?.ready) return w;
			await new Promise(r => win.setTimeout(r, 50));
		}
		throw new Error("PDF servisi yüklenemedi.");
	},

	async _id(att) {
		return `${att.libraryID}/${att.key}@${(await att.attachmentHash) || att.dateModified}`;
	},

	/** Belgeyi servise yükler (zaten yüklüyse dokunmaz); kimliğini döndürür. */
	async ensure(att) {
		if (!att?.isPDFAttachment()) throw new Error("PDF değil");
		let svc = await this._svc();
		let id = await this._id(att);
		if (!svc.PDFS.has(id)) {
			let path = await att.getFilePathAsync();
			if (!path) throw new Error("PDF dosyası bu bilgisayarda yok.");
			let bytes = await IOUtils.read(path);
			await svc.PDFS.open(id, new svc.Uint8Array(bytes));
		}
		return { svc, id };
	},

	/** Basılı sayfa numaraları dizisi (yoksa null). Bellekte tutulur. */
	async labels(att) {
		let key = att.libraryID + "/" + att.key;
		if (this._labels.has(key)) return this._labels.get(key);
		let labels = null;
		try {
			let { svc, id } = await this.ensure(att);
			labels = (await svc.PDFS.info(id)).labels || null;
		}
		catch (e) {
			Zotero.debug("[Hafif] sayfa etiketleri alınamadı: " + e.message);
		}
		// Etiketler sayfa numarasıyla aynıysa saklamaya gerek yok
		if (labels && labels.every((l, i) => String(l) === String(i + 1))) labels = null;
		this._labels.set(key, labels);
		return labels;
	},

	/** Bellekteki etiketten basılı sayfa (eşzamanlı; bilinmiyorsa PDF sayfası). */
	labelSync(att, pageIndex) {
		let l = att && this._labels.get(att.libraryID + "/" + att.key);
		return (l && l[pageIndex]) || String(pageIndex + 1);
	},

	/** Alıntının konumu: { pageIndex, rects, text, sortIndex, pageLabel } ya da null. */
	async findQuote(att, pageIndex, quote, opts) {
		try {
			let { svc, id } = await this.ensure(att);
			let r = await svc.PDFS.findQuote(id, pageIndex, quote, opts);
			if (!r) return null;
			let labels = await this.labels(att);
			return {
				pageIndex: r.pageIndex,
				rects: r.rects,
				text: r.text,
				partial: r.partial,
				pageLabel: (labels && labels[r.pageIndex]) || String(r.pageIndex + 1),
				// Zotero'nun sıralama anahtarı: sayfa|karakter|üstten uzaklık
				sortIndex: [String(r.pageIndex).padStart(5, "0"), String(r.offset).slice(0, 6).padStart(6, "0"), String(Math.max(0, Math.floor(r.top))).slice(0, 5).padStart(5, "0")].join("|"),
			};
		}
		catch (e) {
			Zotero.debug("[Hafif] alıntı konumu bulunamadı: " + e.message);
			return null;
		}
	},

	shutdown() {
		this._frame?.remove();
		this._frame = null;
	},
};
