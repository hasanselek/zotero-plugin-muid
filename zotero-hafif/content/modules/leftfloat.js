/* Yüzer kitaplık: sekme çubuğunun en solundaki düğmeyle açılan küçük çerçeve.
 * Zotero'nun koleksiyon paneli kapatılır (kayıt listesi bütün genişliği alır); onun yerine
 * pencerenin en üst katmanında duran kendi gezginimiz gösterilir. Böylece çerçeve hiçbir
 * listenin altında kalmaz ve okuyucu, EPUB ya da not sekmesindeyken de açılır.
 * Gezgin: kütüphaneler › koleksiyonlar › alt koleksiyonlar ve eserler. Esere tıklamak PDF/EPUB'u
 * okuyucuda, notu not penceresinde açar; boşluk Hızlı Bakış'ı açar. Kütüphane sekmesindeyken
 * koleksiyona tıklamak onu Zotero'da da seçer. Üstteki kutu bütün kütüphanede arar. */

Hafif.modules.leftfloat = {
	_state: new WeakMap(),
	_notifier: null,
	SVG: "http://www.w3.org/2000/svg",
	HTML: "http://www.w3.org/1999/xhtml",

	enabled() {
		return Hafif.pref("leftFloat") === true;
	},

	toggleEnabled() {
		let on = !this.enabled();
		Hafif.pref("leftFloat", on);
		for (let win of Zotero.getMainWindows()) on ? this.apply(win) : this.remove(win);
		Hafif.toast(on ? "Yüzer kitaplık açık: sekme çubuğunun solundaki düğmeyle açılır." : "Sol panel normale döndü.", 2400);
	},

	_json(key, def) {
		try {
			return JSON.parse(Hafif.pref(key) || "null") ?? def;
		}
		catch (e) {
			return def;
		}
	},

	// ---- Kurulum ----

	apply(win) {
		if (this._state.get(win)) return;
		let doc = win.document;
		let pane = doc.getElementById("zotero-collections-pane");
		let h = (tag, cls, text) => {
			let e = doc.createElementNS(this.HTML, tag);
			if (cls) e.className = cls;
			if (text != null) e.textContent = text;
			return e;
		};
		let g = this._json("leftFloatGeom", {});
		let st = {
			open: false,
			wasCollapsed: pane?.getAttribute("collapsed") === "true",
			geom: { left: g.left ?? 8, top: g.top ?? null, width: g.width || 300, height: g.height || null },
			expanded: new Set(this._json("leftFloatExpanded", [])),
			query: "",
			sel: -1,
			rows: [],
			listeners: [],
		};
		this._state.set(win, st);

		// Zotero'nun koleksiyon paneli kapatılır: Görünüm menüsündeki gibi
		this._setZoteroPane(win, true);

		st.style = h("style", null, this.CSS);
		doc.documentElement.append(st.style);

		// Sekme çubuğunun en solundaki düğme
		st.button = h("button", "hlf-btn");
		st.button.title = "Kitaplık";
		st.button.setAttribute("aria-pressed", "false");
		st.button.append(this._icon(doc, [
			["rect", { x: "1.75", y: "2.75", width: "12.5", height: "10.5", rx: "2" }],
			["path", { d: "M6.25 2.75v10.5M3.5 5.5h1.25M3.5 7.75h1.25" }],
		], 16));
		(doc.getElementById("tab-bar-container") || doc.getElementById("zotero-title-bar"))?.prepend(st.button);

		// Çerçeve: pencerenin en üst katmanında
		let root = st.root = h("div", "hlf");
		root.hidden = true;
		let head = h("div", "hlf-head");
		head.append(h("span", "hlf-grip", "⠿"), h("span", "hlf-title", "Kitaplık"));
		let close = h("button", "hlf-x", "–");
		close.title = "Küçült";
		head.append(close);
		let search = st.search = h("input", "hlf-search");
		search.type = "search";
		search.placeholder = "Eser, yazar ya da koleksiyon ara…";
		search.setAttribute("dir", "auto");
		let list = st.list = h("div", "hlf-list");
		list.tabIndex = 0;
		let foot = h("div", "hlf-foot", "Tıkla: aç · boşluk: hızlı bakış · ⌥ tıkla: kütüphanede göster");
		let resize = h("div", "hlf-resize");
		resize.title = "Boyutlandır";
		root.append(head, search, list, foot, resize);
		doc.documentElement.append(root);

		let on = (t, type, fn, opts) => {
			t.addEventListener(type, fn, opts);
			st.listeners.push([t, type, fn, opts]);
		};
		on(st.button, "click", () => this.toggle(win));
		on(close, "click", (e) => {
			e.stopPropagation();
			this.close(win);
		});
		on(head, "mousedown", (e) => this._drag(win, e));
		on(resize, "mousedown", (e) => this._resize(win, e));
		on(win, "resize", () => this._applyGeom(win));
		on(search, "input", () => {
			st.query = search.value.trim();
			st.sel = -1;
			this.render(win);
		});
		on(search, "keydown", (e) => {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				list.focus();
				this._moveSel(win, 1);
			}
			else if (e.key === "Enter" && st.rows.length) {
				e.preventDefault();
				this._activate(win, st.rows[Math.max(0, st.sel)], e);
			}
			else if (e.key === "Escape") {
				e.preventDefault();
				if (search.value) {
					search.value = "";
					st.query = "";
					this.render(win);
				}
				else this.close(win);
			}
		});
		on(list, "click", (e) => this._onClick(win, e));
		on(list, "dblclick", (e) => this._onDblClick(win, e));
		on(list, "keydown", (e) => this._onKey(win, e));
		this._watch();
		this._applyGeom(win);
	},

	remove(win) {
		let st = this._state.get(win);
		if (!st) return;
		for (let [t, type, fn, opts] of st.listeners) t.removeEventListener(type, fn, opts);
		for (let el of [st.button, st.root, st.style]) el?.remove();
		if (!st.wasCollapsed) this._setZoteroPane(win, false);
		this._state.delete(win);
	},

	shutdown() {
		for (let win of Zotero.getMainWindows()) this.remove(win);
		if (this._notifier) Zotero.Notifier.unregisterObserver(this._notifier);
		this._notifier = null;
	},

	_setZoteroPane(win, collapsed) {
		let doc = win.document;
		let pane = doc.getElementById("zotero-collections-pane");
		if (!pane) return;
		doc.getElementById("zotero-collections-splitter")?.setAttribute("state", collapsed ? "collapsed" : "open");
		pane.setAttribute("collapsed", collapsed ? "true" : "false");
		win.ZoteroPane?.updateLayoutConstraints?.();
	},

	_icon(doc, shapes, size) {
		let svg = doc.createElementNS(this.SVG, "svg");
		svg.setAttribute("viewBox", "0 0 16 16");
		svg.setAttribute("width", size);
		svg.setAttribute("height", size);
		for (let [tag, attrs] of shapes) {
			let el = doc.createElementNS(this.SVG, tag);
			for (let [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
			el.setAttribute("fill", "none");
			el.setAttribute("stroke", "currentColor");
			el.setAttribute("stroke-width", "1.3");
			el.setAttribute("stroke-linecap", "round");
			svg.append(el);
		}
		return svg;
	},

	/** Kütüphane değişince açık çerçeveler tazelenir. */
	_watch() {
		if (this._notifier) return;
		this._notifier = Zotero.Notifier.registerObserver({
			notify: () => {
				for (let win of Zotero.getMainWindows()) {
					let st = this._state.get(win);
					if (!st?.open) continue;
					win.clearTimeout(st.refresh);
					st.refresh = win.setTimeout(() => this.render(win), 300);
				}
			},
		}, ["item", "collection", "collection-item"], "hafif-leftfloat");
	},

	// ---- Açma / kapama ----

	toggle(win) {
		let st = this._state.get(win);
		if (!st) return false;
		st.open ? this.close(win) : this.open(win);
		return true;
	},

	open(win) {
		let st = this._state.get(win);
		if (!st || st.open) return;
		st.open = true;
		st.root.hidden = false;
		st.button.setAttribute("aria-pressed", "true");
		this._applyGeom(win);
		this.render(win);
		win.setTimeout(() => (st.query ? st.search : st.list).focus(), 0);
	},

	close(win) {
		let st = this._state.get(win);
		if (!st || !st.open) return;
		st.open = false;
		st.root.hidden = true;
		st.button.setAttribute("aria-pressed", "false");
	},

	// ---- Ağaç ----

	_libs() {
		return Zotero.Libraries.getAll().filter(l => l.libraryType === "user" || l.libraryType === "group");
	},

	_sortCols(cols) {
		return cols.filter(c => !c.deleted).sort((a, b) => a.name.localeCompare(b.name, "tr", { numeric: true }));
	},

	/** Görünür satırlar: { kind: "lib"|"col"|"item", id, depth, ... } */
	_rows(win) {
		let st = this._state.get(win);
		if (st.query) return this._searchRows(st.query);
		let rows = [];
		let walk = (col, depth) => {
			let key = "C" + col.id;
			let kids = this._sortCols(col.getChildCollections(false));
			let n = col.getChildItems(true, false).length;
			rows.push({ kind: "col", id: col.id, key, name: col.name, depth, count: n, expandable: kids.length > 0 || n > 0 });
			if (!st.expanded.has(key)) return;
			for (let k of kids) walk(k, depth + 1);
			let items = col.getChildItems(false, false).filter(i => !i.deleted && (i.isRegularItem() || i.isNote() || i.isAttachment()))
				.sort((a, b) => this._title(a).localeCompare(this._title(b), "tr", { numeric: true }));
			for (let it of items) rows.push({ kind: "item", id: it.id, item: it, depth: depth + 1 });
		};
		for (let lib of this._libs()) {
			let key = "L" + lib.libraryID;
			rows.push({ kind: "lib", id: lib.libraryID, key, name: lib.name, depth: 0, expandable: true });
			// Kütüphaneler varsayılan olarak açık; kapatılanlar "!" ile tutulur
			if (st.expanded.has("!" + key)) continue;
			for (let c of this._sortCols(Zotero.Collections.getByLibrary(lib.libraryID, false))) walk(c, 1);
		}
		return rows;
	},

	_searchRows(q) {
		let S = Hafif.load("search");
		let nq = S.normalize(q);
		let rows = [];
		for (let lib of this._libs()) {
			for (let c of Zotero.Collections.getByLibrary(lib.libraryID, true)) {
				if (!c.deleted && S.normalize(c.name).includes(nq)) {
					rows.push({ kind: "col", id: c.id, key: "C" + c.id, name: c.name, depth: 0, count: c.getChildItems(true, false).length, path: this._colPath(c) });
				}
			}
		}
		rows = rows.slice(0, 30);
		for (let e of S.query(q)) {
			let it = Zotero.Items.get(e.id);
			if (it && !it.deleted && !it.isAnnotation?.()) rows.push({ kind: "item", id: it.id, item: it, depth: 0 });
		}
		return rows;
	},

	_colPath(c) {
		let parts = [];
		for (let p = c.parentID && Zotero.Collections.get(c.parentID); p; p = p.parentID && Zotero.Collections.get(p.parentID)) parts.unshift(p.name);
		return parts.join(" › ");
	},

	_title(it) {
		return it.isNote() ? it.getNoteTitle() || "(boş not)" : it.getDisplayTitle() || "(başlıksız)";
	},

	/** Esere uygun açılış eki ve rozet. */
	_kindOf(it) {
		if (it.isNote()) return { badge: "NOT" };
		if (it.isAttachment()) return { badge: it.isPDFAttachment() ? "PDF" : it.isEPUBAttachment?.() ? "EPUB" : "EK", att: it };
		let best = null;
		for (let id of it.getAttachments()) {
			let a = Zotero.Items.get(id);
			if (!a || a.deleted) continue;
			if (a.isPDFAttachment()) {
				best = a;
				break;
			}
			if (!best && (a.isEPUBAttachment?.() || a.isSnapshotAttachment?.())) best = a;
		}
		return { badge: best ? (best.isPDFAttachment() ? "PDF" : best.isEPUBAttachment?.() ? "EPUB" : "WEB") : "", att: best };
	},

	render(win) {
		let st = this._state.get(win);
		if (!st?.open) return;
		if (st.query && Hafif.indexDirty !== false && !st.indexing) {
			// Arama dizini tembeldir: ilk aramada kurulur
			st.indexing = true;
			Hafif.load("search").buildIndex().then(() => {
				st.indexing = false;
				this.render(win);
			}).catch((e) => {
				st.indexing = false;
				Zotero.logError(e);
			});
		}
		let doc = win.document;
		let h = (tag, cls, text) => {
			let e = doc.createElementNS(this.HTML, tag);
			if (cls) e.className = cls;
			if (text != null) e.textContent = text;
			return e;
		};
		let rows = st.rows = this._rows(win);
		if (st.sel >= rows.length) st.sel = rows.length - 1;
		let scroll = st.list.scrollTop;
		let frag = doc.createDocumentFragment();
		let T = Hafif.load("libtools");
		rows.forEach((r, i) => {
			let row = h("div", "hlf-row " + r.kind + (i === st.sel ? " sel" : ""));
			row.dataset.i = i;
			row.style.paddingInlineStart = (6 + r.depth * 14) + "px";
			if (r.kind === "item") {
				let k = this._kindOf(r.item);
				row.append(h("span", "hlf-tw"));
				let body = h("span", "hlf-body");
				let t = h("span", "hlf-name", this._title(r.item));
				t.setAttribute("dir", "auto");
				body.append(t);
				if (r.item.isRegularItem()) {
					let sub = [T.creatorsShort(r.item, 1), T.year(r.item)].filter(Boolean).join(" ");
					if (sub) body.append(h("span", "hlf-sub", sub));
				}
				row.append(body);
				if (k.badge) row.append(h("span", "hlf-badge " + k.badge.toLowerCase(), k.badge));
				row.title = this._title(r.item);
			}
			else {
				row.append(h("span", "hlf-tw", r.expandable && !st.query ? (this._isOpen(st, r) ? "▾" : "▸") : ""));
				row.append(this._icon(doc, r.kind === "lib"
					? [["path", { d: "M2 13.5h12M3 6.5v6M6.3 6.5v6M9.7 6.5v6M13 6.5v6M1.75 5.5 8 2.25l6.25 3.25" }]]
					: [["path", { d: "M1.75 4.25v8.5c0 .55.45 1 1 1h10.5c.55 0 1-.45 1-1v-6.5c0-.55-.45-1-1-1H7.6L6.1 3.25H2.75c-.55 0-1 .45-1 1Z" }]], 14));
				let body = h("span", "hlf-body");
				let n = h("span", "hlf-name", r.name);
				n.setAttribute("dir", "auto");
				body.append(n);
				if (r.path) body.append(h("span", "hlf-sub", r.path));
				row.append(body);
				if (r.count) row.append(h("span", "hlf-count", String(r.count)));
			}
			frag.append(row);
		});
		st.list.replaceChildren(frag);
		if (!rows.length) st.list.append(h("div", "hlf-empty", st.query ? (st.indexing ? "Aranıyor…" : "Eşleşen yok.") : "Kütüphane boş."));
		st.list.scrollTop = scroll;
	},

	// ---- Etkileşim ----

	_rowAt(win, el) {
		let st = this._state.get(win);
		let row = el.closest?.(".hlf-row");
		return row ? { el: row, r: st.rows[+row.dataset.i], i: +row.dataset.i } : null;
	},

	_onClick(win, e) {
		let hit = this._rowAt(win, e.target);
		if (!hit) return;
		let st = this._state.get(win);
		this._select(win, hit.i);
		if (hit.r.kind === "item") return this._activate(win, hit.r, e);
		// Üçgen her yerde açar/kapar; satıra tıklamak kütüphanedeyken Zotero'da da seçer
		if (e.target.closest(".hlf-tw") || win.Zotero_Tabs.selectedType !== "library" || st.query) this._toggleRow(win, hit.r);
		else this._selectInZotero(win, hit.r);
	},

	_onDblClick(win, e) {
		let hit = this._rowAt(win, e.target);
		if (!hit || hit.r.kind === "item") return;
		if (win.Zotero_Tabs.selectedType !== "library") {
			// Okuyucudayken koleksiyona çift tıklamak kütüphanede açar
			win.Zotero_Tabs.select("zotero-pane");
			this._selectInZotero(win, hit.r);
		}
	},

	_toggleRow(win, r) {
		let st = this._state.get(win);
		if (r.kind === "lib") {
			let k = "!" + r.key;
			st.expanded.has(k) ? st.expanded.delete(k) : st.expanded.add(k);
		}
		else if (r.kind === "col") {
			if (st.query) {
				// Arama sonucundaki koleksiyon: aramayı bırakıp ağaçta aç
				for (let p = Zotero.Collections.get(r.id); p; p = p.parentID && Zotero.Collections.get(p.parentID)) st.expanded.add("C" + p.id);
				st.query = "";
				st.search.value = "";
			}
			else st.expanded.has(r.key) ? st.expanded.delete(r.key) : st.expanded.add(r.key);
		}
		Hafif.pref("leftFloatExpanded", JSON.stringify([...st.expanded].slice(-300)));
		this.render(win);
		let i = st.rows.findIndex(x => x.kind === r.kind && x.id === r.id);
		if (i >= 0) this._select(win, i);
	},

	async _selectInZotero(win, r) {
		let view = win.ZoteroPane?.collectionsView;
		if (!view) return;
		Hafif.modules.litview?.close(win);
		if (r.kind === "lib") await view.selectLibrary(r.id);
		else await view.selectCollection(r.id);
		if (r.kind === "col" && !this._state.get(win).expanded.has(r.key)) this._toggleRow(win, r);
	},

	/** Eseri açar: PDF/EPUB okuyucuda, not kendi penceresinde; ⌥ ile kütüphanede gösterir. */
	async _activate(win, r, e = {}) {
		if (!r) return;
		if (r.kind !== "item") return this._toggleRow(win, r);
		let it = r.item;
		if (e.altKey) return this._reveal(win, it);
		if (it.isNote()) return win.ZoteroPane.openNoteWindow(it.id);
		let { att } = this._kindOf(it);
		if (att && (att.isPDFAttachment() || att.isEPUBAttachment?.() || att.isSnapshotAttachment?.())) {
			await Zotero.Reader.open(att.id, null, { openInBackground: !!(e.metaKey || e.ctrlKey) });
			return;
		}
		if (att) return win.ZoteroPane.viewItems([att]);
		this._reveal(win, it);
	},

	async _reveal(win, it) {
		win.Zotero_Tabs.select("zotero-pane");
		await win.ZoteroPane.selectItem(it.id);
	},

	_select(win, i) {
		let st = this._state.get(win);
		st.sel = i;
		for (let el of st.list.querySelectorAll(".hlf-row.sel")) el.classList.remove("sel");
		let el = st.list.querySelector(`.hlf-row[data-i="${i}"]`);
		el?.classList.add("sel");
		el?.scrollIntoView({ block: "nearest" });
	},

	_moveSel(win, d) {
		let st = this._state.get(win);
		if (!st.rows.length) return;
		let i = st.sel < 0 ? (d > 0 ? 0 : st.rows.length - 1) : Math.max(0, Math.min(st.rows.length - 1, st.sel + d));
		this._select(win, i);
	},

	_isOpen(st, r) {
		return r.kind === "lib" ? !st.expanded.has("!" + r.key) : st.expanded.has(r.key);
	},

	_onKey(win, e) {
		let st = this._state.get(win);
		let r = st.rows[st.sel];
		let stop = () => {
			e.preventDefault();
			e.stopPropagation();
		};
		switch (e.key) {
			case "ArrowDown": stop(); return this._moveSel(win, 1);
			case "ArrowUp": stop(); return this._moveSel(win, -1);
			case "ArrowRight":
				stop();
				if (r && r.kind !== "item" && !st.query && !this._isOpen(st, r)) this._toggleRow(win, r);
				else this._moveSel(win, 1);
				return;
			case "ArrowLeft":
				stop();
				if (r && r.kind !== "item" && !st.query && this._isOpen(st, r)) return this._toggleRow(win, r);
				// Üst satıra çık
				for (let j = st.sel - 1; j >= 0; j--) {
					if (st.rows[j].depth < (r?.depth ?? 0)) return this._select(win, j);
				}
				return;
			case "Enter": stop(); return this._activate(win, r, e);
			case " ":
				stop();
				if (r?.kind === "item") Hafif.load("quicklook").openItem(win, r.item);
				else if (r) this._toggleRow(win, r);
				return;
			case "Escape": stop(); return this.close(win);
			default:
				// Yazmaya başlayınca arama kutusuna geç
				if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) st.search.focus();
		}
	},

	// ---- Konum ve boyut ----

	_applyGeom(win) {
		let st = this._state.get(win);
		if (!st) return;
		let doc = win.document;
		let W = win.innerWidth, H = win.innerHeight, M = 8;
		let barBottom = Math.round(doc.getElementById("zotero-title-bar")?.getBoundingClientRect().bottom || 40);
		let g = st.geom;
		let width = Math.max(220, Math.min(g.width, W - 2 * M));
		let top = Math.max(barBottom + 4, Math.min(g.top ?? barBottom + 6, H - 180));
		let height = Math.max(180, Math.min(g.height || Math.round(H * 0.7), H - top - M));
		let left = Math.max(M, Math.min(g.left, W - width - M));
		Object.assign(st.root.style, { left: left + "px", top: top + "px", width: width + "px", height: height + "px" });
	},

	_save(st) {
		Hafif.pref("leftFloatGeom", JSON.stringify(st.geom));
	},

	_drag(win, e) {
		if (e.button !== 0 || e.target.closest(".hlf-x")) return;
		e.preventDefault();
		let st = this._state.get(win);
		let r = st.root.getBoundingClientRect();
		let x0 = e.clientX, y0 = e.clientY;
		let move = (ev) => {
			st.geom.left = r.left + ev.clientX - x0;
			st.geom.top = r.top + ev.clientY - y0;
			this._applyGeom(win);
		};
		let up = () => {
			win.removeEventListener("mousemove", move, true);
			win.removeEventListener("mouseup", up, true);
			let b = st.root.getBoundingClientRect();
			st.geom.left = Math.round(b.left);
			st.geom.top = Math.round(b.top);
			this._save(st);
		};
		win.addEventListener("mousemove", move, true);
		win.addEventListener("mouseup", up, true);
	},

	_resize(win, e) {
		e.preventDefault();
		e.stopPropagation();
		let st = this._state.get(win);
		let r = st.root.getBoundingClientRect();
		let x0 = e.clientX, y0 = e.clientY;
		let move = (ev) => {
			st.geom.width = Math.max(220, r.width + ev.clientX - x0);
			st.geom.height = Math.max(180, r.height + ev.clientY - y0);
			this._applyGeom(win);
		};
		let up = () => {
			win.removeEventListener("mousemove", move, true);
			win.removeEventListener("mouseup", up, true);
			let b = st.root.getBoundingClientRect();
			st.geom.width = Math.round(b.width);
			st.geom.height = Math.round(b.height);
			this._save(st);
		};
		win.addEventListener("mousemove", move, true);
		win.addEventListener("mouseup", up, true);
	},

	CSS: `
.hlf { position: fixed; z-index: 20000; display: flex; flex-direction: column; box-sizing: border-box;
	/* Tema rengi yarı saydam olsa bile alttaki liste görünmesin: opak zemin üstüne boyanır */
	background-color: Canvas; background-image: linear-gradient(var(--material-sidepane, Canvas), var(--material-sidepane, Canvas));
	color: var(--fill-primary, CanvasText);
	border: 1px solid var(--fill-quinary, #8883); border-radius: 10px; overflow: hidden;
	box-shadow: 0 10px 30px rgba(0, 0, 0, .22), 0 1px 3px rgba(0, 0, 0, .12);
	font: message-box; font-size: 12.5px; animation: hlf-in .12s ease-out; }
.hlf[hidden] { display: none; }
@keyframes hlf-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.hlf-head { display: flex; align-items: center; gap: 6px; flex: none; padding: 5px 6px 5px 9px; cursor: grab; user-select: none; }
.hlf-head:active { cursor: grabbing; }
.hlf-grip { color: var(--fill-tertiary, #999); font-size: 11px; }
.hlf-title { flex: 1; font-size: 11px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--fill-secondary, #777); }
.hlf-x { width: 20px; height: 20px; padding: 0; border: 0; border-radius: 5px; background: none; color: var(--fill-secondary, #777); font-size: 13px; line-height: 20px; cursor: pointer; }
.hlf-x:hover { background: var(--fill-quinary, #8882); color: var(--fill-primary); }
.hlf-search { flex: none; margin: 0 8px 6px; padding: 4px 8px; border: 1px solid var(--fill-quinary, #8884); border-radius: 6px;
	background: var(--material-background, Canvas); color: inherit; font: inherit; outline: none; }
.hlf-search:focus { border-color: var(--color-accent, #4072e5); }
.hlf-list { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 0 8px; outline: none; border-top: 1px solid var(--fill-quinary, #8883); }
.hlf-row { display: flex; align-items: center; gap: 5px; min-height: 24px; padding: 2px 8px 2px 6px; cursor: default; user-select: none; }
.hlf-row:hover { background: var(--fill-quinary, #8881); }
.hlf-row.sel { background: color-mix(in srgb, var(--color-accent, #4072e5) 18%, transparent); }
.hlf-list:focus .hlf-row.sel { background: var(--color-accent, #4072e5); color: #fff; }
.hlf-list:focus .hlf-row.sel .hlf-sub, .hlf-list:focus .hlf-row.sel .hlf-count, .hlf-list:focus .hlf-row.sel .hlf-badge, .hlf-list:focus .hlf-row.sel svg { color: #fff; border-color: #fff8; }
.hlf-tw { width: 12px; flex: none; text-align: center; font-size: 10px; color: var(--fill-secondary, #888); }
.hlf-row svg { flex: none; color: var(--accent-blue, #4072e5); }
.hlf-row.lib svg { color: var(--fill-secondary, #777); }
.hlf-body { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
.hlf-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hlf-row.lib .hlf-name { font-weight: 650; }
.hlf-sub { font-size: 11px; color: var(--fill-secondary, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hlf-count { flex: none; font-size: 10.5px; color: var(--fill-secondary, #888); font-variant-numeric: tabular-nums; }
.hlf-badge { flex: none; font: 700 8.5px/1 -apple-system, system-ui, sans-serif; letter-spacing: .04em; padding: 2px 4px; border-radius: 3px;
	border: 1px solid var(--fill-quinary, #8885); color: var(--fill-secondary, #777); }
.hlf-badge.pdf { color: #c0392b; border-color: #c0392b66; }
.hlf-badge.epub { color: #2e7d32; border-color: #2e7d3266; }
.hlf-empty { padding: 12px; color: var(--fill-secondary, #888); font-style: italic; }
.hlf-foot { flex: none; padding: 4px 9px 5px; border-top: 1px solid var(--fill-quinary, #8883); font-size: 10px; color: var(--fill-secondary, #888);
	white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hlf-resize { position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize;
	background: linear-gradient(135deg, transparent 50%, var(--fill-quinary, #8884) 50%, var(--fill-quinary, #8884) 58%, transparent 58%, transparent 70%, var(--fill-quinary, #8884) 70%, var(--fill-quinary, #8884) 78%, transparent 78%); }
.hlf-btn { flex: none; align-self: center; display: inline-flex; align-items: center; justify-content: center;
	width: 28px; height: 26px; margin-inline: 6px 2px; padding: 0; border: 0; border-radius: 6px; background: none;
	color: var(--fill-secondary, #777); cursor: pointer; -moz-window-dragging: no-drag; }
.hlf-btn:hover { background: var(--fill-quinary, #8882); color: var(--fill-primary); }
.hlf-btn[aria-pressed="true"] { color: var(--fill-primary); background: var(--fill-quinary, #8882); }
`,
};
