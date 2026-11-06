/* Uyumluluk katmanı: Zotero'nun resmî olmayan (iç) yapılarına erişen bütün kod buradan geçer.
 * Zotero 8/9/10'da bir iç ad değişirse yalnızca bu dosya düzeltilir. Her erişim güvenlidir:
 * bulunamayan yapı hata atmaz, null/boş değer döner ve hata ayıklama kaydına bir kez yazılır. */

Hafif.modules.compat = {
	TESTED_MAJOR: [7, 8, 9],
	_warned: new Set(),

	_warn(what) {
		if (this._warned.has(what)) return;
		this._warned.add(what);
		Hafif.log(`uyumluluk: ${what} bulunamadı (Zotero ${Zotero.version})`);
	},

	/** Zotero ana sürümü (7, 8, …). */
	major() {
		return parseInt(String(Zotero.version || "0").split(".")[0], 10) || 0;
	},

	/** Sınanmamış bir Zotero sürümündeyse bir kez uyarır. */
	checkVersion() {
		let m = this.major();
		if (m && !this.TESTED_MAJOR.includes(m)) {
			Hafif.log(`Zotero ${Zotero.version} bu sürümle sınanmadı; sorun görürseniz bildirin.`);
		}
	},

	// ---- Okuyucu ----

	/** Okuyucunun iç durumu (sayfa, kenar çubuğu, seçili vurgular). */
	readerState(reader) {
		let st = reader?._internalReader?._state;
		if (reader && !st) this._warn("reader._internalReader._state");
		return st || null;
	},

	/** { index (0'dan), count } ya da null. */
	readerPage(reader) {
		let st = this.readerState(reader);
		let v = st?.primaryViewStats;
		if (!v) return null;
		return { index: v.pageIndex ?? null, count: v.pagesCount ?? null, label: v.pageLabel ?? null };
	},

	readerSidebarOpen(reader) {
		return !!this.readerState(reader)?.sidebarOpen;
	},

	toggleReaderSidebar(reader, open) {
		let ir = reader?._internalReader;
		if (ir?.toggleSidebar) ir.toggleSidebar(open);
		else this._warn("reader._internalReader.toggleSidebar");
	},

	selectedAnnotationIDs(reader) {
		return [...(this.readerState(reader)?.selectedAnnotationIDs || [])];
	},

	/** Okuyucunun bulunduğu pencere (ana pencere ya da ayrı okuyucu penceresi). */
	readerWindow(reader) {
		return reader?._window || null;
	},

	readerIframe(reader) {
		return reader?._iframe || null;
	},

	readerItem(reader) {
		return reader?._item || (reader?.itemID ? Zotero.Items.get(reader.itemID) : null);
	},

	/** Okuyucu menülerinin ekleneceği yer. */
	readerPopupset(reader) {
		let ps = reader?._popupset;
		if (ps) return ps;
		this._warn("reader._popupset");
		let doc = this.readerWindow(reader)?.document;
		return doc?.querySelector("popupset") || doc?.documentElement || null;
	},

	/** Açık bütün okuyucular. */
	readers() {
		return Zotero.Reader._readers || [];
	},

	// ---- Not düzenleyicileri ----

	noteEditors() {
		let list = Zotero.Notes._editorInstances;
		if (!list) this._warn("Zotero.Notes._editorInstances");
		return list || [];
	},

	_origRegister: null,

	/** Her yeni not düzenleyicisi kaydında fn(instance) çağrılır; var olanlar için de hemen. */
	hookNoteEditors(fn) {
		if (typeof Zotero.Notes.registerEditorInstance !== "function") {
			this._warn("Zotero.Notes.registerEditorInstance");
			return;
		}
		if (Zotero.Notes.registerEditorInstance.hafif) return;
		let orig = this._origRegister = Zotero.Notes.registerEditorInstance;
		let hooked = function (instance) {
			let r = orig.apply(this, arguments);
			try {
				fn(instance);
			}
			catch (e) {
				Zotero.logError(e);
			}
			return r;
		};
		hooked.hafif = true;
		Zotero.Notes.registerEditorInstance = hooked;
		for (let inst of this.noteEditors()) fn(inst);
	},

	unhookNoteEditors() {
		if (this._origRegister && Zotero.Notes.registerEditorInstance?.hafif) {
			Zotero.Notes.registerEditorInstance = this._origRegister;
		}
		this._origRegister = null;
	},

	/** Düzenleyicinin iframe penceresi. */
	editorWindow(instance) {
		return instance?._iframeWindow || null;
	},

	// ---- Platform ----

	/** Dosya yöneticisinin adı: Finder / Gezgin / dosya yöneticisi. */
	fileManagerName() {
		if (Zotero.isMac) return "Finder";
		if (Zotero.isWin) return "Dosya Gezgini";
		return "dosya yöneticisi";
	},
};
