/* Yüzen not içindekiler: her not düzenleyicisinin (sağ panel, not sekmesi, ayrı not penceresi,
 * okuyucu yan paneli) üstünde sürüklenebilir bir içindekiler kutusu.
 * Başlıklar kutuda sürüklenerek ya da klavyeyle taşınır; başlığın bölümü (altındaki metin ve alt
 * başlıklar) birlikte gider. Taşıma ProseMirror işlemi olarak yapılır: ⌘Z ile geri alınır,
 * notu Zotero kendisi kaydeder. Düzenleyicinin nesnelerine wrappedJSObject ile erişilir;
 * içerik tarafına yalnızca sayı ve dizgi geçirilir, nesne gerekiyorsa cloneInto ile kopyalanır. */

Hafif.modules.notetoc = {
	_controllers: new Set(),
	_byWindow: new WeakMap(),

	/** Yeni ya da yeniden başlatılmış düzenleyici: penceresinde kutuyu kurar veya tazeler. */
	attach(instance) {
		if (Hafif.pref("noteOutline") === false) return;
		let win = instance._iframeWindow;
		if (!win || Components.utils.isDeadWrapper(win) || !win.document?.body) return;
		let c = this._byWindow.get(win);
		if (!c || c.dead) {
			c = new this.Outline(win, this);
			this._byWindow.set(win, c);
			this._controllers.add(c);
		}
		c.bind(instance);
	},

	/** Açık bütün düzenleyiciler (eklenti sonradan açıldığında ya da ayar değişince). */
	attachAll() {
		for (let inst of Hafif.load("compat").noteEditors()) {
			inst._initPromise?.then(() => this.attach(inst)).catch(() => {});
		}
	},

	detachAll() {
		for (let c of this._controllers) c.destroy();
		this._controllers.clear();
		this._byWindow = new WeakMap();
	},

	toggleEnabled() {
		let on = Hafif.pref("noteOutline") === false;
		Hafif.pref("noteOutline", on);
		if (on) this.attachAll();
		else this.detachAll();
		Hafif.toast("Yüzen not içindekiler " + (on ? "açıldı" : "kapatıldı"));
	},

	state(wide) {
		let all = {};
		try {
			all = JSON.parse(Hafif.pref("noteOutlineState") || "{}") || {};
		}
		catch (e) {}
		let def = { collapsed: !wide, right: 18, top: null, width: 280, height: null };
		return Object.assign(def, all[wide ? "wide" : "narrow"]);
	},

	saveState(wide, s) {
		let all = {};
		try {
			all = JSON.parse(Hafif.pref("noteOutlineState") || "{}") || {};
		}
		catch (e) {}
		all[wide ? "wide" : "narrow"] = s;
		Hafif.pref("noteOutlineState", JSON.stringify(all));
	},

	shutdown() {
		this.detachAll();
	},
};

Hafif.modules.notetoc.Outline = class {
	constructor(win, mod) {
		this.win = win;
		this.doc = win.document;
		this.mod = mod;
		this.dead = false;
		this.heads = [];
		this.collapsed = new Set();
		this.sel = -1;
		this.active = -1;
		this.query = "";
		this._timer = null;
		this._observer = null;
		this._observed = null;
		this._scroller = null;
		this._raf = 0;
		this._listeners = [];
		this.wide = win.innerWidth >= 620;
		this.st = mod.state(this.wide);
		this._build();
		this._on(win, "unload", () => this.destroy());
		this._on(win, "resize", () => this._onResize());
	}

	_on(target, type, fn, opts) {
		target.addEventListener(type, fn, opts);
		this._listeners.push([target, type, fn, opts]);
	}

	destroy() {
		if (this.dead) return;
		this.dead = true;
		this._observer?.disconnect();
		this.win.clearTimeout?.(this._timer);
		for (let [t, type, fn, opts] of this._listeners) {
			try {
				t.removeEventListener(type, fn, opts);
			}
			catch (e) {}
		}
		try {
			this.root?.remove();
			this.style?.remove();
		}
		catch (e) {}
		this.mod._controllers.delete(this);
	}

	// ---- Düzenleyiciye erişim ----

	/** Etkin ProseMirror görünümü (içerik nesnesi, Xray'siz). */
	get view() {
		try {
			return this.win.wrappedJSObject._currentEditorInstance?._editorCore?.view || null;
		}
		catch (e) {
			return null;
		}
	}

	get editable() {
		let v = this.view;
		return !!v && v.editable !== false;
	}

	bind(instance) {
		this.instance = instance;
		this.itemID = instance._item?.id;
		this.collapsed.clear();
		this.sel = -1;
		// Görünüm init iletisinden biraz sonra oluşuyor
		let tries = 0;
		let go = () => {
			if (this.dead) return;
			let v = this.view;
			if (!v?.dom) {
				if (tries++ < 50) this.win.setTimeout(go, 100);
				return;
			}
			this._observe(v);
			this.refresh();
		};
		go();
	}

	_observe(view) {
		let dom = Components.utils.unwaiveXrays(view.dom);
		if (this._observed === dom) return;
		this._observer?.disconnect();
		this._observer = new this.win.MutationObserver(() => this._schedule());
		this._observer.observe(dom, { childList: true, subtree: true, characterData: true });
		this._observed = dom;
		this._scroller = this._findScroller(dom);
		let onScroll = () => {
			if (this._raf) return;
			this._raf = this.win.requestAnimationFrame(() => {
				this._raf = 0;
				this._trackActive();
			});
		};
		if (!this._scrollBound) {
			this._on(this.doc, "scroll", onScroll, true);
			this._on(this.doc, "keyup", (e) => { if (this._observed?.contains(e.target)) this._trackCaret(); });
			this._on(this.doc, "mouseup", (e) => { if (this._observed?.contains(e.target)) this._trackCaret(); });
			this._scrollBound = true;
		}
	}

	_findScroller(el) {
		for (let n = el; n && n !== this.doc.documentElement; n = n.parentElement) {
			let o = this.win.getComputedStyle(n).overflowY;
			if (o === "auto" || o === "scroll") return n;
		}
		return this.doc.scrollingElement;
	}

	_schedule() {
		this.win.clearTimeout(this._timer);
		this._timer = this.win.setTimeout(() => this.refresh(), 250);
	}

	/** Belgenin üst düzey başlıkları ve bölüm sınırları. */
	_scan() {
		let v = this.view;
		if (!v) return [];
		let doc = v.state.doc;
		let heads = [];
		let pos = 0;
		for (let i = 0; i < doc.childCount; i++) {
			let n = doc.child(i);
			if (n.type.name === "heading") {
				heads.push({ from: pos, level: +n.attrs.level || 1, text: n.textContent.trim(), bodyEnd: 0, to: 0 });
			}
			pos += n.nodeSize;
		}
		let end = doc.content.size;
		let stack = [];
		heads.forEach((h, i) => {
			h.index = i;
			h.bodyEnd = heads[i + 1]?.from ?? end;
			let j = i + 1;
			while (j < heads.length && heads[j].level > h.level) j++;
			h.to = heads[j]?.from ?? end;
			h.last = j - 1;
			while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
			h.parent = stack.length ? stack[stack.length - 1].index : -1;
			h.depth = stack.length;
			stack.push(h);
			let text = doc.textBetween(h.from, h.to, " ");
			h.words = (text.match(/[^\s]+/g) || []).length;
		});
		// Aynı metinli başlıklar için kalıcı anahtar (katlama durumu taşımalarda korunsun)
		let seen = {};
		for (let h of heads) {
			seen[h.text] = (seen[h.text] || 0) + 1;
			h.key = h.text + "#" + seen[h.text];
		}
		return heads;
	}

	// ---- Arayüz ----

	_build() {
		let d = this.doc;
		this.style = d.createElement("style");
		this.style.textContent = this.mod.CSS;
		d.head.append(this.style);

		let el = (tag, cls, text) => {
			let e = d.createElement(tag);
			if (cls) e.className = cls;
			if (text != null) e.textContent = text;
			return e;
		};
		this.el = el;
		let root = this.root = el("div", "hntoc");
		root.setAttribute("dir", "ltr");

		let head = this.headEl = el("div", "hntoc-head");
		let grip = el("span", "hntoc-grip", "⠿");
		let title = el("span", "hntoc-title", "İçindekiler");
		this.countEl = el("span", "hntoc-count");
		let tools = el("span", "hntoc-tools");
		let btn = (label, tip, fn) => {
			let b = el("button", "hntoc-btn", label);
			b.title = tip;
			b.addEventListener("click", (e) => { e.stopPropagation(); fn(e); });
			tools.append(b);
			return b;
		};
		btn("1", "Yalnız 1. düzey", () => this._depth(1));
		btn("2", "2 düzeye kadar", () => this._depth(2));
		btn("✱", "Hepsini aç", () => this._depth(9));
		btn("⌕", "Başlıklarda ara", () => this._toggleFilter());
		btn("–", "Küçült", () => this._setCollapsed(true));
		head.append(grip, title, this.countEl, tools);

		this.filterEl = el("input", "hntoc-filter hidden");
		this.filterEl.placeholder = "Başlıklarda ara…";
		this.filterEl.setAttribute("dir", "auto");
		this.filterEl.addEventListener("input", () => {
			this.query = this.filterEl.value;
			this.render();
		});
		this.filterEl.addEventListener("keydown", (e) => {
			if (e.key === "Escape") this._toggleFilter(false);
			if (e.key === "ArrowDown") {
				e.preventDefault();
				this.listEl.focus();
				this._moveSel(1);
			}
		});

		this.listEl = el("div", "hntoc-list");
		this.listEl.tabIndex = 0;
		this.listEl.addEventListener("keydown", (e) => this._onKey(e));
		this.listEl.addEventListener("mousedown", (e) => this._onRowDown(e));
		this.listEl.addEventListener("contextmenu", (e) => this._onContext(e));

		this.footEl = el("div", "hntoc-foot", "Sürükle: taşı · ⌥↑↓ sırala · ⌥←→ düzey · ⌘Z geri al");
		this.resizeEl = el("div", "hntoc-resize");
		this.resizeEl.title = "Boyutlandır";

		this.pill = el("button", "hntoc-pill");
		this.pill.title = "İçindekiler";
		this.pill.addEventListener("click", () => {
			if (!this._pillMoved) this._setCollapsed(false);
		});

		root.append(head, this.filterEl, this.listEl, this.footEl, this.resizeEl, this.pill);
		d.body.append(root);

		this._dragWindow(head, false);
		this._dragWindow(this.pill, true);
		this._resizable();
		this._applyGeometry();
	}

	_applyGeometry() {
		let s = this.st;
		let r = this.root;
		r.classList.toggle("collapsed", !!s.collapsed);
		let W = this.win.innerWidth, M = 8;
		let top = s.top ?? this._defaultTop();
		let maxTop = Math.max(0, this.win.innerHeight - 44);
		r.style.top = Math.min(Math.max(0, top), maxTop) + "px";
		// Genişlik görünür alana sığsın; sağ boşluk da kutuyu sol kenardan dışarı itmesin
		r.style.width = s.collapsed ? "" : Math.max(120, Math.min(s.width, W - 2 * M)) + "px";
		let w = r.getBoundingClientRect().width || (s.collapsed ? 60 : s.width);
		r.style.right = Math.max(M, Math.min(s.right, W - w - M)) + "px";
		let maxH = this.win.innerHeight - (parseFloat(r.style.top) || 0) - 12;
		r.style.height = s.collapsed || !s.height ? "" : Math.min(s.height, maxH) + "px";
		// Boyutu elle verilmemişse metni fazla örtmesin
		r.style.maxHeight = (s.height ? maxH : Math.min(maxH, Math.round(this.win.innerHeight * 0.7))) + "px";
	}

	_defaultTop() {
		let bar = this.doc.querySelector(".toolbar, .editor-toolbar");
		let b = bar ? bar.getBoundingClientRect().bottom : 40;
		return Math.round(b + 10);
	}

	_save() {
		this.mod.saveState(this.wide, this.st);
	}

	_onResize() {
		let wide = this.win.innerWidth >= 620;
		if (wide !== this.wide) {
			this.wide = wide;
			this.st = this.mod.state(wide);
		}
		this._applyGeometry();
	}

	_setCollapsed(c) {
		this.st.collapsed = c;
		this._applyGeometry();
		this._save();
		if (!c) {
			this.render();
			this.listEl.focus();
		}
	}

	_toggleFilter(show) {
		let hidden = this.filterEl.classList.contains("hidden");
		show = show ?? hidden;
		this.filterEl.classList.toggle("hidden", !show);
		if (show) this.filterEl.focus();
		else {
			this.filterEl.value = "";
			this.query = "";
			this.render();
			this.listEl.focus();
		}
	}

	/** Başlık çubuğundan (ya da küçük düğmeden) kutuyu taşır. */
	_dragWindow(handle, isPill) {
		handle.addEventListener("mousedown", (e) => {
			if (e.button !== 0 || (!isPill && e.target.closest(".hntoc-btn"))) return;
			e.preventDefault();
			let r = this.root.getBoundingClientRect();
			let sx = e.clientX, sy = e.clientY;
			let right0 = this.win.innerWidth - r.right, top0 = r.top;
			this._pillMoved = false;
			let move = (ev) => {
				let dx = ev.clientX - sx, dy = ev.clientY - sy;
				if (Math.abs(dx) + Math.abs(dy) > 3) this._pillMoved = true;
				this.st.right = right0 - dx;
				this.st.top = top0 + dy;
				this._applyGeometry();
				// Ekran dışına sürüklenemesin: kayıtlı değer de sınırlı kalsın
				this.st.right = parseFloat(this.root.style.right) || this.st.right;
			};
			let up = () => {
				this.win.removeEventListener("mousemove", move, true);
				this.win.removeEventListener("mouseup", up, true);
				if (this._pillMoved) this._save();
			};
			this.win.addEventListener("mousemove", move, true);
			this.win.addEventListener("mouseup", up, true);
		});
	}

	_resizable() {
		this.resizeEl.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			let r = this.root.getBoundingClientRect();
			let sx = e.clientX, sy = e.clientY;
			let w0 = r.width, h0 = r.height, right0 = this.win.innerWidth - r.right;
			let move = (ev) => {
				// Tutamak sol altta: sola çekince genişler, sağ kenar sabit kalır
				this.st.width = Math.max(200, w0 - (ev.clientX - sx));
				this.st.height = Math.max(140, h0 + (ev.clientY - sy));
				this.st.right = right0;
				this._applyGeometry();
			};
			let up = () => {
				this.win.removeEventListener("mousemove", move, true);
				this.win.removeEventListener("mouseup", up, true);
				this._save();
			};
			this.win.addEventListener("mousemove", move, true);
			this.win.addEventListener("mouseup", up, true);
		});
	}

	// ---- Liste ----

	refresh() {
		if (this.dead) return;
		this.heads = this._scan();
		this.render();
		this._trackActive();
	}

	_numbers() {
		let nums = [];
		let counters = [];
		for (let h of this.heads) {
			counters.length = h.depth + 1;
			counters[h.depth] = (counters[h.depth] || 0) + 1;
			nums.push(counters.join("."));
		}
		return nums;
	}

	_visible() {
		let q = this.query && Hafif.load("search").normalize(this.query);
		if (q) {
			let norm = (s) => Hafif.load("search").normalize(s);
			let keep = new Set();
			this.heads.forEach((h, i) => {
				if (!norm(h.text).includes(q)) return;
				for (let j = i; j >= 0; j = this.heads[j].parent) keep.add(j);
			});
			return this.heads.filter((h, i) => keep.has(i));
		}
		let out = [];
		let hiddenUntil = -1;
		for (let h of this.heads) {
			if (h.index <= hiddenUntil) continue;
			out.push(h);
			if (this.collapsed.has(h.key)) hiddenUntil = h.last;
		}
		return out;
	}

	render() {
		let n = this.heads.length;
		this.countEl.textContent = n ? String(n) : "";
		this.pill.textContent = n ? `☰ ${n}` : "☰";
		this.root.classList.toggle("empty", !n);
		if (this.st.collapsed) return;
		let list = this.listEl;
		let scroll = list.scrollTop;
		list.replaceChildren();
		if (!n) {
			list.append(this.el("div", "hntoc-none", "Bu notta başlık yok. Başlık eklemek için satırı Başlık 1–3 yapın."));
			return;
		}
		let nums = this._numbers();
		let rows = this._visible();
		if (!rows.length) list.append(this.el("div", "hntoc-none", "Eşleşen başlık yok."));
		for (let h of rows) {
			let row = this.el("div", "hntoc-row d" + Math.min(h.depth, 5));
			row.dataset.i = h.index;
			row.style.paddingInlineStart = (6 + h.depth * 14) + "px";
			let hasKids = h.last > h.index;
			let tw = this.el("span", "hntoc-twisty" + (hasKids ? "" : " leaf"), hasKids ? (this.collapsed.has(h.key) ? "▸" : "▾") : "");
			let num = this.el("span", "hntoc-num", nums[h.index]);
			let txt = this.el("span", "hntoc-txt", h.text || "(boş başlık)");
			txt.setAttribute("dir", "auto");
			let w = this.el("span", "hntoc-words", h.words >= 1000 ? (h.words / 1000).toFixed(1) + "b" : String(h.words));
			w.title = `${h.words} kelime (alt başlıklar dahil)`;
			row.title = `H${h.level} · ${h.words} kelime`;
			row.append(tw, num, txt, w);
			if (h.index === this.sel) row.classList.add("sel");
			if (h.index === this.active) row.classList.add("active");
			list.append(row);
		}
		list.scrollTop = scroll;
	}

	_rowOf(i) {
		return this.listEl.querySelector(`.hntoc-row[data-i="${i}"]`);
	}

	_select(i, { scroll = true } = {}) {
		this.sel = i;
		for (let r of this.listEl.querySelectorAll(".hntoc-row.sel")) r.classList.remove("sel");
		let row = this._rowOf(i);
		row?.classList.add("sel");
		if (scroll) row?.scrollIntoView({ block: "nearest" });
	}

	_moveSel(delta) {
		let rows = this._visible();
		if (!rows.length) return;
		let k = rows.findIndex(h => h.index === this.sel);
		k = k < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, k + delta));
		this._select(rows[k].index);
	}

	_depth(d) {
		this.collapsed.clear();
		for (let h of this.heads) {
			if (h.depth + 1 >= d && h.last > h.index) this.collapsed.add(h.key);
		}
		this.render();
	}

	_toggleCollapse(h) {
		if (this.collapsed.has(h.key)) this.collapsed.delete(h.key);
		else this.collapsed.add(h.key);
		this.render();
	}

	// ---- Etkin bölüm ----

	_trackActive() {
		let v = this.view;
		if (!v || !this.heads.length) return this._setActive(-1);
		let top = (this._scroller?.getBoundingClientRect?.().top ?? 0) + 48;
		let active = 0;
		for (let h of this.heads) {
			let dom = this._dom(h.from);
			if (!dom) continue;
			if (dom.getBoundingClientRect().top <= top) active = h.index;
			else break;
		}
		this._setActive(active);
	}

	_trackCaret() {
		let v = this.view;
		if (!v) return;
		let p = v.state.selection.from;
		let a = -1;
		for (let h of this.heads) if (h.from <= p) a = h.index;
		if (a >= 0) this._setActive(a);
	}

	_setActive(i) {
		if (i === this.active) return;
		this.active = i;
		for (let r of this.listEl.querySelectorAll(".hntoc-row.active")) r.classList.remove("active");
		let row = this._rowOf(i);
		if (row) {
			row.classList.add("active");
			if (!this._dragging) row.scrollIntoView({ block: "nearest" });
		}
	}

	_dom(pos) {
		try {
			let n = this.view.nodeDOM(pos);
			return n ? Components.utils.unwaiveXrays(n) : null;
		}
		catch (e) {
			return null;
		}
	}

	// ---- Gezinme ----

	jump(h, { caret = false } = {}) {
		let dom = this._dom(h.from);
		if (!dom) return;
		dom.scrollIntoView({ block: "start", behavior: "smooth" });
		this._flash(dom);
		if (caret) {
			let v = this.view;
			try {
				let st = v.state;
				let node = st.doc.nodeAt(h.from);
				let pos = h.from + 1 + (node ? node.content.size : 0);
				let sel = st.selection.constructor.near(st.doc.resolve(pos));
				v.dispatch(st.tr.setSelection(sel));
				v.focus();
			}
			catch (e) {
				Zotero.logError(e);
			}
		}
	}

	/** Başlığı kısa süre vurgular. ProseMirror'un DOM'una dokunmamak için üstüne ayrı katman konur. */
	_flash(dom) {
		let show = () => {
			let r = dom.getBoundingClientRect();
			let f = this.el("div", "hntoc-flash");
			f.style.cssText = `top:${r.top - 3}px;left:${r.left - 6}px;width:${r.width + 12}px;height:${r.height + 6}px`;
			this.doc.body.append(f);
			this.win.setTimeout(() => f.remove(), 1300);
		};
		this.win.setTimeout(show, 350);
	}

	// ---- Bölüm işlemleri ----

	/**
	 * Bölümü (başlık + gövde + alt başlıklar) target konumuna taşır ve kökün düzeyini newLevel yapar;
	 * alt başlıklar aynı farkla kayar. target bölümün içinde olamaz.
	 */
	moveSection(h, target, newLevel = h.level) {
		let v = this.view;
		if (!v || !this.editable) return Hafif.toast("Bu not salt okunur.");
		let delta = newLevel - h.level;
		let inner = this.heads.slice(h.index, h.last + 1);
		if (inner.some(x => x.level + delta < 1 || x.level + delta > 6)) {
			return Hafif.toast("Başlık düzeyi 1–6 dışına çıkıyor; taşınamadı.");
		}
		let moving = target !== h.from && target !== h.to;
		if (moving && target > h.from && target < h.to) return;
		if (!moving && !delta) return;

		let tr = v.state.tr;
		if (delta) {
			for (let x of inner) {
				let node = tr.doc.nodeAt(x.from);
				let attrs = Components.utils.cloneInto(Object.assign({}, Components.utils.waiveXrays(node.attrs), { level: x.level + delta }), this.win);
				tr.setNodeMarkup(x.from, null, attrs);
			}
		}
		let newPos = h.from;
		if (moving) {
			let slice = tr.doc.slice(h.from, h.to);
			tr.delete(h.from, h.to);
			newPos = tr.mapping.map(target);
			tr.insert(newPos, slice.content);
		}
		v.dispatch(tr);
		this._afterEdit(newPos, h.key);
	}

	_afterEdit(pos, key) {
		let wasCollapsed = this.collapsed.has(key);
		this.heads = this._scan();
		let h = this.heads.find(x => x.from === pos);
		// Katlama anahtarları metne bağlı; taşınan bölüm kendi durumunu korur
		if (h && wasCollapsed) this.collapsed.add(h.key);
		if (h) {
			// Taşınan başlığın üstleri açık olsun ki görünsün
			for (let p = h.parent; p >= 0; p = this.heads[p].parent) this.collapsed.delete(this.heads[p].key);
			this.sel = h.index;
		}
		this.render();
		if (h) {
			this._select(h.index);
			let dom = this._dom(h.from);
			if (dom) {
				dom.scrollIntoView({ block: "nearest", behavior: "smooth" });
				this._flash(dom);
			}
		}
	}

	_siblings(h) {
		return this.heads.filter(x => x.parent === h.parent);
	}

	moveUp(h) {
		let sib = this._siblings(h);
		let k = sib.indexOf(h);
		if (k > 0) this.moveSection(h, sib[k - 1].from);
		else if (h.parent >= 0) {
			// İlk alt başlık: üst başlığın önüne, onun düzeyinde çıkar
			let p = this.heads[h.parent];
			this.moveSection(h, p.from, p.level);
		}
	}

	moveDown(h) {
		let sib = this._siblings(h);
		let k = sib.indexOf(h);
		if (k < sib.length - 1) this.moveSection(h, sib[k + 1].to);
		else if (h.parent >= 0) {
			let p = this.heads[h.parent];
			this.moveSection(h, p.to, p.level);
		}
	}

	promote(h) {
		if (h.level > 1) this.moveSection(h, h.from, h.level - 1);
	}

	demote(h) {
		this.moveSection(h, h.from, h.level + 1);
	}

	deleteSection(h) {
		let v = this.view;
		if (!v || !this.editable) return;
		v.dispatch(v.state.tr.delete(h.from, h.to));
		this.refresh();
		Hafif.toast("Bölüm silindi. Geri almak için ⌘Z.", 3000);
	}

	copySection(h) {
		let v = this.view;
		let doc = v.state.doc;
		let html = "";
		let pos = h.from;
		while (pos < h.to) {
			let node = doc.nodeAt(pos);
			if (!node) break;
			let dom = this._dom(pos);
			if (dom?.outerHTML) html += dom.outerHTML;
			pos += node.nodeSize;
		}
		Hafif.copy(html, doc.textBetween(h.from, h.to, "\n\n"), "Bölüm kopyalandı.");
	}

	undo(redo) {
		try {
			let w = this.win.wrappedJSObject;
			redo ? w.doRedo() : w.doUndo();
		}
		catch (e) {
			Zotero.logError(e);
		}
		this.refresh();
	}

	// ---- Klavye ----

	_onKey(e) {
		let accel = Zotero.isMac ? e.metaKey : e.ctrlKey;
		if (accel && e.key.toLowerCase() === "z") {
			e.preventDefault();
			return this.undo(e.shiftKey);
		}
		if (accel && e.key.toLowerCase() === "f") {
			e.preventDefault();
			return this._toggleFilter(true);
		}
		let h = this.heads[this.sel];
		let stop = () => { e.preventDefault(); e.stopPropagation(); };
		if (e.altKey && h) {
			let fn = { ArrowUp: "moveUp", ArrowDown: "moveDown", ArrowLeft: "promote", ArrowRight: "demote" }[e.key];
			if (fn) {
				stop();
				return this[fn](h);
			}
		}
		switch (e.key) {
			case "ArrowDown": stop(); return this._moveSel(1);
			case "ArrowUp": stop(); return this._moveSel(-1);
			case "ArrowRight":
				stop();
				if (h && this.collapsed.has(h.key)) this._toggleCollapse(h);
				else this._moveSel(1);
				return;
			case "ArrowLeft":
				stop();
				if (h && h.last > h.index && !this.collapsed.has(h.key)) this._toggleCollapse(h);
				else if (h && h.parent >= 0) this._select(h.parent);
				return;
			case "Enter": stop(); if (h) this.jump(h, { caret: e.shiftKey || accel }); return;
			case " ": stop(); if (h) this.jump(h); return;
			case "Escape": stop(); this.view?.focus(); return;
			case "Tab":
				if (h) {
					stop();
					return e.shiftKey ? this.promote(h) : this.demote(h);
				}
		}
	}

	// ---- Fareyle sürükleme ----

	_onRowDown(e) {
		this._closeMenu();
		let row = e.target.closest(".hntoc-row");
		if (!row || e.button !== 0) return;
		let h = this.heads[+row.dataset.i];
		if (!h) return;
		if (e.target.closest(".hntoc-twisty")) {
			e.preventDefault();
			if (h.last > h.index) this._toggleCollapse(h);
			return;
		}
		e.preventDefault();
		this.listEl.focus();
		this._select(h.index, { scroll: false });
		let sx = e.clientX, sy = e.clientY;
		let started = false;
		let ghost = null;
		let drop = null;
		let autoScroll = 0;

		let clear = () => {
			for (let r of this.listEl.querySelectorAll(".drop-before, .drop-after, .drop-into, .dragging")) {
				r.classList.remove("drop-before", "drop-after", "drop-into", "dragging");
			}
		};
		let move = (ev) => {
			if (!started) {
				if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
				if (!this.editable) return;
				started = true;
				this._dragging = true;
				this.root.classList.add("is-dragging");
				for (let i = h.index; i <= h.last; i++) this._rowOf(i)?.classList.add("dragging");
				ghost = this.el("div", "hntoc-ghost", (h.text || "(boş başlık)") + (h.last > h.index ? `  +${h.last - h.index}` : ""));
				ghost.setAttribute("dir", "auto");
				this.doc.body.append(ghost);
			}
			ghost.style.left = (ev.clientX + 12) + "px";
			ghost.style.top = (ev.clientY + 8) + "px";
			clear();
			for (let i = h.index; i <= h.last; i++) this._rowOf(i)?.classList.add("dragging");
			drop = this._dropTarget(h, ev);
			if (drop) drop.row.classList.add("drop-" + drop.zone);
			ghost.classList.toggle("bad", !drop);
			// Liste kenarına yaklaşınca kaydır
			let lr = this.listEl.getBoundingClientRect();
			autoScroll = ev.clientY < lr.top + 24 ? -8 : ev.clientY > lr.bottom - 24 ? 8 : 0;
		};
		let tick = this.win.setInterval(() => {
			if (autoScroll) this.listEl.scrollTop += autoScroll;
		}, 16);
		let finish = (commit) => {
			this.win.clearInterval(tick);
			this.win.removeEventListener("mousemove", move, true);
			this.win.removeEventListener("mouseup", up, true);
			this.win.removeEventListener("keydown", key, true);
			ghost?.remove();
			clear();
			this._dragging = false;
			this.root.classList.remove("is-dragging");
			if (!started) {
				if (commit) this.jump(h, { caret: e.detail >= 2 });
				return;
			}
			if (commit && drop) this.moveSection(h, drop.target, drop.level);
		};
		let up = () => finish(true);
		let key = (ev) => {
			if (ev.key === "Escape") {
				ev.preventDefault();
				ev.stopPropagation();
				finish(false);
			}
		};
		this.win.addEventListener("mousemove", move, true);
		this.win.addEventListener("mouseup", up, true);
		this.win.addEventListener("keydown", key, true);
	}

	/** İmlecin altındaki satıra göre bırakma yeri: üst şerit önüne, alt şerit arkasına, orta alt başlık olarak. */
	_dropTarget(h, ev) {
		let rows = [...this.listEl.querySelectorAll(".hntoc-row")];
		if (!rows.length) return null;
		let row = this.doc.elementFromPoint(ev.clientX, ev.clientY)?.closest?.(".hntoc-row");
		let lastRow = rows[rows.length - 1];
		if (!row) {
			// Listenin altındaki boşluk: en sona, kök düzeyinde
			let lr = lastRow.getBoundingClientRect();
			if (ev.clientY > lr.bottom && ev.clientY < this.listEl.getBoundingClientRect().bottom) row = lastRow;
			else return null;
		}
		let b = this.heads[+row.dataset.i];
		if (!b || (b.index >= h.index && b.index <= h.last)) return null;
		let r = row.getBoundingClientRect();
		let y = (ev.clientY - r.top) / r.height;
		let zone = y < 0.3 ? "before" : y > 0.7 ? "after" : "into";
		if (row === lastRow && ev.clientY > r.bottom) zone = "after";
		let res;
		if (zone === "before") res = { target: b.from, level: b.level };
		else if (zone === "after") {
			// Katlı ya da alt başlığı olmayan satırın arkası: bölümünün sonu
			res = { target: b.to, level: b.level };
		}
		else res = { target: b.to, level: Math.min(6, b.level + 1) };
		if (res.target === h.from || res.target === h.to) {
			if (res.level === h.level) return null;
		}
		return { row, zone, ...res };
	}

	// ---- Sağ tık menüsü ----

	_onContext(e) {
		let row = e.target.closest(".hntoc-row");
		if (!row) return;
		e.preventDefault();
		let h = this.heads[+row.dataset.i];
		this._select(h.index, { scroll: false });
		let ro = !this.editable;
		let items = [
			["Başlığa git", () => this.jump(h)],
			["İmleci başlığa koy", () => this.jump(h, { caret: true })],
			null,
			["Yukarı taşı  ⌥↑", () => this.moveUp(h), ro],
			["Aşağı taşı  ⌥↓", () => this.moveDown(h), ro],
			["Düzeyi yükselt  ⌥←", () => this.promote(h), ro || h.level <= 1],
			["Düzeyi düşür  ⌥→", () => this.demote(h), ro],
			null,
			["Bölümü kopyala", () => this.copySection(h)],
			["Bölümü sil", () => this.deleteSection(h), ro],
		];
		this._closeMenu();
		let m = this.menu = this.el("div", "hntoc-menu");
		for (let it of items) {
			if (!it) {
				m.append(this.el("div", "hntoc-sep"));
				continue;
			}
			let [label, fn, disabled] = it;
			let b = this.el("div", "hntoc-mi" + (disabled ? " off" : ""), label);
			if (!disabled) b.addEventListener("mousedown", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				this._closeMenu();
				fn();
			});
			m.append(b);
		}
		this.doc.body.append(m);
		let mr = m.getBoundingClientRect();
		m.style.left = Math.min(e.clientX, this.win.innerWidth - mr.width - 6) + "px";
		m.style.top = Math.min(e.clientY, this.win.innerHeight - mr.height - 6) + "px";
		let close = (ev) => {
			if (!m.contains(ev.target)) this._closeMenu();
		};
		this._menuClose = close;
		this.win.addEventListener("mousedown", close, true);
	}

	_closeMenu() {
		if (!this.menu) return;
		this.menu.remove();
		this.menu = null;
		this.win.removeEventListener("mousedown", this._menuClose, true);
	}
};

Hafif.modules.notetoc.CSS = `
.hntoc {
	--hn-bg: rgba(255, 253, 248, .97); --hn-ink: #23211c; --hn-muted: #7a756a; --hn-line: #e0dbd0;
	--hn-accent: #8a5a2b; --hn-soft: #f1e4d3; --hn-sel: #e9dcc8; --hn-shadow: 0 8px 28px rgba(40, 30, 10, .18), 0 1px 3px rgba(40, 30, 10, .12);
	position: fixed; z-index: 2147483000; display: flex; flex-direction: column;
	min-width: min(200px, calc(100vw - 16px)); max-width: calc(100vw - 16px); min-height: 0; box-sizing: border-box;
	background: var(--hn-bg); color: var(--hn-ink); border: 1px solid var(--hn-line); border-radius: 10px;
	box-shadow: var(--hn-shadow); backdrop-filter: blur(8px);
	font: 12.5px/1.35 -apple-system, "Segoe UI", system-ui, sans-serif; user-select: none;
}
@media (prefers-color-scheme: dark) {
	.hntoc {
		--hn-bg: rgba(36, 35, 32, .97); --hn-ink: #ece8df; --hn-muted: #9b958a; --hn-line: #3a3833;
		--hn-accent: #d9a466; --hn-soft: #3a2f22; --hn-sel: #3b342b; --hn-shadow: 0 8px 28px rgba(0, 0, 0, .5);
	}
}
.hntoc * { box-sizing: border-box; }
.hntoc .hidden { display: none !important; }
.hntoc-head { display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 8px; cursor: grab; border-bottom: 1px solid var(--hn-line); }
.hntoc-head:active { cursor: grabbing; }
.hntoc-grip { color: var(--hn-muted); font-size: 11px; }
.hntoc-title { font-weight: 650; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--hn-muted); }
.hntoc-count { font-size: 10.5px; color: var(--hn-muted); background: var(--hn-sel); border-radius: 8px; padding: 0 6px; }
.hntoc-count:empty { display: none; }
.hntoc-tools { margin-inline-start: auto; display: flex; gap: 2px; }
.hntoc-btn { all: unset; cursor: pointer; min-width: 20px; height: 20px; text-align: center; border-radius: 5px; color: var(--hn-muted); font-size: 11.5px; line-height: 20px; }
.hntoc-btn:hover { background: var(--hn-sel); color: var(--hn-ink); }
.hntoc-filter { margin: 6px 8px 2px; padding: 4px 8px; border: 1px solid var(--hn-line); border-radius: 6px; background: transparent; color: inherit; font: inherit; outline: none; }
.hntoc-filter:focus { border-color: var(--hn-accent); }
.hntoc-list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 0 6px; outline: none; }
.hntoc-row { display: flex; align-items: baseline; gap: 5px; padding: 3px 8px 3px 6px; cursor: default; border-inline-start: 3px solid transparent; position: relative; }
.hntoc-row:hover { background: color-mix(in srgb, var(--hn-sel) 55%, transparent); }
.hntoc-row.active { border-inline-start-color: var(--hn-accent); }
.hntoc-row.active .hntoc-txt { color: var(--hn-accent); }
.hntoc-list:focus .hntoc-row.sel, .hntoc-row.sel { background: var(--hn-sel); }
.hntoc-twisty { width: 12px; flex: none; color: var(--hn-muted); font-size: 10px; cursor: pointer; text-align: center; }
.hntoc-twisty.leaf { cursor: default; }
.hntoc-num { color: var(--hn-accent); font-variant-numeric: tabular-nums; font-size: 11px; font-weight: 600; flex: none; }
.hntoc-txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hntoc-row.d0 .hntoc-txt { font-weight: 650; }
.hntoc-row.d2 .hntoc-txt, .hntoc-row.d3 .hntoc-txt, .hntoc-row.d4 .hntoc-txt, .hntoc-row.d5 .hntoc-txt { font-size: 12px; color: color-mix(in srgb, var(--hn-ink) 80%, var(--hn-muted)); }
.hntoc-words { flex: none; font-size: 10px; color: var(--hn-muted); font-variant-numeric: tabular-nums; opacity: .8; }
.hntoc-none { padding: 10px 12px; color: var(--hn-muted); font-style: italic; user-select: text; }
.hntoc-foot { padding: 4px 8px 5px; border-top: 1px solid var(--hn-line); font-size: 10px; color: var(--hn-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hntoc-resize { position: absolute; left: 0; bottom: 0; width: 14px; height: 14px; cursor: nesw-resize; border-bottom-left-radius: 10px;
	background: linear-gradient(225deg, transparent 50%, var(--hn-line) 50%, var(--hn-line) 58%, transparent 58%, transparent 70%, var(--hn-line) 70%, var(--hn-line) 78%, transparent 78%); }
.hntoc-pill { all: unset; display: none; cursor: pointer; padding: 4px 10px; border-radius: 14px; font-size: 12px; font-weight: 600; color: var(--hn-ink); }
.hntoc.collapsed { min-width: 0; border-radius: 16px; }
.hntoc.collapsed > :not(.hntoc-pill) { display: none; }
.hntoc.collapsed .hntoc-pill { display: block; }
.hntoc.collapsed.empty { opacity: .55; }
.hntoc.collapsed:hover { opacity: 1; }

.hntoc.is-dragging .hntoc-row:hover { background: transparent; }
.hntoc-row.dragging { opacity: .35; }
.hntoc-row.drop-before::before, .hntoc-row.drop-after::after {
	content: ""; position: absolute; inset-inline: 6px; height: 2px; background: var(--hn-accent); border-radius: 2px; pointer-events: none;
}
.hntoc-row.drop-before::before { top: -1px; }
.hntoc-row.drop-after::after { bottom: -1px; }
.hntoc-row.drop-into { background: var(--hn-soft); box-shadow: inset 0 0 0 1.5px var(--hn-accent); border-radius: 5px; }
.hntoc-ghost, .hntoc-menu, .hntoc-flash { position: fixed; z-index: 2147483001; }
.hntoc-ghost {
	pointer-events: none; max-width: 260px; padding: 4px 9px; border-radius: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	background: #8a5a2b; color: #fff; font: 600 12px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,.25);
}
.hntoc-ghost.bad { background: #7a756a; }
.hntoc-menu {
	min-width: 180px; padding: 4px; border-radius: 8px; background: var(--hn-bg, #fffdf8); border: 1px solid #e0dbd0;
	box-shadow: 0 8px 24px rgba(0,0,0,.2); font: 12.5px/1.35 -apple-system, "Segoe UI", system-ui, sans-serif; color: #23211c;
}
.hntoc-mi { padding: 4px 10px; border-radius: 5px; cursor: default; white-space: pre; }
.hntoc-mi:hover { background: #8a5a2b; color: #fff; }
.hntoc-mi.off { opacity: .4; }
.hntoc-mi.off:hover { background: none; color: inherit; }
.hntoc-sep { height: 1px; margin: 4px 6px; background: #e0dbd0; }
@media (prefers-color-scheme: dark) {
	.hntoc-menu { background: #2a2925; border-color: #3a3833; color: #ece8df; }
	.hntoc-sep { background: #3a3833; }
	.hntoc-mi:hover { background: #d9a466; color: #1d1c1a; }
}
.hntoc-flash { pointer-events: none; border-radius: 6px; background: rgba(217, 164, 102, .28); animation: hntoc-fade 1.3s ease-out forwards; }
@keyframes hntoc-fade { 0%, 35% { opacity: 1; } 100% { opacity: 0; } }
`;
