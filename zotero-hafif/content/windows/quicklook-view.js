/* Hızlı Bakış temel görünümü: resim, web sayfası, not, künye kartı ve yedek PDF görünümü.
 * PDF'ler normalde quicklook.mjs'teki pdf.js çiziciyle açılır; o yüklenemezse sayfalar
 * Zotero'nun PDF işçisinden resim olarak gelir (openPages). */

(function () {
const $ = (id) => document.getElementById(id);
let gen = 0;
let seq = 0;
const nextSeq = () => ++seq;
const isCurrent = (n) => n === seq;
let observer = null;
let pagerTimer = 0;

function show(id) {
	for (let x of ["scroll", "img", "card", "frame", "msg"]) $(x).classList.toggle("hidden", x !== id);
	$("pager").classList.add("hidden");
}

function message(text) {
	$("msg").textContent = text;
	show("msg");
}

async function reset() {
	gen++;
	observer?.disconnect();
	observer = null;
	$("pages").replaceChildren();
	$("frame").removeAttribute("src");
	$("frame").removeAttribute("srcdoc");
	$("img").replaceChildren();
	$("card").replaceChildren();
	if (window.QL.pdfReset) await window.QL.pdfReset();
}

async function openImage(url) {
	let mine = nextSeq();
	await window.QL.reset();
	if (!isCurrent(mine)) return;
	let img = document.createElement("img");
	img.src = url;
	$("img").append(img);
	show("img");
}

async function openHTML({ url, html }) {
	let mine = nextSeq();
	await window.QL.reset();
	if (!isCurrent(mine)) return;
	let f = $("frame");
	// Betik çalışmaz: sandbox boş
	if (html != null) f.srcdoc = html;
	else f.src = url;
	show("frame");
}

/** Dosyası olmayan kayıt: künye ve özet. */
async function openCard({ title, meta, abstract, fields = [] }) {
	let mine = nextSeq();
	await window.QL.reset();
	if (!isCurrent(mine)) return;
	let c = $("card");
	let inn = document.createElement("div");
	inn.className = "in";
	let h = document.createElement("h1");
	h.textContent = title;
	h.dir = "auto";
	let m = document.createElement("div");
	m.className = "meta";
	m.textContent = meta || "";
	inn.append(h, m);
	if (abstract) {
		let a = document.createElement("div");
		a.className = "abs";
		a.dir = "auto";
		a.textContent = abstract;
		inn.append(a);
	}
	if (fields.length) {
		let dl = document.createElement("dl");
		for (let [k, v] of fields) {
			let dt = document.createElement("dt");
			dt.textContent = k;
			let dd = document.createElement("dd");
			dd.textContent = v;
			dd.dir = "auto";
			dl.append(dt, dd);
		}
		inn.append(dl);
	}
	c.append(inn);
	show("card");
}

document.addEventListener("keydown", (e) => {
	// Odak önizlemedeyken de boşluk ve esc kapatır
	if ((e.key === " " || e.key === "Escape") && !e.metaKey && !e.ctrlKey && !e.altKey) {
		e.preventDefault();
		window.QL.onClose?.();
	}
});


/** Yedek PDF görünümü: sayfa sayısı ve sayfa resmi veren bir yükleyiciyle. */
async function openPages(count, load, ratio = 1.414) {
	let mine = nextSeq();
	await window.QL.reset();
	if (!isCurrent(mine)) return;
	let my = gen;
	let pages = $("pages");
	let w = Math.min(900, $("scroll").clientWidth - 40);
	let els = [];
	for (let i = 0; i < count; i++) {
		let el = document.createElement("div");
		el.className = "page";
		el.dataset.i = i;
		el.style.width = w + "px";
		el.style.height = Math.round(w * ratio) + "px";
		let n = document.createElement("div");
		n.className = "n";
		n.textContent = i + 1;
		el.append(n);
		pages.append(el);
		els.push(el);
	}
	show("scroll");
	let busy = new Set();
	observer = new IntersectionObserver(async (entries) => {
		for (let e of entries) {
			let el = e.target;
			let i = +el.dataset.i;
			if (!e.isIntersecting || el.querySelector("img") || busy.has(i)) continue;
			busy.add(i);
			try {
				let url = await load(i);
				if (my !== gen) return;
				let img = document.createElement("img");
				img.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
				img.onload = () => {
					let r = img.naturalHeight / img.naturalWidth;
					if (r) el.style.height = Math.round(el.clientWidth * r) + "px";
				};
				img.src = url;
				el.prepend(img);
			}
			catch (err) {
				console.error(err);
			}
			busy.delete(i);
		}
	}, { root: $("scroll"), rootMargin: "100% 0px" });
	for (let el of els) observer.observe(el);
	$("scroll").onscroll = () => {
		let sc = $("scroll");
		let mid = sc.scrollTop + sc.clientHeight / 3;
		let cur = 1;
		for (let el of els) {
			if (el.offsetTop <= mid) cur = +el.dataset.i + 1;
			else break;
		}
		let p = $("pager");
		p.textContent = `${cur} / ${count}`;
		p.classList.remove("hidden");
		p.style.opacity = 1;
		clearTimeout(pagerTimer);
		pagerTimer = setTimeout(() => (p.style.opacity = 0), 1400);
		window.QL.page = cur;
	};
}

document.addEventListener("keydown", (e) => {
	// Odak önizlemedeyken de boşluk ve esc kapatır
	if ((e.key === " " || e.key === "Escape") && !e.metaKey && !e.ctrlKey && !e.altKey) {
		e.preventDefault();
		window.QL.onClose?.();
	}
});

window.QL = Object.assign(window.QL || {}, { nextSeq, isCurrent, show, message, reset, openImage, openHTML, openCard, openPages, page: 1, onClose: null, ready: true });
})();
