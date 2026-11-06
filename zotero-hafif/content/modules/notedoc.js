/* Not belgesi modeli: Zotero not HTML'ini dışa aktarma, kaynakça, sözcük sayımı ve alıntı
 * doğrulama için düz bir blok listesine çevirir.
 *   blok: { type: "heading"|"para"|"quote"|"list"|"code"|"rule", level?, ordered?, runs?, items? }
 *   run:  { text, b?, i?, u?, sup?, sub?, code?, href? } | { cite: [{ item, locator, label, prefix, suffix }] }
 * Atıflar Zotero'nun not atıfı (span.citation) ve vurgu (span.highlight) verisinden okunur. */

Hafif.modules.notedoc = {
	_parse(html) {
		let win = Zotero.getMainWindow();
		return new win.DOMParser().parseFromString(html || "", "text/html");
	},

	_json(attr) {
		try {
			return JSON.parse(decodeURIComponent(attr || ""));
		}
		catch (e) {
			return null;
		}
	},

	/** Zotero öğe adresinden (http://zotero.org/users/…/items/KEY) kaydı bulur. */
	async itemFromURI(uri) {
		if (!uri) return null;
		try {
			let lk = Zotero.URI.getURIItemLibraryKey?.(uri);
			if (lk) {
				let it = Zotero.Items.getByLibraryAndKey(lk.libraryID, lk.key);
				if (it) return it;
			}
		}
		catch (e) {}
		try {
			let it = await Zotero.URI.getURIItem(uri);
			if (it) return it;
		}
		catch (e) {}
		let m = String(uri).match(/\/items\/([A-Z0-9]{8})$/);
		if (m) {
			for (let lib of Zotero.Libraries.getAll()) {
				let it = Zotero.Items.getByLibraryAndKey(lib.libraryID, m[1]);
				if (it) return it;
			}
		}
		return null;
	},

	/** citationItem dizisini ({ uris, locator, label, prefix, suffix }) kayıtlara çözer. */
	async resolveCitationItems(list) {
		let out = [];
		for (let ci of list || []) {
			let item = null;
			for (let u of ci.uris || []) {
				item = await this.itemFromURI(u);
				if (item) break;
			}
			if (item) out.push({ item, locator: ci.locator || "", label: ci.label || "page", prefix: ci.prefix || "", suffix: ci.suffix || "" });
		}
		return out;
	},

	/** Not HTML'i → { title, blocks }. */
	async parse(html) {
		let doc = this._parse(html);
		let root = doc.querySelector("body > div[data-schema-version]") || doc.body;
		let blocks = [];
		for (let el of root.children) await this._block(el, blocks);
		let title = blocks.find(b => b.type === "heading")?.runs?.map(r => r.text || "").join("") || "";
		return { title, blocks };
	},

	async _block(el, out) {
		let tag = el.tagName.toLowerCase();
		if (/^h[1-6]$/.test(tag)) out.push({ type: "heading", level: +tag[1], runs: await this._runs(el) });
		else if (tag === "p") out.push({ type: "para", runs: await this._runs(el) });
		else if (tag === "blockquote") {
			let inner = [];
			for (let c of el.children) await this._block(c, inner);
			if (!el.children.length) inner.push({ type: "para", runs: await this._runs(el) });
			for (let b of inner) out.push(b.type === "para" ? { ...b, type: "quote" } : b);
		}
		else if (tag === "ul" || tag === "ol") {
			let items = [];
			for (let li of el.children) {
				if (li.tagName.toLowerCase() !== "li") continue;
				let nested = [...li.children].filter(c => /^(ul|ol)$/i.test(c.tagName));
				for (let n of nested) n.remove();
				items.push({ runs: await this._runs(li), depth: 0 });
				for (let n of nested) {
					let sub = [];
					await this._block(n, sub);
					for (let s of sub) for (let it of s.items || []) items.push({ ...it, depth: it.depth + 1 });
				}
			}
			out.push({ type: "list", ordered: tag === "ol", items });
		}
		else if (tag === "pre") out.push({ type: "code", runs: [{ text: el.textContent, code: true }] });
		else if (tag === "hr") out.push({ type: "rule" });
		else if (tag === "table") {
			for (let tr of el.querySelectorAll("tr")) {
				out.push({ type: "para", runs: [{ text: [...tr.children].map(c => c.textContent.trim()).join(" | ") }] });
			}
		}
		else if (tag === "div" || tag === "section") {
			for (let c of el.children) await this._block(c, out);
		}
		else if (el.textContent.trim()) out.push({ type: "para", runs: await this._runs(el) });
	},

	async _runs(el, fmt = {}, out = []) {
		for (let n of el.childNodes) {
			if (n.nodeType === 3) {
				if (n.data) out.push({ text: n.data, ...fmt });
				continue;
			}
			if (n.nodeType !== 1) continue;
			let tag = n.tagName.toLowerCase();
			if (tag === "span" && n.classList.contains("citation")) {
				let c = this._json(n.getAttribute("data-citation"));
				let items = await this.resolveCitationItems(c?.citationItems);
				if (items.length) out.push({ cite: items, display: n.textContent });
				else out.push({ text: n.textContent, ...fmt });
				continue;
			}
			if (tag === "span" && n.classList.contains("highlight")) {
				// Vurgudan gelen alıntı: metni tutulur, vurgunun atıf bilgisi ayrıca saklanır
				let a = this._json(n.getAttribute("data-annotation"));
				let r = out.length;
				await this._runs(n, fmt, out);
				if (a?.citationItem) {
					let items = await this.resolveCitationItems([a.citationItem]);
					if (items.length) for (let i = r; i < out.length; i++) out[i].source = items[0];
				}
				continue;
			}
			if (tag === "br") {
				out.push({ text: "\n", ...fmt });
				continue;
			}
			if (tag === "img") continue;
			let f = { ...fmt };
			if (tag === "strong" || tag === "b") f.b = true;
			if (tag === "em" || tag === "i") f.i = true;
			if (tag === "u") f.u = true;
			if (tag === "sup") f.sup = true;
			if (tag === "sub") f.sub = true;
			if (tag === "code") f.code = true;
			if (tag === "a" && n.getAttribute("href")) f.href = n.getAttribute("href");
			await this._runs(n, f, out);
		}
		return out;
	},

	/** Bloklardaki bütün atıflar (sırasıyla) ve kaynak kayıtları. */
	citations(blocks) {
		let list = [];
		let walk = (runs) => {
			for (let r of runs || []) if (r.cite) list.push(r.cite);
		};
		for (let b of blocks) {
			walk(b.runs);
			for (let it of b.items || []) walk(it.runs);
		}
		return list;
	},

	citedItems(blocks) {
		let seen = new Map();
		for (let c of this.citations(blocks)) for (let ci of c) seen.set(ci.item.id, ci.item);
		return [...seen.values()];
	},

	plain(runs) {
		return (runs || []).map(r => r.text ?? r.display ?? "").join("");
	},

	/** Sözcük sayısı (atıflar sayılmaz). */
	wordCount(blocks) {
		let n = 0;
		let count = (runs) => {
			let t = (runs || []).filter(r => !r.cite).map(r => r.text || "").join(" ");
			n += (t.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) || []).length;
		};
		for (let b of blocks) {
			count(b.runs);
			for (let it of b.items || []) count(it.runs);
		}
		return n;
	},

	/** Arapça harfleri çoğunlukta olan metin (sağdan sola paragraf için). */
	isRTL(text) {
		let ar = (text.match(/[֐-ࣿיִ-﷿ﹰ-﻿]/g) || []).length;
		let lat = (text.match(/[A-Za-zÀ-ɏ]/g) || []).length;
		return ar > 0 && ar >= lat;
	},
};
