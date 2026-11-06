/* Notlarda sayfa önizlemesi: PDF'ten gelen vurgulu pasajın ya da atfının üzerinde fare
 * iki saniye durunca, kaynağın o sayfası küçük bir pencerede gösterilir ve vurgu sayfada
 * işaretlenir. Tıklayınca PDF o vurguda açılır.
 * Sayfa, Zotero'nun kendi PDF işçisiyle (pdf.renderArea) PNG olarak çizilir; vurgunun ve
 * atfın verisi düzenleyicinin ProseMirror modelinden okunur. */

Hafif.modules.notepreview = {
	DELAY: 2000,
	SCALE: 1.6,
	_cache: new Map(),
	_bound: new WeakSet(),
	_controllers: new Set(),

	attach(instance) {
		if (Hafif.pref("notePreview") === false) return;
		let win = instance._iframeWindow;
		if (!win || Components.utils.isDeadWrapper(win) || this._bound.has(win)) return;
		this._bound.add(win);
		let c = new this.Hover(win, this);
		this._controllers.add(c);
	},

	detachAll() {
		for (let c of this._controllers) c.destroy();
		this._controllers.clear();
		this._bound = new WeakSet();
	},

	shutdown() {
		this.detachAll();
		this._cache.clear();
	},

	// ---- Sayfa çizimi ----

	/** Sayfanın PNG'si: { url, w, h } (w/h: ölçekli piksel). Son 20 sayfa bellekte tutulur. */
	async renderPage(att, pageIndex) {
		let key = `${att.id}:${pageIndex}:${await att.attachmentHash}`;
		let hit = this._cache.get(key);
		if (hit) return hit;
		let path = await att.getFilePathAsync();
		if (!path) throw new Error("PDF dosyası bu bilgisayarda yok.");
		let W = Zotero.PDFWorker;
		let res = await W._enqueue(async () => {
			W._init();
			let buf = new Uint8Array(await IOUtils.read(path)).buffer;
			// Dev bir dikdörtgen işçi tarafında sayfa sınırlarına kırpılır: bütün sayfa çizilir
			return W._query("pdf.renderArea", { buf, pageIndex, rect: [-1e6, -1e6, 1e6, 1e6], scale: this.SCALE }, [buf]);
		}, true);
		if (!res?.buf) throw new Error("Sayfa çizilemedi.");
		let bytes = new Uint8Array(res.buf);
		let bin = "";
		for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
		let url = "data:image/png;base64," + Zotero.getMainWindow().btoa(bin);
		let size = await new Promise((resolve) => {
			let img = new (Zotero.getMainWindow().Image)();
			img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
			img.onerror = () => resolve({ w: 0, h: 0 });
			img.src = url;
		});
		let out = { url, ...size };
		this._cache.set(key, out);
		if (this._cache.size > 20) this._cache.delete(this._cache.keys().next().value);
		return out;
	},

	/** Önizlenecek yerin bilgisi: { att, pageIndex, rects, pageLabel, annotationKey, label } */
	async resolve({ annotation, citation }) {
		let att = null;
		let pageIndex = null;
		let rects = null;
		let pageLabel = null;
		let annotationKey = null;
		if (annotation) {
			att = annotation.attachmentURI && await Zotero.URI.getURIItem(annotation.attachmentURI);
			annotationKey = annotation.annotationKey;
			let live = att && annotationKey && Zotero.Items.getByLibraryAndKey(att.libraryID, annotationKey);
			let pos = live ? JSON.parse(live.annotationPosition) : annotation.position;
			pageIndex = pos?.pageIndex;
			rects = pos?.rects || null;
			pageLabel = live?.annotationPageLabel || annotation.pageLabel;
		}
		let item = null;
		let ci = citation?.citationItems?.[0];
		if (ci?.uris?.[0]) item = await Zotero.URI.getURIItem(ci.uris[0]);
		if (!att && item) {
			att = await Hafif.load("libtools").documentOf(item);
			pageLabel = ci.locator || null;
			if (att?.isPDFAttachment() && pageLabel) {
				// Basılı sayfa numarasından PDF sayfasına: aynı sayfadaki bir vurgudan ya da sayıdan
				let ann = att.getAnnotations().find(a => a.annotationPageLabel === String(pageLabel));
				if (ann) pageIndex = JSON.parse(ann.annotationPosition).pageIndex;
				else if (/^\d+$/.test(pageLabel)) pageIndex = +pageLabel - 1;
			}
		}
		if (!att?.isPDFAttachment() || pageIndex == null) return null;
		let top = item || att.parentItem || att;
		let T = Hafif.load("libtools");
		let label = top.isRegularItem?.() ? `${T.creatorsShort(top, 1)} ${T.year(top)}`.trim() : top.getDisplayTitle();
		return { att, pageIndex, rects, pageLabel: pageLabel || String(pageIndex + 1), annotationKey, label: label || top.getDisplayTitle() };
	},
};

/** Bir not düzenleyici penceresinde fareyi izler ve önizlemeyi gösterir. */
Hafif.modules.notepreview.Hover = class {
	constructor(win, mod) {
		this.win = win;
		this.doc = win.document;
		this.mod = mod;
		this.timer = 0;
		this.target = null;
		this.popup = null;
		this._listeners = [];
		let on = (t, type, fn, opts) => {
			t.addEventListener(type, fn, opts);
			this._listeners.push([t, type, fn, opts]);
		};
		on(this.doc, "mouseover", (e) => this._over(e));
		on(this.doc, "mouseout", (e) => this._out(e));
		on(this.doc, "mousedown", (e) => {
			if (!this.popup?.contains(e.target)) this._clear(true);
		}, true);
		on(this.doc, "keydown", () => this._clear(true), true);
		on(this.doc, "scroll", (e) => {
			if (!this.popup?.contains(e.target)) this._clear(true);
		}, true);
		on(win, "unload", () => this.destroy());
		this.style = this.doc.createElement("style");
		this.style.textContent = this.CSS;
		this.doc.head.append(this.style);
	}

	destroy() {
		this._clear(true);
		for (let [t, type, fn, opts] of this._listeners) {
			try {
				t.removeEventListener(type, fn, opts);
			}
			catch (e) {}
		}
		try {
			this.style.remove();
		}
		catch (e) {}
		this.mod._controllers.delete(this);
	}

	get view() {
		try {
			return this.win.wrappedJSObject._currentEditorInstance?._editorCore?.view || null;
		}
		catch (e) {
			return null;
		}
	}

	_spanOf(el) {
		return el?.closest?.("span.highlight, span.citation") || null;
	}

	_over(e) {
		if (this.popup?.contains(e.target)) {
			this.win.clearTimeout(this._hideTimer);
			return;
		}
		let span = this._spanOf(e.target);
		if (!span) return;
		this.win.clearTimeout(this._hideTimer);
		if (span === this.target) return;
		this._clear(true);
		this.target = span;
		this.timer = this.win.setTimeout(() => this._show(span).catch(err => Zotero.logError(err)), this.mod.DELAY);
	}

	_out(e) {
		let inside = (n) => !!n && (this._spanOf(n) === this.target || !!this.popup?.contains(n));
		if (!this.target || inside(e.relatedTarget) || !inside(e.target)) return;
		if (this.popup) {
			// Fare vurgudan önizlemeye geçebilsin diye kısa bir süre tanınır
			this.win.clearTimeout(this._hideTimer);
			this._hideTimer = this.win.setTimeout(() => this._clear(true), 350);
		}
		else this._clear(false);
	}

	_clear(hide) {
		this.win.clearTimeout(this.timer);
		this.timer = 0;
		this.target = null;
		if (hide && this.popup) {
			this.popup.remove();
			this.popup = null;
		}
	}

	/** Fare altındaki öğenin ProseMirror verisi: vurgu ve/veya atıf. */
	_dataFor(span) {
		let v = this.view;
		if (!v) return null;
		let J = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);
		let pos;
		try {
			pos = v.posAtDOM(span, 0);
		}
		catch (e) {
			return null;
		}
		let doc = v.state.doc;
		let annotation = null, citation = null;
		if (span.classList.contains("citation")) {
			let node = doc.nodeAt(pos) || doc.nodeAt(pos - 1);
			if (node?.type.name !== "citation") {
				let $p = doc.resolve(pos);
				node = $p.nodeAfter?.type.name === "citation" ? $p.nodeAfter : $p.nodeBefore;
			}
			citation = J(node?.attrs?.citation);
			// Zotero'nun “nota ekle” çıktısında atıf vurgunun hemen ardından gelir
			let prev = span.previousElementSibling;
			if (prev?.classList.contains("highlight")) annotation = this._highlightAt(v, prev);
		}
		else annotation = this._highlightAt(v, span);
		if (!annotation && !citation) return null;
		return { annotation, citation };
	}

	_highlightAt(v, span) {
		let J = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);
		try {
			let $p = v.state.doc.resolve(v.posAtDOM(span, 0));
			for (let d = $p.depth; d >= 0; d--) {
				let n = $p.node(d);
				if (n.type.name === "highlight") return J(n.attrs.annotation);
			}
			let after = $p.nodeAfter;
			if (after?.type.name === "highlight") return J(after.attrs.annotation);
		}
		catch (e) {}
		return null;
	}

	async _show(span) {
		if (!span.isConnected || this.target !== span) return;
		let data = this._dataFor(span);
		if (!data) return;
		let info = await this.mod.resolve(data);
		if (!info || this.target !== span) return;
		let d = this.doc;
		let el = (tag, cls, text) => {
			let x = d.createElement(tag);
			if (cls) x.className = cls;
			if (text != null) x.textContent = text;
			return x;
		};
		let pop = el("div", "hnp");
		let head = el("div", "hnp-head");
		head.append(el("span", "hnp-src", `${info.label} · s. ${info.pageLabel}`));
		let open = el("button", "hnp-open", "PDF'te aç ↗");
		open.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			let loc = info.annotationKey ? { annotationID: info.annotationKey } : { pageIndex: info.pageIndex };
			Zotero.Reader.open(info.att.id, loc).catch(err => Zotero.logError(err));
			this._clear(true);
		});
		head.append(open);
		let body = el("div", "hnp-body");
		let wrap = el("div", "hnp-page");
		let wait = el("div", "hnp-wait", "Sayfa hazırlanıyor…");
		wrap.append(wait);
		body.append(wrap);
		pop.append(head, body);
		this._clear(true);
		this.target = span;
		this.popup = pop;
		d.body.append(pop);
		this._position(pop, span);

		let page;
		try {
			page = await this.mod.renderPage(info.att, info.pageIndex);
		}
		catch (e) {
			wait.textContent = e.message;
			return;
		}
		if (this.popup !== pop) return;
		let img = el("img", "hnp-img");
		img.src = page.url;
		wrap.replaceChildren(img);
		// Vurgunun dikdörtgenleri: PDF koordinatı (y yukarı) → resim yüzdesi
		let S = this.mod.SCALE;
		let pw = page.w / S, ph = page.h / S;
		let first = null;
		for (let r of info.rects || []) {
			let box = el("div", "hnp-mark");
			let left = r[0] / pw, top = (ph - r[3]) / ph;
			box.style.left = left * 100 + "%";
			box.style.top = top * 100 + "%";
			box.style.width = (r[2] - r[0]) / pw * 100 + "%";
			box.style.height = (r[3] - r[1]) / ph * 100 + "%";
			wrap.append(box);
			if (first == null || top < first) first = top;
		}
		img.addEventListener("load", () => {
			// Vurgu görünür alanın ortasına gelsin
			if (first != null) body.scrollTop = Math.max(0, first * img.clientHeight - body.clientHeight / 3);
			this._position(pop, span);
		}, { once: true });
	}

	_position(pop, span) {
		let W = this.win.innerWidth, H = this.win.innerHeight;
		let w = Math.min(460, W - 16);
		pop.style.width = w + "px";
		let r = span.getClientRects()[0] || span.getBoundingClientRect();
		let left = Math.max(8, Math.min(r.left, W - w - 8));
		pop.style.left = left + "px";
		let ph = pop.getBoundingClientRect().height || 360;
		let below = H - r.bottom - 8;
		let top = below >= ph || below >= r.top ? r.bottom + 6 : Math.max(8, r.top - ph - 6);
		pop.style.top = Math.min(top, H - Math.min(ph, H - 16) - 8) + "px";
	}
};

Hafif.modules.notepreview.Hover.prototype.CSS = `
.hnp { position: fixed; z-index: 2147483002; display: flex; flex-direction: column; max-height: min(440px, calc(100vh - 16px));
	background: #fffdf8; color: #23211c; border: 1px solid #e0dbd0; border-radius: 10px; overflow: hidden;
	box-shadow: 0 10px 32px rgba(40, 30, 10, .22), 0 1px 3px rgba(40, 30, 10, .14);
	font: 12px/1.35 -apple-system, "Segoe UI", system-ui, sans-serif; animation: hnp-in .14s ease-out; }
@keyframes hnp-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
.hnp-head { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 10px; border-bottom: 1px solid #e0dbd0; }
.hnp-src { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hnp-open { all: unset; cursor: pointer; font-size: 11.5px; color: #8a5a2b; padding: 2px 6px; border-radius: 5px; }
.hnp-open:hover { background: #f1e4d3; }
.hnp-body { overflow-y: auto; min-height: 0; background: #f3f1ec; }
.hnp-page { position: relative; line-height: 0; }
.hnp-img { width: 100%; height: auto; display: block; }
.hnp-mark { position: absolute; background: rgba(255, 196, 0, .32); outline: 1.5px solid rgba(214, 140, 0, .9); border-radius: 2px; pointer-events: none; }
.hnp-wait { line-height: 1.4; padding: 40px 12px; text-align: center; color: #7a756a; }
@media (prefers-color-scheme: dark) {
	.hnp { background: #2a2925; color: #ece8df; border-color: #3a3833; }
	.hnp-head { border-color: #3a3833; }
	.hnp-open { color: #d9a466; }
	.hnp-open:hover { background: #3a2f22; }
	.hnp-body { background: #1d1c1a; }
	.hnp-wait { color: #9b958a; }
}
`;
