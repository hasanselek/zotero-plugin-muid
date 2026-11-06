/* Zotero Hafif — çekirdek.
 * Burada yalnızca ucuz kayıt işleri yapılır (menüler, kısayollar, dinleyiciler, panel bölümleri).
 * Asıl iş yapan kod content/modules/ altında ve ilk kullanımda yüklenir. */

Hafif = {
	id: null,
	version: null,
	rootURI: null,
	modules: {},
	indexDirty: true,
	_scope: null,
	_notifierID: null,
	_chrome: null,
	_keyHandlers: new WeakMap(),
	_l10n: null,
	/** Açılış ve modül yükleme süreleri (ms): Ayarlar › Gelişmiş › Performans raporu. */
	perf: { startup: null, windows: [], modules: {} },

	init({ id, version, rootURI, scope }) {
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this._scope = scope;
	},

	log(msg) {
		Zotero.debug("[Hafif] " + msg);
	},

	pref(key, value) {
		let name = "extensions.hafif." + key;
		if (value === undefined) return Zotero.Prefs.get(name, true);
		Zotero.Prefs.set(name, value, true);
	},

	/** Modülü ilk çağrıldığında yükler, sonra önbellekten verir. */
	load(name) {
		if (!this.modules[name]) {
			let t = this._now();
			Services.scriptloader.loadSubScript(`${this.rootURI}content/modules/${name}.js`, this._scope);
			let ms = Math.round((this._now() - t) * 10) / 10;
			this.perf.modules[name] = ms;
			this.log(`modül yüklendi: ${name} (${ms} ms)`);
		}
		return this.modules[name];
	},

	_now() {
		try {
			return Components.utils.now();
		}
		catch (e) {
			return Date.now();
		}
	},

	/** Yerelleştirilmiş metin (locale/<dil>/hafif.ftl). Bulunamazsa fallback ya da kimlik döner. */
	t(id, args, fallback) {
		try {
			if (!this._l10n) {
				let L = Zotero.getMainWindow()?.Localization;
				if (L) this._l10n = new L(["hafif.ftl"], true);
			}
			let v = this._l10n?.formatValueSync(id, args);
			if (v) return v;
		}
		catch (e) {
			Zotero.debug("[Hafif] çeviri yok: " + id);
		}
		return fallback ?? id;
	},

	/** İşi pencere boşta kalınca yapar (açılışı geciktirmemek için). */
	idle(win, fn) {
		let run = this.safe(fn);
		if (win.requestIdleCallback) win.requestIdleCallback(run, { timeout: 2000 });
		else win.setTimeout(run, 300);
	},

	/** Kullanıcı eylemlerini sarar: hata sessizce yutulmaz, ekranda görünür. */
	safe(fn) {
		return (...args) => {
			try {
				let r = fn(...args);
				if (r && typeof r.catch === "function") r.catch(e => this._fail(e));
				return r;
			}
			catch (e) {
				this._fail(e);
			}
		};
	},

	_fail(e) {
		Zotero.logError(e);
		let msg = String(e?.message || e);
		this.toast(this.t("hafif-error", { msg }, "Hata: " + msg), 6000);
	},

	toast(msg, ms = 2500) {
		let pw = new Zotero.ProgressWindow({ closeOnClick: true });
		pw.changeHeadline("Hafif");
		pw.addDescription(msg);
		pw.show();
		pw.startCloseTimer(ms);
	},

	/** Panoya zengin metin (varsa) ve düz metin birlikte yazar. */
	copy(html, text, msg) {
		let trans = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
		trans.init(null);
		let put = (flavor, data) => {
			let s = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
			s.data = data;
			trans.addDataFlavor(flavor);
			trans.setTransferData(flavor, s);
		};
		if (html) put("text/html", html);
		put("text/plain", text || "");
		Services.clipboard.setData(trans, null, Ci.nsIClipboard.kGlobalClipboard);
		if (msg) this.toast(msg, 1500);
	},

	async startup() {
		await Zotero.initializationPromise;
		let t0 = this._now();
		this.load("compat").checkVersion();
		let aom = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
		this._chrome = aom.registerChrome(Services.io.newURI(this.rootURI + "manifest.json"), [["content", "hafif", "content/"]]);
		Zotero.Hafif = this;

		this._registerMenus();
		this._registerReader();
		this._registerSections();
		this._hookNoteEditors();
		Zotero.PreferencePanes.register({
			pluginID: this.id,
			src: this.rootURI + "content/prefs.xhtml",
			scripts: [this.rootURI + "content/prefs-ai.js", this.rootURI + "content/prefs.js"],
			label: "Hafif",
		});
		this._notifierID = Zotero.Notifier.registerObserver(
			{ notify: (...args) => this._onNotify(...args) },
			["item", "item-tag", "collection", "file"],
			"hafif"
		);
		for (let win of Zotero.getMainWindows()) {
			if (win.ZoteroPane) this.onMainWindowLoad(win);
		}
		this.load("actions").watchPrefs();
		if (this.pref("mcpEnabled") === true) this.safe(() => this.load("mcp").register())();
		// Ayarlarda açık metin duran eski API anahtarları varsa parola yöneticisine taşınır
		if ((this.pref("aiKeys") && this.pref("aiKeys") !== "{}") || this.pref("aiKey") || /"key":\s*"[^"]/.test(this.pref("aiCustom") || "")) {
			this.load("secrets").migrate().catch(e => Zotero.logError(e));
		}
		this.perf.startup = Math.round((this._now() - t0) * 10) / 10;
		this.log(`açılış: ${this.perf.startup} ms`);
		if (this.pref("selfTest")) {
			Zotero.Promise.delay(4000).then(() => this.load("selftest").run()).catch(e => Zotero.logError(e));
		}
	},

	shutdown() {
		if (this._notifierID) Zotero.Notifier.unregisterObserver(this._notifierID);
		this.modules.compat?.unhookNoteEditors();
		for (let win of Zotero.getMainWindows()) this.onMainWindowUnload(win);
		for (let m of Object.values(this.modules)) {
			try {
				m.shutdown?.();
			}
			catch (e) {
				Zotero.logError(e);
			}
		}
		for (let type of ["hafif:toc", "hafif:outline", "hafif:hub"]) {
			for (let w of Services.wm.getEnumerator(type)) w.close();
		}
		this.modules = {};
		this._l10n = null;
		this._chrome?.destruct();
		this._chrome = null;
		delete Zotero.Hafif;
		// Menüler, panel bölümleri, ayar sayfası ve okuyucu dinleyicileri pluginID ile
		// kaydedildiği için Zotero kendisi kaldırır.
	},

	// ---- Pencere ----

	KEYS: {
		search: () => String(Hafif.pref("searchKey") || "P").toUpperCase(),
		tags: () => "T",
		tabs: () => "E",
	},

	onMainWindowLoad(win) {
		let t0 = this._now();
		win.MozXULElement.insertFTLIfNeeded("hafif.ftl");
		let handler = (e) => {
			let accel = Zotero.isMac ? e.metaKey : e.ctrlKey;
			if (!accel || !e.shiftKey || e.altKey) return;
			let k = e.key.toUpperCase();
			for (let [mod, key] of Object.entries(this.KEYS)) {
				if (k === key()) {
					e.preventDefault();
					e.stopPropagation();
					this.safe(() => this.load(mod).toggle(win))();
					return;
				}
			}
		};
		win.addEventListener("keydown", handler, true);
		this._keyHandlers.set(win, handler);
		this.safe(() => this.load("actions").bindKeys(win))();
		// Kısayol gerektirmeyenler pencere açıldıktan sonra, boşta kurulur
		this.idle(win, () => {
			if (win.closed) return;
			this.load("quicklook").bind(win);
			this.load("litview").attach(win);
		});
		if (this.pref("leftFloat") === true) {
			// Pencere yerleşimi bitsin diye biraz sonra
			win.setTimeout(this.safe(() => this.load("leftfloat").apply(win)), 600);
		}
		if (this.pref("hiddenSections") && this.pref("hiddenSections") !== "[]") this.load("panel").apply(win);
		this.perf.windows.push(Math.round((this._now() - t0) * 10) / 10);
	},

	onMainWindowUnload(win) {
		let handler = this._keyHandlers.get(win);
		if (handler) win.removeEventListener("keydown", handler, true);
		this._keyHandlers.delete(win);
		this.modules.palette?.destroy(win);
		this.modules.actions?.unbind(win);
		this.modules.chat?.destroy(win);
		this.modules.leftfloat?.remove(win);
		this.modules.quicklook?.unbind(win);
		this.modules.litview?.detach(win);
		this.modules.panel?.remove(win);
		win.document.querySelector('link[href="hafif.ftl"]')?.remove();
	},

	async _onNotify(event, type, ids, extraData) {
		// Arama dizini tembeldir: yalnızca kirli diye işaretlenir, pencere açılınca yenilenir.
		this.indexDirty = true;
		// Anlamsal dizin kuruluysa değişikliklerden birkaç dakika sonra sessizce güncellenir
		if (this.pref("aiEmbed") && (type === "item" || type === "collection")) this.load("embed").scheduleAuto();
		let rules = this.pref("actionRules");
		if (rules && rules !== "[]" && ((type === "item" && event === "add") || (type === "file" && event === "open"))) {
			try {
				await this.load("actions").onNotify(event, type, ids);
			}
			catch (e) {
				this._fail(e);
			}
		}
		if (type === "item" && event === "add" && this.pref("autoAppend") && this.pref("lastTarget")) {
			try {
				await this.load("notes").autoSend(ids);
			}
			catch (e) {
				this._fail(e);
			}
		}
	},

	// ---- Menüler ----

	_registerMenus() {
		let pluginID = this.id;
		let notes = () => this.load("notes");
		let hasSource = (ctx) => !!ctx.items?.some(i => i.isRegularItem() || i.isFileAttachment());
		let pdfOf = (ctx) => ctx.items?.length === 1 ? this.load("outline")._attachmentFrom(ctx.items[0]) : null;
		let collectionOf = (ctx) => {
			let row = ctx.collectionTreeRows?.length === 1 ? ctx.collectionTreeRows[0] : null;
			return row?.isCollection() ? row.ref : null;
		};

		// Şablon listesi değişebildiği için alt menü her açılışta yeniden doldurulur
		let templateMenu = {
			menuType: "submenu",
			l10nID: "hafif-new-from-template",
			onShowing: (ev, ctx) => {
				let popup = ctx.menuElem?.querySelector("menupopup");
				if (!popup) return;
				let doc = popup.ownerDocument;
				for (let el of popup.querySelectorAll(".hafif-dyn")) el.remove();
				for (let tpl of notes().templates()) {
					let mi = doc.createXULElement("menuitem");
					mi.className = "hafif-dyn";
					mi.setAttribute("label", tpl.name);
					mi.addEventListener("command", this.safe(() => notes().createFromTemplate(tpl)));
					popup.append(mi);
				}
			},
			menus: [{ menuType: "menuitem", l10nID: "hafif-template-placeholder", onShowing: (ev, ctx) => ctx.setVisible(false) }],
		};

		let actionsMenu = {
			menuType: "submenu",
			l10nID: "hafif-actions-menu",
			onShowing: (ev, ctx) => {
				let popup = ctx.menuElem?.querySelector("menupopup");
				if (popup) this.load("actions").fillMenu(popup, popup.ownerGlobal);
			},
			menus: [{ menuType: "menuitem", l10nID: "hafif-template-placeholder", onShowing: (ev, ctx) => ctx.setVisible(false) }],
		};
		let action = (id, l10nID) => ({
			menuType: "menuitem",
			l10nID,
			onShowing: (ev, ctx) => {
				let k = this.load("actions").keys()[id];
				if (k) ctx.menuElem?.setAttribute("acceltext", this.load("actions").prettyKey(k));
				else ctx.menuElem?.removeAttribute("acceltext");
			},
			onCommand: this.safe(() => this.load("actions").run(id)),
		});

		Zotero.MenuManager.registerMenu({
			menuID: "hafif-item-menu",
			pluginID,
			target: "main/library/item",
			menus: [
				{ menuType: "separator" },
				actionsMenu,
				{
					menuType: "menuitem",
					l10nID: "hafif-send-items-last",
					onShowing: (ev, ctx) => ctx.setVisible(hasSource(ctx)),
					onCommand: this.safe((ev, ctx) => notes().sendItemsToLast(ctx.items)),
				},
				{
					menuType: "menuitem",
					l10nID: "hafif-edit-outline",
					onShowing: (ev, ctx) => ctx.setVisible(!!pdfOf(ctx)),
					onCommand: this.safe((ev, ctx) => this.load("outline").openEditor(pdfOf(ctx))),
				},
				{
					menuType: "menuitem",
					l10nID: "hafif-move-files",
					onShowing: (ev, ctx) => ctx.setVisible(!!ctx.items?.length && this.load("move").storedAttachments(ctx.items).length > 0),
					onCommand: this.safe((ev, ctx) => this.load("move").run(ctx.items)),
				},
			],
		});

		Zotero.MenuManager.registerMenu({
			menuID: "hafif-collection-menu",
			pluginID,
			target: "main/library/collection",
			menus: [
				{
					menuType: "menuitem",
					l10nID: "hafif-collection-target",
					onShowing: (ev, ctx) => {
						let c = collectionOf(ctx);
						ctx.setVisible(!!c);
						if (c) ctx.setL10nArgs(JSON.stringify({ on: notes().isTarget(c) ? "yes" : "no" }));
					},
					onCommand: this.safe((ev, ctx) => notes().toggleTarget(collectionOf(ctx))),
				},
				{ ...templateMenu, onShowing: (ev, ctx) => { templateMenu.onShowing(ev, ctx); ctx.setVisible(!!collectionOf(ctx)); } },
			],
		});

		let panelToggles = Hafif.load("panel").SECTIONS.map(([id, name]) => ({
			menuType: "menuitem",
			l10nID: "hafif-pane-toggle",
			onShowing: (ev, ctx) => ctx.setL10nArgs(JSON.stringify({ name, on: this.load("panel").isHidden(id) ? "no" : "yes" })),
			onCommand: this.safe(() => this.load("panel").toggle(id)),
		}));

		Zotero.MenuManager.registerMenu({
			menuID: "hafif-tools-menu",
			pluginID,
			target: "main/menubar/tools",
			menus: [
				{ menuType: "separator" },
				{ menuType: "menuitem", l10nID: "hafif-quick-search", onCommand: this.safe(() => this.load("search").toggle(Zotero.getMainWindow())) },
				{ menuType: "menuitem", l10nID: "hafif-tag-browser", onCommand: this.safe(() => this.load("tags").toggle(Zotero.getMainWindow())) },
				{ menuType: "menuitem", l10nID: "hafif-tab-manager", onCommand: this.safe(() => this.load("tabs").toggle(Zotero.getMainWindow())) },
				action("palette", "hafif-action-palette"),
				action("litSearch", "hafif-lit-search"),
				{ menuType: "separator" },
				{ menuType: "menuitem", l10nID: "hafif-open-toc", onCommand: this.safe(() => this.load("toc").open()) },
				{
					menuType: "menuitem",
					l10nID: "hafif-note-outline",
					onShowing: (ev, ctx) => ctx.setL10nArgs(JSON.stringify({ on: this.pref("noteOutline") === false ? "no" : "yes" })),
					onCommand: this.safe(() => this.load("notetoc").toggleEnabled()),
				},
				templateMenu,
				{ menuType: "menuitem", l10nID: "hafif-show-notes", onCommand: this.safe(() => notes().showCollection()) },
				{
					menuType: "menuitem",
					l10nID: "hafif-auto-append",
					onShowing: (ev, ctx) => ctx.setL10nArgs(JSON.stringify({ on: this.pref("autoAppend") ? "yes" : "no" })),
					onCommand: () => {
						let on = !this.pref("autoAppend");
						this.pref("autoAppend", on);
						this.toast(on ? this.t("hafif-auto-append-on") : this.t("hafif-auto-append-off"));
					},
				},
				{ menuType: "submenu", l10nID: "hafif-panel-menu", menus: panelToggles },
			],
		});

		Zotero.MenuManager.registerMenu({
			menuID: "hafif-view-menu",
			pluginID,
			target: "main/menubar/view",
			menus: [
				{ menuType: "separator" },
				action("fullscreen", "hafif-view-fullscreen"),
				action("focus", "hafif-view-focus"),
				action("leftPane", "hafif-view-left"),
				action("rightPane", "hafif-view-right"),
				{ menuType: "separator" },
				{
					menuType: "menuitem",
					l10nID: "hafif-edit-outline",
					enableForTabTypes: ["reader/pdf"],
					onCommand: this.safe(() => {
						let win = Zotero.getMainWindow();
						let reader = Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
						if (reader) this.load("outline").openEditor(reader.itemID);
					}),
				},
			],
		});
	},

	// ---- Not düzenleyici ----

	/** Her not düzenleyicisi açıldığında yüzen içindekiler kutusunu kurar. */
	_hookNoteEditors() {
		this.load("compat").hookNoteEditors((inst) => {
			// init() kaydı en başta yapar; _initPromise aynı adımda biraz sonra kurulur
			Promise.resolve().then(() => inst._initPromise)
				.then(() => {
					if (this.pref("noteOutline") !== false) this.load("notetoc").attach(inst);
					if (this.pref("notePreview") !== false) this.load("notepreview").attach(inst);
				})
				.catch(e => Zotero.logError(e));
		});
	},

	// ---- Okuyucu ----

	_registerReader() {
		// Vurgu sağ tık menüsü. Okuyucunun bu menüsü alt menü desteklemediği için
		// seçenekler tıklanınca ayrı bir Zotero menüsü olarak açılır.
		Zotero.Reader.registerEventListener("createAnnotationContextMenu", this.safe((event) => {
			let { reader, params, append } = event;
			let C = this.load("compat");
			let libraryID = C.readerItem(reader).libraryID;
			let keys = [...params.ids];
			let x = params.x, y = params.y;
			let pos = () => {
				let rect = C.readerIframe(reader).getBoundingClientRect();
				return C.readerWindow(reader).windowUtils.toScreenRectInCSSUnits(rect.x + x, rect.y + y, 0, 0);
			};
			let later = (fn) => C.readerWindow(reader).setTimeout(this.safe(fn), 0);
			let send = this.safe((target) => {
				let items = keys.map(k => Zotero.Items.getByLibraryAndKey(libraryID, k)).filter(Boolean);
				return this.load("notes").sendAnnotations(items, target);
			});
			append(
				{
					label: keys.length > 1 ? this.t("hafif-reader-send-n", { n: keys.length }, `Nota gönder (${keys.length} vurgu)…`) : this.t("hafif-reader-send", null, "Nota gönder…"),
					onCommand: () => later(() => {
						let p = pos();
						this._openPopup(reader, p.x, p.y, this.load("notes").menuTree(send));
					}),
				},
				{
					label: this.t("hafif-reader-ask", null, "✦ Asistana sor"),
					onCommand: () => later(async () => {
						let item = Zotero.Items.getByLibraryAndKey(libraryID, keys[0]);
						if (!item) return;
						let page = JSON.parse(item.annotationPosition || "{}").pageIndex;
						let image = null;
						if (["image", "ink"].includes(item.annotationType)) {
							// Alan seçimi: Zotero'nun önbellekteki görüntüsü modele gönderilir
							if (!(await Zotero.Annotations.hasCacheImage(item))) await Zotero.PDFWorker.renderAttachmentAnnotations(item.parentID);
							let bytes = await IOUtils.read(Zotero.Annotations.getCacheImagePath(item));
							let bin = "";
							for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
							image = { mediaType: "image/png", data: C.readerWindow(reader).btoa(bin) };
						}
						let text = [item.annotationText, item.annotationComment ? `(Yorumum: ${item.annotationComment})` : ""].filter(Boolean).join(" ");
						this.load("chat").askAboutSelection(C.readerWindow(reader), text, { page: page != null ? page + 1 : null, image });
					}),
				},
				{
					label: this.t("hafif-reader-linked", null, "Bağlı notları göster…"),
					onCommand: () => later(async () => {
						let p = pos();
						this._openPopup(reader, p.x, p.y, await this.load("notes").linkedNotesTree(keys));
					}),
				},
			);
		}), this.id);

		// Vurgu kartında ve açılır vurgu çerçevesinde doğrudan "Nota gönder" simgesi
		Zotero.Reader.registerEventListener("renderSidebarAnnotationHeader",
			this.safe((event) => this.load("sendbtn").renderSidebar(event)), this.id);
		// Araç çubuğu her okuyucuda çizilir: açılır çerçeveyi izlemeyi başlatmak için kullanılır
		Zotero.Reader.registerEventListener("renderToolbar",
			this.safe((event) => this.load("sendbtn").watch(event.reader)), this.id);
		if (Zotero.Reader._readers?.length) this.load("sendbtn").watchAll();

		// Metin seçim balonu: "Nota gönder ▾" ve "İçindekilere ekle ▾"
		Zotero.Reader.registerEventListener("renderTextSelectionPopup", this.safe((event) => {
			let { reader, doc, params, append } = event;
			let annotation = JSON.parse(JSON.stringify(params.annotation));
			let mk = (label, nodes) => {
				let b = doc.createElement("button");
				b.className = "toolbar-button wide-button";
				b.textContent = label;
				b.addEventListener("click", this.safe((e) => this._openPopup(reader, e.screenX, e.screenY + 6, nodes())));
				return b;
			};
			let toNote = mk(this.t("hafif-reader-send-menu", null, "Nota gönder ▾"), () => {
				let send = this.safe(target => this.load("notes").sendSelection(reader, annotation, target));
				return this.load("notes").menuTree(send);
			});
			let toToc = mk(this.t("hafif-reader-toc-menu", null, "İçindekilere ekle ▾"), () => [1, 2, 3].map(level => ({
				label: this.t("hafif-reader-toc-level", { level }, `${level}. düzey başlık`),
				onCommand: this.safe(() => this.load("outline").addFromSelection(reader, annotation, level)),
			})).concat([{ separator: true }, {
				label: this.t("hafif-reader-toc-edit", null, "PDF içindekilerini düzenle…"),
				onCommand: this.safe(() => this.load("outline").openEditor(reader.itemID)),
			}]));
			let ask = doc.createElement("button");
			ask.className = "toolbar-button wide-button";
			ask.textContent = this.t("hafif-reader-ask", null, "✦ Asistana sor");
			ask.addEventListener("click", this.safe(() => {
				let page = annotation.position?.pageIndex;
				this.load("chat").askAboutSelection(this.load("compat").readerWindow(reader), annotation.text, { page: page != null ? page + 1 : null });
			}));
			append(toNote, toToc, ask);
		}), this.id);
	},

	/** Menü ağacını okuyucu penceresinde, verilen ekran konumunda açar. */
	_openPopup(reader, screenX, screenY, nodes) {
		let C = this.load("compat");
		let popup = this._xulPopup(C.readerWindow(reader).document, nodes);
		C.readerPopupset(reader).append(popup);
		popup.addEventListener("popuphidden", (ev) => { if (ev.target === popup) popup.remove(); });
		popup.openPopupAtScreen(screenX, screenY, true);
	},

	/** Menü ağacından XUL menupopup kurar. Düğüm: { label, onCommand } | { label, children } | { separator }. */
	_xulPopup(doc, nodes) {
		let popup = doc.createXULElement("menupopup");
		for (let n of nodes) {
			if (n.separator) {
				popup.append(doc.createXULElement("menuseparator"));
			}
			else if (n.children) {
				let menu = doc.createXULElement("menu");
				menu.setAttribute("label", n.label);
				menu.append(this._xulPopup(doc, n.children));
				popup.append(menu);
			}
			else {
				let mi = doc.createXULElement("menuitem");
				mi.setAttribute("label", n.label);
				mi.addEventListener("command", () => n.onCommand());
				popup.append(mi);
			}
		}
		return popup;
	},

	// ---- Sağ panel bölümleri ----

	_registerSections() {
		let icon = (n) => `${this.rootURI}content/icons/${n}.svg`;
		Zotero.ItemPaneManager.registerSection({
			paneID: "hafif-cite",
			pluginID: this.id,
			header: { l10nID: "hafif-cite-header", icon: icon("cite") },
			sidenav: { l10nID: "hafif-cite-sidenav", icon: icon("cite") },
			onInit: this.safe((props) => this.load("cite").init(props)),
			onItemChange: ({ item, setEnabled }) => {
				setEnabled(!!item?.isRegularItem());
				return true;
			},
			onRender: () => {},
			onAsyncRender: this.safe(async (props) => this.load("cite").render(props)),
		});
	},
};
