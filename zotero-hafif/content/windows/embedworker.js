/* Anlamsal arama işçisi: vektör dizini burada bellekte durur, puanlama arayüzü dondurmadan yapılır. */
/* global HafifVec, importScripts */
importScripts("chrome://hafif/content/windows/vecmath.js");

let store = null;

onmessage = (e) => {
	let m = e.data;
	if (m.type === "load") {
		store = { id: m.id, vec: new Int8Array(m.vec), scales: new Float32Array(m.scales), dims: m.dims, n: m.n };
		postMessage({ type: "loaded", id: m.id });
	}
	else if (m.type === "search") {
		if (!store || store.id !== m.id) {
			postMessage({ type: "result", req: m.req, error: "stale" });
			return;
		}
		let r = HafifVec.topScores(store.vec, store.dims, store.n, store.scales, new Int8Array(m.q), m.qk, m.mask ? new Uint8Array(m.mask) : null, m.top);
		postMessage({ type: "result", req: m.req, idx: r.idx.buffer, score: r.score.buffer }, [r.idx.buffer, r.score.buffer]);
	}
	else if (m.type === "clear") store = null;
};
