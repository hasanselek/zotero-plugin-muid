/* Literatür Ara'nın kütüphane içindeki görünümü: kayıt araç çubuğuna (yeni not düğmesinin yanına)
 * bir düğme eklenir; basınca arama ekranı ayrı pencerede değil, kayıt listesi ile sağ panelin
 * yerinde açılır. Araç çubuğu görünür kalır; düğmeye yeniden basmak, bir koleksiyon seçmek ya da
 * hızlı arama kutusuna yazmak listeyi geri getirir. */

Hafif.modules.litview = {
	_state: new WeakMap(),
	HIDE: ["zotero-items-pane", "zotero-items-splitter", "zotero-item-pane", "zotero-advanced-search-pane-deck"],

	/** Düğmeyi pencereye ekler (pencere açılışında). */
	attach(win) {
		if (this._state.get(win)) return;
		let doc = win.document;
		let note = doc.getElementById("zotero-tb-note-add");
		if (!note) return;
		let st = { open: false, listeners: [] };
		this._state.set(win, st);
		st.style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
		st.style.textContent = `
#hafif-tb-litsearch { list-style-image: url("chrome://hafif/content/icons/litsearch.svg"); fill: currentColor; -moz-context-properties: fill, fill-opacity; }
#hafif-tb-hub { list-style-image: url("chrome://hafif/content/icons/hub.svg"); fill: currentColor; -moz-context-properties: fill, fill-opacity; }
#hafif-tb-litsearch[checked="true"] { background: var(--fill-quinary, #8883); border-radius: 5px; }
#hafif-litview { flex: 1; min-height: 0; min-width: 0; width: 100%; border: 0; background: var(--material-background, Canvas); }`;
		doc.documentElement.append(st.style);
		let b = st.button = doc.createXULElement("toolbarbutton");
		b.id = "hafif-tb-litsearch";
		b.className = "zotero-tb-button";
		b.setAttribute("tabindex", "-1");
		b.setAttribute("tooltiptext", "Literatür ara (YÖK Tez, DergiPark, TDV İslâm Ansiklopedisi, OpenAlex)");
		note.after(b);
		// Hafif Merkezi: vurgular, tekrar, okuma, projeler, künye denetimi
		let hub = st.hubButton = doc.createXULElement("toolbarbutton");
		hub.id = "hafif-tb-hub";
		hub.className = "zotero-tb-button";
		hub.setAttribute("tabindex", "-1");
		hub.setAttribute("tooltiptext", "Hafif Merkezi — vurgular, tekrar, okuma, yazım projeleri, künye denetimi");
		hub.addEventListener("command", Hafif.safe(() => Hafif.load("hub").open()));
		b.after(hub);
		let on = (t, type, fn, opts) => {
			if (!t) return;
			t.addEventListener(type, fn, opts);
			st.listeners.push([t, type, fn, opts]);
		};
		on(b, "command", () => this.toggle(win));
		// Kütüphaneye dönüş: koleksiyon seçmek ya da hızlı aramaya yazmak listeyi geri getirir
		on(doc.getElementById("zotero-collections-tree"), "mousedown", () => this.close(win));
		on(doc.getElementById("zotero-tb-search"), "keydown", () => this.close(win));
		for (let id of ["zotero-tb-add", "zotero-tb-lookup", "zotero-tb-attachment-add", "zotero-tb-note-add"]) {
			on(doc.getElementById(id), "mousedown", () => this.close(win));
		}
	},

	detach(win) {
		let st = this._state.get(win);
		if (!st) return;
		this.close(win);
		for (let [t, type, fn, opts] of st.listeners) t.removeEventListener(type, fn, opts);
		st.button?.remove();
		st.hubButton?.remove();
		st.frame?.remove();
		st.style?.remove();
		this._state.delete(win);
	},

	shutdown() {
		for (let win of Zotero.getMainWindows()) this.detach(win);
	},

	isOpen(win) {
		return !!this._state.get(win)?.open;
	},

	toggle(win) {
		this.isOpen(win) ? this.close(win) : this.open(win);
	},

	/** Arama ekranını kütüphanede açar; sorgu verilirse hemen arar. */
	async open(win = Zotero.getMainWindow(), query) {
		let st = this._state.get(win);
		if (!st) {
			this.attach(win);
			st = this._state.get(win);
		}
		if (!st) return Hafif.load("sources").openWindow(query);
		let doc = win.document;
		win.Zotero_Tabs?.select("zotero-pane");
		if (!st.frame) {
			let f = st.frame = doc.createElementNS("http://www.w3.org/1999/xhtml", "iframe");
			f.id = "hafif-litview";
			f.setAttribute("src", "chrome://hafif/content/windows/litsearch.xhtml");
			doc.getElementById("zotero-items-pane").after(f);
		}
		if (!st.open) {
			st.hidden = [];
			for (let id of this.HIDE) {
				let el = doc.getElementById(id);
				if (!el) continue;
				st.hidden.push([el, el.style.display]);
				el.style.display = "none";
			}
			st.frame.style.display = "";
			st.open = true;
			st.button.setAttribute("checked", "true");
		}
		let ls = await this._page(st);
		if (!ls) return Hafif.toast("Literatür Ara yüklenemedi.");
		ls.embedded(() => this.close(win));
		if (query) {
			ls.$("q").value = query;
			ls.run();
		}
		else ls?.$("q").focus();
	},

	close(win = Zotero.getMainWindow()) {
		let st = this._state.get(win);
		if (!st?.open) return;
		for (let [el, d] of st.hidden || []) el.style.display = d || "";
		st.hidden = [];
		if (st.frame) st.frame.style.display = "none";
		st.open = false;
		st.button.removeAttribute("checked");
		win.ZoteroPane?.updateLayoutConstraints?.();
	},

	async _page(st) {
		for (let i = 0; i < 100; i++) {
			let ls = st.frame.contentWindow?.LitSearch;
			if (ls?.ready) return ls;
			await new Promise(r => setTimeout(r, 50));
		}
		return null;
	},
};
