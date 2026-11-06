/* Vurgu başlığında "Nota gönder" simgesi: hem sol paneldeki vurgu kartında hem de sol panel
 * kapalıyken PDF üzerinde açılan vurgu çerçevesinde. Tıklayınca not › başlık menüsü açılır;
 * ⇧ ile tıklayınca doğrudan son hedefe gönderir.
 * Sol panel için Zotero'nun renderSidebarAnnotationHeader olayı kullanılır. Açılır çerçevenin
 * eklenti kancası olmadığı için okuyucu belgesi izlenir ve düğme çerçevenin başlığına konur. */

Hafif.modules.sendbtn = {
	_watched: new WeakSet(),
	_observers: new Set(),

	// Köşesi kıvrık not sayfası ve sağdan içine giren ok
	ICON: "M12.5 8.5v-4l-3-3h-6v13h9v-1M9.5 1.5v3h3M5.5 6.5h4M5.5 9h2.5M15.5 11h-6M11.75 8.75 9.5 11l2.25 2.25",

	/** Sol panel kartının başlığına düğme ekler (olay içinde, eşzamanlı). */
	renderSidebar(event) {
		let { reader, doc, params, append } = event;
		if (reader._item?.libraryID == null) return;
		this.watch(reader);
		let key = params.annotation?.id;
		if (!key) return;
		append(this._button(doc, reader, () => this._keysFor(reader, key)));
	},

	/** Okuyucu belgesini açılır vurgu çerçevesi için izlemeye başlar (bir kez). */
	watch(reader) {
		let win = reader._iframeWindow;
		if (!win || Components.utils.isDeadWrapper(win) || this._watched.has(win)) return;
		let doc = win.document;
		if (!doc?.body) return;
		this._watched.add(win);
		this._style(doc);
		let scan = () => {
			for (let end of doc.querySelectorAll(".annotation-popup .preview header .end")) {
				if (end.querySelector(".hafif-send")) continue;
				let btn = this._button(doc, reader, () => {
					let st = reader._internalReader?._state;
					let id = st?.primaryViewAnnotationPopup?.annotation?.id || st?.secondaryViewAnnotationPopup?.annotation?.id;
					return id ? [id] : [];
				});
				end.insertBefore(btn, end.querySelector(".more"));
			}
		};
		let obs = new win.MutationObserver(scan);
		obs.observe(doc.body, { childList: true, subtree: true });
		this._observers.add(obs);
		win.addEventListener("unload", () => {
			obs.disconnect();
			this._observers.delete(obs);
		}, { once: true });
		scan();
	},

	watchAll() {
		for (let r of Zotero.Reader._readers || []) {
			if (r._iframeWindow) this.watch(r);
		}
	},

	/** Sol panelde birden çok vurgu seçiliyken simgesine basılan seçiliyse hepsi gider. */
	_keysFor(reader, key) {
		let sel = [...(reader._internalReader?._state?.selectedAnnotationIDs || [])];
		return sel.length > 1 && sel.includes(key) ? sel : [key];
	},

	_button(doc, reader, getKeys) {
		let btn = doc.createElement("button");
		btn.className = "hafif-send";
		btn.tabIndex = -1;
		btn.title = "Nota gönder… (⇧ tıklama: son başlığa)";
		let svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 16 16");
		svg.setAttribute("width", "16");
		svg.setAttribute("height", "16");
		let path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", this.ICON);
		path.setAttribute("fill", "none");
		path.setAttribute("stroke", "currentColor");
		path.setAttribute("stroke-width", "1.25");
		path.setAttribute("stroke-linecap", "round");
		path.setAttribute("stroke-linejoin", "round");
		svg.append(path);
		btn.append(svg);
		// Kartın kendi tıklama/seçme davranışı tetiklenmesin
		for (let type of ["mousedown", "pointerdown", "dblclick"]) {
			btn.addEventListener(type, (e) => e.stopPropagation());
		}
		btn.addEventListener("click", Hafif.safe((e) => {
			e.preventDefault();
			e.stopPropagation();
			let keys = getKeys();
			if (!keys.length) return;
			let libraryID = reader._item.libraryID;
			let send = Hafif.safe((target) => {
				let items = keys.map(k => Zotero.Items.getByLibraryAndKey(libraryID, k)).filter(Boolean);
				return Hafif.load("notes").sendAnnotations(items, target);
			});
			let notes = Hafif.load("notes");
			if (e.shiftKey) {
				let last = notes._lastTarget();
				if (last && notes._resolve(last)) return send(last);
				Hafif.toast("Henüz son hedef yok; menüden bir başlık seçin.");
			}
			let r = btn.getBoundingClientRect();
			let frame = reader._iframe.getBoundingClientRect();
			let p = reader._window.windowUtils.toScreenRectInCSSUnits(frame.x + r.left, frame.y + r.bottom + 2, 0, 0);
			Hafif._openPopup(reader, p.x, p.y, notes.menuTree(send));
		}));
		return btn;
	},

	_style(doc) {
		let s = doc.createElement("style");
		s.className = "hafif-send-style";
		s.textContent = `
.hafif-send {
	all: unset; display: inline-flex; align-items: center; justify-content: center;
	width: 22px; height: 22px; margin-inline: 2px; border-radius: 5px; cursor: pointer;
	color: var(--fill-secondary, #666); flex: none;
}
.hafif-send:hover { background: var(--fill-quinary, rgba(0,0,0,.08)); color: var(--fill-primary, #222); }
.hafif-send:active { background: var(--fill-quarternary, rgba(0,0,0,.14)); }
.custom-sections .section:has(> .hafif-send) { display: flex; }
`;
		doc.head.append(s);
	},

	shutdown() {
		for (let o of this._observers) o.disconnect();
		this._observers.clear();
		for (let r of Zotero.Reader._readers || []) {
			let doc = r._iframeWindow?.document;
			if (!doc) continue;
			for (let el of doc.querySelectorAll(".hafif-send, .hafif-send-style")) el.remove();
		}
		this._watched = new WeakSet();
	},
};
