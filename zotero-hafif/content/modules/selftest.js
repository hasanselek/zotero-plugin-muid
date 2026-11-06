/* Kendi kendini sınama. extensions.hafif.selfTest açıksa Zotero açılışından birkaç saniye sonra çalışır.
 * Kütüphaneye yazmaz: yalnızca okur, pencereleri açıp kapatır. Sonuçlar hata ayıklama kaydına
 * "[Hafif TEST]" önekiyle yazılır. */

Hafif.modules.selftest = {
	async run() {
		let results = [];
		let log = (ok, name, info = "") => {
			results.push(ok);
			Zotero.debug(`[Hafif TEST] ${ok ? "ok  " : "FAIL"} ${name}${info ? " — " + info : ""}`);
		};
		let test = async (name, fn) => {
			try {
				let info = await fn();
				log(true, name, info);
			}
			catch (e) {
				log(false, name, e && (e.message || String(e)));
				Zotero.logError(e);
			}
		};
		let assert = (c, msg) => { if (!c) throw new Error(msg); };
		let win = Zotero.getMainWindow();
		let wait = (ms) => new Promise(r => setTimeout(r, ms));
		let waitFor = async (fn, ms = 8000) => {
			let t = Date.now();
			while (Date.now() - t < ms) {
				let v = fn();
				if (v) return v;
				await wait(100);
			}
			throw new Error("zaman aşımı");
		};

		Zotero.debug(`[Hafif TEST] başlıyor — sürüm ${Hafif.version}`);

		await test("hızlı arama dizini ve Arapça eşleşme", async () => {
			let s = Hafif.load("search");
			await s.buildIndex();
			assert(s._index.length > 0, "dizin boş");
			let ar = s._index.find(e => /[؀-ۿ]{3}/.test(e.title));
			if (ar) {
				let word = ar.title.match(/[؀-ۿ]{3,}/)[0];
				assert(s.query(word).some(e => e.id === ar.id), "Arapça başlık bulunamadı");
			}
			let t0 = Date.now();
			s.query("fıkıh hidaye");
			return `${s._index.length} kayıt, sorgu ${Date.now() - t0} ms${ar ? ", Arapça eşleşme ok" : ""}`;
		});

		await test("hızlı pencere açılıp kapanıyor", async () => {
			await Hafif.load("search").toggle(win);
			let root = win.document.querySelector(".hafif-palette");
			assert(root && !root.hidden, "pencere görünmüyor");
			Hafif.modules.palette.close(win);
			assert(root.hidden, "kapanmadı");
		});

		let notes = Hafif.load("notes");
		await test("not koleksiyonları ve başlıklar", async () => {
			let cols = notes.getCollections();
			assert(cols.length, "not koleksiyonu yok");
			let n = 0, h = 0;
			for (let c of cols) {
				for (let note of c.getChildItems(false, false).filter(i => i.isNote())) {
					n++;
					h += notes.headings(note).length;
				}
			}
			let tree = notes.menuTree(() => {});
			assert(tree.length, "menü ağacı boş");
			return `${cols.map(c => c.name).join(", ")}: ${n} not, ${h} başlık`;
		});

		await test("not şablonu doldurma", async () => {
			let tpl = notes.templates()[0];
			let html = notes.renderTemplate(tpl, "Deneme <Başlık>");
			assert(html.includes("Deneme &lt;Başlık&gt;"), "başlık yerleşmedi/kaçırılmadı");
			let doc = notes._parse(`<div data-schema-version="9">${html}</div>`);
			let hs = doc.querySelectorAll("h1, h2, h3").length;
			assert(hs >= 2, "şablonda başlık yok");
			return `“${tpl.name}”: ${hs} başlık`;
		});

		await test("vurgu → bağlı notlar", async () => {
			let rows = await Zotero.DB.queryAsync("SELECT itemID, note FROM itemNotes WHERE note LIKE ? LIMIT 1", ["%annotationKey%"]);
			if (!rows.length) return "hiçbir notta vurgu bağlantısı yok (atlandı)";
			let key = decodeURIComponent(rows[0].note.match(/annotationKey%22%3A%22([A-Z0-9]{8})%22/)[1]);
			let found = await notes.notesWithAnnotation(key);
			assert(found.some(f => f.note.id === rows[0].itemID), "not bulunamadı");
			let tree = await notes.linkedNotesTree([key]);
			return `${found.length} not, örnek: ${tree[0].label}`;
		});

		await test("atıf üretimi", async () => {
			let item = (await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, true)).find(i => i.isRegularItem() && i.getCreators().length);
			let cite = Hafif.load("cite");
			await cite.ready();
			let f = cite.format(item);
			assert(f.citation.text && f.bibliography.text, "boş çıktı");
			return `${Zotero.Styles.get(cite.styleID()).title}: ${f.citation.text}`;
		});

		let pdf = null;
		await test("PDF içindekiler okuma (dosyaya yazmadan)", async () => {
			let o = Hafif.load("outline");
			let atts = (await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, false)).filter(i => i.isPDFAttachment?.());
			for (let a of atts) {
				if (await a.fileExists()) {
					pdf = a;
					break;
				}
			}
			assert(pdf, "dosyası olan PDF yok");
			let t0 = Date.now();
			let r = await o.load(pdf);
			assert(r.pageCount > 0, "sayfa okunamadı");
			return `${r.pageCount} sayfa, ${r.entries.length} başlık, ${Date.now() - t0} ms`;
		});

		await test("PDF içindekiler yazma (geçici kopya üzerinde)", async () => {
			assert(pdf, "PDF yok");
			let o = Hafif.load("outline");
			let PDFLib = o.pdfLib();
			let tmp = PathUtils.join(PathUtils.tempDir, "hafif-selftest.pdf");
			await IOUtils.copy(await pdf.getFilePathAsync(), tmp);
			try {
				let doc = await PDFLib.PDFDocument.load(await o._read(tmp), { ignoreEncryption: true, updateMetadata: false });
				let n = doc.getPageCount();
				let entries = [
					{ title: "Test — باب الطهارة", level: 1, pageIndex: 0, top: null },
					{ title: "Alt başlık", level: 2, pageIndex: Math.min(1, n - 1), top: 300 },
				];
				o.write(PDFLib, doc, entries);
				await IOUtils.write(tmp, await doc.save({ useObjectStreams: false }));
				let back = o.read(PDFLib, await PDFLib.PDFDocument.load(await o._read(tmp), { ignoreEncryption: true }));
				assert(back.length === 2 && back[0].title === entries[0].title && back[1].level === 2, "geri okunan farklı: " + JSON.stringify(back));
				return "yazıldı ve aynen geri okundu (Arapça dahil)";
			}
			finally {
				await IOUtils.remove(tmp, { ignoreAbsent: true });
			}
		});

		await test("PDF içindekiler düzenleyici penceresi", async () => {
			assert(pdf, "PDF yok");
			let before = new Set(Services.wm.getEnumerator("hafif:outline"));
			Hafif.load("outline").openEditor(pdf);
			let w = await waitFor(() => [...Services.wm.getEnumerator("hafif:outline")].find(x => !before.has(x)));
			await waitFor(() => w.document.readyState === "complete" && w.HafifOutline?.pageCount > 0);
			let rows = w.document.querySelectorAll("#list li").length;
			w.HafifOutline.dirty = false;
			w.close();
			return `${rows} satır listelendi`;
		});

		await test("not içindekiler penceresi", async () => {
			let target = null;
			for (let c of notes.getCollections()) {
				target = c.getChildItems(false, false).find(i => i.isNote() && notes.headings(i).length > 1);
				if (target) break;
			}
			let w = Hafif.load("toc").open(target ? { noteID: target.id } : {});
			await waitFor(() => w.document.readyState === "complete" && w.HafifTOC?.current !== undefined && w.document.querySelectorAll(".note-row").length);
			let rows = w.document.querySelectorAll(".note-row").length;
			let toc = w.document.querySelectorAll("#toc-list li:not(.none)").length;
			if (target) assert(toc > 1, "içindekiler boş");
			let paras = w.document.querySelectorAll("#content > *").length;
			w.close();
			return `${rows} not listelendi, içindekiler ${toc} başlık, okuma görünümünde ${paras} blok`;
		});

		await test("etiket gezgini", async () => {
			let t = Hafif.load("tags");
			await t.load();
			let list = t.list("");
			return `${t._tags.length} etiket, ilk: ${list[0]?.title || "-"}`;
		});

		await test("sekme yöneticisi", async () => {
			let list = Hafif.load("tabs").list(win, "");
			assert(list.length >= 3, "komutlar yok");
			return `${list.length - 3} açık sekme`;
		});

		await test("sade panel seçicileri", async () => {
			let p = Hafif.load("panel");
			let present = p.SECTIONS.filter(([id]) => win.document.querySelector(`#zotero-item-pane [data-pane="${id}"]`)).length;
			assert(present > 0, "bölüm öğeleri bulunamadı");
			return `${present}/${p.SECTIONS.length} bölüm DOM'da bulundu`;
		});

		await test("PDF taşıma (yalnızca seçim, dosyaya dokunmadan)", async () => {
			let m = Hafif.load("move");
			let items = (await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, true)).filter(i => i.isRegularItem()).slice(0, 50);
			let atts = m.storedAttachments(items);
			assert(m._safe('a/b:c*?"<>|') === "a_b_c______", "dosya adı temizleme hatalı");
			return `${atts.length} depolanmış ek bulundu (ilk 50 kayıtta)`;
		});

		await test("yapay zekâ araçları (ağa çıkmadan)", async () => {
			let T = Hafif.load("libtools");
			let r = JSON.parse(await T.searchLibrary({ limit: 3 }));
			assert(r.toplam >= 0, "arama sonucu yok");
			let info = `${r.toplam} kayıt`;
			if (pdf) {
				let pages = await T.pages(pdf);
				info += `, örnek PDF ${pages.length} sayfa`;
			}
			let llm = Hafif.load("llm");
			assert(typeof fetch === "function", "fetch yok");
			return info + `, sağlayıcılar: ${llm.configured().join(", ") || "(yok)"}`;
		});

		await test("ayarlar sayfası kaydı", async () => {
			assert(Zotero.PreferencePanes.pluginPanes.some(p => p.pluginID === Hafif.id), "kayıtlı değil");
		});

		let ok = results.filter(Boolean).length;
		Zotero.debug(`[Hafif TEST] SONUÇ ${ok}/${results.length} geçti`);
		// Bir kez çalışsın: sonraki açılışlarda pencereler kendiliğinden açılmasın
		Hafif.pref("selfTest", false);
	},
};
