/* Vektör puanlama (anlamsal arama). Hem ana iş parçacığında (küçük dizin) hem de embedworker.js
 * içinde kullanılır; tek kaynak olsun diye ayrı dosyadadır.
 * vec: Int8Array (n × dims, 8 bitlik nicemlenmiş, normalleştirilmiş vektörler), scales: her girdinin ölçeği,
 * q: sorgu (Int8Array), qk: sorgunun ölçeği, mask: Uint8Array (0 = atla) ya da null.
 * → en yüksek `top` puan: { idx: Int32Array, score: Float32Array } (azalan sırada). */

// eslint-disable-next-line no-unused-vars
var HafifVec = {
	topScores(vec, dims, n, scales, q, qk, mask, top) {
		top = Math.min(top, n);
		let idx = new Int32Array(top).fill(-1);
		let sc = new Float32Array(top).fill(-Infinity);
		let filled = 0;
		let minPos = 0;
		for (let i = 0; i < n; i++) {
			if (mask && !mask[i]) continue;
			let s = 0;
			let o = i * dims;
			for (let k = 0; k < dims; k++) s += vec[o + k] * q[k];
			s *= scales[i] * qk;
			if (filled < top) {
				idx[filled] = i;
				sc[filled] = s;
				filled++;
				if (filled === top) minPos = this._min(sc);
			}
			else if (s > sc[minPos]) {
				idx[minPos] = i;
				sc[minPos] = s;
				minPos = this._min(sc);
			}
		}
		let order = Array.from({ length: filled }, (_, j) => j).sort((a, b) => sc[b] - sc[a]);
		return { idx: Int32Array.from(order, j => idx[j]), score: Float32Array.from(order, j => sc[j]) };
	},

	_min(sc) {
		let m = 0;
		for (let j = 1; j < sc.length; j++) if (sc[j] < sc[m]) m = j;
		return m;
	},
};
