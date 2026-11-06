/* Ortak hızlı pencere (komut paleti): arama, etiket gezgini ve sekme yöneticisi bunu kullanır.
 * Her pencere için bir "kaynak" verilir:
 *   { id, placeholder, hint, items(query) → [{ title, meta, data }], onEnter(entry, mods), onKey?(e, entry) } */

Hafif.modules.palette = {
	_ui: new WeakMap(),

	async toggle(win, source) {
		let ui = this._ui.get(win) || this._create(win);
		if (!ui.root.hidden && ui.source?.id === source.id) return this.close(win);
		ui.source = source;
		ui.input.placeholder = source.placeholder || "";
		ui.hint.textContent = source.hint || "";
		ui.input.value = "";
		ui.sel = 0;
		if (source.prepare) await source.prepare();
		ui.root.hidden = false;
		ui.input.focus();
		await this.render(win);
	},

	close(win) {
		let ui = this._ui.get(win);
		if (ui) ui.root.hidden = true;
	},

	destroy(win) {
		this._ui.get(win)?.root.remove();
		this._ui.delete(win);
	},

	shutdown() {
		for (let win of Zotero.getMainWindows()) this.destroy(win);
	},

	_create(win) {
		let doc = win.document;
		let h = (tag, cls) => {
			let el = doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
			if (cls) el.className = cls;
			return el;
		};
		let root = h("div", "hafif-palette");
		root.hidden = true;
		let style = h("style");
		style.textContent = `
			.hafif-palette { position: fixed; inset: 0; z-index: 30000; background: rgba(0,0,0,.25); }
			.hafif-palette[hidden] { display: none; }
			.hafif-box { position: absolute; left: 50%; top: 12%; transform: translateX(-50%);
				width: min(680px, 90vw); max-height: 70vh; display: flex; flex-direction: column;
				background: var(--material-background, Canvas); color: var(--fill-primary, CanvasText);
				border: 1px solid var(--fill-quinary, #8884); border-radius: 10px;
				box-shadow: 0 12px 40px rgba(0,0,0,.3); overflow: hidden; font: message-box; }
			.hafif-box input { font-size: 17px; padding: 12px 14px; border: 0; outline: 0;
				border-bottom: 1px solid var(--fill-quinary, #8884); background: transparent; color: inherit; }
			.hafif-list { overflow-y: auto; margin: 0; padding: 4px 0; list-style: none; }
			.hafif-list li { padding: 6px 14px; cursor: default; display: flex; gap: 10px; align-items: baseline; }
			.hafif-list li > div { flex: 1; min-width: 0; }
			.hafif-list li.sel { background: var(--color-accent, Highlight); color: var(--accent-white, HighlightText); }
			.hafif-t { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.hafif-m { font-size: 12px; opacity: .75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.hafif-badge { font-size: 11px; opacity: .7; font-variant-numeric: tabular-nums; }
			.hafif-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; align-self: center; }
			.hafif-empty { padding: 14px; opacity: .6; font-size: 13px; }
			.hafif-hint { font-size: 11px; opacity: .6; padding: 6px 14px; border-top: 1px solid var(--fill-quinary, #8884); }
		`;
		let box = h("div", "hafif-box");
		let input = h("input");
		input.setAttribute("dir", "auto");
		let list = h("ul", "hafif-list");
		let hint = h("div", "hafif-hint");
		box.append(input, list, hint);
		root.append(style, box);
		(doc.body || doc.documentElement).append(root);

		let ui = { root, input, list, hint, results: [], sel: 0, source: null };
		this._ui.set(win, ui);

		let mods = (e) => ({ accel: Zotero.isMac ? e.metaKey : e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
		root.addEventListener("mousedown", (e) => { if (e.target === root) this.close(win); });
		input.addEventListener("input", () => { ui.sel = 0; this.render(win); });
		input.addEventListener("keydown", Hafif.safe(async (e) => {
			let entry = ui.results[ui.sel];
			if (e.key === "Escape") { e.preventDefault(); this.close(win); }
			else if (e.key === "ArrowDown") { e.preventDefault(); this._move(win, 1); }
			else if (e.key === "ArrowUp") { e.preventDefault(); this._move(win, -1); }
			else if (e.key === "Enter") {
				e.preventDefault();
				if (await ui.source.onEnter(entry, mods(e), ui.input.value) !== false) this.close(win);
				else this.render(win);
			}
			else if (ui.source.onKey && await ui.source.onKey(e, entry, mods(e))) {
				e.preventDefault();
				this.render(win);
			}
		}));
		list.addEventListener("click", Hafif.safe(async (e) => {
			let li = e.target.closest("li");
			if (!li) return;
			if (await ui.source.onEnter(ui.results[+li.dataset.i], mods(e), ui.input.value) !== false) this.close(win);
			else this.render(win);
		}));
		return ui;
	},

	async render(win) {
		let ui = this._ui.get(win);
		let doc = win.document;
		let h = (tag, cls, text) => {
			let el = doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
			if (cls) el.className = cls;
			if (text != null) {
				el.textContent = text;
				el.setAttribute("dir", "auto");
			}
			return el;
		};
		ui.results = await ui.source.items(ui.input.value);
		if (ui.sel >= ui.results.length) ui.sel = Math.max(0, ui.results.length - 1);
		if (!ui.results.length) {
			ui.list.replaceChildren(h("div", "hafif-empty", ui.source.empty || "Sonuç yok"));
			return;
		}
		ui.list.replaceChildren(...ui.results.map((r, i) => {
			let li = h("li", i === ui.sel ? "sel" : "");
			li.dataset.i = i;
			if (r.color) {
				let dot = h("span", "hafif-dot");
				dot.style.background = r.color;
				li.append(dot);
			}
			let body = h("div");
			body.append(h("div", "hafif-t", r.title || "(başlıksız)"));
			if (r.meta) body.append(h("div", "hafif-m", r.meta));
			li.append(body);
			if (r.badge != null) li.append(h("span", "hafif-badge", String(r.badge)));
			return li;
		}));
		ui.list.children[ui.sel]?.scrollIntoView({ block: "nearest" });
	},

	_move(win, d) {
		let ui = this._ui.get(win);
		if (!ui.results.length) return;
		ui.sel = (ui.sel + d + ui.results.length) % ui.results.length;
		let lis = ui.list.children;
		for (let i = 0; i < lis.length; i++) lis[i].classList.toggle("sel", i === ui.sel);
		lis[ui.sel]?.scrollIntoView({ block: "nearest" });
	},
};
