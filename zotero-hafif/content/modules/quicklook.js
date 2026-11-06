/* Hızlı Bakış (macOS Quick Look gibi): kayıt listesinde bir kayıt seçiliyken boşluk tuşu,
 * ekinin bütün sayfalarını kaydırılabilir bir pencerede gösterir. Pencere açıkken ↑↓ ya da
 * tıklamayla başka kayda geçilince önizleme de değişir. Boşluk ya da esc kapatır.
 * PDF, resim, web sayfası anlık görüntüsü ve not önizlenir; dosyası olmayan kayıtta künye ve
 * özet gösterilir. Sayfalar Zotero okuyucusunun pdf.js'iyle çizilir (windows/quicklook.mjs). */

Hafif.modules.quicklook = {
	_ui: new WeakMap(),
	_bound: new WeakMap(),
	HTML: "http://www.w3.org/1999/xhtml",
	TYPING_GAP: 1200,

	// ---- Pencereye bağlama ----

	bind(win) {
		if (this._bound.get(win)) return;
		let st = { lastType: 0 };
		let tree = () => win.document.getElementById("zotero-items-tree");
		let editable = (t) => t?.closest?.("input, textarea, [contenteditable], search-textbox, editable-text") || t?.localName === "input";
		let inTree = (t) => !!tree()?.contains(t);

		st.keydown = (e) => {
			if (Hafif.pref("quickLook") === false) return;
			let open = this._ui.get(win)?.open;
			let mods = e.metaKey || e.ctrlKey || e.altKey;
			let t = e.target;
			if (inTree(t) && e.key.length === 1 && e.key !== " " && !mods) st.lastType = Date.now();
			if (e.key === " " && !mods && !e.repeat) {
				if (editable(t)) return;
				if (open) {
					e.preventDefault();
					e.stopPropagation();
					this.close(win);
				}
				else if (inTree(t) && Date.now() - st.lastType > this.TYPING_GAP) {
					// Liste içinde yazarak arama sürerken boşluk aramaya aittir
					e.preventDefault();
					e.stopPropagation();
					Hafif.safe(() => this.open(win))();
				}
			}
			else if (e.key === "Escape" && open && !mods) {
				e.preventDefault();
				e.stopPropagation();
				this.close(win);
			}
		};
		// Açıkken başka kayda geçilince önizleme güncellenir
		st.follow = (e) => {
			if (!this._ui.get(win)?.open || !inTree(e.target)) return;
			if (e.type === "keyup" && !["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) return;
			win.clearTimeout(st.followTimer);
			st.followTimer = win.setTimeout(() => Hafif.safe(() => this.update(win))(), 60);
		};
		win.addEventListener("keydown", st.keydown, true);
		win.addEventListener("keyup", st.follow, true);
		win.addEventListener("mouseup", st.follow, true);
		this._bound.set(win, st);
	},

	unbind(win) {
		let st = this._bound.get(win);
		if (!st) return;
		win.removeEventListener("keydown", st.keydown, true);
		win.removeEventListener("keyup", st.follow, true);
		win.removeEventListener("mouseup", st.follow, true);
		this._bound.delete(win);
		this.destroy(win);
	},

	shutdown() {
		for (let win of Zotero.getMainWindows()) this.unbind(win);
		if (this._tabObs) Zotero.Notifier.unregisterObserver(this._tabObs);
		this._tabObs = null;
	},

	// ---- Pencere ----

	_ensure(win) {
		let ui = this._ui.get(win);
		if (ui) return ui;
		let doc = win.document;
		let h = (tag, cls, text) => {
			let e = doc.createElementNS(this.HTML, tag);
			if (cls) e.className = cls;
			if (text != null) e.textContent = text;
			return e;
		};
		let style = h("style", null, this.CSS);
		doc.documentElement.append(style);
		let root = h("div", "hql");
		root.hidden = true;
		let head = h("div", "hql-head");
		let icon = h("span", "hql-icon");
		let titles = h("div", "hql-titles");
		let title = h("div", "hql-title");
		title.setAttribute("dir", "auto");
		let meta = h("div", "hql-meta");
		meta.setAttribute("dir", "auto");
		titles.append(title, meta);
		let openBtn = h("button", "hql-btn", "Aç");
		openBtn.title = "Okuyucuda aç";
		let close = h("button", "hql-btn x", "✕");
		close.title = "Kapat (boşluk / esc)";
		head.append(icon, titles, openBtn, close);
		let frame = h("iframe", "hql-frame");
		frame.setAttribute("src", "chrome://hafif/content/windows/quicklook.html");
		root.append(head, frame);
		doc.documentElement.append(root);
		ui = { root, style, head, icon, title, meta, openBtn, frame, open: false, item: null, target: null };
		this._ui.set(win, ui);
		close.addEventListener("click", () => this.close(win));
		openBtn.addEventListener("click", Hafif.safe(() => this._openExternal(win)));
		head.addEventListener("dblclick", Hafif.safe(() => this._openExternal(win)));
		if (!this._tabObs) {
			// Bir sekme açılınca (örn. ↵ ile okuyucu) önizleme kapanır
			this._tabObs = Zotero.Notifier.registerObserver({
				notify: (event, type) => {
					if (type !== "tab" || event !== "select") return;
					for (let w of Zotero.getMainWindows()) if (this._ui.get(w)?.open) this.close(w);
				},
			}, ["tab"], "hafif-quicklook");
		}
		return ui;
	},

	destroy(win) {
		let ui = this._ui.get(win);
		if (!ui) return;
		ui.root.remove();
		ui.style.remove();
		this._ui.delete(win);
	},

	/** Önizleme sayfasının hazır olmasını bekler. */
	async _ql(ui) {
		for (let i = 0; i < 100; i++) {
			let w = ui.frame.contentWindow;
			if (w?.QL?.ready) {
				w.QL.onClose = () => this.close(ui.root.ownerGlobal);
				return w;
			}
			await new Promise(r => ui.root.ownerGlobal.setTimeout(r, 50));
		}
		throw new Error("Önizleme açılamadı.");
	},

	/** pdf.js çizicisi hazır mı (modül yüklenemezse 1,5 sn sonra vazgeçilir). */
	async _pdfReady(ql) {
		for (let i = 0; i < 30; i++) {
			if (ql.QL.pdfReady) return true;
			await new Promise(r => ql.setTimeout(r, 50));
		}
		Zotero.debug("[Hafif] Hızlı Bakış: pdf.js yüklenemedi, yedek çizici kullanılıyor");
		return false;
	},

	async open(win) {
		let item = this._selected(win);
		if (!item) return;
		let ui = this._ensure(win);
		ui.open = true;
		ui.root.hidden = false;
		ui.root.classList.remove("in");
		void ui.root.offsetWidth;
		ui.root.classList.add("in");
		await this.show(win, item);
	},

	/** Listedeki seçimden bağımsız olarak belirli bir kaydı önizler (yüzer kitaplıktan). */
	async openItem(win, item) {
		if (!item) return;
		let ui = this._ensure(win);
		if (ui.open && ui.item?.id === item.id) return this.close(win);
		ui.open = true;
		ui.pinnedItem = true;
		ui.root.hidden = false;
		ui.root.classList.remove("in");
		void ui.root.offsetWidth;
		ui.root.classList.add("in");
		await this.show(win, item);
	},

	close(win) {
		let ui = this._ui.get(win);
		if (!ui?.open) return;
		ui.open = false;
		ui.root.hidden = true;
		ui.item = null;
		ui.pinnedItem = false;
		ui.frame.contentWindow?.QL?.reset?.();
		// Odak geldiği listeye dönsün
		let back = Hafif.modules.leftfloat?._state.get(win);
		if (back?.open && back.root.contains(win.document.activeElement)) back.list.focus();
		else if (win.Zotero_Tabs.selectedType === "library") win.document.getElementById("zotero-items-tree")?.querySelector(".virtualized-table")?.focus();
	},

	toggle(win) {
		this._ui.get(win)?.open ? this.close(win) : this.open(win);
	},

	async update(win) {
		let ui = this._ui.get(win);
		if (!ui?.open) return;
		if (ui.pinnedItem) return;
		let item = this._selected(win);
		if (item && item.id !== ui.item?.id) await this.show(win, item);
	},

	_selected(win) {
		let items = win.ZoteroPane?.getSelectedItems?.() || [];
		return items[0] || null;
	},

	// ---- İçerik ----

	async show(win, item) {
		let ui = this._ensure(win);
		ui.item = item;
		let T = Hafif.load("libtools");
		let top = item.isRegularItem() ? item : (item.parentItem || item);
		let target = item.isRegularItem() ? await T.documentOf(item) || await this._anyFile(item) : item;
		ui.target = target;
		if (ui.item !== item) return;

		// Başlık
		let title = top.isNote() ? top.getNoteTitle() : top.getDisplayTitle();
		ui.title.textContent = title || "(başlıksız)";
		let metaParts = [];
		if (top.isRegularItem()) {
			let a = T.creatorsShort(top, 2);
			let y = T.year(top);
			if (a) metaParts.push(a);
			if (y) metaParts.push(y);
		}
		if (target && target !== top && target.isAttachment?.()) metaParts.push(target.getField("title"));
		ui.meta.textContent = metaParts.join(" · ");
		ui.icon.textContent = target?.isPDFAttachment?.() ? "PDF" : target?.isEPUBAttachment?.() ? "EPUB" : target?.isNote?.() ? "NOT" : target?.isAttachment?.() ? "DOSYA" : "KÜNYE";
		ui.openBtn.hidden = !target || target.isNote?.();

		let ql = await this._ql(ui);
		if (ui.item !== item) return;
		if (!target) return ql.QL.openCard(this._card(top));
		if (target.isNote()) return ql.QL.openHTML({ html: this._noteHTML(target) });
		let path = await target.getFilePathAsync();
		if (!path) {
			return ql.QL.openCard({ ...this._card(top), meta: "Dosya bu bilgisayarda yok (eşitlenmemiş ya da taşınmış)." });
		}
		let type = target.attachmentContentType || "";
		if (target.isPDFAttachment()) {
			if (await this._pdfReady(ql)) {
				let bytes = await IOUtils.read(path);
				if (ui.item !== item) return;
				// Veri önizleme sayfasının kendi alanına kopyalanır (işçiye aktarılabilsin diye)
				return ql.QL.openPDF(new ql.Uint8Array(bytes));
			}
			// Yedek yol: pdf.js yüklenemediyse sayfalar Zotero'nun PDF işçisinden resim olarak gelir
			ql.QL.message("Yükleniyor…");
			let info = await Zotero.PDFWorker.getFullText(target.id, 1, true);
			if (ui.item !== item) return;
			let np = Hafif.load("notepreview");
			return ql.QL.openPages(info?.totalPages || 1, async i => (await np.renderPage(target, i)).url);
		}
		let url = PathUtils.toFileURI(path);
		if (type.startsWith("image/")) return ql.QL.openImage(url);
		if (type === "text/html" || type === "application/xhtml+xml" || type === "text/plain") return ql.QL.openHTML({ url });
		if (target.isEPUBAttachment?.()) {
			return ql.QL.openCard({ ...this._card(top), meta: "EPUB burada önizlenemiyor — “Aç” ile okuyucuda açın." });
		}
		return ql.QL.openCard({ ...this._card(top), meta: `${type || "Bu dosya türü"} önizlenemiyor — “Aç” ile kendi uygulamasında açın.` });
	},

	async _anyFile(item) {
		for (let id of item.getAttachments()) {
			let a = Zotero.Items.get(id);
			if (a?.isFileAttachment() && !a.deleted) return a;
		}
		return null;
	},

	_card(top) {
		if (!top.isRegularItem()) return { title: top.getDisplayTitle?.() || "", meta: "" };
		let T = Hafif.load("libtools");
		let fields = [];
		for (let f of ["publicationTitle", "bookTitle", "publisher", "place", "date", "pages", "numPages", "DOI", "ISBN", "language"]) {
			let v = "";
			try {
				v = top.getField(f);
			}
			catch (e) {}
			if (v) fields.push([Zotero.ItemFields.getLocalizedString(f), v]);
		}
		return {
			title: top.getField("title") || top.getDisplayTitle(),
			meta: [Zotero.ItemTypes.getLocalizedString(top.itemType), T.creatorsShort(top, 4)].filter(Boolean).join(" · "),
			abstract: top.getField("abstractNote"),
			fields,
		};
	},

	_noteHTML(note) {
		let body = note.getNote() || "";
		let doc = Hafif.load("notes")._parse(body);
		for (let bad of doc.querySelectorAll("script, style, iframe, object, embed, link, meta, form")) bad.remove();
		for (let img of doc.querySelectorAll("img[data-attachment-key]")) {
			let att = Zotero.Items.getByLibraryAndKey(note.libraryID, img.getAttribute("data-attachment-key"));
			let p = att?.getFilePath?.();
			if (p) img.setAttribute("src", PathUtils.toFileURI(p));
		}
		let css = `body{margin:0;padding:28px 34px 60px;max-width:760px;margin:0 auto;font:16px/1.65 "Iowan Old Style",Charter,Georgia,"Geeza Pro",serif;color:#23211c;background:#fffdf8}
h1,h2,h3{line-height:1.3}h1{font-size:1.5em}h2{font-size:1.25em}h3{font-size:1.08em}
blockquote{margin:1em 0;padding:.5em 1em;background:#f6f1e6;border-inline-start:3px solid #8a5a2b;border-radius:0 6px 6px 0}
img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 7px}.citation{color:#7a756a;font-size:.9em}
@media(prefers-color-scheme:dark){body{background:#23221f;color:#ece8df}blockquote{background:#2c2925;border-color:#d9a466}}`;
		return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body dir="auto">${doc.body.innerHTML}</body></html>`;
	},

	async _openExternal(win) {
		let ui = this._ui.get(win);
		let t = ui?.target;
		if (!t) return;
		let page = ui.frame.contentWindow?.QL?.page || 1;
		this.close(win);
		if (t.isPDFAttachment?.()) await Zotero.Reader.open(t.id, { pageIndex: page - 1 });
		else await win.ZoteroPane.viewItems([t]);
	},

	CSS: `
.hql { position: fixed; z-index: 25000; left: 50%; top: 50%; transform: translate(-50%, -50%);
	width: min(1000px, 92vw); height: min(88vh, 1200px); display: flex; flex-direction: column;
	background: var(--material-background, Canvas); border: 1px solid var(--fill-quinary, #8883); border-radius: 12px; overflow: hidden;
	box-shadow: 0 24px 70px rgba(0, 0, 0, .35), 0 2px 8px rgba(0, 0, 0, .18); }
.hql[hidden] { display: none; }
.hql.in { animation: hql-in .16s cubic-bezier(.2, .8, .2, 1); }
@keyframes hql-in { from { opacity: 0; transform: translate(-50%, -50%) scale(.965); } to { opacity: 1; transform: translate(-50%, -50%); } }
.hql-head { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 14px; border-bottom: 1px solid var(--fill-quinary, #8883); flex: none; -moz-user-select: none; }
.hql-icon { flex: none; font: 700 9.5px/1 -apple-system, system-ui, sans-serif; letter-spacing: .06em; color: var(--fill-secondary, #777);
	border: 1px solid var(--fill-quinary, #8884); border-radius: 4px; padding: 3px 5px; }
.hql-titles { flex: 1; min-width: 0; }
.hql-title { font-weight: 650; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hql-meta { font-size: 11.5px; color: var(--fill-secondary, #777); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hql-btn { flex: none; height: 26px; padding: 0 12px; border: 1px solid var(--fill-quinary, #8884); border-radius: 6px; background: none; color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
.hql-btn:hover { background: var(--fill-quinary, #8882); }
.hql-btn.x { width: 26px; padding: 0; border: 0; color: var(--fill-secondary, #777); }
.hql-btn[hidden] { display: none; }
.hql-frame { flex: 1; min-height: 0; width: 100%; border: 0; background: transparent; }
`,
};
