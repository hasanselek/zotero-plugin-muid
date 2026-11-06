import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const { Hafif } = load("search", "actions");
const A = Hafif.modules.actions;

test("prettyKey (Windows/Linux)", () => {
	assert.equal(A.prettyKey("accel+shift+K"), "Ctrl+Shift+K");
	assert.equal(A.prettyKey("accel+alt+ArrowLeft"), "Ctrl+Alt+←");
});

test("başlık düzeni: Türkçe bağlaçlar küçük kalır", () => {
	let t = A.titleCase("osmanlı hukukunda vakıf ve miras", "tr");
	assert.match(t, /^Osmanlı Hukukunda Vakıf ve Miras$/);
});
