/* Hızlı Bakış görüntüleyicisi: Zotero okuyucusunun kendi pdf.js kopyasıyla bütün sayfaları
 * kaydırılabilir biçimde çizer. Sayfalar yalnızca görünür alana yaklaşınca çizilir, uzaklaşınca
 * tuvali bırakılır; yüzlerce sayfalık kitaplar da akıcı kalır. Dil haritaları (Arapça, Osmanlıca
 * ve CJK yazı tipleri için) ve standart yazı tipleri Zotero'nun kopyasından gelir. */

import * as pdfjs from "resource://zotero/reader/pdf/build/pdf.mjs";

const BASE = "resource://zotero/reader/pdf/";
pdfjs.GlobalWorkerOptions.workerSrc = BASE + "build/pdf.worker.mjs";

const $ = (id) => document.getElementById(id);
const MAX_LIVE = 14;

let doc = null;
let task = null;
let token = 0;
let seq = 0;
let observer = null;
let resizer = null;
let live = new Map();
let pagerTimer = 0;

const show = (id) => window.QL.show(id);
const message = (text) => window.QL.message(text);

async function reset() {
	token++;
	observer?.disconnect();
	observer = null;
	resizer?.disconnect();
	resizer = null;
	for (let c of live.values()) c.cancel?.();
	live.clear();
	$("pages").replaceChildren();
	let t = task;
	task = null;
	doc = null;
	if (t) {
		try {
			await t.destroy();
		}
		catch (e) {}
	}
}

/** PDF baytlarını açar, sayfa yer tutucularını kurar; sayfalar göründükçe çizilir. */
async function openPDF(data, { page = 0 } = {}) {
	// Sıra numarası beklemeden önce alınır: art arda açmalarda yalnızca sonuncusu sonuç yazar
	let mine = window.QL.nextSeq();
	await window.QL.reset();
	if (!window.QL.isCurrent(mine)) return;
	let my = token;
	message("Yükleniyor…");
	let t = task = pdfjs.getDocument({
		data,
		cMapUrl: BASE + "web/cmaps/",
		cMapPacked: true,
		standardFontDataUrl: BASE + "web/standard_fonts/",
		wasmUrl: BASE + "web/wasm/",
		iccUrl: BASE + "web/iccs/",
		isEvalSupported: false,
	});
	let d;
	try {
		d = await t.promise;
	}
	catch (e) {
		if (my === token) message(e?.name === "PasswordException" ? "Bu PDF parola korumalı." : "PDF açılamadı: " + (e?.message || e));
		return;
	}
	if (my !== token) {
		t.destroy().catch(() => {});
		return;
	}
	doc = d;
	let first = await doc.getPage(1);
	let base = first.getViewport({ scale: 1 });
	let pages = $("pages");
	let width = () => Math.min(900, $("scroll").clientWidth - 40);
	let n = doc.numPages;
	let els = [];
	for (let i = 1; i <= n; i++) {
		let el = document.createElement("div");
		el.className = "page";
		el.dataset.i = i;
		el.dataset.ratio = base.height / base.width;
		let num = document.createElement("div");
		num.className = "n";
		num.textContent = i;
		el.append(num);
		pages.append(el);
		els.push(el);
	}
	show("scroll");
	let layout = () => {
		let w = width();
		for (let el of els) {
			el.style.width = w + "px";
			el.style.height = Math.round(w * el.dataset.ratio) + "px";
		}
	};
	layout();
	resizer = new ResizeObserver(() => {
		if (my !== token) return;
		layout();
		// Genişlik değişince çizilmiş sayfalar yeniden çizilir
		for (let i of [...live.keys()]) drop(i);
		check();
	}).observe($("scroll"));

	observer = new IntersectionObserver((entries) => {
		for (let e of entries) {
			let i = +e.target.dataset.i;
			if (e.isIntersecting) render(i, e.target, my);
		}
		trim();
		pager();
	}, { root: $("scroll"), rootMargin: "120% 0px" });
	for (let el of els) observer.observe(el);
	$("scroll").onscroll = () => pager();
	if (page > 0 && els[page]) els[page].scrollIntoView({ block: "start" });

	function check() {
		for (let el of els) {
			let r = el.getBoundingClientRect();
			if (r.bottom > -innerHeight && r.top < innerHeight * 2) render(+el.dataset.i, el, my);
		}
	}
}

async function render(i, el, my) {
	if (live.has(i) || my !== token || !doc) return;
	let entry = { cancel: null, el };
	live.set(i, entry);
	try {
		let page = await doc.getPage(i);
		if (my !== token || !live.has(i)) return;
		let w = el.clientWidth;
		let v1 = page.getViewport({ scale: 1 });
		// Gerçek oran ilk sayfadan farklıysa yer tutucuyu düzelt
		let ratio = v1.height / v1.width;
		if (Math.abs(ratio - el.dataset.ratio) > 0.01) {
			el.dataset.ratio = ratio;
			el.style.height = Math.round(w * ratio) + "px";
		}
		let dpr = window.devicePixelRatio || 1;
		let vp = page.getViewport({ scale: (w / v1.width) * dpr });
		let canvas = document.createElement("canvas");
		canvas.width = Math.floor(vp.width);
		canvas.height = Math.floor(vp.height);
		let rt = page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport: vp, background: "#ffffff" });
		entry.cancel = () => rt.cancel();
		await rt.promise;
		if (my !== token || !live.has(i)) return;
		el.querySelector("canvas")?.remove();
		el.prepend(canvas);
		entry.canvas = canvas;
	}
	catch (e) {
		if (e?.name !== "RenderingCancelledException") console.error(e);
		live.delete(i);
	}
}

function drop(i) {
	let e = live.get(i);
	if (!e) return;
	e.cancel?.();
	e.canvas?.remove();
	if (e.canvas) e.canvas.width = e.canvas.height = 0;
	live.delete(i);
}

/** Görünür alandan en uzak sayfaların tuvallerini bırakır. */
function trim() {
	if (live.size <= MAX_LIVE) return;
	let mid = $("scroll").scrollTop + $("scroll").clientHeight / 2;
	let far = [...live.entries()]
		.map(([i, e]) => [i, Math.abs(e.el.offsetTop + e.el.offsetHeight / 2 - mid)])
		.sort((a, b) => b[1] - a[1]);
	for (let [i] of far.slice(0, live.size - MAX_LIVE)) drop(i);
}

function pager() {
	if (!doc) return;
	let sc = $("scroll");
	let mid = sc.scrollTop + sc.clientHeight / 3;
	let cur = 1;
	for (let el of $("pages").children) {
		if (el.offsetTop <= mid) cur = +el.dataset.i;
		else break;
	}
	let p = $("pager");
	p.textContent = `${cur} / ${doc.numPages}`;
	p.classList.remove("hidden");
	p.style.opacity = 1;
	clearTimeout(pagerTimer);
	pagerTimer = setTimeout(() => (p.style.opacity = 0), 1400);
	window.QL.page = cur;
}

// Temel görünüm (quicklook-view.js) PDF çiziciyi buradan alır
Object.assign(window.QL, { openPDF, pdfReset: reset, pdfReady: true });
