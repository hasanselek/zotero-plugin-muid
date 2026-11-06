/* Sohbet panelinin Markdown çizicisi: model çıktısını innerHTML kullanmadan DOM düğümlerine çevirir.
 * chat.js'in prototipidir: buradaki yöntemler `this` olarak sohbet modülünü görür
 * (this.h, this._citeLabel, ui…). */

Hafif.modules.chatmd = {
	// ---- Markdown ----

	/** Basit Markdown → DOM: başlık, paragraf, liste, alıntı, kod, tablo, kalın/eğik, bağlantı, atıf. */
	_renderMarkdown(ui, el, src) {
		let doc = ui.doc;
		let h = (tag, cls, text) => this.h(doc, tag, cls, text);
		el.replaceChildren();
		let lines = String(src).replace(/\r/g, "").split("\n");
		let i = 0;
		let para = [];
		let flushPara = () => {
			if (!para.length) return;
			let p = h("p");
			p.setAttribute("dir", "auto");
			this._inline(ui, p, para.join("\n"));
			el.append(p);
			para = [];
		};
		while (i < lines.length) {
			let line = lines[i];
			let m;
			if (/^```/.test(line)) {
				flushPara();
				let code = [];
				i++;
				while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
				i++;
				el.append(h("pre", "hc-code", code.join("\n")));
				continue;
			}
			if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
				flushPara();
				let hd = h("h" + Math.min(6, m[1].length + 2));
				hd.setAttribute("dir", "auto");
				this._inline(ui, hd, m[2]);
				el.append(hd);
				i++;
				continue;
			}
			if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
				flushPara();
				el.append(h("hr"));
				i++;
				continue;
			}
			if (/^\s*>/.test(line)) {
				flushPara();
				let q = [];
				while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
				let bq = h("blockquote");
				bq.setAttribute("dir", "auto");
				this._renderMarkdown(ui, bq, q.join("\n"));
				el.append(bq);
				continue;
			}
			if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
				flushPara();
				let cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
				let table = h("table");
				let tr = h("tr");
				for (let c of cells(line)) {
					let th = h("th");
					this._inline(ui, th, c);
					tr.append(th);
				}
				table.append(tr);
				i += 2;
				while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
					let r = h("tr");
					for (let c of cells(lines[i++])) {
						let td = h("td");
						td.setAttribute("dir", "auto");
						this._inline(ui, td, c);
						r.append(td);
					}
					table.append(r);
				}
				let wrap = h("div", "hc-tablewrap");
				wrap.append(table);
				el.append(wrap);
				continue;
			}
			if ((m = line.match(/^(\s*)([-*+]|\d+[.)])\s+/))) {
				flushPara();
				let ordered = /\d/.test(m[2]);
				let list = h(ordered ? "ol" : "ul");
				let base = m[1].length;
				while (i < lines.length) {
					let lm = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
					if (!lm) {
						// Liste öğesinin devam satırı
						if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && list.lastChild) {
							list.lastChild.append(doc.createTextNode(" "));
							this._inline(ui, list.lastChild, lines[i].trim());
							i++;
							continue;
						}
						break;
					}
					// Aynı düzeyde liste türü değişince (madde ↔ numara) yeni liste başlar
					if (lm[1].length <= base + 1 && /\d/.test(lm[2]) !== ordered) break;
					if (lm[1].length > base + 1 && list.lastChild) {
						// İç içe liste
						let sub = [];
						while (i < lines.length && (lines[i].match(/^(\s*)/)[1].length > base + 1) && lines[i].trim()) sub.push(lines[i++].slice(base + 2));
						let wrap = h("div");
						this._renderMarkdown(ui, wrap, sub.join("\n"));
						list.lastChild.append(...wrap.childNodes);
						continue;
					}
					let li = h("li");
					li.setAttribute("dir", "auto");
					this._inline(ui, li, lm[3]);
					list.append(li);
					i++;
				}
				el.append(list);
				continue;
			}
			if (!line.trim()) {
				flushPara();
				i++;
				continue;
			}
			para.push(line);
			i++;
		}
		flushPara();
	},

	/** Satır içi öğeler: **kalın**, *eğik*, `kod`, [bağlantı](url), [[ANAHTAR, s. N]] atıfı. */
	_inline(ui, el, text) {
		let doc = ui.doc;
		let re = /(\[\[([A-Za-z0-9]{8})(?:\s*[,;|:]\s*(?:s\.|p\.|pp\.|sayfa)?\s*([\w\-–]+))?(?:\s*[,;|]\s*["“”«„]([^"“”»\]]{2,600})["“”»])?\]\])|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|(\*([^*\s][^*]*?)\*)|(_([^_\s][^_]*?)_(?![\p{L}\p{N}]))|(\n)/gu;
		let last = 0;
		let m;
		while ((m = re.exec(text))) {
			if (m.index > last) el.append(doc.createTextNode(text.slice(last, m.index)));
			if (m[1]) {
				let key = m[2].toUpperCase();
				let page = m[3];
				let quote = m[4];
				let label = this._citeLabel(key);
				if (label) {
					let b = this.h(doc, "button", "hc-cite" + (quote ? " q" : ""));
					b.dataset.key = key;
					if (page) b.dataset.page = page;
					if (quote) b.dataset.quote = quote;
					let setText = () => {
						// PDF sayfası yerine kitabın basılı sayfa numarası gösterilir (biliniyorsa)
						let printed = page && /^\d+$/.test(page) ? this._printed(key, +page) : page;
						b.textContent = printed ? `${label}, s. ${printed}` : label;
						b.dataset.text = b.textContent;
					};
					setText();
					this._ensureLabels(key, setText);
					b.title = quote ? `“${quote}”\n— tıklayınca PDF'te bu cümle vurgulanır` : page ? "PDF'i bu sayfada aç" : "Kaydı göster";
					el.append(b);
				}
				else el.append(doc.createTextNode(m[0]));
			}
			else if (m[5]) {
				let s = this.h(doc, "strong");
				this._inline(ui, s, m[6]);
				el.append(s);
			}
			else if (m[7]) {
				let s = this.h(doc, "strong");
				this._inline(ui, s, m[8]);
				el.append(s);
			}
			else if (m[9]) el.append(this.h(doc, "code", null, m[10]));
			else if (m[11]) {
				let a = this.h(doc, "a", null, m[12]);
				a.dataset.href = m[13];
				a.href = "#";
				a.title = m[13];
				el.append(a);
			}
			else if (m[14]) {
				let s = this.h(doc, "em");
				this._inline(ui, s, m[15]);
				el.append(s);
			}
			else if (m[16]) {
				let s = this.h(doc, "em");
				this._inline(ui, s, m[17]);
				el.append(s);
			}
			else if (m[18]) el.append(this.h(doc, "br"));
			last = re.lastIndex;
		}
		if (last < text.length) el.append(doc.createTextNode(text.slice(last)));
	},
};
