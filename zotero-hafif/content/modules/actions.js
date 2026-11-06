/* Eylemler: görünüm (tam ekran, sol/sağ panel, odak modu), okuma etiketleri, toplu düzenleme,
 * kopyalama ve özel betikler. Her eyleme ayarlardan kısayol verilebilir, sağ tık menüsüne konabilir
 * ve otomatik kurallara bağlanabilir (öğe eklenince, PDF açılınca, vurgu yapılınca).
 * Eylemler kütüphanede seçili kayıtlara, okuyucuda açık PDF'in üst kaydına uygulanır. */

Hafif.modules.actions = {
	GROUPS: [
		["ai", "Yapay zekâ"],
		["write", "Yazma"],
		["view", "Görünüm"],
		["read", "Okuma etiketleri"],
		["edit", "Toplu düzenleme"],
		["copy", "Kopyala ve bağlantı"],
		["org", "Düzen"],
		["script", "Özel betikler"],
	],

	TRIGGERS: [
		["itemAdd", "Kütüphaneye yeni kayıt eklenince"],
		["fileOpen", "PDF/dosya açılınca"],
		["annotationAdd", "PDF'te vurgu ya da not yapılınca"],
	],

	_keysets: new WeakMap(),
	_focus: new WeakMap(),
	_prefObservers: [],

	// ---- Yerleşik eylemler ----

	builtins() {
		let A = this;
		return [
			// Yapay zekâ
			{ id: "aiChat", group: "ai", name: "Asistan panelini aç/kapat", desc: "Sağ panelin yerine sohbet paneli: kütüphanenizde arar, PDF okur, sayfa atıflarıyla yanıtlar.", run: ({ win }) => Hafif.load("chat").toggle(win) },
			{ id: "aiNew", group: "ai", name: "Yeni asistan sohbeti", desc: "Asistan panelini boş bir sohbetle açar.", run: ({ win }) => { let c = Hafif.load("chat"); c.show(win); c.newThread(c._ensure(win)); } },
			{ id: "aiTable", group: "ai", items: true, name: "Karşılaştırma tablosu…", desc: "Seçili kayıtları belirlediğiniz sütunlara (soru, yöntem, bulgu, görüş…) göre sayfa atıflı bir tabloda karşılaştırır.", run: (c) => A.aiTable(c) },
			{ id: "aiOCR", group: "ai", items: true, name: "Taranmış PDF'i metne çevir (OCR)", desc: "Metin katmanı olmayan sayfaları görsel destekli modelle okur ve saklar; sonra aranabilir ve asistan tarafından okunabilir.", run: (c) => Hafif.load("tables").ocrAction(c.win, c.items) },
			{ id: "litSearch", group: "ai", name: "Literatür ara…", desc: "YÖK Tez, DergiPark, TDV İslâm Ansiklopedisi ve OpenAlex'te tez türü, alan, yıl ve dil süzgeçleriyle (ya da doğal dilde) arar; sonuçları künyesi ve PDF'iyle ekler.", run: () => Hafif.load("sources").open() },
			{ id: "aiMeta", group: "ai", items: true, name: "Künyeyi PDF'ten çıkar (YZ)", desc: "Seçili PDF'lerin ilk sayfalarından ve künye sayfasından künyeyi çıkarır; üst kaydı olmayan PDF'e kayıt oluşturur, olanı düzeltir (onaylı).", run: (c) => A.aiMeta(c) },
			{ id: "aiSummarize", group: "ai", name: "Asistanla özetle", desc: "Açık PDF'i ya da seçili kaydı özetletir.", run: ({ win }) => Hafif.load("chat").show(win, { prompt: "Bunu özetle: ana iddia, yöntem, temel bulgular ve sonuç; her noktaya sayfa atfı ver.", send: true }) },

			// Yazma
			{ id: "projectNew", group: "write", name: "Yeni yazım projesi…", desc: "Makale, tez, bölüm ya da tebliğ için kaynak koleksiyonu + bölümlü taslak notu + atıf stili kurar; vurgular doğrudan taslağa gider.", run: ({ win }) => Hafif.load("project").create(win) },
			{ id: "projectSwitch", group: "write", name: "Yazım projesine geç…", desc: "Etkin projeyi seçer; taslağı açar ve vurgu gönderme hedefi yapar.", run: ({ win }) => Hafif.load("project").switch(win) },
			{ id: "projectAdd", group: "write", items: true, name: "Etkin projeye kaynak olarak ekle", desc: "Seçili kayıtları etkin projenin koleksiyonuna koyar.", run: (c) => Hafif.load("project").addSources(c) },
			{ id: "projectStatus", group: "write", name: "Proje durumu…", desc: "Sözcük sayısı, bölümler, atıflar; atıf yapılmamış ve koleksiyonda olmayan kaynaklar.", run: ({ win }) => Hafif.load("project").status(win) },
			{ id: "projectBib", group: "write", name: "Proje kaynakçasını yenile", desc: "Taslaktaki atıflardan, projenin stiliyle “Kaynakça” bölümünü yeniden yazar.", run: ({ win }) => Hafif.load("project").updateBibliography(win) },
			{ id: "projectExport", group: "write", name: "Proje taslağını dışa aktar (Word / Markdown)…", desc: "Taslağı dipnotlu .docx, Pandoc Markdown ya da zengin metin olarak verir.", run: ({ win }) => Hafif.load("project").exportDraft(win) },
			{ id: "projectStyle", group: "write", name: "Projenin atıf stilini değiştir…", desc: "Etkin projenin kaynakça ve dışa aktarmada kullandığı CSL stili.", run: ({ win }) => Hafif.load("project").changeStyle(win) },
			{ id: "exportNote", group: "write", items: true, name: "Notu dışa aktar (Word / Markdown)…", desc: "Seçili notu atıfları biçimlenmiş olarak dışa aktarır (dipnot stillerinde gerçek Word dipnotları).", run: ({ win, items }) => Hafif.load("export").exportNote(win, items.find(i => i.isNote())) },
			{ id: "citekeyAssign", group: "write", items: true, auto: true, name: "Atıf anahtarı ata (Pandoc/LaTeX)", desc: "Anahtarı olmayan kayıtlara yazarYılKelime biçiminde tekil anahtar yazar (Better BibTeX gerekmez).", run: (c) => Hafif.load("citekey").assign(A._regular(c.items), { quiet: !!c.auto }) },
			{ id: "citekeyCopy", group: "write", items: true, name: "Atıf anahtarını kopyala (@anahtar)", desc: "Seçili kayıtların Pandoc atıf anahtarlarını panoya kopyalar.", run: (c) => Hafif.load("citekey").copy(A._regular(c.items)) },
			{ id: "lint", group: "edit", name: "Künye denetimi (İSNAD)…", desc: "Seçili kayıtlarda, açık koleksiyonda ya da bütün kütüphanede eksik alan, büyük harf, ISBN/DOI, tarih, dil ve transkripsiyon sorunlarını bulur.", run: ({ win }) => Hafif.load("lint").run(win) },
			{ id: "lintFix", group: "edit", items: true, auto: true, name: "Künyeyi güvenle düzelt", desc: "Fazla boşluk, sondaki nokta, DOI öneki, dil adı → kodu, büyük harfli başlık/yazar düzeltmeleri.", run: async (c) => { let n = await Hafif.load("lint").fix(A._regular(c.items)); if (!c.auto) Hafif.toast(n ? `${n} kayıt düzeltildi.` : "Düzeltilecek bir şey yok."); } },

			// Görünüm
			{ id: "fullscreen", group: "view", name: "Tam ekran", desc: "Zotero penceresini tam ekrana alır ya da çıkarır.", run: ({ win }) => A.fullscreen(win) },
			{ id: "leftPane", group: "view", name: "Sol paneli aç/kapat", desc: "Kütüphanede koleksiyonlar paneli; okuyucuda vurgular ve içindekiler kenar çubuğu.", run: ({ win }) => A.leftPane(win) },
			{ id: "rightPane", group: "view", name: "Sağ paneli aç/kapat", desc: "Kütüphanede kayıt bilgisi paneli; okuyucuda notlar ve bilgi paneli.", run: ({ win }) => A.rightPane(win) },
			{ id: "focus", group: "view", name: "Odak modu", desc: "Tam ekran ve iki panel kapalı; yalnızca metin. Tekrar basınca eski düzen geri gelir.", run: ({ win }) => A.focusMode(win) },
			{ id: "leftFloat", group: "view", name: "Yüzer sol panel (aç/kapat)", desc: "Koleksiyon paneli yer kaplamaz; sekme çubuğunun solundaki düğme her sekmede (PDF, EPUB, not) koleksiyonları ve eserleri gösteren küçük bir çerçeve açar.", run: () => Hafif.load("leftfloat").toggleEnabled() },
			{ id: "tagSelector", group: "view", name: "Etiket seçiciyi aç/kapat", desc: "Sol alttaki etiket kutusunu gizler ya da gösterir.", run: ({ win }) => win.ZoteroPane.toggleTagSelector() },

			// Okuma etiketleri
			{ id: "markToRead", group: "read", items: true, auto: true, name: "Okunacak olarak işaretle", desc: "Okunacak etiketini ekler; okunuyor/okundu etiketlerini kaldırır.", run: (c) => A.readState(c.items, "toRead") },
			{ id: "markReading", group: "read", items: true, auto: true, name: "Okunuyor olarak işaretle", desc: "Okunuyor etiketini ekler; okunacak/okundu etiketlerini kaldırır.", run: (c) => A.readState(c.items, "reading") },
			{ id: "markRead", group: "read", items: true, auto: true, name: "Okundu olarak işaretle", desc: "Okundu etiketini ekler; okunacak/okunuyor etiketlerini kaldırır.", run: (c) => A.readState(c.items, "read") },
			{ id: "toggleTag", group: "read", items: true, name: "Etiket ekle/çıkar…", desc: "Yazdığınız etiket hepsinde varsa çıkarır, yoksa ekler.", run: (c) => A.toggleTagPrompt(c) },
			{ id: "removeAutoTags", group: "read", items: true, auto: true, name: "Otomatik etiketleri sil", desc: "Veritabanlarından gelen (otomatik) etiketleri seçili kayıtlardan kaldırır; elle verdiklerinize dokunmaz.", run: (c) => A.removeAutoTags(c.items) },
			{ id: "renameTag", group: "read", name: "Etiketi yeniden adlandır (bütün kütüphane)…", desc: "Bir etiketin adını kütüphanedeki bütün kayıtlarda değiştirir.", run: (c) => A.renameTag(c) },

			// Toplu düzenleme
			{ id: "bulkField", group: "edit", items: true, name: "Alanı toplu değiştir…", desc: "Seçili kayıtlarda bir alanı ayarla, başına/sonuna ekle, bul-değiştir ya da temizle. Önce önizleme gösterilir.", run: (c) => A.bulkField(c) },
			{ id: "titleCase", group: "edit", items: true, auto: true, name: "Başlığı başlık düzenine çevir (İSNAD)", desc: "Her kelime büyük harfle; ve, ile, ya da, ki, de/da küçük; el-/’l- takıları ve Türkçe İ/ı doğru. İngilizce kayıtlarda İngilizce kurallar.", run: (c) => A.mapTitles(c.items, (t, lang) => A.titleCase(t, lang)) },
			{ id: "sentenceCase", group: "edit", items: true, name: "Başlığı cümle düzenine çevir (APA)", desc: "Yalnızca ilk kelime ve iki noktadan sonraki kelime büyük. Özel isimleri sonra kontrol edin.", run: (c) => A.mapTitles(c.items, (t, lang) => A.sentenceCase(t, lang)) },
			{ id: "cleanTitle", group: "edit", items: true, auto: true, name: "Başlığı temizle", desc: "Fazla boşlukları, sondaki noktayı ve satır sonlarını atar.", run: (c) => A.mapTitles(c.items, t => A.cleanTitle(t)) },
			{ id: "fixNames", group: "edit", items: true, auto: true, name: "BÜYÜK HARFLİ yazar adlarını düzelt", desc: "“YILMAZ, AHMET” → “Yılmaz, Ahmet” (Türkçe harf kurallarıyla).", run: (c) => A.fixNames(c.items) },
			{ id: "setLanguage", group: "edit", items: true, name: "Dil alanını ayarla…", desc: "Seçili kayıtların Dil alanını yazar (ör. tr, en, ar).", run: (c) => A.setLanguage(c) },
			{ id: "renameFiles", group: "edit", items: true, auto: true, name: "Dosyaları kayıt bilgisine göre yeniden adlandır", desc: "Eklerin dosya adlarını Zotero'nun dosya adı biçimine göre yeniler.", run: (c) => A.renameFiles(c.items) },

			// Kopyala
			{ id: "copyBib", group: "copy", items: true, name: "Kaynakça olarak kopyala", desc: "Hafif'in atıf stiliyle (Ayarlar › Atıf) kaynakça girdileri.", run: (c) => A.copyCite(c.items, false) },
			{ id: "copyCitation", group: "copy", items: true, name: "Dipnot/atıf olarak kopyala", desc: "Seçili kayıtların atfı.", run: (c) => A.copyCite(c.items, true) },
			{ id: "copyLink", group: "copy", items: true, name: "Zotero bağlantısını kopyala", desc: "zotero://select bağlantısı: Word, Obsidian ya da notlarda tıklayınca kayıt seçilir.", run: (c) => A.copyLinks(c.items, "select") },
			{ id: "copyPDFLink", group: "copy", items: true, name: "PDF açma bağlantısını kopyala", desc: "zotero://open-pdf bağlantısı; okuyucuda açıksa bulunduğunuz sayfayla.", run: (c) => A.copyLinks(c.items, "pdf", c.reader) },
			{ id: "showFile", group: "copy", items: true, name: `Dosyayı ${Hafif.load("compat").fileManagerName()} içinde göster`, desc: "İlk ekin dosyasını bilgisayarınızdaki klasöründe gösterir.", run: (c) => A.showFile(c) },

			// Düzen
			{ id: "toCollection", group: "org", items: true, name: "Yeni koleksiyona koy…", desc: "Ad verdiğiniz yeni bir koleksiyon kurar ve seçili kayıtları içine ekler.", run: (c) => A.toNewCollection(c) },
			{ id: "openPDFs", group: "org", items: true, name: "PDF'leri sekmelerde aç", desc: "Seçili kayıtların PDF'lerini ayrı sekmelerde açar.", run: (c) => A.openPDFs(c.items) },
			{ id: "palette", group: "org", name: "Eylem paleti", desc: "Bütün eylemleri yazarak bulup çalıştırın.", run: ({ win }) => A.palette(win) },
		];
	},

	/** Yerleşikler ve özel betikler birlikte. */
	all() {
		let scripts = this.scripts().map(s => ({
			id: "script:" + s.id, group: "script", items: s.items !== false, auto: true,
			name: s.name || "(adsız betik)", desc: s.desc || "Özel betik", script: s,
			run: (c) => this.runScript(s, c),
		}));
		return [...this.builtins(), ...scripts];
	},

	get(id) {
		return this.all().find(a => a.id === id);
	},

	// ---- Ayarlar ----

	_json(key, fallback) {
		try {
			let v = JSON.parse(Hafif.pref(key) || "null");
			return v ?? fallback;
		}
		catch (e) {
			return fallback;
		}
	},

	DEFAULT_KEYS: { projectSwitch: "accel+alt+P", aiChat: "accel+J", litSearch: "accel+alt+L", focus: "accel+alt+F", leftPane: "accel+alt+ArrowLeft", rightPane: "accel+alt+ArrowRight", palette: "accel+shift+K" },

	/** Kayıtlı kısayollar varsayılanların üstüne yazılır; silinen kısayol "" olarak saklanır. */
	keys() { return Object.assign({}, this.DEFAULT_KEYS, this._json("actionKeys", {})); },
	menus() { return this._json("actionMenu", { aiMeta: true, aiTable: true, markRead: true, markToRead: true, bulkField: true, titleCase: true, copyLink: true, copyBib: true }); },
	rules() { return this._json("actionRules", []); },
	scripts() { return this._json("actionScripts", []); },
	tagNames() {
		return Object.assign({ toRead: "/okunacak", reading: "/okunuyor", read: "/okundu" }, this._json("readTags", {}));
	},

	/** "accel+shift+F" → "⌘⇧F" */
	prettyKey(combo) {
		if (!combo) return "";
		let mac = Zotero.isMac;
		let map = { accel: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", alt: mac ? "⌥" : "Alt+", shift: mac ? "⇧" : "Shift+" };
		let parts = combo.split("+");
		let key = parts.pop() || "+";
		let named = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Enter: "↵", Backspace: "⌫", Escape: "esc", " ": "Boşluk" };
		return parts.map(p => map[p] || p).join("") + (named[key] || (key.length === 1 ? key.toUpperCase() : key));
	},

	/** Klavye olayından "accel+shift+F" biçimi; yalnız değiştirici tuşsa null. */
	comboFromEvent(e) {
		if (["Shift", "Control", "Alt", "Meta", "OS"].includes(e.key)) return null;
		let parts = [];
		let accel = Zotero.isMac ? e.metaKey : e.ctrlKey;
		if (accel) parts.push("accel");
		if (Zotero.isMac && e.ctrlKey) parts.push("ctrl");
		if (e.altKey) parts.push("alt");
		if (e.shiftKey) parts.push("shift");
		// ⌥ basılıyken e.key başka harf verir (ƒ gibi); fiziksel tuştan harfi al
		let key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5)
			: e.code === "BracketLeft" ? "[" : e.code === "BracketRight" ? "]" : e.key;
		if (/^F\d{1,2}$/.test(key)) return [...parts, key].join("+");
		if (!parts.length || (parts.length === 1 && parts[0] === "shift")) return null;
		return [...parts, key.length === 1 ? key.toUpperCase() : key].join("+");
	},

	// ---- Çalıştırma ----

	context(win = Zotero.getMainWindow()) {
		let tabs = win.Zotero_Tabs;
		let reader = tabs && tabs.selectedType !== "library" ? Zotero.Reader.getByTabID(tabs.selectedID) : null;
		let items;
		if (reader) {
			let att = Zotero.Items.get(reader.itemID);
			items = att ? [att.parentItem || att] : [];
		}
		else {
			items = win.ZoteroPane?.getSelectedItems() || [];
		}
		let collection = win.ZoteroPane?.getSelectedCollection?.() || null;
		return { win, reader, items, collection, libraryID: items[0]?.libraryID ?? win.ZoteroPane?.getSelectedLibraryID?.() ?? Zotero.Libraries.userLibraryID };
	},

	async run(id, ctx) {
		let a = this.get(id);
		if (!a) return Hafif.toast("Eylem bulunamadı: " + id);
		ctx = ctx || this.context();
		if (a.items && !ctx.items.length) return Hafif.toast("Önce bir ya da daha fazla kayıt seçin.");
		Hafif.log(`eylem: ${id} (${ctx.items.length} kayıt)`);
		return a.run(ctx);
	},

	/** Kayıt düzeyinde düzenlenecekler: notlar ve ekler kendi üst kayıtlarına çevrilir. */
	_regular(items) {
		let out = new Map();
		for (let it of items) {
			let top = it.isRegularItem() ? it : it.parentItem;
			if (top?.isRegularItem()) out.set(top.id, top);
		}
		return [...out.values()];
	},

	async _saveAll(items, fn) {
		let changed = 0;
		await Zotero.DB.executeTransaction(async () => {
			for (let it of items) {
				if (fn(it) !== false && it.hasChanged()) {
					await it.save();
					changed++;
				}
			}
		});
		return changed;
	},

	// ---- Yapay zekâ ----

	aiMeta({ win, items }) {
		let keys = items.filter(i => i.isPDFAttachment() || i.isRegularItem()).map(i => i.key);
		if (!keys.length) return Hafif.toast("Künyesi çıkarılacak PDF ya da kayıt seçin.");
		Hafif.load("chat").show(win, {
			prompt: `Şu ${keys.length} kaydın künyesini PDF'lerinden extract_metadata ile çıkar (her biri için ayrı ayrı): ${keys.join(", ")}. Sonuçta kısaca ne değiştiğini söyle.`,
			send: true,
		});
	},

	aiTable({ win, items }) {
		items = this._regular(items);
		if (items.length < 1) return Hafif.toast("Karşılaştırmak için kayıt seçin.");
		let cols = this._prompt(win, "Karşılaştırma tablosu", `${items.length} kayıt karşılaştırılacak. Sütunları noktalı virgülle ayırın:`, "Ana iddia; Yöntem ve kaynaklar; Temel bulgular; Mezhep/ekol");
		if (!cols) return;
		let list = cols.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
		let keys = items.map(i => i.key).join(", ");
		Hafif.load("chat").show(win, {
			prompt: `Şu ${items.length} kaydı build_table ile karşılaştır (keys: ${keys}). Sütunlar: ${list.join(" | ")}. Tabloyu göster, sonra ortak noktaları ve ayrılıkları kısaca değerlendir.`,
			send: true,
		});
	},

	// ---- Görünüm ----

	fullscreen(win) {
		win.fullScreen = !win.fullScreen;
	},

	_isLibrary(win) {
		return win.Zotero_Tabs.selectedType === "library";
	},

	_reader(win) {
		return this._isLibrary(win) ? null : Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
	},

	_floating(win) {
		return !!Hafif.modules.leftfloat?._state.get(win);
	},

	_collectionsCollapsed(win) {
		if (this._floating(win)) return !Hafif.modules.leftfloat._state.get(win).open;
		return win.document.getElementById("zotero-collections-pane")?.getAttribute("collapsed") === "true";
	},

	_setCollections(win, collapsed) {
		let doc = win.document;
		let pane = doc.getElementById("zotero-collections-pane");
		if (!pane) return;
		// Yüzer kipte panel yer kaplamaz: açmak/kapatmak kayan pencereyi açıp kapatır
		if (this._floating(win)) {
			let lf = Hafif.modules.leftfloat;
			if (collapsed) lf.close(win);
			else lf.open(win);
			return;
		}
		doc.getElementById("zotero-collections-splitter")?.setAttribute("state", collapsed ? "collapsed" : "open");
		pane.setAttribute("collapsed", collapsed);
		win.ZoteroPane.updateLayoutConstraints();
	},

	_readerSidebarOpen(reader) {
		return Hafif.load("compat").readerSidebarOpen(reader);
	},

	_setReaderSidebar(reader, open) {
		Hafif.load("compat").toggleReaderSidebar(reader, open);
	},

	leftPane(win) {
		let reader = this._reader(win);
		if (reader) this._setReaderSidebar(reader, !this._readerSidebarOpen(reader));
		else if (this._floating(win)) Hafif.modules.leftfloat.toggle(win);
		else this._setCollections(win, !this._collectionsCollapsed(win));
	},

	rightPane(win) {
		if (this._isLibrary(win)) win.ZoteroPane.toggleItemPane();
		else win.ZoteroContextPane?.togglePane();
	},

	/** Tam ekran + paneller kapalı. Açılırken eski durum saklanır, kapanırken geri yüklenir. */
	focusMode(win) {
		let prev = this._focus.get(win);
		let reader = this._reader(win);
		if (prev) {
			this._focus.delete(win);
			win.fullScreen = prev.fullScreen;
			this._setCollections(win, prev.collections);
			win.ZoteroPane.itemPane.collapsed = prev.itemPane;
			win.ZoteroPane.updateLayoutConstraints();
			if (win.ZoteroContextPane) win.ZoteroContextPane.collapsed = prev.context;
			if (reader && prev.sidebar != null) this._setReaderSidebar(reader, prev.sidebar);
			Hafif.toast("Odak modu kapandı", 1200);
			return;
		}
		this._focus.set(win, {
			fullScreen: win.fullScreen,
			collections: this._collectionsCollapsed(win),
			itemPane: win.ZoteroPane.itemPane.collapsed,
			context: win.ZoteroContextPane?.collapsed,
			sidebar: reader ? this._readerSidebarOpen(reader) : null,
		});
		win.fullScreen = true;
		this._setCollections(win, true);
		win.ZoteroPane.itemPane.collapsed = true;
		win.ZoteroPane.updateLayoutConstraints();
		if (win.ZoteroContextPane) win.ZoteroContextPane.collapsed = true;
		if (reader) this._setReaderSidebar(reader, false);
		let key = this.prettyKey(this.keys().focus);
		Hafif.toast("Odak modu" + (key ? ` — çıkmak için ${key}` : ""), 1800);
	},

	// ---- Etiketler ----

	async readState(items, state) {
		items = this._regular(items);
		let names = this.tagNames();
		let all = Object.values(names).filter(Boolean);
		let n = await this._saveAll(items, (it) => {
			for (let t of all) if (t !== names[state]) it.removeTag(t);
			if (names[state]) it.addTag(names[state]);
		});
		if (n) Hafif.toast(`${items.length} kayıt: ${names[state]}`, 1500);
	},

	async addTag(items, tag) {
		items = this._regular(items);
		return this._saveAll(items, it => { it.addTag(tag); });
	},

	async removeTag(items, tag) {
		items = this._regular(items);
		return this._saveAll(items, it => { it.removeTag(tag); });
	},

	async toggleTagPrompt({ win, items }) {
		let tag = this._prompt(win, "Etiket ekle/çıkar", "Etiket:", "");
		if (!tag) return;
		items = this._regular(items);
		let allHave = items.every(it => it.hasTag(tag));
		await this._saveAll(items, it => { allHave ? it.removeTag(tag) : it.addTag(tag); });
		Hafif.toast(`“${tag}” ${items.length} kayıttan ${allHave ? "çıkarıldı" : "eklendi"}.`);
	},

	async removeAutoTags(items) {
		items = this._regular(items);
		let count = 0;
		await this._saveAll(items, (it) => {
			for (let t of it.getTags()) {
				if (t.type === 1) {
					it.removeTag(t.tag);
					count++;
				}
			}
		});
		Hafif.toast(`${count} otomatik etiket silindi.`);
	},

	async renameTag({ win, libraryID }) {
		let from = this._prompt(win, "Etiketi yeniden adlandır", "Eski ad (tam olarak):", "");
		if (!from) return;
		if (!Zotero.Tags.getID(from)) return Hafif.toast(`“${from}” adlı etiket yok.`);
		let to = this._prompt(win, "Etiketi yeniden adlandır", `“${from}” yerine yeni ad:`, from);
		if (!to || to === from) return;
		await Zotero.Tags.rename(libraryID, from, to);
		Hafif.toast(`“${from}” → “${to}”`);
	},

	// ---- Toplu düzenleme ----

	MODES: [
		["set", "Değeri ayarla (eskisinin yerine)"],
		["prepend", "Başına ekle"],
		["append", "Sonuna ekle"],
		["replace", "Bul ve değiştir"],
		["regex", "Bul ve değiştir (düzenli ifade)"],
		["clear", "Alanı boşalt"],
	],

	/** Seçili kayıtlarda kullanılabilen alanlar, Zotero'nun Türkçe adlarıyla. */
	fieldsFor(items) {
		let names = new Map();
		for (let it of items) {
			for (let fid of Zotero.ItemFields.getItemTypeFields(it.itemTypeID)) {
				let base = Zotero.ItemFields.getBaseIDFromTypeAndField(it.itemTypeID, fid) || fid;
				let name = Zotero.ItemFields.getName(base);
				if (!names.has(name)) names.set(name, Zotero.ItemFields.getLocalizedString(name));
			}
		}
		let first = ["title", "date", "language", "publicationTitle", "publisher", "place", "series", "extra", "shortTitle", "url"];
		return [...names.entries()].map(([name, label]) => ({ name, label }))
			.sort((a, b) => ((first.indexOf(a.name) + 1 || 99) - (first.indexOf(b.name) + 1 || 99)) || a.label.localeCompare(b.label, "tr"));
	},

	/** Tek kayıtta yeni değer (alan o türde yoksa undefined). */
	computeField(item, field, mode, a = "", b = "") {
		let fid = Zotero.ItemFields.getFieldIDFromTypeAndBase(item.itemTypeID, field) || Zotero.ItemFields.getID(field);
		if (!fid || !Zotero.ItemFields.isValidForType(fid, item.itemTypeID)) return undefined;
		let name = Zotero.ItemFields.getName(fid);
		let old = item.getField(name) || "";
		let sep = field === "extra" ? "\n" : "";
		switch (mode) {
			case "set": return { name, old, value: a };
			case "prepend": return { name, old, value: old ? a + sep + old : a };
			case "append": return { name, old, value: old ? old + sep + a : a };
			case "replace": return { name, old, value: old.split(a).join(b) };
			case "regex": return { name, old, value: old.replace(new RegExp(a, "gu"), b) };
			case "clear": return { name, old, value: "" };
		}
		return undefined;
	},

	async bulkField({ win, items }) {
		items = this._regular(items);
		if (!items.length) return Hafif.toast("Düzenlenecek kayıt yok.");
		let fields = this.fieldsFor(items);
		let field = await this._pick(win, "Hangi alan değişsin?", fields.map(f => ({ title: f.label, meta: f.name, data: f })));
		if (!field) return;
		let modeIdx = this._select(win, `“${field.label}” alanı`, "Ne yapılsın?", this.MODES.map(m => m[1]));
		if (modeIdx == null) return;
		let mode = this.MODES[modeIdx][0];
		let a = "", b = "";
		if (mode === "replace" || mode === "regex") {
			a = this._prompt(win, "Bul", mode === "regex" ? "Düzenli ifade (Türkçe/Arapça harf için \\p{L} kullanın; ör. ^(\\p{L}+)):" : "Aranacak metin:", "");
			if (a == null || a === "") return;
			if (mode === "regex") {
				try {
					new RegExp(a, "gu");
				}
				catch (e) {
					return Hafif.toast("Geçersiz düzenli ifade: " + e.message, 5000);
				}
			}
			b = this._prompt(win, "Değiştir", "Yerine yazılacak (boş bırakılabilir; $1 grupları kullanılabilir):", "");
			if (b == null) return;
		}
		else if (mode !== "clear") {
			a = this._prompt(win, field.label, "Değer:", "");
			if (a == null) return;
		}
		let plan = [];
		let skipped = 0;
		for (let it of items) {
			let r = this.computeField(it, field.name, mode, a, b);
			if (!r) skipped++;
			else if (r.value !== r.old) plan.push({ it, ...r });
		}
		if (!plan.length) return Hafif.toast("Değişecek kayıt yok." + (skipped ? ` (${skipped} kayıtta bu alan yok)` : ""));
		let cut = (s) => (s.length > 70 ? s.slice(0, 70) + "…" : s) || "(boş)";
		let preview = plan.slice(0, 5).map(p => `• ${cut(p.old)}\n   → ${cut(p.value)}`).join("\n");
		let msg = `${plan.length} kayıtta “${field.label}” değişecek${skipped ? `, ${skipped} kayıtta bu alan yok` : ""}.\n\n${preview}${plan.length > 5 ? `\n… ve ${plan.length - 5} kayıt daha` : ""}\n\nUygulansın mı?`;
		if (!Services.prompt.confirm(win, "Toplu düzenleme — önizleme", msg)) return;
		await Zotero.DB.executeTransaction(async () => {
			for (let p of plan) {
				p.it.setField(p.name, p.value);
				await p.it.save();
			}
		});
		Hafif.toast(`${plan.length} kayıt güncellendi.`);
	},

	SMALL_TR: new Set(["ve", "ile", "veya", "ya", "yahut", "ki", "de", "da", "mi", "mı", "mu", "mü", "ila"]),
	SMALL_EN: new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "as", "at", "by", "in", "of", "off", "on", "per", "to", "up", "via", "vs", "from", "into", "with"]),

	_isEnglish(item) {
		return /^en\b/i.test(item?.getField?.("language") || "");
	},

	/** İSNAD başlık düzeni. lang: "tr" | "en" */
	titleCase(title, lang = "tr") {
		let loc = lang === "en" ? "en" : "tr";
		let small = lang === "en" ? this.SMALL_EN : this.SMALL_TR;
		let allCaps = title === title.toLocaleUpperCase(loc) && /\p{Lu}{3}/u.test(title);
		let upFirst = (w) => w.charAt(0).toLocaleUpperCase(loc) + w.slice(1);
		let startOfClause = true;
		return title.replace(/\S+/gu, (word) => {
			let lead = word.match(/^[("“‘'«\[]*/u)[0];
			let core = word.slice(lead.length);
			let out;
			let letters = core.replace(/[^\p{L}]/gu, "");
			if (!allCaps && letters.length >= 2 && letters === letters.toLocaleUpperCase(loc) && /\p{Lu}/u.test(letters)) {
				out = core; // kısaltma: TDV, İSAM, DİA
			}
			else if (/^[IVXLCDM]+[.,:;]?$/.test(core) && !/^(?:DI|MI|MD|LI|DC|CD)$/.test(core.replace(/[.,:;]$/, ""))) {
				out = core; // Roma rakamı
			}
			else {
				let lower = core.toLocaleLowerCase(loc);
				let bare = lower.replace(/[^\p{L}]+$/u, "");
				let prefix = lower.match(/^([ae][lrsndtzşc]|bi|li|fi)-/u);
				if (prefix) {
					// el-Hidâye, er-Risâle: takı küçük, ardındaki ad büyük
					out = prefix[0] + upFirst(lower.slice(prefix[0].length));
				}
				else if (!startOfClause && small.has(bare)) out = lower;
				else out = upFirst(lower);
				// Kitâbü’l-Ümm, Mukaddime-i İbn Haldûn: tireden sonraki ad büyük (tek harfli -i/-ı ekleri hariç)
				out = out.replace(/(['’]l-|-)(\p{L})(\p{L})/gu, (m, sep, c, d) => sep + c.toLocaleUpperCase(loc) + d);
			}
			startOfClause = /[:.?!—–]$/.test(core);
			return lead + out;
		});
	},

	sentenceCase(title, lang = "tr") {
		let loc = lang === "en" ? "en" : "tr";
		let allCaps = title === title.toLocaleUpperCase(loc) && /\p{Lu}{3}/u.test(title);
		let start = true;
		return title.replace(/\S+/gu, (word) => {
			let letters = word.replace(/[^\p{L}]/gu, "");
			let out;
			if (!allCaps && letters.length >= 2 && letters === letters.toLocaleUpperCase(loc) && /\p{Lu}/u.test(letters)) out = word;
			else {
				out = word.toLocaleLowerCase(loc);
				if (start) out = out.replace(/\p{L}/u, c => c.toLocaleUpperCase(loc));
			}
			start = /[:.?!]$/.test(word);
			return out;
		});
	},

	cleanTitle(t) {
		return t.replace(/\s+/g, " ").replace(/\s+([,.;:?!])/g, "$1").trim().replace(/(?<!\.\.)\.$/, "");
	},

	async mapTitles(items, fn) {
		items = this._regular(items);
		let n = await this._saveAll(items, (it) => {
			let t = it.getField("title");
			if (!t) return false;
			// İngilizce kayıtlarda İngilizce kurallar (Dil alanına bakılır)
			let v = fn(t, this._isEnglish(it) ? "en" : "tr");
			if (v !== t) it.setField("title", v);
		});
		Hafif.toast(n ? `${n} başlık güncellendi.` : "Değişecek başlık yok.");
	},

	async fixNames(items) {
		items = this._regular(items);
		let fix = (s) => s && s === s.toLocaleUpperCase("tr") && /\p{Lu}{2}/u.test(s)
			? s.toLocaleLowerCase("tr").replace(/(^|[\s\-'’.])(\p{L})/gu, (m, a, c) => a + c.toLocaleUpperCase("tr"))
			: s;
		let n = await this._saveAll(items, (it) => {
			let cs = it.getCreators();
			let changed = false;
			for (let c of cs) {
				for (let k of ["firstName", "lastName"]) {
					let v = fix(c[k]);
					if (v !== c[k]) {
						c[k] = v;
						changed = true;
					}
				}
			}
			if (!changed) return false;
			it.setCreators(cs);
		});
		Hafif.toast(n ? `${n} kayıtta yazar adları düzeltildi.` : "Düzeltilecek ad yok.");
	},

	async setLanguage({ win, items, value }) {
		let lang = value ?? this._prompt(win, "Dil alanı", "Dil kodu ya da adı (ör. tr, en, ar, de):", "tr");
		if (lang == null) return;
		items = this._regular(items);
		let n = await this._saveAll(items, (it) => {
			if (!Zotero.ItemFields.isValidForType(Zotero.ItemFields.getID("language"), it.itemTypeID)) return false;
			it.setField("language", lang);
		});
		if (value == null) Hafif.toast(`${n} kayıtta dil “${lang}” yapıldı.`);
	},

	async renameFiles(items) {
		let n = 0;
		for (let it of this._regular(items)) {
			for (let id of it.getAttachments()) {
				let att = Zotero.Items.get(id);
				if (!att?.isFileAttachment() || att.attachmentLinkMode === Zotero.Attachments.LINK_MODE_LINKED_URL) continue;
				let path = await att.getFilePathAsync();
				if (!path) continue;
				let base = Zotero.Attachments.getFileBaseNameFromItem(it, { attachmentTitle: att.getField("title") });
				let ext = path.match(/\.[^./\\]+$/)?.[0] || "";
				if (PathUtils.filename(path) === base + ext) continue;
				let r = await att.renameAttachmentFile(base + ext, false, true);
				if (r === true) n++;
			}
		}
		Hafif.toast(n ? `${n} dosya yeniden adlandırıldı.` : "Yeniden adlandırılacak dosya yok.");
	},

	// ---- Kopyala ----

	async copyCite(items, asCitation) {
		items = this._regular(items);
		let cite = Hafif.load("cite");
		await cite.ready();
		let style = Zotero.Styles.get(cite.styleID());
		let out = {};
		for (let fmt of ["html", "text"]) {
			let engine = style.getCiteProc(cite.locale(), fmt);
			try {
				if (asCitation) {
					engine.updateItems(items.map(i => i.id));
					let cluster = { citationItems: items.map(i => ({ id: i.id })), properties: {} };
					out[fmt] = engine.previewCitationCluster(cluster, [], [], fmt);
				}
				else out[fmt] = Zotero.Cite.makeFormattedBibliographyOrCitationList(engine, items, fmt);
			}
			finally {
				engine.free();
			}
		}
		Hafif.copy(out.html, (out.text || "").trim(), asCitation ? "Atıf kopyalandı." : `${items.length} kaynakça girdisi kopyalandı.`);
	},

	_libPath(item) {
		let lib = Zotero.Libraries.get(item.libraryID);
		return lib.libraryType === "group" ? `groups/${lib.groupID}` : "library";
	},

	copyLinks(items, kind, reader) {
		let links = [];
		for (let it of this._regular(items)) {
			if (kind === "select") links.push(`zotero://select/${this._libPath(it)}/items/${it.key}`);
			else {
				let att = reader ? Zotero.Items.get(reader.itemID) : Zotero.Items.get(it.getAttachments().find(id => Zotero.Items.get(id)?.isPDFAttachment()));
				if (!att) continue;
				let page = reader ? Hafif.load("compat").readerPage(reader)?.index : null;
				links.push(`zotero://open-pdf/${this._libPath(att)}/items/${att.key}` + (page != null ? `?page=${page + 1}` : ""));
			}
		}
		if (!links.length) return Hafif.toast("Bağlantı üretilecek PDF yok.");
		Hafif.copy(null, links.join("\n"), links.length > 1 ? `${links.length} bağlantı kopyalandı.` : "Bağlantı kopyalandı.");
	},

	async showFile({ win, items, reader }) {
		let att = reader ? Zotero.Items.get(reader.itemID) : null;
		if (!att) {
			let it = items[0];
			att = it.isFileAttachment() ? it : Zotero.Items.get(it.getAttachments().find(id => Zotero.Items.get(id)?.isFileAttachment()));
		}
		if (!att) return Hafif.toast("Dosya eki yok.");
		await win.ZoteroPane.showAttachmentInFilesystem(att.id);
	},

	// ---- Düzen ----

	async toNewCollection({ win, items, collection, libraryID }) {
		let name = this._prompt(win, "Yeni koleksiyon", "Koleksiyon adı:", "");
		if (!name) return;
		let col = new Zotero.Collection();
		col.libraryID = libraryID;
		col.name = name;
		if (collection && Services.prompt.confirm(win, "Yeni koleksiyon", `“${name}”, “${collection.name}” koleksiyonunun altına konsun mu?\n(Hayır: ana düzeye)`)) {
			col.parentID = collection.id;
		}
		await col.saveTx();
		let tops = this._regular(items);
		await Zotero.DB.executeTransaction(async () => {
			for (let it of tops) {
				it.addToCollection(col.id);
				await it.save();
			}
		});
		Hafif.toast(`${tops.length} kayıt “${name}” koleksiyonuna kondu.`);
	},

	async openPDFs(items) {
		let n = 0;
		for (let it of this._regular(items)) {
			let id = it.getAttachments().find(a => Zotero.Items.get(a)?.isPDFAttachment());
			if (id) {
				await Zotero.Reader.open(id, null, { openInBackground: n > 0 });
				n++;
			}
		}
		if (!n) Hafif.toast("PDF eki yok.");
	},

	// ---- Özel betikler ----

	async runScript(s, ctx) {
		let AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
		let fn = new AsyncFunction("items", "item", "collection", "window", "reader", "Zotero", "Hafif", "Services", s.code || "");
		let r = await fn(ctx.items, ctx.items[0] || null, ctx.collection, ctx.win, ctx.reader, Zotero, Hafif, Services);
		if (typeof r === "string" && r) Hafif.toast(r, 4000);
		return r;
	},

	// ---- Otomatik kurallar ----

	async onNotify(event, type, ids) {
		let rules = this.rules().filter(r => r.enabled !== false);
		if (!rules.length) return;
		let trigger = null;
		let items = [];
		if (type === "item" && event === "add") {
			let added = Zotero.Items.get(ids).filter(Boolean);
			let anns = added.filter(i => i.isAnnotation?.());
			let regs = added.filter(i => i.isRegularItem());
			// Eşitleme ile gelen kayıtlar "yeni" sayılmaz
			if (regs.length && !Zotero.Sync.Runner.syncInProgress) await this._fire(rules, "itemAdd", regs);
			if (anns.length) {
				let tops = anns.map(a => a.parentItem?.parentItem || a.parentItem).filter(Boolean);
				await this._fire(rules, "annotationAdd", tops);
			}
			return;
		}
		if (type === "file" && event === "open") {
			trigger = "fileOpen";
			items = Zotero.Items.get(ids).filter(Boolean).map(i => i.parentItem || i);
		}
		if (trigger && items.length) await this._fire(rules, trigger, items);
	},

	async _fire(rules, trigger, items) {
		items = this._regular(items);
		if (!items.length) return;
		for (let r of rules.filter(r => r.on === trigger)) {
			try {
				await this.applyRule(r, items);
			}
			catch (e) {
				Zotero.logError(e);
				Hafif.toast("Kural çalışmadı: " + e.message, 5000);
			}
		}
	},

	RULE_ACTIONS: [
		["addTag", "Etiket ekle"],
		["removeTag", "Etiketi kaldır"],
		["setLanguage", "Dil alanını ayarla"],
		["action", "Eylemi çalıştır"],
	],

	async applyRule(r, items) {
		let win = Zotero.getMainWindow();
		if (r.do === "addTag" && r.value) return this.addTag(items, r.value);
		if (r.do === "removeTag" && r.value) return this.removeTag(items, r.value);
		if (r.do === "setLanguage" && r.value) return this.setLanguage({ win, items, value: r.value });
		if (r.do === "action" && r.value) {
			let a = this.get(r.value);
			if (a?.auto) return a.run({ win, items, reader: null, collection: null, libraryID: items[0].libraryID, auto: true });
		}
	},

	PRESETS: [
		{ on: "itemAdd", do: "addTag", value: "/okunacak" },
		{ on: "fileOpen", do: "action", value: "markReading" },
		{ on: "itemAdd", do: "action", value: "cleanTitle" },
	],

	// ---- Kısayollar ----

	/** Kısayolları pencerenin XUL keyset'ine yazar: okuyucu dahil her sekmede çalışır. */
	bindKeys(win) {
		let doc = win.document;
		this._keysets.get(win)?.remove();
		let set = doc.createXULElement("keyset");
		set.id = "hafif-action-keys";
		for (let [id, combo] of Object.entries(this.keys())) {
			if (!combo || !this.get(id)) continue;
			let parts = combo.split("+");
			let key = parts.pop();
			let k = doc.createXULElement("key");
			k.id = "hafif-key-" + id.replace(/[^\w-]/g, "_");
			let vk = { ArrowLeft: "VK_LEFT", ArrowRight: "VK_RIGHT", ArrowUp: "VK_UP", ArrowDown: "VK_DOWN", Enter: "VK_RETURN", Backspace: "VK_BACK", " ": "VK_SPACE" }[key];
			if (vk) k.setAttribute("keycode", vk);
			else if (/^F\d+$/.test(key)) k.setAttribute("keycode", "VK_" + key);
			else k.setAttribute("key", key);
			if (parts.length) k.setAttribute("modifiers", parts.join(","));
			// <key> yalnızca oncommand ya da command özniteliği varsa etkin olur
			k.setAttribute("oncommand", "void 0;");
			k.addEventListener("command", () => Hafif.safe(() => this.run(id, this.context(win)))());
			set.append(k);
		}
		(doc.getElementById("mainKeyset")?.parentNode || doc.documentElement).append(set);
		this._keysets.set(win, set);
	},

	bindAll() {
		for (let w of Zotero.getMainWindows()) this.bindKeys(w);
	},

	unbind(win) {
		this._keysets.get(win)?.remove();
		this._keysets.delete(win);
	},

	/** Ayar değişince kısayolları yeniden kurar. */
	watchPrefs() {
		if (this._prefObservers.length) return;
		for (let k of ["actionKeys", "actionScripts"]) {
			this._prefObservers.push(Zotero.Prefs.registerObserver("extensions.hafif." + k, () => this.bindAll(), true));
		}
	},

	// ---- Palet ve menüler ----

	palette(win) {
		let keys = this.keys();
		let groups = Object.fromEntries(this.GROUPS);
		return Hafif.load("palette").toggle(win, {
			id: "actions",
			placeholder: "Eylem ara… (tam ekran, okundu, başlık, kopyala…)",
			hint: "↵ çalıştır · esc kapat",
			empty: "Eşleşen eylem yok",
			items: (q) => {
				let norm = Hafif.load("search").normalize(q);
				return this.all()
					.filter(a => a.id !== "palette")
					.filter(a => !norm || Hafif.modules.search.normalize(a.name + " " + a.desc + " " + groups[a.group]).includes(norm))
					.map(a => ({ title: a.name, meta: `${groups[a.group]} · ${a.desc}`, badge: this.prettyKey(keys[a.id]) || null, data: a }));
			},
			onEnter: (entry) => {
				if (!entry) return;
				// Palet kapandıktan sonra çalışsın ki açtığı pencereler önde olsun
				win.setTimeout(Hafif.safe(() => this.run(entry.data.id, this.context(win))), 0);
			},
		});
	},

	/** Sağ tık alt menüsünü doldurur. */
	fillMenu(popup, win) {
		let doc = popup.ownerDocument;
		for (let el of popup.querySelectorAll(".hafif-dyn")) el.remove();
		let menus = this.menus();
		let keys = this.keys();
		let list = this.all().filter(a => menus[a.id] || (a.script && a.script.menu));
		let lastGroup = null;
		for (let a of list) {
			if (lastGroup && a.group !== lastGroup) {
				let sep = doc.createXULElement("menuseparator");
				sep.className = "hafif-dyn";
				popup.append(sep);
			}
			lastGroup = a.group;
			let mi = doc.createXULElement("menuitem");
			mi.className = "hafif-dyn";
			mi.setAttribute("label", a.name);
			if (keys[a.id]) mi.setAttribute("acceltext", this.prettyKey(keys[a.id]));
			mi.addEventListener("command", Hafif.safe(() => this.run(a.id, this.context(win))));
			popup.append(mi);
		}
		let sep = doc.createXULElement("menuseparator");
		sep.className = "hafif-dyn";
		let all = doc.createXULElement("menuitem");
		all.className = "hafif-dyn";
		all.setAttribute("label", "Bütün eylemler…");
		if (keys.palette) all.setAttribute("acceltext", this.prettyKey(keys.palette));
		all.addEventListener("command", Hafif.safe(() => this.palette(win)));
		popup.append(sep, all);
	},

	// ---- Küçük pencereler ----

	_prompt(win, title, text, def) {
		let v = { value: def ?? "" };
		return Services.prompt.prompt(win, title, text, v, null, {}) ? v.value.trim() : null;
	},

	_select(win, title, text, labels) {
		let sel = { value: 0 };
		return Services.prompt.select(win, title, text, labels, sel) ? sel.value : null;
	},

	/** Paletten bir seçim yaptırır; seçilen öğenin data'sı ya da null döner. */
	_pick(win, placeholder, entries) {
		return new Promise((resolve) => {
			let done = false;
			let finish = (v) => {
				if (done) return;
				done = true;
				resolve(v);
			};
			Hafif.load("palette").toggle(win, {
				id: "pick-" + Date.now(),
				placeholder,
				hint: "↵ seç · esc vazgeç",
				items: (q) => {
					let norm = Hafif.load("search").normalize(q);
					return entries.filter(e => !norm || Hafif.modules.search.normalize(e.title + " " + (e.meta || "")).includes(norm));
				},
				onEnter: (entry) => {
					win.setTimeout(() => finish(entry?.data || null), 0);
				},
			}).then(() => {
				// Esc ya da dışarı tıklama: palet gizlenince boş dön
				let ui = Hafif.modules.palette._ui.get(win);
				let obs = new win.MutationObserver(() => {
					if (ui.root.hidden) {
						obs.disconnect();
						win.setTimeout(() => finish(null), 50);
					}
				});
				obs.observe(ui.root, { attributes: true, attributeFilter: ["hidden"] });
			});
		});
	},

	shutdown() {
		for (let w of Zotero.getMainWindows()) this.unbind(w);
		for (let id of this._prefObservers) Zotero.Prefs.unregisterObserver(id);
		this._prefObservers = [];
	},
};
