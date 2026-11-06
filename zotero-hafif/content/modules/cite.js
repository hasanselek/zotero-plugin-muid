/* Atıf önizleme ve kopyalama: sağ panelde seçili kaydın atfı ve kaynakça girdisi.
 * Stil olarak Zotero'nun yüklü stilleri kullanılır; varsayılan Zotero'nun Hızlı Kopyala stilidir. */

Hafif.modules.cite = {
	/** Zotero stilleri tembel yüklenir; atıf üretmeden önce hazır olmalı. */
	async ready() {
		if (!Zotero.Styles.initialized()) await Zotero.Styles.init();
	},

	styleID() {
		let id = Hafif.pref("citeStyle");
		if (id && Zotero.Styles.get(id)) return id;
		let qc = Zotero.Prefs.get("export.quickCopy.setting") || "";
		let m = qc.match(/^bibliography=(.+)$/);
		if (m && Zotero.Styles.get(m[1])) return m[1];
		return Zotero.Styles.getVisible()[0]?.styleID;
	},

	locale() {
		return Zotero.Prefs.get("export.quickCopy.locale") || Zotero.locale;
	},

	/** { citation: {html, text}, bibliography: {html, text} } */
	format(item, styleID = this.styleID()) {
		let style = Zotero.Styles.get(styleID);
		if (!style) throw new Error("Atıf stili bulunamadı: " + styleID);
		let out = {};
		let csl = style.getCiteProc(this.locale(), "html");
		try {
			csl.updateItems([item.id]);
			let cluster = { citationItems: [{ id: item.id }], properties: {} };
			out.citation = {
				html: csl.previewCitationCluster(cluster, [], [], "html"),
				text: csl.previewCitationCluster(cluster, [], [], "text"),
			};
		}
		finally {
			csl.free();
		}
		out.bibliography = {};
		for (let fmt of ["html", "text"]) {
			let engine = style.getCiteProc(this.locale(), fmt);
			try {
				out.bibliography[fmt] = Zotero.Cite.makeFormattedBibliographyOrCitationList(engine, [item], fmt);
			}
			finally {
				engine.free();
			}
		}
		out.bibliography.text = (out.bibliography.text || "").trim();
		return out;
	},

	// ---- Sağ panel bölümü ----

	init({ body }) {
		let doc = body.ownerDocument;
		let h = (tag, cls, text) => {
			let el = doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
			if (cls) el.className = cls;
			if (text) el.textContent = text;
			return el;
		};
		let style = h("style");
		style.textContent = `
			.hafif-cite { display: flex; flex-direction: column; gap: 8px; padding: 2px 0 6px; }
			.hafif-cite select { width: 100%; }
			.hafif-cite .lbl { font-size: 11px; opacity: .65; text-transform: uppercase; letter-spacing: .04em; }
			.hafif-cite .box { padding: 6px 8px; border-radius: 6px; background: var(--fill-quinary, #8881);
				font-size: 13px; line-height: 1.45; user-select: text; }
			.hafif-cite .box .csl-entry { margin: 0; }
			.hafif-cite .row { display: flex; gap: 6px; }
			.hafif-cite .row button { flex: 1; }
		`;
		let wrap = h("div", "hafif-cite");
		let select = h("select");
		let cit = h("div", "box");
		let bib = h("div", "box");
		let row = h("div", "row");
		let bCit = h("button", null, "Atfı kopyala");
		let bBib = h("button", null, "Kaynakçayı kopyala");
		row.append(bCit, bBib);
		wrap.append(select, h("div", "lbl", "Atıf"), cit, h("div", "lbl", "Kaynakça"), bib, row);
		body.append(style, wrap);

		body._hafif = { select, cit, bib, bCit, bBib, current: null };
		select.addEventListener("change", Hafif.safe(() => {
			Hafif.pref("citeStyle", select.value);
			if (body._hafif.item) return this.render({ body, item: body._hafif.item });
		}));
		bCit.addEventListener("click", Hafif.safe(() => {
			let f = body._hafif.current;
			if (f) Hafif.copy(f.citation.html, f.citation.text, "Atıf kopyalandı");
		}));
		bBib.addEventListener("click", Hafif.safe(() => {
			let f = body._hafif.current;
			if (f) Hafif.copy(f.bibliography.html, f.bibliography.text, "Kaynakça girdisi kopyalandı");
		}));
	},

	async render({ body, item, setSectionSummary }) {
		let ui = body._hafif;
		if (!ui || !item?.isRegularItem()) return;
		ui.item = item;
		await this.ready();
		if (!ui.select.options.length) {
			for (let s of Zotero.Styles.getVisible()) {
				let o = body.ownerDocument.createElementNS("http://www.w3.org/1999/xhtml", "option");
				o.textContent = s.title;
				o.value = s.styleID;
				ui.select.append(o);
			}
		}
		ui.select.value = this.styleID();
		let f;
		try {
			f = this.format(item, ui.select.value);
		}
		catch (e) {
			Zotero.logError(e);
			ui.cit.textContent = "Atıf üretilemedi: " + e.message;
			ui.bib.textContent = "";
			return;
		}
		ui.current = f;
		this._setHTML(ui.cit, f.citation.html);
		this._setHTML(ui.bib, f.bibliography.html);
		setSectionSummary?.(f.citation.text);
	},

	/** citeproc çıktısını güvenli biçimde yerleştirir (yalnızca biçim etiketleri kalır). */
	_setHTML(el, html) {
		let doc = new el.ownerGlobal.DOMParser().parseFromString(html || "", "text/html");
		for (let bad of doc.querySelectorAll("script, style, iframe, object, embed, link")) bad.remove();
		for (let node of doc.body.querySelectorAll("*")) {
			for (let a of [...node.attributes]) if (/^on/i.test(a.name) || a.name === "href") node.removeAttribute(a.name);
		}
		el.replaceChildren(...[...doc.body.childNodes].map(n => el.ownerDocument.importNode(n, true)));
	},
};
