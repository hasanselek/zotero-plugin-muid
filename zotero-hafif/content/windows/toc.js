/* Not İçindekiler penceresi: notlar · numaralı içindekiler · okuma görünümü. */

var HafifTOC = {
	notes: null,
	current: null,
	rows: [],
	observerID: null,
	_spy: null,

	init() {
		this.Hafif = Zotero.Hafif;
		this.notes = this.Hafif.load("notes");
		let $ = (id) => document.getElementById(id);
		this.$ = $;

		$("filter").addEventListener("input", () => this.renderList());
		$("edit").addEventListener("click", () => {
			if (this.current) Zotero.getActiveZoteroPane().openNoteWindow(this.current.id);
		});
		$("new-note").addEventListener("click", (e) => this.newNoteMenu(e));
		$("content").addEventListener("click", (e) => this.onContentClick(e));

		this.observerID = Zotero.Notifier.registerObserver({
			notify: (event, type, ids) => {
				if (type === "item" && ["modify", "add", "delete", "trash"].includes(event)) {
					this.renderList();
					if (this.current && ids.includes(this.current.id)) this.renderNote(this.current, { keepScroll: true });
				}
				else if (type === "collection-item" || type === "collection") this.renderList();
			},
		}, ["item", "collection", "collection-item"], "hafif-toc");
		window.addEventListener("unload", () => Zotero.Notifier.unregisterObserver(this.observerID));

		this.renderList();
		this.show(window.arguments?.[0] || {});
	},

	show({ noteID, annotationKey } = {}) {
		let note = noteID ? Zotero.Items.get(noteID) : this.rows[0]?.note;
		if (note) this.renderNote(note, { annotationKey });
	},

	// ---- Not listesi ----

	collectNotes() {
		let out = [];
		let walk = (col, path) => {
			let notes = col.getChildItems(false, false).filter(i => i.isNote())
				.sort((a, b) => a.getNoteTitle().localeCompare(b.getNoteTitle(), "tr"));
			for (let note of notes) out.push({ note, group: path });
			for (let sub of col.getChildCollections(false).sort((a, b) => a.name.localeCompare(b.name, "tr"))) {
				walk(sub, path + " › " + sub.name);
			}
		};
		for (let col of this.notes.getCollections()) walk(col, col.name);
		return out;
	},

	renderList() {
		let q = this.Hafif.load("search").normalize(this.$("filter").value);
		this.rows = this.collectNotes();
		let list = this.$("note-list");
		list.replaceChildren();
		let lastGroup = null;
		let shown = 0;
		for (let { note, group } of this.rows) {
			let title = note.getNoteTitle() || "(başlıksız not)";
			if (q && !this.Hafif.load("search").normalize(title + " " + note.getNote().replace(/<[^>]+>/g, " ")).includes(q)) continue;
			if (group !== lastGroup) {
				let g = document.createElement("div");
				g.className = "group eyebrow";
				g.textContent = group;
				list.append(g);
				lastGroup = group;
			}
			let stats = this.stats(note);
			let row = document.createElement("div");
			row.className = "note-row" + (this.current?.id === note.id ? " active" : "");
			row.dataset.id = note.id;
			let t = document.createElement("div");
			t.className = "t";
			t.dir = "auto";
			t.textContent = title;
			let m = document.createElement("div");
			m.className = "m";
			m.textContent = `${stats.headings} başlık · ${stats.quotes} alıntı · ${this.date(note.dateModified)}`;
			row.append(t, m);
			row.addEventListener("click", () => this.renderNote(note));
			list.append(row);
			shown++;
		}
		if (!shown) {
			let e = document.createElement("div");
			e.className = "group";
			e.textContent = this.rows.length ? "Eşleşen not yok." : "Not koleksiyonu boş ya da seçilmemiş.";
			list.append(e);
		}
	},

	stats(note) {
		let html = note.getNote();
		return {
			headings: (html.match(/<h[1-3][\s>]/g) || []).length,
			quotes: (html.match(/data-annotation=/g) || []).length,
		};
	},

	date(sql) {
		try {
			return Zotero.Date.sqlToDate(sql, true).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
		}
		catch (e) {
			return "";
		}
	},

	// ---- Okuma görünümü ----

	renderNote(note, { keepScroll = false, annotationKey } = {}) {
		this.current = note;
		let reader = this.$("reader");
		let scroll = reader.scrollTop;
		for (let row of document.querySelectorAll(".note-row")) row.classList.toggle("active", +row.dataset.id === note.id);
		this.$("empty").classList.add("hidden");

		let col = this.rows.find(r => r.note.id === note.id)?.group || "";
		this.$("note-collection").textContent = col;
		this.$("note-title").textContent = note.getNoteTitle() || "(başlıksız not)";
		let st = this.stats(note);
		this.$("note-meta").textContent = `${st.headings} başlık · ${st.quotes} alıntı · son değişiklik ${this.date(note.dateModified)}`;
		document.title = `${note.getNoteTitle()} — Not İçindekiler`;

		let src = this.notes._wrapper(this.notes._parse(note.getNote()));
		this.sanitize(src, note);
		let content = this.$("content");
		content.replaceChildren(...[...src.childNodes].map(n => document.importNode(n, true)));
		// İlk satır notun başlığıysa okuma görünümünde tekrar etmesin
		let first = content.firstElementChild;
		if (first && first.textContent.trim() === note.getNoteTitle().trim() && !/^H[2-6]$/.test(first.tagName)) first.remove();
		for (let el of content.querySelectorAll("p, li, blockquote, h1, h2, h3, h4, td")) el.setAttribute("dir", "auto");

		this.renderTOC(content);
		if (keepScroll) reader.scrollTop = scroll;
		else reader.scrollTop = 0;
		if (annotationKey) this.focusAnnotation(annotationKey);
	},

	/** Not HTML'inden zararlı olabilecek her şeyi atar; gömülü görselleri dosyalarına bağlar. */
	sanitize(root, note) {
		for (let bad of root.querySelectorAll("script, style, iframe, object, embed, link, meta, form")) bad.remove();
		for (let el of root.querySelectorAll("*")) {
			for (let a of [...el.attributes]) {
				if (/^on/i.test(a.name) || (a.name === "href" && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
			}
		}
		for (let a of root.querySelectorAll("a[href]")) a.setAttribute("target", "_blank");
		for (let img of root.querySelectorAll("img[data-attachment-key]")) {
			let att = Zotero.Items.getByLibraryAndKey(note.libraryID, img.getAttribute("data-attachment-key"));
			let path = att?.getFilePath?.();
			if (path) img.setAttribute("src", PathUtils.toFileURI(path));
			else img.remove();
		}
	},

	renderTOC(content) {
		let list = this.$("toc-list");
		list.replaceChildren();
		this._spy?.disconnect();
		let heads = [...content.querySelectorAll(":scope > h1, :scope > h2, :scope > h3")];
		let counters = [0, 0, 0];
		let minLevel = Math.min(...heads.map(h => +h.tagName[1]), 3);
		let total = content.querySelectorAll("[data-annotation]").length;
		this.$("toc-stats").textContent = heads.length ? `${heads.length} başlık · ${total} alıntı` : "";
		if (!heads.length) {
			let li = document.createElement("li");
			li.className = "none";
			li.textContent = "Bu notta başlık yok.";
			list.append(li);
			return;
		}
		let items = heads.map((h, i) => {
			let level = +h.tagName[1] - minLevel + 1;
			counters[level - 1]++;
			for (let j = level; j < 3; j++) counters[j] = 0;
			let num = counters.slice(0, level).map(n => n || 1).join(".");
			h.id = "h-" + i;
			// Bölümdeki alıntı sayısı: bir sonraki aynı/üst düzey başlığa kadar
			let quotes = 0;
			for (let el = h.nextElementSibling; el && !(/^H[1-3]$/.test(el.tagName) && +el.tagName[1] <= +h.tagName[1]); el = el.nextElementSibling) {
				quotes += el.querySelectorAll("[data-annotation]").length + (el.hasAttribute?.("data-annotation") ? 1 : 0);
			}
			let li = document.createElement("li");
			li.className = "l" + level;
			let n = document.createElement("span");
			n.className = "num";
			n.textContent = num;
			let t = document.createElement("span");
			t.className = "txt";
			t.dir = "auto";
			t.textContent = h.textContent.trim() || "(boş başlık)";
			li.append(n, t);
			if (quotes) {
				let c = document.createElement("span");
				c.className = "cnt";
				c.title = `${quotes} alıntı`;
				c.textContent = quotes;
				li.append(c);
			}
			li.addEventListener("click", () => {
				h.scrollIntoView({ behavior: "smooth", block: "start" });
				h.classList.remove("flash");
				void h.offsetWidth;
				h.classList.add("flash");
			});
			list.append(li);
			return li;
		});
		// Okurken hangi bölümde olunduğunu içindekilerde işaretle
		this._spy = new IntersectionObserver((entries) => {
			let visible = heads.filter(h => {
				let r = h.getBoundingClientRect();
				return r.top < window.innerHeight * 0.45;
			});
			let active = visible.length ? heads.indexOf(visible[visible.length - 1]) : 0;
			items.forEach((li, i) => li.classList.toggle("active", i === active));
		}, { root: this.$("reader"), threshold: [0, 1] });
		heads.forEach(h => this._spy.observe(h));
	},

	focusAnnotation(key) {
		let el = [...this.$("content").querySelectorAll("[data-annotation]")]
			.find(e => e.getAttribute("data-annotation").includes(`annotationKey%22%3A%22${key}%22`));
		let block = el?.closest("blockquote, p") || el;
		if (!block) return;
		setTimeout(() => {
			block.scrollIntoView({ behavior: "smooth", block: "center" });
			block.classList.add("flash");
		}, 60);
	},

	async onContentClick(e) {
		let hl = e.target.closest("[data-annotation]");
		let cit = e.target.closest(".citation[data-citation]");
		try {
			if (hl) {
				let data = JSON.parse(decodeURIComponent(hl.getAttribute("data-annotation")));
				let att = await Zotero.URI.getURIItem(data.attachmentURI);
				if (!att) return this.Hafif.toast("Kaynak PDF bulunamadı.");
				let ann = Zotero.Items.getByLibraryAndKey(att.libraryID, data.annotationKey);
				let location = ann ? { annotationID: ann.key } : { position: data.position };
				await Zotero.Reader.open(att.id, location);
				Zotero.getMainWindow().focus();
			}
			else if (cit) {
				let data = JSON.parse(decodeURIComponent(cit.getAttribute("data-citation")));
				let uri = data.citationItems?.[0]?.uris?.[0];
				let item = uri && await Zotero.URI.getURIItem(uri);
				if (item) {
					let pane = Zotero.getActiveZoteroPane();
					await pane.selectItem(item.id);
					Zotero.getMainWindow().focus();
				}
			}
		}
		catch (err) {
			Zotero.logError(err);
			this.Hafif.toast("Açılamadı: " + err.message);
		}
	},

	newNoteMenu(e) {
		let tpls = this.notes.templates();
		let names = tpls.map(t => t.name);
		let sel = { value: 0 };
		if (!Services.prompt.select(window, "Yeni not", "Şablon seçin:", names, sel)) return;
		this.notes.createFromTemplate(tpls[sel.value]).then((note) => {
			if (note) {
				this.renderList();
				this.renderNote(note);
			}
		}).catch(err => this.Hafif.toast("Not oluşturulamadı: " + err.message));
	},
};

window.addEventListener("load", () => {
	try {
		HafifTOC.init();
	}
	catch (e) {
		Zotero.logError(e);
		document.body.textContent = "Not İçindekiler açılamadı: " + e.message;
	}
});
