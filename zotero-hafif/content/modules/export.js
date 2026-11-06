/* Notu dışa aktarma: Word (.docx, gerçek dipnotlarla), Markdown + CSL JSON (Pandoc) ve
 * zengin metin (panoya, Word/Google Docs'a yapıştırmak için).
 * Nottaki Zotero atıfları seçilen CSL stiliyle biçimlenir: dipnot stillerinde (İSNAD 2, Chicago
 * notes…) her atıf bir dipnota dönüşür ve citeproc "a.g.e./ibid." kısaltmalarını sırayla uygular;
 * yazar-tarih stillerinde metin içinde kalır. Sonuna atıf yapılan eserlerin kaynakçası eklenir.
 * .docx için hiçbir dış kitaplık kullanılmaz: OOXML parçaları yazılır, Firefox'un zip yazıcısıyla paketlenir. */

Hafif.modules.export = {
	FORMATS: [
		["docx", "Word (.docx) — dipnotlu, kaynakçalı"],
		["md", "Markdown + CSL JSON (Pandoc, Obsidian, Quarto)"],
		["html", "Zengin metin panoya (Word / Google Docs'a yapıştırmak için)"],
	],

	// ---- Giriş ----

	async exportNote(win, note, format) {
		if (!note?.isNote()) return Hafif.toast("Dışa aktarmak için bir not seçin.");
		if (!format) {
			let i = Hafif.load("actions")._select(win, "Notu dışa aktar", `“${note.getNoteTitle()}” hangi biçimde aktarılsın?`, this.FORMATS.map(f => f[1]));
			if (i == null) return;
			format = this.FORMATS[i][0];
		}
		let styleID = this.styleFor(note);
		let doc = await Hafif.load("notedoc").parse(note.getNote());
		let name = (doc.title || note.getNoteTitle() || "not").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
		if (format === "md") return this.saveMarkdown(win, doc, name);
		let fmt = await this.formatCitations(doc.blocks, styleID);
		if (format === "html") {
			let html = this.toHTML(doc.blocks, fmt);
			Hafif.copy(html, this.toPlain(doc.blocks, fmt), "Not, atıfları biçimlenmiş olarak panoya kopyalandı.");
			return;
		}
		return this.saveDocx(win, doc, fmt, name);
	},

	/** Not bir yazım projesine aitse projenin stili, değilse Hafif'in atıf stili. */
	styleFor(note) {
		let p = Hafif.load("project").forNote?.(note);
		let id = p?.style;
		if (id && Zotero.Styles.get(id)) return id;
		return Hafif.load("cite").styleID();
	},

	async _pickFile(win, title, name, ext, label) {
		let { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
		let fp = new FilePicker();
		fp.init(win, title, fp.modeSave);
		fp.appendFilter(label, "*." + ext);
		fp.defaultString = name + "." + ext;
		if (await fp.show() === fp.returnCancel) return null;
		let path = fp.file;
		return path.endsWith("." + ext) ? path : path + "." + ext;
	},

	// ---- Atıf biçimleme ----

	/**
	 * Bloklardaki atıfları sırayla biçimler.
	 * → { note: bool, strings: [html…] (atıf sırasıyla), bibliography: [html…] , styleTitle }
	 */
	async formatCitations(blocks, styleID) {
		let D = Hafif.load("notedoc");
		let clusters = D.citations(blocks);
		let items = D.citedItems(blocks);
		let cite = Hafif.load("cite");
		await cite.ready();
		let style = Zotero.Styles.get(styleID);
		if (!style) throw new Error("Atıf stili bulunamadı: " + styleID);
		let note = style.class === "note";
		let strings = [];
		if (clusters.length) {
			let engine = style.getCiteProc(cite.locale(), "html");
			try {
				engine.updateItems(items.map(i => i.id));
				let pre = [];
				clusters.forEach((cl, i) => {
					let citation = {
						citationID: "hafif" + i,
						citationItems: cl.map(ci => {
							let o = { id: ci.item.id };
							if (ci.locator) {
								o.locator = ci.locator;
								o.label = ci.label || "page";
							}
							if (ci.prefix) o.prefix = ci.prefix;
							if (ci.suffix) o.suffix = ci.suffix;
							return o;
						}),
						properties: { noteIndex: note ? i + 1 : 0 },
					};
					let res = engine.processCitationCluster(citation, pre, []);
					for (let [idx, str] of res[1] || []) strings[idx] = str;
					pre.push([citation.citationID, citation.properties.noteIndex]);
				});
			}
			finally {
				engine.free?.();
			}
		}
		let bibliography = [];
		if (items.length) {
			let engine = style.getCiteProc(cite.locale(), "html");
			try {
				let html = Zotero.Cite.makeFormattedBibliographyOrCitationList(engine, items, "html");
				let d = D._parse(html);
				let entries = [...d.querySelectorAll(".csl-entry")];
				bibliography = entries.length ? entries.map(e => e.innerHTML) : [html];
			}
			finally {
				engine.free?.();
			}
		}
		return { note, strings, bibliography, styleTitle: style.title };
	},

	/** Kaynakça başlığı notta zaten varsa otomatik kaynakça eklenmez. */
	_hasBibliography(blocks) {
		return blocks.some(b => b.type === "heading" && /^(kaynakça|kaynaklar|bibliyografya|bibliography|references|works cited)$/i.test(Hafif.load("notedoc").plain(b.runs).trim()));
	},

	// ---- Markdown ----

	_mdEscape(s) {
		return String(s).replace(/([\\`*_[\]<>])/g, "\\$1");
	},

	mdInline(runs) {
		let K = Hafif.load("citekey");
		let out = "";
		for (let r of runs || []) {
			if (r.cite) {
				let parts = r.cite.map((ci) => {
					let loc = ci.locator ? `, ${ci.label === "page" || !ci.label ? "p." : ci.label} ${ci.locator}` : "";
					return `${ci.prefix ? ci.prefix + " " : ""}@${K.get(ci.item)}${loc}${ci.suffix ? " " + ci.suffix : ""}`;
				});
				out = out.replace(/\s+$/, "") + ` [${parts.join("; ")}]`;
				continue;
			}
			let t = this._mdEscape(r.text || "").replace(/\n/g, "  \n");
			if (!t.trim()) {
				out += t;
				continue;
			}
			let lead = t.match(/^\s*/)[0], trail = t.match(/\s*$/)[0];
			let core = t.trim();
			if (r.code) core = "`" + core + "`";
			if (r.b) core = "**" + core + "**";
			if (r.i) core = "*" + core + "*";
			if (r.sup) core = "^" + core + "^";
			if (r.href) core = `[${core}](${r.href})`;
			out += lead + core + trail;
		}
		return out.replace(/\*\*\*\*/g, "");
	},

	toMarkdown(doc) {
		let lines = [];
		for (let b of doc.blocks) {
			if (b.type === "heading") lines.push("#".repeat(b.level) + " " + this.mdInline(b.runs).trim(), "");
			else if (b.type === "para") {
				let t = this.mdInline(b.runs).trim();
				if (t) lines.push(t, "");
			}
			else if (b.type === "quote") lines.push(...this.mdInline(b.runs).trim().split("\n").map(l => "> " + l), "");
			else if (b.type === "list") {
				b.items.forEach((it, i) => lines.push("  ".repeat(it.depth) + (b.ordered ? `${i + 1}. ` : "- ") + this.mdInline(it.runs).trim()));
				lines.push("");
			}
			else if (b.type === "code") lines.push("```", b.runs[0].text.replace(/\n$/, ""), "```", "");
			else if (b.type === "rule") lines.push("---", "");
		}
		return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
	},

	async saveMarkdown(win, doc, name) {
		let path = await this._pickFile(win, "Markdown olarak kaydet", name, "md", "Markdown");
		if (!path) return;
		let D = Hafif.load("notedoc");
		let K = Hafif.load("citekey");
		let items = D.citedItems(doc.blocks);
		let refsName = PathUtils.filename(path).replace(/\.md$/, "") + ".json";
		let front = items.length ? `---\ntitle: "${(doc.title || name).replace(/"/g, "'")}"\nbibliography: ${refsName}\n---\n\n` : "";
		await IOUtils.writeUTF8(path, front + this.toMarkdown(doc));
		if (items.length) {
			let csl = items.map((it) => {
				let j = Zotero.Utilities.Item.itemToCSLJSON(it);
				j.id = K.get(it);
				return j;
			});
			await IOUtils.writeUTF8(PathUtils.join(PathUtils.parent(path), refsName), JSON.stringify(csl, null, 2));
		}
		Hafif.toast(`Kaydedildi: ${PathUtils.filename(path)}${items.length ? ` ve ${refsName} (${items.length} kaynak)` : ""}`, 4000);
	},

	// ---- Zengin metin (HTML) ----

	_esc(s) {
		return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
	},

	_htmlRuns(runs, fmt, notes, counter) {
		let out = "";
		for (let r of runs || []) {
			if (r.cite) {
				let s = fmt.strings[counter.i++] || "";
				if (fmt.note) {
					notes.push(s);
					out = out.replace(/\s+$/, "") + `<sup>${notes.length}</sup>`;
				}
				else out += s;
				continue;
			}
			let t = this._esc(r.text || "").replace(/\n/g, "<br>");
			if (r.code) t = `<code>${t}</code>`;
			if (r.b) t = `<b>${t}</b>`;
			if (r.i) t = `<i>${t}</i>`;
			if (r.u) t = `<u>${t}</u>`;
			if (r.sup) t = `<sup>${t}</sup>`;
			if (r.sub) t = `<sub>${t}</sub>`;
			if (r.href) t = `<a href="${this._esc(r.href)}">${t}</a>`;
			out += t;
		}
		return out;
	},

	toHTML(blocks, fmt) {
		let notes = [];
		let counter = { i: 0 };
		let D = Hafif.load("notedoc");
		let dir = (runs) => (D.isRTL(D.plain(runs)) ? " dir=\"rtl\"" : "");
		let parts = [];
		for (let b of blocks) {
			if (b.type === "heading") parts.push(`<h${b.level}${dir(b.runs)}>${this._htmlRuns(b.runs, fmt, notes, counter)}</h${b.level}>`);
			else if (b.type === "para") parts.push(`<p${dir(b.runs)}>${this._htmlRuns(b.runs, fmt, notes, counter)}</p>`);
			else if (b.type === "quote") parts.push(`<blockquote${dir(b.runs)}><p>${this._htmlRuns(b.runs, fmt, notes, counter)}</p></blockquote>`);
			else if (b.type === "list") {
				let tag = b.ordered ? "ol" : "ul";
				parts.push(`<${tag}>${b.items.map(it => `<li${it.depth ? ` style="margin-left:${it.depth * 1.5}em"` : ""}>${this._htmlRuns(it.runs, fmt, notes, counter)}</li>`).join("")}</${tag}>`);
			}
			else if (b.type === "code") parts.push(`<pre>${this._esc(b.runs[0].text)}</pre>`);
			else if (b.type === "rule") parts.push("<hr>");
		}
		if (notes.length) parts.push("<hr>", notes.map((n, i) => `<p style="font-size:10pt"><sup>${i + 1}</sup> ${n}</p>`).join(""));
		if (fmt.bibliography.length && !this._hasBibliography(blocks)) {
			parts.push("<h2>Kaynakça</h2>", ...fmt.bibliography.map(e => `<p style="padding-left:1.27cm;text-indent:-1.27cm">${e}</p>`));
		}
		return parts.join("\n");
	},

	toPlain(blocks, fmt) {
		let d = Hafif.load("notedoc")._parse(this.toHTML(blocks, fmt));
		return [...d.body.children].map(e => e.textContent).join("\n\n");
	},

	// ---- Word (.docx) ----

	_x(s) {
		return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c])
			.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
	},

	/** Tek bir metin parçası → <w:r>. */
	_run(text, f = {}, rtl = false) {
		let pr = "";
		if (f.style) pr += `<w:rStyle w:val="${f.style}"/>`;
		if (f.b) pr += "<w:b/><w:bCs/>";
		if (f.i) pr += "<w:i/><w:iCs/>";
		if (f.u || f.href) pr += "<w:u w:val=\"single\"/>";
		if (f.smallcaps) pr += "<w:smallCaps/>";
		if (f.code) pr += "<w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\"/>";
		if (f.sup) pr += "<w:vertAlign w:val=\"superscript\"/>";
		if (f.sub) pr += "<w:vertAlign w:val=\"subscript\"/>";
		if (rtl) pr += "<w:rtl/>";
		let body = String(text).split("\n").map(t => `<w:t xml:space="preserve">${this._x(t)}</w:t>`).join("<w:br/>");
		return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}${body}</w:r>`;
	},

	/** CSL'in ürettiği küçük HTML (<i>, <b>, <span style=…>) → <w:r> dizisi. */
	_htmlToRuns(html, base = {}) {
		let d = Hafif.load("notedoc")._parse(`<div>${html}</div>`);
		let out = "";
		let walk = (node, f) => {
			for (let n of node.childNodes) {
				if (n.nodeType === 3) {
					if (n.data) out += this._run(n.data, f);
					continue;
				}
				if (n.nodeType !== 1) continue;
				let g = { ...f };
				let tag = n.tagName.toLowerCase();
				let st = n.getAttribute("style") || "";
				if (tag === "i" || tag === "em" || /font-style:\s*italic/.test(st)) g.i = true;
				if (tag === "b" || tag === "strong" || /font-weight:\s*bold/.test(st)) g.b = true;
				if (/font-style:\s*normal/.test(st)) g.i = false;
				if (/small-caps/.test(st)) g.smallcaps = true;
				if (tag === "sup") g.sup = true;
				if (tag === "sub") g.sub = true;
				if (tag === "br") {
					out += "<w:r><w:br/></w:r>";
					continue;
				}
				walk(n, g);
			}
		};
		walk(d.body.firstChild, base);
		return out;
	},

	_para(runsXML, { style, rtl, indent } = {}) {
		let pr = "";
		if (style) pr += `<w:pStyle w:val="${style}"/>`;
		if (indent) pr += `<w:ind w:left="${indent * 360}"/>`;
		if (rtl) pr += "<w:bidi/><w:jc w:val=\"right\"/>";
		return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ""}${runsXML}</w:p>`;
	},

	buildDocx(doc, fmt) {
		let D = Hafif.load("notedoc");
		let footnotes = [];
		let counter = { i: 0 };
		let runsXML = (runs) => {
			let rtl = D.isRTL(D.plain(runs));
			let parts = [];
			for (let r of runs || []) {
				if (r.cite) {
					let s = fmt.strings[counter.i++] || "";
					if (fmt.note) {
						footnotes.push(s);
						// Dipnot işaretinden önceki boşluk atılır: "metin¹." gibi
						if (parts.length) parts[parts.length - 1] = parts[parts.length - 1].replace(/(<w:t xml:space="preserve">[^<]*?)\s+(<\/w:t><\/w:r>)$/, "$1$2");
						parts.push(`<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${footnotes.length}"/></w:r>`);
					}
					else parts.push(this._htmlToRuns(s));
					continue;
				}
				if (r.text) parts.push(this._run(r.text, r, rtl));
			}
			return { xml: parts.join(""), rtl };
		};
		let body = [];
		let firstHeading = true;
		for (let b of doc.blocks) {
			if (b.type === "heading") {
				let r = runsXML(b.runs);
				let style = firstHeading && b.level === 1 ? "Title" : "Heading" + Math.min(b.level, 3);
				firstHeading = false;
				body.push(this._para(r.xml, { style, rtl: r.rtl }));
			}
			else if (b.type === "para") {
				let r = runsXML(b.runs);
				body.push(this._para(r.xml, { rtl: r.rtl }));
			}
			else if (b.type === "quote") {
				let r = runsXML(b.runs);
				body.push(this._para(r.xml, { style: "Quote", rtl: r.rtl }));
			}
			else if (b.type === "list") {
				b.items.forEach((it, i) => {
					let r = runsXML(it.runs);
					body.push(this._para(this._run(b.ordered ? `${i + 1}. ` : "• ") + r.xml, { indent: it.depth + 1, rtl: r.rtl }));
				});
			}
			else if (b.type === "code") body.push(this._para(this._run(b.runs[0].text, { code: true })));
			else if (b.type === "rule") body.push(this._para(this._run("* * *"), { style: "Center" }));
		}
		if (fmt.bibliography.length && !this._hasBibliography(doc.blocks)) {
			body.push(this._para(this._run("Kaynakça"), { style: "Heading1" }));
			for (let e of fmt.bibliography) body.push(this._para(this._htmlToRuns(e), { style: "Bibliography" }));
		}
		let NS = "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"";
		let document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body.join("")}<w:sectPr><w:footnotePr><w:numFmt w:val="decimal"/></w:footnotePr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
		let fn = footnotes.map((s, i) => `<w:footnote w:id="${i + 1}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>${this._htmlToRuns(s)}</w:p></w:footnote>`).join("");
		let footnotesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes ${NS}><w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${fn}</w:footnotes>`;
		return {
			"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
			"_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
			"word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>`,
			"word/document.xml": document,
			"word/footnotes.xml": footnotesXML,
			"word/settings.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings ${NS}><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:defaultTabStop w:val="708"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`,
			"word/styles.xml": this.STYLES.replace("{{NS}}", NS),
			"docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${this._x(doc.title || "")}</dc:title><dc:creator>Zotero Hafif</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`,
		};
	},

	STYLES: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles {{NS}}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="tr-TR" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:after="360"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="60"/><w:jc w:val="left"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720" w:right="720"/><w:spacing w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Center"><w:name w:val="Center"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Bibliography"><w:name w:val="Bibliography"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:hanging="720"/><w:spacing w:line="240" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
</w:styles>`,

	/** Parçaları geçici bir klasöre yazıp zip olarak paketler. */
	async writeZip(path, parts) {
		let tmp = PathUtils.join(Zotero.getTempDirectory().path, "hafif-docx-" + Date.now());
		await IOUtils.makeDirectory(tmp, { createAncestors: true });
		let zw = Cc["@mozilla.org/zipwriter;1"].createInstance(Ci.nsIZipWriter);
		try {
			if (await IOUtils.exists(path)) await IOUtils.remove(path);
			zw.open(Zotero.File.pathToFile(path), 0x04 | 0x08 | 0x20);
			let i = 0;
			for (let [name, content] of Object.entries(parts)) {
				let f = PathUtils.join(tmp, `p${i++}.xml`);
				await IOUtils.writeUTF8(f, content);
				zw.addEntryFile(name, Ci.nsIZipWriter.COMPRESSION_DEFAULT, Zotero.File.pathToFile(f), false);
			}
		}
		finally {
			try {
				zw.close();
			}
			catch (e) {}
			await IOUtils.remove(tmp, { recursive: true, ignoreAbsent: true });
		}
	},

	async saveDocx(win, doc, fmt, name) {
		let path = await this._pickFile(win, "Word belgesi olarak kaydet", name, "docx", "Word");
		if (!path) return;
		await this.writeZip(path, this.buildDocx(doc, fmt));
		let n = fmt.strings.length;
		Hafif.toast(`Kaydedildi: ${PathUtils.filename(path)}${n ? ` — ${n} atıf (${fmt.note ? "dipnot" : "metin içi"}, ${fmt.styleTitle})` : ""}`, 5000);
	},
};
