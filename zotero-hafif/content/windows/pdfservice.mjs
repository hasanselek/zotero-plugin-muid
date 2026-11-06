/* Görünmez PDF servisi: Zotero okuyucusunun pdf.js'iyle basılı sayfa numaralarını okur ve bir
 * alıntının sayfadaki konumunu (PDF koordinatında dikdörtgenler) bulur. Asistan atıfta
 * cümleyi vurgulamak ve PDF'e gerçek Zotero vurgusu eklemek için bunu kullanır.
 * Eşleştirme boşluk, satır sonu tirelemesi, büyük/küçük harf, Latin aksanı ve Arapça hareke
 * farklarına aldırmaz. */

import * as pdfjs from "resource://zotero/reader/pdf/build/pdf.mjs";

const BASE = "resource://zotero/reader/pdf/";
pdfjs.GlobalWorkerOptions.workerSrc = BASE + "build/pdf.worker.mjs";

const docs = new Map();
const MAX_DOCS = 3;

/** Harf katlama: yalnızca harf ve rakamlar kalır, küçük harfe iner; boşluk tamamen atılır. */
function foldChar(ch) {
	let s = ch.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, "")
		.replace(/[آأإٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
		.replace(/ı/g, "i").toLowerCase();
	return s.replace(/[^\p{L}\p{N}]/gu, "");
}

export function fold(s) {
	let out = "";
	for (let ch of s) out += foldChar(ch);
	return out;
}

async function open(id, data) {
	if (docs.has(id)) return docs.get(id);
	let task = pdfjs.getDocument({
		data,
		cMapUrl: BASE + "web/cmaps/",
		cMapPacked: true,
		standardFontDataUrl: BASE + "web/standard_fonts/",
		wasmUrl: BASE + "web/wasm/",
		isEvalSupported: false,
	});
	let doc = await task.promise;
	let entry = { doc, task, pages: new Map() };
	docs.set(id, entry);
	if (docs.size > MAX_DOCS) {
		let [oldId, old] = docs.entries().next().value;
		docs.delete(oldId);
		old.task.destroy().catch(() => {});
	}
	return entry;
}

function has(id) {
	return docs.has(id);
}

async function info(id) {
	let { doc } = docs.get(id);
	let labels = null;
	try {
		labels = await doc.getPageLabels();
	}
	catch (e) {}
	return { numPages: doc.numPages, labels };
}

/** Sayfanın karakterleri: her biri { f: katlanmış, x0, x1, y0, y1, item } */
async function chars(id, pageIndex) {
	let entry = docs.get(id);
	if (entry.pages.has(pageIndex)) return entry.pages.get(pageIndex);
	let page = await entry.doc.getPage(pageIndex + 1);
	let tc = await page.getTextContent();
	let out = [];
	let raw = "";
	tc.items.forEach((it, idx) => {
		if (!it.str) return;
		let [, , c, d, e, f] = it.transform;
		let fontH = Math.hypot(c, d) || it.height || 10;
		let w = it.width || 0;
		let n = [...it.str].length;
		let k = 0;
		for (let ch of it.str) {
			let t0 = k / n, t1 = (k + 1) / n;
			// Sağdan sola satırlarda karakterler sağdan dizilir
			if (it.dir === "rtl") [t0, t1] = [1 - t1, 1 - t0];
			let x0 = e + w * t0, x1 = e + w * t1;
			let fc = foldChar(ch);
			// Her katlanmış harf bir kayıt; asıl karakter yalnızca ilkinde (bağlaçlarda tekrar etmesin)
			[...fc].forEach((fch, j) => out.push({ f: fch, x0, x1, y0: f - fontH * 0.22, y1: f + fontH * 0.82, item: idx, ch: j ? "" : ch }));
			if (!fc && /\s/.test(ch) && out.length) out[out.length - 1].sp = true;
			// Noktalama harf sayılmaz ama metne geri konur
			if (!fc && !/\s/.test(ch) && out.length) out[out.length - 1].ch += ch;
			raw += ch;
			k++;
		}
		// Satır sonu: tireyle bölünmüş kelime birleşir, değilse araya boşluk girer
		let lastItem = out[out.length - 1];
		if (lastItem && lastItem.item === idx) {
			if (/[-\u00ad]$/.test(lastItem.ch)) lastItem.ch = lastItem.ch.replace(/[-\u00ad]$/, "");
			else lastItem.sp = true;
		}
		raw += it.hasEOL ? "\n" : " ";
	});
	let entryPage = { chars: out, folded: out.map(c => c.f).join(""), view: page.view, raw };
	entry.pages.set(pageIndex, entryPage);
	return entryPage;
}

/** Karakter aralığını satır parçalarına (dikdörtgenlere) çevirir. */
function rectsFor(cs) {
	let rects = [];
	let cur = null;
	for (let c of cs) {
		if (cur && cur.item === c.item) {
			cur.r[0] = Math.min(cur.r[0], c.x0);
			cur.r[2] = Math.max(cur.r[2], c.x1);
			continue;
		}
		// Aynı satırdaki komşu parçalar birleştirilir
		let last = rects[rects.length - 1];
		if (last && Math.abs(last[1] - c.y0) < 2 && Math.abs(last[3] - c.y1) < 2 && c.x0 - last[2] < 6 && c.x0 >= last[0]) {
			cur = { item: c.item, r: last };
			last[2] = Math.max(last[2], c.x1);
			continue;
		}
		cur = { item: c.item, r: [c.x0, c.y0, c.x1, c.y1] };
		rects.push(cur.r);
	}
	return rects.map(r => r.map(v => Math.round(v * 1000) / 1000));
}

/**
 * Alıntıyı sayfada (bulamazsa komşu sayfalarda) arar.
 * Dönüş: { pageIndex, rects, text, top, offset, view } ya da null.
 */
async function findQuote(id, pageIndex, quote, { spread = 1 } = {}) {
	let q = fold(quote || "");
	if (q.length < 3) return null;
	let { doc } = docs.get(id);
	let order = [pageIndex];
	for (let d = 1; d <= spread; d++) order.push(pageIndex + d, pageIndex - d);
	// Uzun alıntıda önce tamamı, sonra baştan ve sondan parçalar denenir
	let tries = [q];
	if (q.length > 60) tries.push(q.slice(0, 60), q.slice(-60));
	for (let t of tries) {
		for (let p of order) {
			if (p < 0 || p >= doc.numPages) continue;
			let pg = await chars(id, p);
			let i = pg.folded.indexOf(t);
			if (i < 0) continue;
			let start = i, end = i + t.length;
			// Parça bulunduysa alıntının tamamını kapsayacak kadar genişlet
			if (t !== q) {
				if (t === tries[1]) end = Math.min(pg.folded.length, i + q.length);
				else start = Math.max(0, i + t.length - q.length);
			}
			let cs = pg.chars.slice(start, end);
			let text = cs.map((c, i) => c.ch + (c.sp && i < cs.length - 1 ? " " : "")).join("").replace(/\s+/g, " ").trim();
			let rects = rectsFor(cs);
			let top = Math.max(...rects.map(r => r[3]));
			return { pageIndex: p, rects, text, top: pg.view[3] - top, offset: start, view: pg.view, partial: t !== q };
		}
	}
	return null;
}

async function pageText(id, pageIndex) {
	return (await chars(id, pageIndex)).raw;
}

window.PDFS = { open, has, info, findQuote, pageText, fold, ready: true };
