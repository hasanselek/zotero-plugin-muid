/* Asistanın değişiklik yapan araçları: not yazma/düzenleme ve kütüphane düzenleme.
 * Her araç önce ne yapacağını kullanıcıya gösterir (ctx.approve), onaylanınca uygular ve
 * geri alma işlevi bırakır (ctx.registerUndo). Notlardaki atıflar gerçek Zotero atıfı olarak
 * yazılır: [[ANAHTAR, s. N, "alıntı"]] → tıklanabilir (Yazar, yıl, s. N) atfı. */

Hafif.modules.libedit = {
	// ---- Markdown → Zotero not HTML'i ----

	_esc(s) {
		return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
	},

	/** [[ANAHTAR, s. N, "alıntı"]] → Zotero atıf öğesi. Kayıt bulunamazsa düz metin kalır. */
	_citationHTML(key, page) {
		let T = Hafif.load("libtools");
		let item;
		try {
			item = T.top(T.byKey(key));
		}
		catch (e) {
			return null;
		}
		if (!item.isRegularItem()) return null;
		let locator = null;
		if (page) {
			// PDF sayfası basılı sayfa numarasına çevrilir (biliniyorsa)
			let att = Hafif.load("chat")._pdfOf?.(key);
			locator = att && /^\d+$/.test(page) ? Hafif.load("pdfsvc").labelSync(att, +page - 1) : page;
		}
		let ci = { uris: [Zotero.URI.getItemURI(item)], itemData: Zotero.Utilities.Item.itemToCSLJSON(item) };
		if (locator) ci.locator = String(locator);
		let citation = { citationItems: [ci], properties: {} };
		let formatted;
		try {
			formatted = Zotero.EditorInstanceUtilities.formatCitation(citation);
		}
		catch (e) {
			formatted = this._esc(`(${T.creatorsShort(item, 1)} ${T.year(item)}${locator ? ", s. " + locator : ""})`);
		}
		return `<span class="citation" data-citation="${encodeURIComponent(JSON.stringify(citation))}">${formatted}</span>`;
	},

	_inline(text) {
		let out = "";
		let re = /(\[\[([A-Za-z0-9]{8})(?:\s*[,;|:]\s*(?:s\.|p\.|sayfa)?\s*([\w\-–]+))?(?:\s*[,;|]\s*["“”«„]([^"“”»\]]{2,600})["“”»])?\]\])|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|(\*([^*\s][^*]*?)\*)|(_([^_\s][^_]*?)_(?![\p{L}\p{N}]))/gu;
		let last = 0;
		let m;
		while ((m = re.exec(text))) {
			out += this._esc(text.slice(last, m.index));
			if (m[1]) out += this._citationHTML(m[2].toUpperCase(), m[3]) || this._esc(m[0]);
			else if (m[5]) out += `<strong>${this._inline(m[6])}</strong>`;
			else if (m[7]) out += `<code>${this._esc(m[8])}</code>`;
			else if (m[9]) out += `<a href="${this._esc(m[11])}">${this._esc(m[10])}</a>`;
			else if (m[12]) out += `<em>${this._inline(m[13])}</em>`;
			else if (m[14]) out += `<em>${this._inline(m[15])}</em>`;
			last = re.lastIndex;
		}
		return out + this._esc(text.slice(last));
	},

	/** Markdown'ı Zotero notunun anladığı HTML'e çevirir. */
	mdToHTML(md) {
		let lines = String(md || "").replace(/\r/g, "").split("\n");
		let html = [];
		let para = [];
		let flush = () => {
			if (para.length) html.push(`<p>${para.map(l => this._inline(l)).join("<br/>")}</p>`);
			para = [];
		};
		for (let i = 0; i < lines.length;) {
			let line = lines[i];
			let m;
			if (/^```/.test(line)) {
				flush();
				let code = [];
				i++;
				while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
				i++;
				html.push(`<pre>${this._esc(code.join("\n"))}</pre>`);
				continue;
			}
			if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
				flush();
				let lv = Math.min(6, m[1].length);
				html.push(`<h${lv}>${this._inline(m[2])}</h${lv}>`);
				i++;
				continue;
			}
			if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
				flush();
				html.push("<hr/>");
				i++;
				continue;
			}
			if (/^\s*>/.test(line)) {
				flush();
				let q = [];
				while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
				html.push(`<blockquote>${this.mdToHTML(q.join("\n"))}</blockquote>`);
				continue;
			}
			if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || "")) {
				flush();
				let cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
				let rows = [`<tr>${cells(line).map(c => `<th>${this._inline(c)}</th>`).join("")}</tr>`];
				i += 2;
				while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(`<tr>${cells(lines[i++]).map(c => `<td>${this._inline(c)}</td>`).join("")}</tr>`);
				html.push(`<table>${rows.join("")}</table>`);
				continue;
			}
			if ((m = line.match(/^(\s*)([-*+]|\d+[.)])\s+/))) {
				flush();
				let ordered = /\d/.test(m[2]);
				let items = [];
				while (i < lines.length) {
					let lm = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
					if (!lm || /\d/.test(lm[2]) !== ordered) break;
					items.push(`<li>${this._inline(lm[3])}</li>`);
					i++;
				}
				html.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
				continue;
			}
			if (!line.trim()) {
				flush();
				i++;
				continue;
			}
			para.push(line);
			i++;
		}
		flush();
		return html.join("\n");
	},

	_wrap(html) {
		return `<div data-schema-version="9">${html}</div>`;
	},

	_textPreview(html, n = 500) {
		let t = Hafif.load("libtools")._noteText(html);
		return t.length > n ? t.slice(0, n) + "…" : t;
	},

	// ---- Araçlar ----

	tools() {
		let E = this;
		let T = Hafif.load("libtools");
		let keysLabel = (keys) => (keys || []).length === 1 ? T._labelFor(keys[0]) : `${(keys || []).length} kayıt`;
		return [
			{
				name: "create_note",
				approval: true,
				label: (a) => `Not yazılıyor${a.title ? `: “${a.title}”` : ""}`,
				description: "Yeni bir Zotero notu oluşturur. İçerik Markdown yazılır (başlıklar, listeler, tablolar, alıntılar); atıflar [[ANAHTAR, s. N, \"alıntı\"]] biçiminde yazılırsa nota gerçek, tıklanabilir Zotero atıfı olarak girer. parent_key verilirse o kaydın altına (kayıt notu), yoksa bağımsız not olarak, collection verilirse o koleksiyona konur. Kullanıcı onaylamadan oluşturulmaz.",
				parameters: {
					type: "object",
					properties: {
						title: { type: "string", description: "Notun başlığı (ilk satırda büyük başlık olur)" },
						content: { type: "string", description: "Markdown içerik" },
						parent_key: { type: "string", description: "Notun ekleneceği kayıt (isteğe bağlı)" },
						collection: { type: "string", description: "Bağımsız notun konacağı koleksiyon adı ya da anahtarı (isteğe bağlı)" },
					},
					required: ["content"],
				},
				run: (a, ctx) => E.createNote(a, ctx),
			},
			{
				name: "edit_note",
				approval: true,
				label: (a) => `Not düzenleniyor: ${T._labelFor(a.key)}`,
				description: "Var olan bir Zotero notunu düzenler. İşlemler: append (sona ekle), append_to_section (heading başlıklı bölümün sonuna ekle), replace_section (heading başlıklı bölümün içeriğini değiştir, başlık kalır), insert_before_section (heading başlığından önce yeni içerik), replace_text (find metnini content ile değiştir), rewrite (bütün notu yeniden yaz; yalnızca kullanıcı açıkça isterse). Önce read_note ile oku. İçerik Markdown; atıflar [[ANAHTAR, s. N, \"alıntı\"]].",
				parameters: {
					type: "object",
					properties: {
						key: { type: "string" },
						operation: { type: "string", enum: ["append", "append_to_section", "replace_section", "insert_before_section", "replace_text", "rewrite"] },
						heading: { type: "string", description: "Bölüm başlığının metni (append_to_section, replace_section, insert_before_section için)" },
						find: { type: "string", description: "replace_text için değiştirilecek metin (nottaki gibi)" },
						content: { type: "string", description: "Eklenecek ya da yeni içerik (Markdown; replace_text'te düz metin)" },
					},
					required: ["key", "operation", "content"],
				},
				run: (a, ctx) => E.editNote(a, ctx),
			},
			{
				name: "update_item",
				approval: true,
				label: (a) => `Künye düzeltiliyor: ${T._labelFor(a.key)}`,
				description: "Bir kaydın künye alanlarını (title, date, publisher, place, publicationTitle, volume, issue, pages, language, DOI, ISBN, url, extra, abstractNote, shortTitle, series…) ve isteğe bağlı olarak yazarlarını değiştirir. Yalnızca değişecek alanları ver. Yazarlar verilirse eski listenin yerine geçer.",
				parameters: {
					type: "object",
					properties: {
						key: { type: "string" },
						fields: { type: "object", description: "{ alan_adı: yeni_değer } — boş dize alanı temizler", additionalProperties: { type: "string" } },
						creators: {
							type: "array",
							items: {
								type: "object",
								properties: { firstName: { type: "string" }, lastName: { type: "string" }, name: { type: "string", description: "tek parçalı ad (kurum vb.)" }, creatorType: { type: "string", description: "author, editor, translator… (varsayılan author)" } },
							},
						},
					},
					required: ["key"],
				},
				run: (a, ctx) => E.updateItem(a, ctx),
			},
			{
				name: "manage_tags",
				approval: true,
				label: (a) => `Etiketler: ${keysLabel(a.keys)}`,
				description: "Kayıtlara etiket ekler ve/veya kaldırır.",
				parameters: {
					type: "object",
					properties: {
						keys: { type: "array", items: { type: "string" } },
						add: { type: "array", items: { type: "string" } },
						remove: { type: "array", items: { type: "string" } },
					},
					required: ["keys"],
				},
				run: (a, ctx) => E.manageTags(a, ctx),
			},
			{
				name: "manage_collections",
				approval: true,
				label: (a) => `Koleksiyonlar: ${keysLabel(a.keys)}`,
				description: "Kayıtları koleksiyonlara ekler ve/veya koleksiyonlardan çıkarır (kayıt silinmez). Koleksiyon adı ya da anahtarı verilir.",
				parameters: {
					type: "object",
					properties: {
						keys: { type: "array", items: { type: "string" } },
						add_to: { type: "array", items: { type: "string" } },
						remove_from: { type: "array", items: { type: "string" } },
					},
					required: ["keys"],
				},
				run: (a, ctx) => E.manageCollections(a, ctx),
			},
			{
				name: "create_collection",
				approval: true,
				label: (a) => `Koleksiyon: “${a.name}”`,
				description: "Yeni koleksiyon oluşturur; parent verilirse onun altına. İstenirse keys ile kayıtları içine koyar.",
				parameters: {
					type: "object",
					properties: {
						name: { type: "string" },
						parent: { type: "string", description: "Üst koleksiyon adı ya da anahtarı (isteğe bağlı)" },
						keys: { type: "array", items: { type: "string" }, description: "İçine konacak kayıtlar (isteğe bağlı)" },
					},
					required: ["name"],
				},
				run: (a, ctx) => E.createCollection(a, ctx),
			},
			{
				name: "import_by_identifier",
				approval: true,
				label: (a) => `Kütüphaneye ekleniyor: ${(a.identifiers || []).join(", ")}`,
				description: "DOI, ISBN, PMID ya da arXiv kimliğiyle kütüphaneye yeni kayıt ekler (Zotero'nun kendi künye çekicisiyle), isteğe bağlı olarak bir koleksiyona koyar ve erişilebilir PDF'i indirir.",
				parameters: {
					type: "object",
					properties: {
						identifiers: { type: "array", items: { type: "string" } },
						collection: { type: "string" },
						find_pdf: { type: "boolean", description: "Açık erişim PDF'i de indir (varsayılan evet)" },
					},
					required: ["identifiers"],
				},
				run: (a, ctx) => E.importByIdentifier(a, ctx),
			},
		];
	},

	// ---- Notlar ----

	async createNote(a, ctx = {}) {
		let T = Hafif.load("libtools");
		let parent = a.parent_key ? T.top(T.byKey(a.parent_key)) : null;
		if (parent && !parent.isRegularItem()) parent = null;
		let col = !parent && a.collection ? T._collectionByRef(a.collection) : null;
		let body = this.mdToHTML(a.content);
		let title = (a.title || "").trim();
		let html = this._wrap((title && !/^\s*<h1/.test(body) ? `<h1>${this._esc(title)}</h1>\n` : "") + body);
		let where = parent ? `“${T._labelFor(parent.key)}” kaydının altına` : col ? `“${col.name}” koleksiyonuna` : "bağımsız not olarak";
		let ok = await ctx.approve?.({
			title: `Yeni not — ${where}`,
			items: [{ text: this._textPreview(html, 700), meta: title || "(başlıksız)" }],
			yes: "Notu oluştur",
		});
		if (ctx.approve && !ok) return "Kullanıcı notu oluşturmayı reddetti.";
		let note = new Zotero.Item("note");
		note.libraryID = parent?.libraryID ?? col?.libraryID ?? Zotero.Libraries.userLibraryID;
		if (parent) note.parentID = parent.id;
		note.setNote(html);
		if (col) note.addToCollection(col.id);
		await note.saveTx();
		ctx.registerUndo?.("Notu geri al (çöpe taşı)", async () => {
			await Zotero.Items.trashTx([note.id]);
		});
		return `Not oluşturuldu: ${note.key} (“${note.getNoteTitle()}”), ${where}.`;
	},

	/** Notun üst düzey öğeleri içinde başlığı bulur: { wrap, h, end } (end: bölümün bittiği öğe ya da null). */
	_section(wrap, heading) {
		let S = Hafif.load("search");
		let want = S.normalize(heading || "");
		let heads = [...wrap.children].filter(el => /^H[1-6]$/.test(el.tagName));
		let h = heads.find(x => S.normalize(x.textContent) === want) || heads.find(x => S.normalize(x.textContent).includes(want));
		if (!h) return null;
		let lv = +h.tagName[1];
		let end = h.nextElementSibling;
		while (end && !(/^H[1-6]$/.test(end.tagName) && +end.tagName[1] <= lv)) end = end.nextElementSibling;
		return { h, end };
	},

	async editNote(a, ctx = {}) {
		let T = Hafif.load("libtools");
		let N = Hafif.load("notes");
		let note = T.byKey(a.key);
		if (!note.isNote()) return "Bu kayıt bir not değil.";
		let old = note.getNote();
		let doc = N._parse(old);
		let wrap = N._wrapper(doc);
		let frag = (html) => {
			let d = N._parse(`<div>${html}</div>`);
			return [...d.body.firstElementChild.childNodes].map(n => doc.importNode(n, true));
		};
		let summary;
		let op = a.operation;
		let newHTML = this.mdToHTML(a.content);
		if (["append_to_section", "replace_section", "insert_before_section"].includes(op)) {
			let sec = this._section(wrap, a.heading);
			if (!sec) {
				let list = [...wrap.children].filter(el => /^H[1-6]$/.test(el.tagName)).map(x => x.textContent.trim()).slice(0, 40);
				return `“${a.heading}” başlığı notta yok. Var olan başlıklar: ${list.join(" | ") || "(başlık yok)"}`;
			}
			if (op === "append_to_section") {
				for (let n of frag(newHTML)) wrap.insertBefore(n, sec.end);
				summary = `“${sec.h.textContent.trim()}” bölümünün sonuna eklenecek`;
			}
			else if (op === "insert_before_section") {
				for (let n of frag(newHTML)) wrap.insertBefore(n, sec.h);
				summary = `“${sec.h.textContent.trim()}” başlığından önce eklenecek`;
			}
			else {
				let removed = [];
				for (let el = sec.h.nextElementSibling; el && el !== sec.end;) {
					let next = el.nextElementSibling;
					removed.push(el.textContent);
					el.remove();
					el = next;
				}
				for (let n of frag(newHTML)) wrap.insertBefore(n, sec.end);
				summary = `“${sec.h.textContent.trim()}” bölümünün içeriği değişecek (${removed.join(" ").trim().split(/\s+/).filter(Boolean).length} kelime silinip yerine yenisi yazılacak)`;
			}
		}
		else if (op === "replace_text") {
			if (!a.find) return "replace_text için find gerekli.";
			let walker = doc.createTreeWalker(wrap, 4);
			let hit = null;
			for (let n = walker.nextNode(); n; n = walker.nextNode()) {
				if (n.nodeValue.includes(a.find)) {
					hit = n;
					break;
				}
			}
			if (!hit) return `“${a.find}” notta tek bir metin parçası olarak bulunamadı (biçimlendirme bölüyor olabilir). Daha kısa bir parça dene.`;
			hit.nodeValue = hit.nodeValue.replace(a.find, a.content);
			summary = `“${a.find.slice(0, 120)}” → “${a.content.slice(0, 120)}”`;
		}
		else if (op === "rewrite") {
			wrap.replaceChildren(...frag(newHTML));
			summary = "Notun tamamı yeniden yazılacak";
		}
		else {
			for (let n of frag(newHTML)) wrap.append(n);
			summary = "Notun sonuna eklenecek";
		}
		let html = wrap.outerHTML;
		let ok = await ctx.approve?.({
			title: `“${note.getNoteTitle()}” — ${summary}`,
			items: op === "replace_text" ? [{ text: summary, meta: "metin değişikliği" }] : [{ text: this._textPreview(this.mdToHTML(a.content), 700), meta: summary }],
			yes: "Notu güncelle",
		});
		if (ctx.approve && !ok) return "Kullanıcı not değişikliğini reddetti.";
		note.setNote(html);
		await note.saveTx();
		ctx.registerUndo?.("Not değişikliğini geri al", async () => {
			note.setNote(old);
			await note.saveTx();
		});
		return `Not güncellendi: ${note.key} — ${summary}.`;
	},

	// ---- Kütüphane ----

	async updateItem(a, ctx = {}) {
		let T = Hafif.load("libtools");
		let item = T.top(T.byKey(a.key));
		if (!item.isRegularItem()) return "Yalnızca kayıtların künyesi düzenlenebilir.";
		let changes = [];
		let skipped = [];
		for (let [field, value] of Object.entries(a.fields || {})) {
			let fid = Zotero.ItemFields.getFieldIDFromTypeAndBase(item.itemTypeID, field) || Zotero.ItemFields.getID(field);
			if (!fid || !Zotero.ItemFields.isValidForType(fid, item.itemTypeID)) {
				skipped.push(field);
				continue;
			}
			let name = Zotero.ItemFields.getName(fid);
			let oldV = item.getField(name) || "";
			if (oldV !== String(value ?? "")) changes.push({ name, label: Zotero.ItemFields.getLocalizedString(name), oldV, newV: String(value ?? "") });
		}
		let oldCreators = item.getCreators();
		let newCreators = null;
		if (Array.isArray(a.creators)) {
			newCreators = a.creators.map(c => {
				let type = c.creatorType && Zotero.CreatorTypes.getID(c.creatorType) ? c.creatorType : "author";
				return c.name ? { name: c.name, creatorType: type } : { firstName: c.firstName || "", lastName: c.lastName || "", creatorType: type };
			});
		}
		let fmt = (cs) => cs.map(c => c.name || [c.lastName, c.firstName].filter(Boolean).join(", ")).join("; ") || "(yok)";
		let items = changes.map(c => ({ text: `${c.oldV || "(boş)"}  →  ${c.newV || "(boş)"}`, meta: c.label }));
		if (newCreators) items.push({ text: `${fmt(oldCreators)}  →  ${fmt(newCreators)}`, meta: "Yazarlar" });
		if (!items.length) return "Değişecek bir şey yok." + (skipped.length ? ` Bu kayıt türünde olmayan alanlar: ${skipped.join(", ")}` : "");
		let ok = await ctx.approve?.({
			title: `“${item.getDisplayTitle().slice(0, 80)}” künyesi değişecek`,
			items,
			note: skipped.length ? `Bu kayıt türünde olmadığı için atlanacak: ${skipped.join(", ")}` : "",
			yes: "Künyeyi güncelle",
		});
		if (ctx.approve && !ok) return "Kullanıcı künye değişikliğini reddetti.";
		for (let c of changes) item.setField(c.name, c.newV);
		if (newCreators) item.setCreators(newCreators);
		await item.saveTx();
		ctx.registerUndo?.("Künye değişikliğini geri al", async () => {
			for (let c of changes) item.setField(c.name, c.oldV);
			if (newCreators) item.setCreators(oldCreators);
			await item.saveTx();
		});
		return `Künye güncellendi (${item.key}): ${items.map(i => i.meta).join(", ")}.`;
	},

	_items(keys) {
		let T = Hafif.load("libtools");
		let out = new Map();
		for (let k of keys || []) {
			let it = T.top(T.byKey(k));
			out.set(it.id, it);
		}
		return [...out.values()];
	},

	async manageTags(a, ctx = {}) {
		let items = this._items(a.keys);
		let add = (a.add || []).map(t => String(t).trim()).filter(Boolean);
		let remove = (a.remove || []).map(t => String(t).trim()).filter(Boolean);
		if (!items.length || (!add.length && !remove.length)) return "Kayıt ya da etiket verilmedi.";
		let plan = items.map(it => ({
			it,
			add: add.filter(t => !it.hasTag(t)),
			remove: remove.filter(t => it.hasTag(t)),
		})).filter(p => p.add.length || p.remove.length);
		if (!plan.length) return "Değişecek bir şey yok (etiketler zaten istenen durumda).";
		let T = Hafif.load("libtools");
		let ok = await ctx.approve?.({
			title: `${plan.length} kaydın etiketleri değişecek`,
			items: plan.slice(0, 30).map(p => ({
				text: [p.add.length ? "+ " + p.add.join(", ") : "", p.remove.length ? "− " + p.remove.join(", ") : ""].filter(Boolean).join("   "),
				meta: T._labelFor(p.it.key) + " · " + p.it.getDisplayTitle().slice(0, 60),
			})),
			note: plan.length > 30 ? `… ve ${plan.length - 30} kayıt daha` : "",
			yes: "Etiketleri uygula",
		});
		if (ctx.approve && !ok) return "Kullanıcı etiket değişikliğini reddetti.";
		await Zotero.DB.executeTransaction(async () => {
			for (let p of plan) {
				for (let t of p.add) p.it.addTag(t);
				for (let t of p.remove) p.it.removeTag(t);
				await p.it.save();
			}
		});
		ctx.registerUndo?.("Etiket değişikliğini geri al", async () => {
			await Zotero.DB.executeTransaction(async () => {
				for (let p of plan) {
					for (let t of p.add) p.it.removeTag(t);
					for (let t of p.remove) p.it.addTag(t);
					await p.it.save();
				}
			});
		});
		return `${plan.length} kaydın etiketleri güncellendi.`;
	},

	async manageCollections(a, ctx = {}) {
		let T = Hafif.load("libtools");
		let items = this._items(a.keys);
		let addTo = (a.add_to || []).map(r => T._collectionByRef(r));
		let removeFrom = (a.remove_from || []).map(r => T._collectionByRef(r));
		if (!items.length || (!addTo.length && !removeFrom.length)) return "Kayıt ya da koleksiyon verilmedi.";
		let plan = items.map(it => ({
			it,
			add: addTo.filter(c => c.libraryID === it.libraryID && !it.inCollection(c.id)),
			remove: removeFrom.filter(c => it.inCollection(c.id)),
		})).filter(p => p.add.length || p.remove.length);
		if (!plan.length) return "Değişecek bir şey yok.";
		let ok = await ctx.approve?.({
			title: `${plan.length} kayıt koleksiyonlara taşınacak`,
			items: plan.slice(0, 30).map(p => ({
				text: [p.add.length ? "→ " + p.add.map(c => c.name).join(", ") : "", p.remove.length ? "✕ " + p.remove.map(c => c.name).join(", ") : ""].filter(Boolean).join("   "),
				meta: T._labelFor(p.it.key) + " · " + p.it.getDisplayTitle().slice(0, 60),
			})),
			note: (plan.length > 30 ? `… ve ${plan.length - 30} kayıt daha. ` : "") + "Koleksiyondan çıkarmak kaydı silmez.",
			yes: "Uygula",
		});
		if (ctx.approve && !ok) return "Kullanıcı koleksiyon değişikliğini reddetti.";
		await Zotero.DB.executeTransaction(async () => {
			for (let p of plan) {
				for (let c of p.add) p.it.addToCollection(c.id);
				for (let c of p.remove) p.it.removeFromCollection(c.id);
				await p.it.save();
			}
		});
		ctx.registerUndo?.("Koleksiyon değişikliğini geri al", async () => {
			await Zotero.DB.executeTransaction(async () => {
				for (let p of plan) {
					for (let c of p.add) p.it.removeFromCollection(c.id);
					for (let c of p.remove) p.it.addToCollection(c.id);
					await p.it.save();
				}
			});
		});
		return `${plan.length} kaydın koleksiyonları güncellendi.`;
	},

	async createCollection(a, ctx = {}) {
		let T = Hafif.load("libtools");
		let parent = a.parent ? T._collectionByRef(a.parent) : null;
		let items = a.keys?.length ? this._items(a.keys) : [];
		let name = String(a.name || "").trim();
		if (!name) return "Koleksiyon adı gerekli.";
		let ok = await ctx.approve?.({
			title: `Yeni koleksiyon: “${name}”${parent ? ` (“${parent.name}” altında)` : ""}`,
			items: items.slice(0, 30).map(it => ({ text: it.getDisplayTitle().slice(0, 100), meta: T._labelFor(it.key) })),
			note: items.length ? `${items.length} kayıt içine konacak.` : "",
			yes: "Oluştur",
		});
		if (ctx.approve && !ok) return "Kullanıcı koleksiyon oluşturmayı reddetti.";
		let col = new Zotero.Collection();
		col.libraryID = parent?.libraryID ?? items[0]?.libraryID ?? Zotero.Libraries.userLibraryID;
		col.name = name;
		if (parent) col.parentID = parent.id;
		await col.saveTx();
		if (items.length) {
			await Zotero.DB.executeTransaction(async () => {
				for (let it of items) {
					if (it.libraryID !== col.libraryID) continue;
					it.addToCollection(col.id);
					await it.save();
				}
			});
		}
		ctx.registerUndo?.("Koleksiyonu geri al", async () => {
			await col.eraseTx();
		});
		return `Koleksiyon oluşturuldu: “${name}” (${col.key})${items.length ? `, ${items.length} kayıt kondu` : ""}.`;
	},

	async importByIdentifier(a, ctx = {}) {
		let T = Hafif.load("libtools");
		let ids = [];
		for (let s of a.identifiers || []) ids.push(...Zotero.Utilities.extractIdentifiers(String(s)));
		if (!ids.length) return "Geçerli bir DOI, ISBN, PMID ya da arXiv kimliği bulunamadı.";
		let col = a.collection ? T._collectionByRef(a.collection) : null;
		let show = (id) => id.DOI ? "DOI " + id.DOI : id.ISBN ? "ISBN " + id.ISBN : id.PMID ? "PMID " + id.PMID : id.arXiv ? "arXiv " + id.arXiv : JSON.stringify(id);
		let ok = await ctx.approve?.({
			title: `${ids.length} kayıt kütüphaneye eklenecek${col ? ` (“${col.name}” koleksiyonuna)` : ""}`,
			items: ids.map(id => ({ text: show(id), meta: a.find_pdf === false ? "yalnızca künye" : "künye + erişilebilirse PDF" })),
			yes: "Ekle",
		});
		if (ctx.approve && !ok) return "Kullanıcı kayıt eklemeyi reddetti.";
		let libraryID = col?.libraryID ?? Zotero.Libraries.userLibraryID;
		let created = [];
		let failed = [];
		for (let id of ids) {
			try {
				let tr = new Zotero.Translate.Search();
				tr.setIdentifier(id);
				tr.setTranslator(await tr.getTranslators());
				let items = await tr.translate({ libraryID, collections: col ? [col.id] : false, saveAttachments: a.find_pdf !== false });
				created.push(...items);
				if (a.find_pdf !== false) {
					for (let it of items) {
						if (!it.getAttachments().length) {
							try {
								await Zotero.Attachments.addAvailableFile(it);
							}
							catch (e) {}
						}
					}
				}
			}
			catch (e) {
				failed.push(show(id));
			}
		}
		if (created.length) {
			ctx.registerUndo?.(`Eklenen ${created.length} kaydı geri al (çöpe taşı)`, async () => {
				await Zotero.Items.trashTx(created.map(i => i.id));
			});
		}
		return (created.length ? `Eklendi: ${created.map(i => `${i.key} “${i.getDisplayTitle().slice(0, 80)}”`).join("; ")}.` : "Hiçbir kayıt eklenemedi.")
			+ (failed.length ? ` Bulunamayanlar: ${failed.join(", ")}.` : "");
	},
};
